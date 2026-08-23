use crate::plugin::types::{BinConfig, HostTarget, PluginManifest};

pub const NATIVE_EXECUTE_PERMISSION: &str = "native.execute";
pub const LONG_RUNNING_PERMISSION: &str = "process.long-running";
pub const WORKSPACE_READ_PERMISSION: &str = "workspace.read";
pub const WORKSPACE_WRITE_PERMISSION: &str = "workspace.write";

pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.id.is_empty() {
        return Err("id is required".into());
    }
    if !manifest.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("id must match [a-z0-9-]".into());
    }
    if manifest.name.is_empty() {
        return Err("name is required".into());
    }
    if manifest.version.is_empty() {
        return Err("version is required".into());
    }
    if let Some(category) = &manifest.category {
        if !is_known_category(category) {
            return Err(format!("unknown category '{category}'"));
        }
    }
    if let Some(targets) = &manifest.targets {
        for target in targets {
            if !is_known_host_target(target) {
                return Err(format!("unknown host target '{target}'"));
            }
        }
    }
    if let Some(bin) = &manifest.bin {
        if bin.mode != "cli" {
            return Err("bin.mode must be 'cli'".into());
        }
        if bin.entry.is_none() && bin.entries.is_empty() {
            return Err("bin.entry or bin.entries is required".into());
        }
        if let Some(lifecycle) = &bin.lifecycle {
            if lifecycle.shutdown_deadline_ms > lifecycle.force_kill_after_ms {
                return Err(
                    "bin.lifecycle.shutdownDeadlineMs must not exceed forceKillAfterMs".into()
                );
            }
            if lifecycle.shutdown_deadline_ms > 30_000 {
                return Err("bin.lifecycle.shutdownDeadlineMs must not exceed 30000".into());
            }
            if lifecycle.force_kill_after_ms > 60_000 {
                return Err("bin.lifecycle.forceKillAfterMs must not exceed 60000".into());
            }
        }

        let permissions = manifest.permissions.as_deref().unwrap_or_default();
        let uses_native_runtime = !bin.entries.is_empty() || bin.lifecycle.is_some();
        if uses_native_runtime && !permissions.iter().any(|p| p == NATIVE_EXECUTE_PERMISSION) {
            return Err(format!(
                "native plugin features require permission '{NATIVE_EXECUTE_PERMISSION}'"
            ));
        }
        if bin.lifecycle.is_some() && !permissions.iter().any(|p| p == LONG_RUNNING_PERMISSION) {
            return Err(format!(
                "managed process lifecycle requires permission '{LONG_RUNNING_PERMISSION}'"
            ));
        }
    }

    if let Some(permissions) = &manifest.permissions {
        for permission in permissions {
            if (permission.starts_with("native.") || permission.starts_with("process."))
                && permission != NATIVE_EXECUTE_PERMISSION
                && permission != LONG_RUNNING_PERMISSION
            {
                return Err(format!("unknown native permission '{permission}'"));
            }
            if permission.starts_with("workspace.")
                && permission != WORKSPACE_READ_PERMISSION
                && permission != WORKSPACE_WRITE_PERMISSION
            {
                return Err(format!("unknown workspace permission '{permission}'"));
            }
        }
    }
    Ok(())
}

/// Categories recognised by the plugin UI. Keep in sync with frontend category list.
#[must_use]
pub fn is_known_category(category: &str) -> bool {
    matches!(category, "system" | "dev" | "ai" | "files" | "network" | "other")
}

#[must_use]
pub fn is_known_host_target(target: &str) -> bool {
    matches!(
        target,
        "windows-x86_64" | "linux-x86_64" | "linux-aarch64" | "macos-x86_64" | "macos-aarch64"
    )
}

/// Returns true if the plugin's declared `targets` cover the current host.
/// `None` means "all platforms supported".
#[must_use]
pub fn is_compatible(manifest_targets: Option<&[String]>, host: Option<HostTarget>) -> bool {
    let Some(host) = host else {
        // Unknown host: don't claim compatibility, but don't block either.
        return true;
    };
    match manifest_targets {
        None => true,
        Some(targets) => targets.iter().any(|t| t == host.as_str()),
    }
}

#[must_use]
pub fn required_native_permissions(manifest: &PluginManifest) -> Vec<&str> {
    let Some(bin) = &manifest.bin else {
        return Vec::new();
    };
    if bin.entries.is_empty() && bin.lifecycle.is_none() {
        return Vec::new();
    }

    let mut permissions = vec![NATIVE_EXECUTE_PERMISSION];
    if bin.lifecycle.is_some() {
        permissions.push(LONG_RUNNING_PERMISSION);
    }
    permissions
}

pub fn require_native_approval(manifest: &PluginManifest, approved: bool) -> Result<(), String> {
    let permissions = required_native_permissions(manifest);
    if permissions.is_empty() || approved {
        return Ok(());
    }
    Err(format!("native permissions require approval: {}", permissions.join(", ")))
}

pub fn validate_min_app_version(
    manifest: &PluginManifest,
    host_version: &str,
) -> Result<(), String> {
    if let Some(required) = manifest.min_app_version.as_deref() {
        let required_version = semver::Version::parse(required.trim_start_matches('v'))
            .map_err(|e| format!("invalid minAppVersion '{required}': {e}"))?;
        let host_version_value = semver::Version::parse(host_version.trim_start_matches('v'))
            .map_err(|e| format!("invalid Dinotty host version '{host_version}': {e}"))?;
        if required_version > host_version_value {
            return Err(format!(
                "plugin requires Dinotty {required} or newer (current: {host_version})"
            ));
        }
    }
    Ok(())
}

pub fn selected_binary_entry(bin: &BinConfig, target: HostTarget) -> Result<&str, String> {
    bin.entries
        .get(target.as_str())
        .map(String::as_str)
        .or(bin.entry.as_deref())
        .ok_or_else(|| format!("plugin has no binary for host target {}", target.as_str()))
}

pub fn resolve_binary(
    plugin_root: &std::path::Path,
    bin: &BinConfig,
    target: HostTarget,
) -> Result<std::path::PathBuf, String> {
    use std::path::Component;

    let entry = selected_binary_entry(bin, target)?;
    let entry_path = std::path::Path::new(entry);
    if entry_path.is_absolute()
        || entry_path.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err("binary entry must be a relative path inside the plugin directory".into());
    }

    let canonical_root = std::fs::canonicalize(plugin_root)
        .map_err(|e| format!("failed to resolve plugin directory: {e}"))?;
    let canonical_binary = std::fs::canonicalize(plugin_root.join(entry_path))
        .map_err(|e| format!("failed to resolve plugin binary '{entry}': {e}"))?;
    if !canonical_binary.starts_with(&canonical_root) {
        return Err("binary entry resolves outside the plugin directory".into());
    }
    let metadata = std::fs::metadata(&canonical_binary)
        .map_err(|e| format!("failed to inspect plugin binary: {e}"))?;
    if !metadata.is_file() {
        return Err("binary entry is not a regular file".into());
    }
    Ok(canonical_binary)
}

pub fn set_executable(path: &std::path::Path) -> Result<(), String> {
    crate::platform::fs::set_executable(path)
}

#[cfg(test)]
mod tests {
    use super::{
        is_compatible, require_native_approval, resolve_binary, validate_manifest,
        validate_min_app_version, LONG_RUNNING_PERMISSION, NATIVE_EXECUTE_PERMISSION,
        WORKSPACE_READ_PERMISSION, WORKSPACE_WRITE_PERMISSION,
    };
    use crate::plugin::{
        BinConfig, HostTarget, PluginManifest, ProcessLifecycleConfig, ProcessLifecycleScope,
    };
    use std::collections::HashMap;

    fn manifest(min_app_version: Option<&str>) -> PluginManifest {
        PluginManifest {
            id: "test-plugin".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            min_app_version: min_app_version.map(str::to_string),
            description: None,
            icon: None,
            entry: None,
            bin: None,
            commands: None,
            styles: None,
            permissions: None,
            category: None,
            targets: None,
            show_in_toolbar: None,
            events: None,
            keyboard_api_version: None,
        }
    }

    fn minimal_manifest() -> PluginManifest {
        PluginManifest {
            id: "demo".into(),
            name: "Demo".into(),
            version: "0.1.0".into(),
            min_app_version: None,
            description: None,
            icon: None,
            entry: None,
            bin: None,
            commands: None,
            styles: None,
            permissions: None,
            category: None,
            targets: None,
            show_in_toolbar: None,
            events: None,
            keyboard_api_version: None,
        }
    }

    #[test]
    fn min_app_version_uses_semver_ordering() {
        assert!(validate_min_app_version(&manifest(Some("0.17.2")), "0.17.2").is_ok());
        assert!(validate_min_app_version(&manifest(Some("0.18.0")), "0.17.2").is_err());
        assert!(validate_min_app_version(&manifest(Some("not-semver")), "0.17.2").is_err());
    }

    #[test]
    fn lifecycle_deadlines_are_bounded_and_ordered() {
        let mut manifest = manifest(None);
        manifest.bin = Some(BinConfig {
            mode: "cli".into(),
            entry: Some("bin/tool".into()),
            entries: HashMap::new(),
            lifecycle: Some(ProcessLifecycleConfig {
                scope: ProcessLifecycleScope::Host,
                stdin_lease: true,
                shutdown_deadline_ms: 10_000,
                force_kill_after_ms: 15_000,
            }),
        });
        assert!(validate_manifest(&manifest).unwrap_err().contains(NATIVE_EXECUTE_PERMISSION));
        manifest.permissions =
            Some(vec![NATIVE_EXECUTE_PERMISSION.into(), LONG_RUNNING_PERMISSION.into()]);
        assert!(validate_manifest(&manifest).is_ok());
        assert!(require_native_approval(&manifest, false).is_err());
        assert!(require_native_approval(&manifest, true).is_ok());

        manifest.bin.as_mut().unwrap().lifecycle.as_mut().unwrap().shutdown_deadline_ms = 20_000;
        manifest.bin.as_mut().unwrap().lifecycle.as_mut().unwrap().force_kill_after_ms = 10_000;
        assert!(validate_manifest(&manifest).is_err());

        manifest.bin.as_mut().unwrap().lifecycle.as_mut().unwrap().shutdown_deadline_ms = 30_000;
        manifest.bin.as_mut().unwrap().lifecycle.as_mut().unwrap().force_kill_after_ms = 60_001;
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn workspace_permissions_validate_against_allowlist() {
        let mut m = manifest(None);
        m.permissions =
            Some(vec![WORKSPACE_READ_PERMISSION.into(), WORKSPACE_WRITE_PERMISSION.into()]);
        assert!(validate_manifest(&m).is_ok());

        m.permissions = Some(vec!["workspace.unknown".into()]);
        assert!(validate_manifest(&m).unwrap_err().contains("unknown workspace permission"));
    }

    #[test]
    fn resolver_prefers_target_entry_and_rejects_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let selected = tmp.path().join("bin").join("selected.exe");
        std::fs::create_dir_all(selected.parent().unwrap()).unwrap();
        std::fs::write(&selected, b"binary").unwrap();
        std::fs::write(tmp.path().join("legacy.exe"), b"legacy").unwrap();
        let mut entries = HashMap::new();
        entries.insert("windows-x86_64".into(), "bin/selected.exe".into());
        let bin = BinConfig {
            mode: "cli".into(),
            entry: Some("legacy.exe".into()),
            entries,
            lifecycle: None,
        };
        assert_eq!(
            resolve_binary(tmp.path(), &bin, HostTarget::WindowsX86_64).unwrap(),
            std::fs::canonicalize(selected).unwrap()
        );

        let escaping = BinConfig {
            mode: "cli".into(),
            entry: Some("../outside".into()),
            entries: HashMap::new(),
            lifecycle: None,
        };
        assert!(resolve_binary(tmp.path(), &escaping, HostTarget::WindowsX86_64).is_err());
    }

    #[test]
    fn validate_accepts_known_category() {
        let mut manifest = minimal_manifest();
        manifest.category = Some("dev".into());
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn validate_rejects_unknown_category() {
        let mut manifest = minimal_manifest();
        manifest.category = Some("games".into());
        let err = validate_manifest(&manifest).unwrap_err();
        assert!(err.contains("unknown category"));
    }

    #[test]
    fn validate_accepts_known_targets() {
        let mut manifest = minimal_manifest();
        manifest.targets = Some(vec!["macos-aarch64".into(), "linux-x86_64".into()]);
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn validate_rejects_unknown_target() {
        let mut manifest = minimal_manifest();
        manifest.targets = Some(vec!["macos-aarch64".into(), "windows-arm".into()]);
        let err = validate_manifest(&manifest).unwrap_err();
        assert!(err.contains("unknown host target"));
    }

    #[test]
    fn is_compatible_none_targets_is_universal() {
        assert!(is_compatible(None, HostTarget::current()));
    }

    #[test]
    fn is_compatible_matching_target() {
        let targets = vec!["macos-aarch64".to_string()];
        assert!(is_compatible(Some(&targets), Some(HostTarget::MacosAarch64)));
    }

    #[test]
    fn is_compatible_mismatching_target() {
        let targets = vec!["linux-x86_64".to_string()];
        assert!(!is_compatible(Some(&targets), Some(HostTarget::MacosAarch64)));
    }

    #[test]
    fn is_compatible_unknown_host_is_permissive() {
        let targets = vec!["linux-x86_64".to_string()];
        assert!(is_compatible(Some(&targets), None));
    }
}

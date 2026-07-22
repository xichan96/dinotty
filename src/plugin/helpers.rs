use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use super::types::{BinConfig, HostTarget, PluginManifest};

pub const NATIVE_EXECUTE_PERMISSION: &str = "native.execute";
pub const LONG_RUNNING_PERMISSION: &str = "process.long-running";

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
        }
    }
    Ok(())
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

pub fn extract_tar_gz(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(decoder);
    archive.set_overwrite(false);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let raw_name = path.to_string_lossy();
        validate_archive_path(&raw_name, &path, dest)?;
    }

    let decoder2 = GzDecoder::new(Cursor::new(data));
    let mut archive2 = tar::Archive::new(decoder2);
    archive2.unpack(dest).map_err(|e| e.to_string())
}

pub fn copy_plugin_dir(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_symlink() {
            return Err(format!(
                "symbolic links are not allowed in folder installs: {}",
                src_path.display()
            ));
        }
        if file_type.is_dir() {
            if is_development_cache(&src_path, &entry.file_name()) {
                continue;
            }
            copy_plugin_dir(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "special files are not allowed in folder installs: {}",
                src_path.display()
            ));
        }
    }
    Ok(())
}

fn is_development_cache(path: &std::path::Path, name: &std::ffi::OsStr) -> bool {
    if name == ".git" {
        return true;
    }
    name == "target"
        && (path.join("CACHEDIR.TAG").is_file() || path.join(".rustc_info.json").is_file())
}

pub fn plugin_err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

pub fn native_approval_response(error: &str) -> Option<Response> {
    let permissions = error.strip_prefix("native permissions require approval: ")?;
    let permissions: Vec<_> = permissions.split(", ").collect();
    Some(
        (
            StatusCode::PRECONDITION_REQUIRED,
            Json(serde_json::json!({
                "error": "native permissions require approval",
                "permissions": permissions,
            })),
        )
            .into_response(),
    )
}

pub fn is_safe_segment(s: &str) -> bool {
    !s.is_empty() && !s.contains('/') && !s.contains('\\') && s != ".." && s != "."
}

pub fn extract_zip(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use std::io::Cursor;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| format!("zip read error: {e}"))?;
        let raw_name = file.name().to_string();
        validate_archive_path(&raw_name, std::path::Path::new(&raw_name), dest)?;
    }

    let mut archive2 =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;
    archive2.extract(dest).map_err(|e| format!("zip extract error: {e}"))
}

fn validate_archive_path(
    raw_name: &str,
    path: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    use std::path::Component;

    if raw_name.trim().is_empty() {
        return Err("archive contains empty path".into());
    }
    if raw_name.starts_with('/') || raw_name.starts_with('\\') {
        return Err("archive contains absolute path".into());
    }
    if has_windows_drive_prefix(raw_name) {
        return Err("archive contains Windows drive path".into());
    }
    if raw_name.contains('\\') {
        return Err("archive contains Windows-style path separator".into());
    }
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err("archive contains path traversal or absolute path".into());
    }

    let outpath = dest.join(path);
    if !outpath.starts_with(dest) {
        return Err("archive entry escapes destination".into());
    }

    Ok(())
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub fn find_plugin_root(
    base: &std::path::Path,
    subdir: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let top_level = std::fs::read_dir(base)
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .find(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path());

    let root = match (&top_level, subdir) {
        (Some(top), Some(sub)) => top.join(sub),
        (Some(top), None) => top.clone(),
        (None, Some(sub)) => base.join(sub),
        (None, None) => base.to_path_buf(),
    };

    if root.join("plugin.json").exists() {
        Ok(root)
    } else {
        Err("plugin.json not found in downloaded archive".into())
    }
}

pub fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.trim_start_matches('v').split('.').filter_map(|p| p.parse().ok()).collect()
    };
    parse(a) > parse(b)
}

#[cfg(test)]
mod tests {
    use super::{
        copy_plugin_dir, extract_tar_gz, extract_zip, require_native_approval, resolve_binary,
        validate_manifest, validate_min_app_version, LONG_RUNNING_PERMISSION,
        NATIVE_EXECUTE_PERMISSION,
    };
    use crate::plugin::{
        BinConfig, HostTarget, PluginManifest, ProcessLifecycleConfig, ProcessLifecycleScope,
    };
    use std::collections::HashMap;
    use std::io::{Cursor, Write};

    fn tar_gz_with_entry(name: &str, content: &[u8]) -> Vec<u8> {
        fn write_octal(field: &mut [u8], value: u64) {
            let encoded = format!("{value:0width$o}\0", width = field.len() - 1);
            field.copy_from_slice(encoded.as_bytes());
        }

        let mut tar = Vec::new();
        let mut header = [0_u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        write_octal(&mut header[100..108], 0o644);
        write_octal(&mut header[108..116], 0);
        write_octal(&mut header[116..124], 0);
        write_octal(&mut header[124..136], content.len() as u64);
        write_octal(&mut header[136..148], 0);
        header[148..156].fill(b' ');
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let checksum: u32 = header.iter().map(|&byte| u32::from(byte)).sum();
        let checksum = format!("{checksum:06o}\0 ");
        header[148..156].copy_from_slice(checksum.as_bytes());

        tar.extend_from_slice(&header);
        tar.extend_from_slice(content);
        let padding = (512 - (content.len() % 512)) % 512;
        tar.extend(std::iter::repeat_n(0, padding));
        tar.extend_from_slice(&[0_u8; 1024]);

        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&tar).unwrap();
        encoder.finish().unwrap()
    }

    fn zip_with_entry(name: &str, content: &[u8]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        writer.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn zip_with_directory_and_file(dir: &str, file: &str, content: &[u8]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        writer.add_directory(dir, zip::write::SimpleFileOptions::default()).unwrap();
        writer.start_file(file, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

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
        }
    }

    fn assert_rejects_without_writes(
        entry_name: &str,
        archive: Vec<u8>,
        extract: fn(&[u8], &std::path::Path) -> Result<(), String>,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let err = extract(&archive, &dest).unwrap_err();

        assert!(err.contains("archive contains"), "unexpected error: {err}");
        assert!(std::fs::read_dir(&dest).unwrap().next().is_none());
        assert!(!tmp.path().join("evil").exists(), "entry {entry_name} wrote outside dest");
    }

    // 验证 tar.gz 会拒绝路径穿越、绝对路径和 Windows drive path。
    #[test]
    fn extract_tar_gz_rejects_unsafe_archive_paths() {
        for name in ["../evil", "/absolute", r"..\evil", r"C:\evil", "C:/evil"] {
            assert_rejects_without_writes(name, tar_gz_with_entry(name, b"bad"), extract_tar_gz);
        }
    }

    // 验证 zip 会拒绝路径穿越、绝对路径和 Windows drive path。
    #[test]
    fn extract_zip_rejects_unsafe_archive_paths() {
        for name in ["../evil", "/absolute", r"..\evil", r"C:\evil", "C:/evil"] {
            assert_rejects_without_writes(name, zip_with_entry(name, b"bad"), extract_zip);
        }
    }

    // 验证 tar.gz 中正常嵌套相对路径可以解压。
    #[test]
    fn extract_tar_gz_allows_nested_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_tar_gz(&tar_gz_with_entry("safe/nested.txt", b"ok"), &dest).unwrap();

        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
    }

    // 验证 zip 中正常嵌套相对路径可以解压。
    #[test]
    fn extract_zip_allows_nested_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_zip(&zip_with_entry("safe/nested.txt", b"ok"), &dest).unwrap();

        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
    }

    // 验证 zip 中目录项和文件项混合时安全路径仍可解压。
    #[test]
    fn extract_zip_allows_safe_directory_and_file_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_zip(&zip_with_directory_and_file("safe/", "safe/nested.txt", b"ok"), &dest)
            .unwrap();

        assert!(dest.join("safe").is_dir());
        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
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
    fn plugin_copy_keeps_runtime_files_and_skips_development_caches() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("source");
        let dest = tmp.path().join("destination");

        std::fs::create_dir_all(src.join("bin/windows-x86_64")).unwrap();
        std::fs::create_dir_all(src.join(".git/objects")).unwrap();
        std::fs::create_dir_all(src.join("node_modules/package")).unwrap();
        std::fs::create_dir_all(src.join("native/target/release")).unwrap();
        std::fs::create_dir_all(src.join("assets/target")).unwrap();
        std::fs::write(src.join("plugin.json"), b"{}").unwrap();
        std::fs::write(src.join("bin/windows-x86_64/plugin.exe"), b"binary").unwrap();
        std::fs::write(src.join(".git/objects/cache"), b"git cache").unwrap();
        std::fs::write(src.join("node_modules/package/index.js"), b"dependency cache").unwrap();
        std::fs::write(src.join("native/target/CACHEDIR.TAG"), b"cargo cache").unwrap();
        std::fs::write(src.join("native/target/release/plugin.exe"), b"build cache").unwrap();
        std::fs::write(src.join("assets/target/runtime.txt"), b"runtime asset").unwrap();

        copy_plugin_dir(&src, &dest).unwrap();

        assert_eq!(std::fs::read(dest.join("plugin.json")).unwrap(), b"{}");
        assert_eq!(std::fs::read(dest.join("bin/windows-x86_64/plugin.exe")).unwrap(), b"binary");
        assert_eq!(
            std::fs::read(dest.join("assets/target/runtime.txt")).unwrap(),
            b"runtime asset"
        );
        assert!(!dest.join(".git").exists());
        assert_eq!(
            std::fs::read(dest.join("node_modules/package/index.js")).unwrap(),
            b"dependency cache"
        );
        assert!(!dest.join("native/target").exists());
    }

    #[cfg(unix)]
    #[test]
    fn plugin_copy_rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("source");
        let dest = tmp.path().join("destination");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("real.txt"), b"content").unwrap();
        symlink(src.join("real.txt"), src.join("linked.txt")).unwrap();

        let error = copy_plugin_dir(&src, &dest).unwrap_err();
        assert!(error.contains("symbolic links are not allowed"));
    }
}

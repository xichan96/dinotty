use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

use crate::tray::state::{TrayCapability, TrayCapabilityState};

const BACKGROUND_ARG: &str = "--background";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum AutostartPackageKind {
    WindowsDesktop,
    MacosInstalledApp,
    LinuxDeb,
    LinuxAppImage,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutostartState {
    Off,
    OnCurrent,
    OnDifferentPath,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum AutostartSupportReason {
    UnsupportedPlatform,
    UnsupportedPackage,
    UnstableInstallLocation,
    ExecutablePathUnavailable,
    HomeDirectoryUnavailable,
    TrayUnavailable,
    RuntimeEvidenceInvalid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutostartStateError {
    RegistrationMalformed,
    RegistrationUnreadable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutostartOperationError {
    NotAllowed,
    WriteFailed,
    DeleteFailed,
    VerificationFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum AutostartWarning {
    PathMoveBreaksRegistration,
    RemovableVolumeMayBeUnavailable,
    DesktopEnvironmentDependent,
    SystemMaySuppress,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    pub package_kind: AutostartPackageKind,
    pub can_enable: bool,
    pub can_disable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support_reason: Option<AutostartSupportReason>,
    pub state: AutostartState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_error: Option<AutostartStateError>,
    pub warnings: Vec<AutostartWarning>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAutostartResult {
    pub status: AutostartStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_error: Option<AutostartOperationError>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AutostartTarget {
    package_kind: AutostartPackageKind,
    executable: PathBuf,
}

#[derive(Debug)]
enum NativeRegistration {
    Missing,
    Managed(PathBuf),
    Malformed,
}

trait AutostartBackend {
    fn read(&self) -> Result<NativeRegistration, String>;
    fn enable(&self, target: &AutostartTarget) -> Result<(), String>;
    fn disable(&self) -> Result<(), String>;
}

#[derive(Debug)]
struct Capability {
    package_kind: AutostartPackageKind,
    candidate: Option<AutostartTarget>,
    target_eligible: bool,
    support_reason: Option<AutostartSupportReason>,
    warnings: Vec<AutostartWarning>,
}

impl Capability {
    #[allow(dead_code)]
    fn unsupported(reason: AutostartSupportReason) -> Self {
        Self {
            package_kind: AutostartPackageKind::Unknown,
            candidate: None,
            target_eligible: false,
            support_reason: Some(reason),
            warnings: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct AutostartController(Mutex<()>);

fn tray_available(capability: &TrayCapability) -> bool {
    capability.is_available()
}

fn status_with_tray(tray_is_available: bool) -> AutostartStatus {
    let capability = platform::capability(Some(tray_is_available));
    status_from_capability(capability)
}

fn status_from_capability(capability: Capability) -> AutostartStatus {
    let registration = match platform::backend().and_then(|backend| backend.read()) {
        Ok(registration) => registration,
        Err(error) => {
            tracing::warn!(%error, "autostart registration could not be read");
            return AutostartStatus {
                package_kind: capability.package_kind,
                can_enable: false,
                can_disable: false,
                support_reason: capability.support_reason,
                state: AutostartState::Error,
                state_error: Some(AutostartStateError::RegistrationUnreadable),
                warnings: capability.warnings,
            };
        }
    };

    status_from_registration(capability, registration)
}

fn status_from_registration(
    mut capability: Capability,
    registration: NativeRegistration,
) -> AutostartStatus {
    let (state, can_disable, state_error) = match registration {
        NativeRegistration::Missing => (AutostartState::Off, false, None),
        NativeRegistration::Managed(path) => {
            let is_current = capability
                .candidate
                .as_ref()
                .is_some_and(|candidate| platform::targets_equal(candidate, &path));
            if capability.package_kind == AutostartPackageKind::WindowsDesktop {
                capability.warnings.push(AutostartWarning::SystemMaySuppress);
            }
            (
                if is_current {
                    AutostartState::OnCurrent
                } else {
                    AutostartState::OnDifferentPath
                },
                true,
                None,
            )
        }
        NativeRegistration::Malformed => {
            (AutostartState::Error, false, Some(AutostartStateError::RegistrationMalformed))
        }
    };

    capability.warnings.sort_by_key(|warning| *warning as u8);
    capability.warnings.dedup();
    AutostartStatus {
        package_kind: capability.package_kind,
        can_enable: capability.target_eligible && state != AutostartState::Error,
        can_disable,
        support_reason: capability.support_reason,
        state,
        state_error,
        warnings: capability.warnings,
    }
}

#[tauri::command]
pub fn autostart_status(tray: State<'_, TrayCapabilityState>) -> AutostartStatus {
    status_with_tray(tray_available(&tray.get()))
}

#[tauri::command]
pub fn set_autostart(
    enabled: bool,
    tray: State<'_, TrayCapabilityState>,
    controller: State<'_, AutostartController>,
) -> SetAutostartResult {
    let _guard = controller.0.lock().unwrap_or_else(|error| error.into_inner());
    let tray_is_available = tray_available(&tray.get());
    let capability = platform::capability(Some(tray_is_available));
    let before = status_from_capability(capability);
    let allowed = if enabled { before.can_enable } else { before.can_disable };
    if !allowed {
        return SetAutostartResult {
            status: before,
            operation_error: Some(AutostartOperationError::NotAllowed),
        };
    }

    // Re-evaluate immediately before writing so a moved executable or changed runtime
    // environment cannot use a stale settings-page snapshot.
    let capability = platform::capability(Some(tray_is_available));
    if enabled && !capability.target_eligible {
        return SetAutostartResult {
            status: status_from_capability(capability),
            operation_error: Some(AutostartOperationError::NotAllowed),
        };
    }
    let operation = match platform::backend() {
        Ok(backend) if enabled => capability
            .candidate
            .as_ref()
            .ok_or_else(|| "autostart target is unavailable".to_string())
            .and_then(|target| backend.enable(target)),
        Ok(backend) => backend.disable(),
        Err(error) => Err(error),
    };

    let after = status_with_tray(tray_is_available);
    if after.state_error == Some(AutostartStateError::RegistrationUnreadable) {
        return SetAutostartResult {
            status: after,
            operation_error: Some(AutostartOperationError::VerificationFailed),
        };
    }

    let operation_error = match operation {
        Err(error) => {
            tracing::warn!(enabled, %error, "autostart operation failed");
            Some(if enabled {
                AutostartOperationError::WriteFailed
            } else {
                AutostartOperationError::DeleteFailed
            })
        }
        Ok(())
            if (enabled && after.state != AutostartState::OnCurrent)
                || (!enabled && after.state != AutostartState::Off) =>
        {
            Some(AutostartOperationError::VerificationFailed)
        }
        Ok(()) => None,
    };

    SetAutostartResult { status: after, operation_error }
}

/// Background launch validation intentionally ignores tray state because the tray has
/// not been installed yet; setup exits if that installation subsequently fails.
pub fn background_package_supported() -> bool {
    platform::capability(None).target_eligible
}

fn valid_text_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .to_str()
            .is_some_and(|value| !value.is_empty() && !value.contains(['\0', '\n', '\r']))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_atomic(
    path: &Path,
    contents: &[u8],
    validate: impl Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "registration path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = parent.join(format!(".dinotty-autostart-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        std::fs::write(&temp, contents).map_err(|error| error.to_string())?;
        validate(&temp)?;
        std::fs::rename(&temp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(any(target_os = "linux", test))]
fn encode_desktop_exec(path: &Path) -> Result<String, String> {
    if !valid_text_path(path) {
        return Err("executable path cannot be represented in a desktop entry".into());
    }
    let mut exec = String::from("\"");
    for character in path.to_str().expect("validated UTF-8 path").chars() {
        match character {
            '"' | '\\' | '`' | '$' => {
                exec.push('\\');
                exec.push(character);
            }
            '%' => exec.push_str("%%"),
            _ => exec.push(character),
        }
    }
    exec.push_str("\" ");
    exec.push_str(BACKGROUND_ARG);

    let mut value = String::with_capacity(exec.len());
    for character in exec.chars() {
        match character {
            '\\' => value.push_str("\\\\"),
            _ => value.push(character),
        }
    }
    Ok(value)
}

#[cfg(any(target_os = "linux", test))]
fn decode_desktop_value(value: &str) -> Result<String, String> {
    let mut decoded = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        match chars.next() {
            Some('\\') => decoded.push('\\'),
            Some('s') => decoded.push(' '),
            Some('n') => decoded.push('\n'),
            Some('t') => decoded.push('\t'),
            Some('r') => decoded.push('\r'),
            _ => return Err("invalid desktop entry escape".into()),
        }
    }
    Ok(decoded)
}

#[cfg(any(target_os = "linux", test))]
fn decode_desktop_exec(value: &str) -> Result<PathBuf, String> {
    let value = decode_desktop_value(value)?;
    let suffix = format!("\" {BACKGROUND_ARG}");
    if !value.starts_with('"') || !value.ends_with(&suffix) {
        return Err("desktop Exec must contain one quoted path and --background".into());
    }
    let encoded = &value[1..value.len() - suffix.len()];
    let mut path = String::with_capacity(encoded.len());
    let mut chars = encoded.chars();
    while let Some(character) = chars.next() {
        match character {
            '\\' => match chars.next() {
                Some(next @ ('"' | '\\' | '`' | '$')) => path.push(next),
                _ => return Err("invalid desktop Exec quoting".into()),
            },
            '%' => match chars.next() {
                Some('%') => path.push('%'),
                _ => return Err("desktop Exec contains a field code".into()),
            },
            _ => path.push(character),
        }
    }
    let path = PathBuf::from(path);
    if valid_text_path(&path) {
        Ok(path)
    } else {
        Err("desktop Exec path is invalid".into())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Prefix};
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows_sys::Win32::System::WindowsProgramming::{
        DRIVE_CDROM, DRIVE_FIXED, DRIVE_NO_ROOT_DIR, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
        DRIVE_UNKNOWN,
    };
    use winreg::enums::{HKEY_CURRENT_USER, REG_SZ};
    use winreg::RegKey;

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_VALUE: &str = "Dinotty";
    const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Dinotty";

    pub(super) struct WindowsBackend;

    impl AutostartBackend for WindowsBackend {
        fn read(&self) -> Result<NativeRegistration, String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = match current_user.open_subkey(RUN_KEY) {
                Ok(key) => key,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Ok(NativeRegistration::Missing)
                }
                Err(error) => return Err(error.to_string()),
            };
            let raw = match key.get_raw_value(RUN_VALUE) {
                Ok(raw) => raw,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Ok(NativeRegistration::Missing)
                }
                Err(error) => return Err(error.to_string()),
            };
            if raw.vtype != REG_SZ {
                return Ok(NativeRegistration::Malformed);
            }
            let Some(command) = decode_reg_sz(&raw.bytes) else {
                return Ok(NativeRegistration::Malformed);
            };
            Ok(match parse_windows_command(&command) {
                Ok(path) => NativeRegistration::Managed(path),
                Err(_) => NativeRegistration::Malformed,
            })
        }

        fn enable(&self, target: &AutostartTarget) -> Result<(), String> {
            if target.package_kind != AutostartPackageKind::WindowsDesktop {
                return Err("target package does not belong to the Windows backend".into());
            }
            let command = format_windows_command(&target.executable)?;
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) =
                current_user.create_subkey(RUN_KEY).map_err(|error| error.to_string())?;
            key.set_value(RUN_VALUE, &command).map_err(|error| error.to_string())
        }

        fn disable(&self) -> Result<(), String> {
            let current_user = RegKey::predef(HKEY_CURRENT_USER);
            let key = current_user
                .open_subkey_with_flags(RUN_KEY, winreg::enums::KEY_SET_VALUE)
                .map_err(|error| error.to_string())?;
            key.delete_value(RUN_VALUE).map_err(|error| error.to_string())
        }
    }

    pub(super) fn backend() -> Result<Box<dyn AutostartBackend>, String> {
        Ok(Box::new(WindowsBackend))
    }

    pub(super) fn capability(_tray_available: Option<bool>) -> Capability {
        let executable = match std::env::current_exe() {
            Ok(path) if valid_text_path(&path) && path.is_file() => path,
            _ => {
                return Capability {
                    package_kind: AutostartPackageKind::WindowsDesktop,
                    candidate: None,
                    target_eligible: false,
                    support_reason: Some(AutostartSupportReason::ExecutablePathUnavailable),
                    warnings: vec![AutostartWarning::PathMoveBreaksRegistration],
                }
            }
        };
        let candidate = AutostartTarget {
            package_kind: AutostartPackageKind::WindowsDesktop,
            executable: executable.clone(),
        };
        let mut warnings = Vec::new();
        if !is_nsis_install(&executable) {
            warnings.push(AutostartWarning::PathMoveBreaksRegistration);
        }
        match drive_type(&executable) {
            Some(DRIVE_FIXED) => Capability {
                package_kind: AutostartPackageKind::WindowsDesktop,
                candidate: Some(candidate),
                target_eligible: true,
                support_reason: None,
                warnings,
            },
            Some(DRIVE_REMOVABLE) => {
                warnings.push(AutostartWarning::RemovableVolumeMayBeUnavailable);
                Capability {
                    package_kind: AutostartPackageKind::WindowsDesktop,
                    candidate: Some(candidate),
                    target_eligible: true,
                    support_reason: None,
                    warnings,
                }
            }
            Some(
                DRIVE_REMOTE | DRIVE_CDROM | DRIVE_RAMDISK | DRIVE_UNKNOWN | DRIVE_NO_ROOT_DIR,
            )
            | None => Capability {
                package_kind: AutostartPackageKind::WindowsDesktop,
                candidate: Some(candidate),
                target_eligible: false,
                support_reason: Some(AutostartSupportReason::UnstableInstallLocation),
                warnings,
            },
            Some(_) => Capability {
                package_kind: AutostartPackageKind::WindowsDesktop,
                candidate: Some(candidate),
                target_eligible: false,
                support_reason: Some(AutostartSupportReason::UnstableInstallLocation),
                warnings,
            },
        }
    }

    pub(super) fn targets_equal(candidate: &AutostartTarget, registered: &Path) -> bool {
        windows_path_key(&candidate.executable) == windows_path_key(registered)
    }

    fn format_windows_command(path: &Path) -> Result<String, String> {
        let is_exe = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
        if !valid_text_path(path)
            || !is_exe
            || path.to_str().is_some_and(|value| value.contains('"'))
        {
            return Err("invalid Windows executable path".into());
        }
        Ok(format!("\"{}\" {BACKGROUND_ARG}", path.to_str().expect("validated path")))
    }

    fn parse_windows_command(command: &str) -> Result<PathBuf, String> {
        let suffix = format!("\" {BACKGROUND_ARG}");
        if !command.starts_with('"') || !command.ends_with(&suffix) {
            return Err("invalid managed command".into());
        }
        let path = PathBuf::from(&command[1..command.len() - suffix.len()]);
        let is_exe = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
        if valid_text_path(&path)
            && is_exe
            && path.to_str().is_some_and(|value| !value.contains('"'))
        {
            Ok(path)
        } else {
            Err("invalid managed executable path".into())
        }
    }

    fn decode_reg_sz(bytes: &[u8]) -> Option<String> {
        if !bytes.len().is_multiple_of(2) {
            return None;
        }
        let mut units = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        if units.last() == Some(&0) {
            units.pop();
        }
        if units.contains(&0) {
            return None;
        }
        String::from_utf16(&units).ok()
    }

    fn drive_type(path: &Path) -> Option<u32> {
        let letter = match path.components().next()? {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter,
                _ => return None,
            },
            _ => return None,
        };
        let root = [u16::from(letter), u16::from(b':'), u16::from(b'\\'), 0];
        Some(unsafe { GetDriveTypeW(root.as_ptr()) })
    }

    fn windows_path_key(path: &Path) -> String {
        let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let value = normalized.as_os_str().encode_wide().collect::<Vec<_>>();
        let mut value = String::from_utf16_lossy(&value).replace('/', "\\");
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            value = stripped.to_string();
        }
        value.to_lowercase()
    }

    fn is_nsis_install(executable: &Path) -> bool {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(key) = current_user.open_subkey(UNINSTALL_KEY) else {
            return false;
        };
        let Ok(raw): Result<winreg::RegValue, _> = key.get_raw_value("InstallLocation") else {
            return false;
        };
        if raw.vtype != REG_SZ {
            return false;
        }
        let Some(location) = decode_reg_sz(&raw.bytes) else {
            return false;
        };
        let location =
            location.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(&location);
        let installed_exe = PathBuf::from(location).join(format!("{}.exe", env!("CARGO_PKG_NAME")));
        windows_path_key(executable) == windows_path_key(&installed_exe)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn windows_command_round_trips_spaces_and_unicode() {
            let path = PathBuf::from(r"C:\Program Files\恐龙\dinotty.exe");
            let command = format_windows_command(&path).unwrap();
            assert_eq!(parse_windows_command(&command).unwrap(), path);
            assert!(parse_windows_command(r#""C:\dinotty.exe" --background extra"#).is_err());
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use plist::{Dictionary, Value};
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    const LABEL: &str = "com.dinotty.terminal.autostart";
    const PLIST_NAME: &str = "com.dinotty.terminal.autostart.plist";

    pub(super) struct MacosBackend {
        path: PathBuf,
    }

    impl AutostartBackend for MacosBackend {
        fn read(&self) -> Result<NativeRegistration, String> {
            read_plist(&self.path)
        }

        fn enable(&self, target: &AutostartTarget) -> Result<(), String> {
            if target.package_kind != AutostartPackageKind::MacosInstalledApp {
                return Err("target package does not belong to the macOS backend".into());
            }
            let mut dictionary = Dictionary::new();
            dictionary.insert("Label".into(), Value::String(LABEL.into()));
            dictionary.insert("RunAtLoad".into(), Value::Boolean(true));
            dictionary.insert("KeepAlive".into(), Value::Boolean(false));
            dictionary.insert(
                "ProgramArguments".into(),
                Value::Array(vec![
                    Value::String(
                        target
                            .executable
                            .to_str()
                            .ok_or("executable path is not valid UTF-8")?
                            .into(),
                    ),
                    Value::String(BACKGROUND_ARG.into()),
                ]),
            );
            let mut bytes = Vec::new();
            Value::Dictionary(dictionary)
                .to_writer_xml(&mut bytes)
                .map_err(|error| error.to_string())?;
            write_atomic(&self.path, &bytes, |path| match read_plist(path)? {
                NativeRegistration::Managed(_) => Ok(()),
                _ => Err("generated LaunchAgent failed validation".into()),
            })
        }

        fn disable(&self) -> Result<(), String> {
            std::fs::remove_file(&self.path).map_err(|error| error.to_string())
        }
    }

    pub(super) fn backend() -> Result<Box<dyn AutostartBackend>, String> {
        let home = home_dir().ok_or_else(|| "home directory is unavailable".to_string())?;
        Ok(Box::new(MacosBackend { path: home.join("Library/LaunchAgents").join(PLIST_NAME) }))
    }

    pub(super) fn capability(_tray_available: Option<bool>) -> Capability {
        let executable = match std::env::current_exe() {
            Ok(path) if valid_text_path(&path) && path.is_file() => path,
            _ => return Capability::unsupported(AutostartSupportReason::ExecutablePathUnavailable),
        };
        let Some(bundle) = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        else {
            return Capability::unsupported(AutostartSupportReason::UnsupportedPackage);
        };
        let valid_bundle_executable = executable.starts_with(bundle.join("Contents/MacOS"));
        let candidate = AutostartTarget {
            package_kind: AutostartPackageKind::MacosInstalledApp,
            executable: executable.clone(),
        };
        let home = home_dir();
        let installed = bundle.starts_with("/Applications")
            || home.as_ref().is_some_and(|home| bundle.starts_with(home.join("Applications")));
        let translocated = bundle.to_string_lossy().contains("/AppTranslocation/");
        let launch_agents_available = home.is_some();
        let writable_volume = !volume_is_read_only(bundle).unwrap_or(true);
        let eligible = valid_bundle_executable
            && installed
            && !translocated
            && launch_agents_available
            && writable_volume;
        Capability {
            package_kind: AutostartPackageKind::MacosInstalledApp,
            candidate: Some(candidate),
            target_eligible: eligible,
            support_reason: if !launch_agents_available {
                Some(AutostartSupportReason::HomeDirectoryUnavailable)
            } else if !eligible {
                Some(AutostartSupportReason::UnstableInstallLocation)
            } else {
                None
            },
            warnings: Vec::new(),
        }
    }

    pub(super) fn targets_equal(candidate: &AutostartTarget, registered: &Path) -> bool {
        candidate.executable.canonicalize().unwrap_or_else(|_| candidate.executable.clone())
            == registered.canonicalize().unwrap_or_else(|_| registered.to_path_buf())
    }

    fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from).filter(|path| path.is_absolute())
    }

    fn volume_is_read_only(path: &Path) -> Result<bool, String> {
        let path = CString::new(path.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
        let mut info = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        let result = unsafe { libc::statvfs(path.as_ptr(), info.as_mut_ptr()) };
        if result != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let info = unsafe { info.assume_init() };
        Ok(info.f_flag & libc::MNT_RDONLY as libc::c_ulong != 0)
    }

    fn read_plist(path: &Path) -> Result<NativeRegistration, String> {
        if !path.exists() {
            return Ok(NativeRegistration::Missing);
        }
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        let Ok(value) = Value::from_reader(std::io::Cursor::new(bytes)) else {
            return Ok(NativeRegistration::Malformed);
        };
        let Some(dictionary) = value.as_dictionary() else {
            return Ok(NativeRegistration::Malformed);
        };
        if dictionary.len() != 4
            || dictionary.get("Label").and_then(Value::as_string) != Some(LABEL)
            || dictionary.get("RunAtLoad").and_then(Value::as_boolean) != Some(true)
            || dictionary.get("KeepAlive").and_then(Value::as_boolean) != Some(false)
        {
            return Ok(NativeRegistration::Malformed);
        }
        let Some(arguments) = dictionary.get("ProgramArguments").and_then(Value::as_array) else {
            return Ok(NativeRegistration::Malformed);
        };
        if arguments.len() != 2 || arguments[1].as_string() != Some(BACKGROUND_ARG) {
            return Ok(NativeRegistration::Malformed);
        }
        let Some(path) = arguments[0].as_string().map(PathBuf::from) else {
            return Ok(NativeRegistration::Malformed);
        };
        Ok(if valid_text_path(&path) {
            NativeRegistration::Managed(path)
        } else {
            NativeRegistration::Malformed
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn target(path: PathBuf) -> AutostartTarget {
            AutostartTarget {
                package_kind: AutostartPackageKind::MacosInstalledApp,
                executable: path,
            }
        }

        #[test]
        fn launch_agent_round_trips_xml_characters_and_rejects_unknown_keys() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(PLIST_NAME);
            let backend = MacosBackend { path: path.clone() };
            let executable = directory.path().join("Dino & <Terminal>.app/Contents/MacOS/dinotty");
            backend.enable(&target(executable.clone())).unwrap();
            assert!(matches!(
                backend.read().unwrap(),
                NativeRegistration::Managed(registered) if registered == executable
            ));

            let mut value = Value::from_file(&path).unwrap().into_dictionary().unwrap();
            value.insert("Unexpected".into(), Value::Boolean(true));
            Value::Dictionary(value).to_file_binary(&path).unwrap();
            assert!(matches!(backend.read().unwrap(), NativeRegistration::Malformed));
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::collections::BTreeMap;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    const DESKTOP_NAME: &str = "dinotty.desktop";

    pub(super) struct LinuxBackend {
        path: PathBuf,
    }

    impl AutostartBackend for LinuxBackend {
        fn read(&self) -> Result<NativeRegistration, String> {
            read_desktop_file(&self.path)
        }

        fn enable(&self, target: &AutostartTarget) -> Result<(), String> {
            if !matches!(
                target.package_kind,
                AutostartPackageKind::LinuxDeb | AutostartPackageKind::LinuxAppImage
            ) {
                return Err("target package does not belong to the Linux backend".into());
            }
            let exec = encode_desktop_exec(&target.executable)?;
            let contents = format!(
                "[Desktop Entry]\nType=Application\nName=Dinotty\nExec={exec}\nTerminal=false\nX-Dinotty-Autostart=true\n"
            );
            write_atomic(&self.path, contents.as_bytes(), |path| match read_desktop_file(path)? {
                NativeRegistration::Managed(_) => Ok(()),
                _ => Err("generated desktop entry failed validation".into()),
            })
        }

        fn disable(&self) -> Result<(), String> {
            std::fs::remove_file(&self.path).map_err(|error| error.to_string())
        }
    }

    pub(super) fn backend() -> Result<Box<dyn AutostartBackend>, String> {
        Ok(Box::new(LinuxBackend { path: autostart_path()? }))
    }

    pub(super) fn capability(tray_available: Option<bool>) -> Capability {
        let appimage_attempt =
            std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some();
        if appimage_attempt {
            return appimage_capability(tray_available);
        }

        let fixed = PathBuf::from("/usr/bin").join(env!("CARGO_PKG_NAME"));
        let Ok(current) = std::env::current_exe() else {
            return Capability::unsupported(AutostartSupportReason::ExecutablePathUnavailable);
        };
        if current != fixed {
            return Capability::unsupported(AutostartSupportReason::UnsupportedPackage);
        }
        let candidate = AutostartTarget {
            package_kind: AutostartPackageKind::LinuxDeb,
            executable: fixed.clone(),
        };
        let xdg_available = autostart_path().is_ok();
        let identity_matches = same_file(&current, &fixed);
        let tray_ok = tray_available.unwrap_or(true);
        let eligible = identity_matches && xdg_available && tray_ok;
        Capability {
            package_kind: AutostartPackageKind::LinuxDeb,
            candidate: Some(candidate),
            target_eligible: eligible,
            support_reason: if !identity_matches {
                Some(AutostartSupportReason::ExecutablePathUnavailable)
            } else if !xdg_available {
                Some(AutostartSupportReason::HomeDirectoryUnavailable)
            } else if !tray_ok {
                Some(AutostartSupportReason::TrayUnavailable)
            } else {
                None
            },
            warnings: vec![AutostartWarning::DesktopEnvironmentDependent],
        }
    }

    fn appimage_capability(tray_available: Option<bool>) -> Capability {
        let invalid = || Capability {
            package_kind: AutostartPackageKind::LinuxAppImage,
            candidate: None,
            target_eligible: false,
            support_reason: Some(AutostartSupportReason::RuntimeEvidenceInvalid),
            warnings: vec![
                AutostartWarning::PathMoveBreaksRegistration,
                AutostartWarning::DesktopEnvironmentDependent,
            ],
        };
        let (Some(image), Some(appdir)) =
            (std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR"))
        else {
            return invalid();
        };
        let image = PathBuf::from(image);
        let appdir = PathBuf::from(appdir);
        let Ok(current) = std::env::current_exe() else {
            return invalid();
        };
        let runtime_valid = valid_text_path(&image)
            && image.is_file()
            && image.metadata().is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
            && appdir.is_absolute()
            && appdir.is_dir()
            && appdir.canonicalize().ok().is_some_and(|appdir| {
                current.canonicalize().ok().is_some_and(|current| current.starts_with(appdir))
            });
        if !runtime_valid {
            return invalid();
        }
        let candidate = AutostartTarget {
            package_kind: AutostartPackageKind::LinuxAppImage,
            executable: image,
        };
        let xdg_available = autostart_path().is_ok();
        let tray_ok = tray_available.unwrap_or(true);
        Capability {
            package_kind: AutostartPackageKind::LinuxAppImage,
            candidate: Some(candidate),
            target_eligible: xdg_available && tray_ok,
            support_reason: if !xdg_available {
                Some(AutostartSupportReason::HomeDirectoryUnavailable)
            } else if !tray_ok {
                Some(AutostartSupportReason::TrayUnavailable)
            } else {
                None
            },
            warnings: vec![
                AutostartWarning::PathMoveBreaksRegistration,
                AutostartWarning::DesktopEnvironmentDependent,
            ],
        }
    }

    pub(super) fn targets_equal(candidate: &AutostartTarget, registered: &Path) -> bool {
        same_file(&candidate.executable, registered) || candidate.executable == registered
    }

    fn same_file(left: &Path, right: &Path) -> bool {
        let (Ok(left), Ok(right)) = (left.metadata(), right.metadata()) else {
            return false;
        };
        left.dev() == right.dev() && left.ino() == right.ino()
    }

    fn autostart_path() -> Result<PathBuf, String> {
        if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
            let config = PathBuf::from(config);
            if !config.is_absolute() {
                return Err("XDG_CONFIG_HOME must be absolute".into());
            }
            return Ok(config.join("autostart").join(DESKTOP_NAME));
        }
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| "home directory is unavailable".to_string())?;
        Ok(home.join(".config/autostart").join(DESKTOP_NAME))
    }

    fn read_desktop_file(path: &Path) -> Result<NativeRegistration, String> {
        if !path.exists() {
            return Ok(NativeRegistration::Missing);
        }
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        let Ok(contents) = std::str::from_utf8(&bytes) else {
            return Ok(NativeRegistration::Malformed);
        };
        let mut lines = contents.lines();
        if lines.next() != Some("[Desktop Entry]") {
            return Ok(NativeRegistration::Malformed);
        }
        let mut fields = BTreeMap::new();
        for line in lines {
            if line.is_empty() {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                return Ok(NativeRegistration::Malformed);
            };
            if fields.insert(key, value).is_some() {
                return Ok(NativeRegistration::Malformed);
            }
        }
        if fields.len() != 5
            || fields.get("Type") != Some(&"Application")
            || fields.get("Name") != Some(&"Dinotty")
            || fields.get("Terminal") != Some(&"false")
            || fields.get("X-Dinotty-Autostart") != Some(&"true")
        {
            return Ok(NativeRegistration::Malformed);
        }
        let Some(exec) = fields.get("Exec") else {
            return Ok(NativeRegistration::Malformed);
        };
        Ok(match decode_desktop_exec(exec) {
            Ok(path) => NativeRegistration::Managed(path),
            Err(_) => NativeRegistration::Malformed,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn desktop_file_round_trips_special_paths_and_rejects_extra_fields() {
            let directory = tempfile::tempdir().unwrap();
            let registration = directory.path().join(DESKTOP_NAME);
            let backend = LinuxBackend { path: registration.clone() };
            let executable = directory.path().join("Dino ` $ % \\ terminal.AppImage");
            let target = AutostartTarget {
                package_kind: AutostartPackageKind::LinuxAppImage,
                executable: executable.clone(),
            };
            backend.enable(&target).unwrap();
            assert!(matches!(
                backend.read().unwrap(),
                NativeRegistration::Managed(registered) if registered == executable
            ));

            let mut contents = std::fs::read_to_string(&registration).unwrap();
            contents.push_str("Unexpected=true\n");
            std::fs::write(&registration, contents).unwrap();
            assert!(matches!(backend.read().unwrap(), NativeRegistration::Malformed));
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    pub(super) fn backend() -> Result<Box<dyn AutostartBackend>, String> {
        Err("autostart is unsupported on this platform".into())
    }

    pub(super) fn capability(_tray_available: Option<bool>) -> Capability {
        Capability::unsupported(AutostartSupportReason::UnsupportedPlatform)
    }

    pub(super) fn targets_equal(_candidate: &AutostartTarget, _registered: &Path) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_exec_round_trips_reserved_characters_without_a_shell() {
        let path = if cfg!(target_os = "windows") {
            PathBuf::from(r"C:\Dinotty Files\tick` dollar$ percent% back\slash.exe")
        } else {
            PathBuf::from(r"/opt/Dinotty Files/tick` dollar$ percent% back\slash")
        };
        let encoded = encode_desktop_exec(&path).unwrap();
        assert_eq!(decode_desktop_exec(&encoded).unwrap(), path);
        assert!(decode_desktop_exec("\"/tmp/app\" --background %f").is_err());
    }

    #[test]
    fn status_model_keeps_disable_independent_from_current_package() {
        let capability = Capability {
            package_kind: AutostartPackageKind::Unknown,
            candidate: None,
            target_eligible: false,
            support_reason: Some(AutostartSupportReason::UnsupportedPackage),
            warnings: Vec::new(),
        };
        let status = status_from_registration(
            capability,
            NativeRegistration::Managed(PathBuf::from(if cfg!(target_os = "windows") {
                r"C:\old\dinotty.exe"
            } else {
                "/old/dinotty"
            })),
        );
        assert_eq!(status.state, AutostartState::OnDifferentPath);
        assert!(!status.can_enable);
        assert!(status.can_disable);
    }

    #[test]
    fn registration_states_protect_malformed_entries() {
        let current = PathBuf::from(if cfg!(target_os = "windows") {
            r"C:\Dinotty\dinotty.exe"
        } else {
            "/opt/dinotty"
        });
        let capability = || Capability {
            package_kind: if cfg!(target_os = "windows") {
                AutostartPackageKind::WindowsDesktop
            } else {
                AutostartPackageKind::Unknown
            },
            candidate: Some(AutostartTarget {
                package_kind: AutostartPackageKind::Unknown,
                executable: current.clone(),
            }),
            target_eligible: true,
            support_reason: None,
            warnings: Vec::new(),
        };

        let off = status_from_registration(capability(), NativeRegistration::Missing);
        assert_eq!(off.state, AutostartState::Off);
        assert!(off.can_enable);
        assert!(!off.can_disable);

        let on =
            status_from_registration(capability(), NativeRegistration::Managed(current.clone()));
        assert_eq!(on.state, AutostartState::OnCurrent);
        assert!(on.can_enable);
        assert!(on.can_disable);

        let malformed = status_from_registration(capability(), NativeRegistration::Malformed);
        assert_eq!(malformed.state, AutostartState::Error);
        assert_eq!(malformed.state_error, Some(AutostartStateError::RegistrationMalformed));
        assert!(!malformed.can_enable);
        assert!(!malformed.can_disable);
    }

    #[test]
    fn nsis_template_does_not_unconditionally_delete_the_run_value() {
        let template = include_str!("../windows/installer.nsi");
        assert!(template.contains("{{#if installer_hooks}}"));
        assert!(template.contains("$UpdateMode"));
        assert!(!template.contains(
            "DeleteRegValue HKCU \"Software\\Microsoft\\Windows\\CurrentVersion\\Run\" \"${PRODUCTNAME}\""
        ));

        let hook = include_str!("../windows/hooks.nsh");
        assert!(hook.contains("NSIS_HOOK_PREUNINSTALL"));
        assert!(hook.contains("RegQueryValueExW"));
        assert!(hook.contains("$UpdateMode <> 1"));
        assert!(hook.contains("REG_SZ"));
    }
}

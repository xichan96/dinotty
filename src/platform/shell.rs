use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShellLaunchKind {
    Native,
    Wsl { distro: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellPreference {
    pub kind: String,
    pub custom_path: Option<String>,
    pub wsl_distro: Option<String>,
}

impl ShellPreference {
    #[must_use]
    pub fn new(
        kind: impl Into<String>,
        custom_path: Option<String>,
        wsl_distro: Option<String>,
    ) -> Self {
        Self { kind: kind.into(), custom_path, wsl_distro }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
    pub shell_type: String,
    pub launch_kind: ShellLaunchKind,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct DetectedShell {
    pub kind: String,
    pub program: String,
    pub distro: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellResolveError {
    pub code: &'static str,
    pub detail: String,
}

impl ShellResolveError {
    #[must_use]
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl std::fmt::Display for ShellResolveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for ShellResolveError {}

impl ShellSpec {
    fn native(program: String, normalized_type: Option<&str>) -> Self {
        let shell_type = normalized_type.map_or_else(|| shell_type(&program), str::to_string);
        Self {
            args: shell_args_for_type(&program, &shell_type),
            shell_type,
            program,
            launch_kind: ShellLaunchKind::Native,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HookShellSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[must_use]
pub fn resolve_command(program: &str) -> Option<PathBuf> {
    resolve_command_impl(program)
}

#[must_use]
pub fn default_shell() -> ShellSpec {
    default_shell_impl()
}

/// Resolve native shell preferences. WSL resolution is asynchronous and lives in
/// `ShellProbeService`, which validates the selected distribution before launch.
///
/// # Errors
///
/// Returns `shell_unavailable` when a custom shell path does not resolve to an
/// executable file, or `wsl_capability_unsupported` when called for WSL.
pub fn resolve_native_preference(
    preference: &ShellPreference,
) -> Result<ShellSpec, ShellResolveError> {
    let kind = preference.kind.trim();
    if kind.is_empty() || kind == "auto" {
        return Ok(default_shell_impl());
    }

    let program = match kind {
        "custom" => {
            let Some(path) = preference.custom_path.as_deref() else {
                return Err(ShellResolveError::new(
                    "shell_unavailable",
                    "custom shell path is empty",
                ));
            };
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err(ShellResolveError::new(
                    "shell_unavailable",
                    "custom shell path is empty",
                ));
            }
            resolve_command(trimmed)
                .filter(|path| is_executable_file(path))
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| {
                    ShellResolveError::new(
                        "shell_unavailable",
                        format!("custom shell is not executable: {trimmed}"),
                    )
                })?
        }
        "wsl" => {
            return Err(ShellResolveError::new(
                "wsl_capability_unsupported",
                "WSL must be resolved asynchronously",
            ));
        }
        other => {
            let Some(p) = find_shell_program(other) else {
                tracing::warn!(shell_kind = other, "Configured shell was not detected; using auto");
                return Ok(default_shell_impl());
            };
            p
        }
    };

    let normalized_type = (kind != "custom").then_some(kind);
    Ok(ShellSpec::native(program, normalized_type))
}

#[must_use]
pub fn available_native_shells() -> Vec<DetectedShell> {
    ["zsh", "bash", "sh", "fish", "powershell", "cmd"]
        .into_iter()
        .filter_map(|kind| {
            find_shell_program(kind).map(|program| DetectedShell {
                kind: kind.to_string(),
                program,
                distro: None,
            })
        })
        .collect()
}

#[must_use]
pub fn default_shell_kind(spec: &ShellSpec) -> String {
    match spec.shell_type.as_str() {
        "zsh" | "bash" | "sh" | "fish" | "powershell" | "cmd" => spec.shell_type.clone(),
        _ => "custom".to_string(),
    }
}

fn find_shell_program(kind: &str) -> Option<String> {
    #[cfg(windows)]
    if !matches!(kind, "powershell" | "cmd") {
        // bash.exe on Windows is a legacy WSL launcher, while Git Bash,
        // Cygwin, and MSYS2 require distinct argv/path semantics.
        return None;
    }
    #[cfg(not(windows))]
    if kind == "cmd" {
        return None;
    }

    let candidates: &[&str] = match kind {
        "zsh" => {
            &["/bin/zsh", "/usr/bin/zsh", "/opt/homebrew/bin/zsh", "/usr/local/bin/zsh", "zsh"]
        }
        "bash" => {
            &["/bin/bash", "/usr/bin/bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash", "bash"]
        }
        "sh" => &["/bin/sh", "/usr/bin/sh", "sh"],
        "fish" => &["/usr/bin/fish", "/opt/homebrew/bin/fish", "/usr/local/bin/fish", "fish"],
        "powershell" => &["pwsh", "powershell", "pwsh.exe", "powershell.exe"],
        "cmd" => &["cmd", "cmd.exe"],
        _ => return None,
    };
    for candidate in candidates {
        let path = Path::new(candidate);
        if path.is_absolute() {
            if is_executable_file(path) {
                return Some((*candidate).to_string());
            }
            continue;
        }
        if let Some(resolved) = resolve_command(candidate) {
            return Some(resolved.to_string_lossy().into_owned());
        }
    }
    None
}

#[must_use]
pub fn shell_type(program: &str) -> String {
    let lower = Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();

    if lower.contains("pwsh") || lower.contains("powershell") {
        "powershell".into()
    } else if lower.contains("cmd") {
        "cmd".into()
    } else if lower.contains("zsh") {
        "zsh".into()
    } else if lower.contains("bash") {
        "bash".into()
    } else if lower.contains("fish") {
        "fish".into()
    } else {
        "sh".into()
    }
}

#[must_use]
pub fn shell_args(program: &str) -> Vec<String> {
    shell_args_for_type(program, &shell_type(program))
}

fn shell_args_for_type(_program: &str, shell_type: &str) -> Vec<String> {
    match shell_type {
        "zsh" | "bash" => vec!["-i".into(), "-l".into()],
        "powershell" => vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-Command".into(),
            powershell_integration_script(),
        ],
        "cmd" => Vec::new(),
        _ => vec!["-i".into()],
    }
}

#[must_use]
pub fn home_dir() -> PathBuf {
    dirs::home_dir().or_else(|| std::env::current_dir().ok()).unwrap_or_else(root_dir)
}

#[must_use]
pub fn notification_hook_shell(script: &str) -> HookShellSpec {
    notification_hook_shell_impl(script)
}

#[cfg(unix)]
fn default_shell_impl() -> ShellSpec {
    const BLOCKED: &[&str] = &[
        "/sbin/nologin",
        "/usr/sbin/nologin",
        "/bin/false",
        "/usr/bin/false",
        "/bin/nologin",
        "/usr/bin/nologin",
    ];

    let program = std::env::var("SHELL")
        .ok()
        .filter(|s| is_executable_file(Path::new(s)) && !BLOCKED.contains(&s.as_str()))
        .or_else(|| {
            ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"]
                .into_iter()
                .find(|s| is_executable_file(Path::new(s)))
                .map(str::to_string)
        })
        .unwrap_or_else(|| "/bin/sh".into());

    ShellSpec::native(program, None)
}

#[cfg(windows)]
fn default_shell_impl() -> ShellSpec {
    let program = std::env::var("DINOTTY_SHELL")
        .ok()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .and_then(|s| resolve_command(&s).map(|path| path.to_string_lossy().into_owned()))
        .or_else(|| resolve_command("pwsh.exe").map(|path| path.to_string_lossy().into_owned()))
        .or_else(|| {
            resolve_command("powershell.exe").map(|path| path.to_string_lossy().into_owned())
        })
        .or_else(|| {
            std::env::var("ComSpec")
                .ok()
                .map(|s| s.trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .and_then(|s| resolve_command(&s).map(|path| path.to_string_lossy().into_owned()))
        })
        .or_else(|| resolve_command("cmd.exe").map(|path| path.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "cmd.exe".into());

    ShellSpec::native(program, None)
}

#[cfg(not(any(unix, windows)))]
fn default_shell_impl() -> ShellSpec {
    let program = std::env::var("SHELL").unwrap_or_else(|_| "sh".into());
    ShellSpec::native(program, None)
}

#[cfg(unix)]
fn notification_hook_shell_impl(script: &str) -> HookShellSpec {
    HookShellSpec { program: "sh".into(), args: vec!["-c".into(), script.into()] }
}

#[cfg(windows)]
fn notification_hook_shell_impl(script: &str) -> HookShellSpec {
    if let Some(program) = resolve_command("pwsh.exe") {
        return HookShellSpec {
            program: program.to_string_lossy().into_owned(),
            args: vec!["-NoProfile".into(), "-Command".into(), script.into()],
        };
    }
    if let Some(program) = resolve_command("powershell.exe") {
        return HookShellSpec {
            program: program.to_string_lossy().into_owned(),
            args: vec!["-NoProfile".into(), "-Command".into(), script.into()],
        };
    }

    let program = resolve_command("cmd.exe")
        .map_or_else(|| "cmd.exe".into(), |path| path.to_string_lossy().into_owned());
    HookShellSpec { program, args: vec!["/C".into(), script.into()] }
}

#[cfg(not(any(unix, windows)))]
fn notification_hook_shell_impl(script: &str) -> HookShellSpec {
    HookShellSpec { program: "sh".into(), args: vec!["-c".into(), script.into()] }
}

#[cfg(windows)]
fn resolve_command_impl(program: &str) -> Option<PathBuf> {
    let program = program.trim_matches('"');
    if program.is_empty() {
        return None;
    }

    let path = PathBuf::from(program);
    if path.is_absolute() || program.contains('\\') || program.contains('/') {
        return is_executable_file(&path).then_some(path);
    }

    let candidates = command_candidates(program);
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| candidates.iter().map(move |candidate| dir.join(candidate)))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(not(windows))]
fn resolve_command_impl(program: &str) -> Option<PathBuf> {
    let program = program.trim_matches('"');
    if program.is_empty() {
        return None;
    }

    let path = PathBuf::from(program);
    if path.is_absolute() || program.contains('/') {
        return is_executable_file(&path).then_some(path);
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(program))
            .find(|candidate| is_executable_file(candidate))
    })
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(windows)]
fn command_candidates(program: &str) -> Vec<String> {
    if Path::new(program).extension().is_some() {
        return vec![program.to_string()];
    }

    let mut candidates = vec![program.to_string()];
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    candidates.extend(
        pathext.split(';').filter(|ext| !ext.is_empty()).map(|ext| format!("{program}{ext}")),
    );
    candidates
}

fn powershell_integration_script() -> String {
    r"$global:__DinottyOriginalPrompt = if (Test-Path Function:\prompt) { (Get-Command prompt).ScriptBlock } else { { 'PS ' + (Get-Location) + '> ' } }; function global:prompt { $promptText = & $global:__DinottyOriginalPrompt; $esc = [char]27; $bel = [char]7; $cwd = (Get-Location).ProviderPath; [Console]::Out.Write($esc + ']0;' + $env:USERNAME + '@' + $env:COMPUTERNAME + ':' + $cwd + $bel); [Console]::Out.Write($esc + ']133;A' + $esc + '\'); $promptText }".to_string()
}

#[cfg(windows)]
fn root_dir() -> PathBuf {
    PathBuf::from(r"C:\")
}

#[cfg(not(windows))]
fn root_dir() -> PathBuf {
    PathBuf::from("/")
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::{default_shell, find_shell_program, notification_hook_shell, resolve_command};
    use super::{resolve_native_preference, shell_args, shell_type, ShellPreference};

    #[test]
    fn detects_windows_shell_types() {
        assert_eq!(shell_type(r"C:\Program Files\PowerShell\7\pwsh.exe"), "powershell");
        assert_eq!(shell_type(r"C:\Windows\System32\cmd.exe"), "cmd");
        assert_eq!(shell_type("/usr/bin/fish"), "fish");
    }

    #[test]
    fn invalid_custom_shell_is_not_silently_replaced() {
        let preference = ShellPreference::new(
            "custom",
            Some("this-shell-does-not-exist-anywhere".to_string()),
            None,
        );

        let error = resolve_native_preference(&preference).unwrap_err();

        assert_eq!(error.code, "shell_unavailable");
    }

    #[cfg(windows)]
    #[test]
    fn legacy_windows_bash_launcher_is_not_a_native_shell_candidate() {
        assert_eq!(find_shell_program("bash"), None);
    }

    #[test]
    fn returns_expected_shell_args() {
        assert_eq!(shell_args("/bin/bash"), vec!["-i".to_string(), "-l".to_string()]);
        let pwsh_args = shell_args("pwsh.exe");
        assert_eq!(pwsh_args[0], "-NoLogo");
        assert!(pwsh_args.iter().any(|arg| arg.contains("DinottyOriginalPrompt")));
        assert!(shell_args("cmd.exe").is_empty());
    }

    #[cfg(windows)]
    fn write_fake_command(path: &std::path::Path) {
        std::fs::write(path, b"").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn resolve_command_uses_pathext_case_insensitively() {
        let _env = crate::test_support::EnvGuard::new(&["PATH", "PATHEXT"]);
        let tmp = tempfile::tempdir().unwrap();
        write_fake_command(&tmp.path().join("foo.cmd"));
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("PATHEXT", ".EXE;.CMD");

        let resolved = resolve_command("foo").unwrap();

        assert!(resolved.is_file());
        assert!(resolved
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("foo.cmd")));
    }

    #[cfg(windows)]
    #[test]
    fn default_shell_prefers_quoted_dinotty_shell() {
        let _env =
            crate::test_support::EnvGuard::new(&["PATH", "PATHEXT", "DINOTTY_SHELL", "ComSpec"]);
        let tmp = tempfile::tempdir().unwrap();
        let pwsh = tmp.path().join("pwsh.exe");
        write_fake_command(&pwsh);
        std::env::set_var("PATH", "");
        std::env::set_var("PATHEXT", ".EXE;.CMD");
        std::env::set_var("DINOTTY_SHELL", format!("\"{}\"", pwsh.display()));
        std::env::remove_var("ComSpec");

        let shell = default_shell();

        assert_eq!(shell.program, pwsh.to_string_lossy().as_ref());
        assert_eq!(shell.shell_type, "powershell");
    }

    #[cfg(windows)]
    #[test]
    fn default_shell_uses_expected_windows_priority() {
        let _env =
            crate::test_support::EnvGuard::new(&["PATH", "PATHEXT", "DINOTTY_SHELL", "ComSpec"]);
        let tmp = tempfile::tempdir().unwrap();
        let pwsh = tmp.path().join("pwsh.exe");
        let powershell = tmp.path().join("powershell.exe");
        let comspec = tmp.path().join("custom-cmd.exe");
        let cmd = tmp.path().join("cmd.exe");
        for path in [&pwsh, &powershell, &comspec, &cmd] {
            write_fake_command(path);
        }
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("PATHEXT", ".EXE;.CMD");
        std::env::remove_var("DINOTTY_SHELL");
        std::env::remove_var("ComSpec");

        assert_eq!(default_shell().program, pwsh.to_string_lossy().as_ref());

        std::fs::remove_file(&pwsh).unwrap();
        assert_eq!(default_shell().program, powershell.to_string_lossy().as_ref());

        std::fs::remove_file(&powershell).unwrap();
        std::env::set_var("ComSpec", &comspec);
        assert_eq!(default_shell().program, comspec.to_string_lossy().as_ref());

        std::env::remove_var("ComSpec");
        assert_eq!(default_shell().program, cmd.to_string_lossy().as_ref());
    }

    #[cfg(windows)]
    #[test]
    fn notification_hook_shell_prefers_pwsh_with_powershell_args() {
        let _env = crate::test_support::EnvGuard::new(&["PATH", "PATHEXT"]);
        let tmp = tempfile::tempdir().unwrap();
        let pwsh = tmp.path().join("pwsh.exe");
        write_fake_command(&pwsh);
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("PATHEXT", ".EXE;.CMD");

        let hook = notification_hook_shell("echo hi");

        assert_eq!(hook.program, pwsh.to_string_lossy().as_ref());
        assert_eq!(hook.args, vec!["-NoProfile", "-Command", "echo hi"]);
    }

    #[cfg(windows)]
    #[test]
    fn notification_hook_shell_falls_back_to_cmd() {
        let _env = crate::test_support::EnvGuard::new(&["PATH", "PATHEXT"]);
        let tmp = tempfile::tempdir().unwrap();
        let cmd = tmp.path().join("cmd.exe");
        write_fake_command(&cmd);
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("PATHEXT", ".EXE;.CMD");

        let hook = notification_hook_shell("echo hi");

        assert_eq!(hook.program, cmd.to_string_lossy().as_ref());
        assert_eq!(hook.args, vec!["/C", "echo hi"]);
    }
}

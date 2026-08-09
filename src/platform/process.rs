pub trait CommandNoWindowExt {
    fn no_window(&mut self) -> &mut Self;

    /// Suppress a console window without detaching the child from piped stdio.
    fn no_window_with_stdio(&mut self) -> &mut Self;
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
// GUI builds have no parent console; detach background CLI tools so Windows
// does not create transient conhost windows for each short-lived command.
const NO_CONSOLE_WINDOW_FLAGS: u32 = CREATE_NO_WINDOW | DETACHED_PROCESS;

impl CommandNoWindowExt for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl CommandNoWindowExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

/// Resolve a program used by the direct terminal argv API.
///
/// Unix keeps the existing `execvp`-style behavior. Windows resolves only
/// native executables before handing the absolute path to portable-pty, whose
/// own PATH lookup otherwise prefers extensionless Unix shims and batch files.
///
/// # Errors
///
/// On Windows, returns an error when `program` is a script, is not a native
/// `.exe`/`.com` path, or cannot be resolved to a native executable on `PATH`.
pub fn resolve_terminal_program(
    program: &std::ffi::OsStr,
    cwd: &std::path::Path,
) -> Result<std::ffi::OsString, String> {
    #[cfg(windows)]
    {
        resolve_windows_native_program_from(
            program,
            std::env::var_os("PATH").as_deref(),
            std::env::var_os("PATHEXT").as_deref(),
            cwd,
        )
    }

    #[cfg(not(windows))]
    {
        let _ = cwd;
        Ok(program.to_os_string())
    }
}

#[cfg(windows)]
fn resolve_windows_native_program_from(
    program: &std::ffi::OsStr,
    search_path: Option<&std::ffi::OsStr>,
    path_ext: Option<&std::ffi::OsStr>,
    cwd: &std::path::Path,
) -> Result<std::ffi::OsString, String> {
    use std::path::Path;

    fn extension_kind(path: &Path) -> Option<String> {
        path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase())
    }

    fn is_native_extension(extension: Option<&str>) -> bool {
        matches!(extension, Some("exe" | "com"))
    }

    fn is_script_extension(extension: Option<&str>) -> bool {
        matches!(extension, Some("cmd" | "bat" | "ps1"))
    }

    fn resolved_file(path: &Path, cwd: &Path) -> Option<std::ffi::OsString> {
        let absolute = if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) };
        if !absolute.is_file() {
            return None;
        }
        Some(absolute.into_os_string())
    }

    let requested = Path::new(program);
    let extension = extension_kind(requested);
    if is_script_extension(extension.as_deref()) {
        return Err(format!(
            "terminal argv[0] is a Windows script and cannot be launched directly: {}",
            requested.display()
        ));
    }

    let has_path = requested.is_absolute() || requested.components().count() > 1;
    if has_path {
        if !is_native_extension(extension.as_deref()) {
            return Err(format!(
                "terminal argv[0] must be a native .exe or .com executable on Windows: {}",
                requested.display()
            ));
        }
        return resolved_file(requested, cwd).ok_or_else(|| {
            format!("terminal native executable was not found: {}", requested.display())
        });
    }

    // The terminal API accepts a caller-controlled cwd. Relative PATH entries
    // (including `.` and empty entries) would make a bare program name resolve
    // inside that cwd, allowing a workspace file to impersonate a trusted
    // native executable such as cmd.exe. Direct argv execution therefore only
    // searches absolute PATH entries on Windows.
    let directories = search_path
        .into_iter()
        .flat_map(std::env::split_paths)
        .filter(|directory| directory.is_absolute());
    if is_native_extension(extension.as_deref()) {
        for directory in directories {
            let candidate = directory.join(requested);
            if let Some(resolved) = resolved_file(&candidate, cwd) {
                return Ok(resolved);
            }
        }
    } else {
        let mut native_extensions: Vec<&str> = path_ext
            .and_then(std::ffi::OsStr::to_str)
            .into_iter()
            .flat_map(|value| value.split(';'))
            .filter_map(|value| match value.trim().to_ascii_lowercase().as_str() {
                ".com" => Some(".COM"),
                ".exe" => Some(".EXE"),
                _ => None,
            })
            .collect();
        if native_extensions.is_empty() {
            native_extensions.extend([".COM", ".EXE"]);
        }

        for directory in directories {
            for extension in &native_extensions {
                let mut file_name = program.to_os_string();
                file_name.push(extension);
                let candidate = directory.join(file_name);
                if let Some(resolved) = resolved_file(&candidate, cwd) {
                    return Ok(resolved);
                }
            }
        }
    }

    Err(format!(
        "terminal argv[0] did not resolve to a native .exe or .com executable on Windows: {}",
        requested.display()
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use std::{ffi::OsStr, fs};

    use super::resolve_windows_native_program_from;

    #[test]
    fn bare_program_skips_extensionless_and_script_shims_for_a_later_exe() {
        let temp = tempfile::tempdir().unwrap();
        let poison = temp.path().join("poison");
        let native = temp.path().join("native");
        fs::create_dir_all(&poison).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(poison.join("tool"), b"#!/bin/sh\n").unwrap();
        fs::write(poison.join("tool.cmd"), b"@echo off\r\n").unwrap();
        fs::write(native.join("tool.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&poison, &native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool"),
            Some(&search_path),
            Some(OsStr::new(".COM;.EXE;.BAT;.CMD")),
            temp.path(),
        )
        .unwrap();

        assert!(
            resolved
                .to_string_lossy()
                .eq_ignore_ascii_case(&native.join("tool.exe").to_string_lossy()),
            "{resolved:?}"
        );
    }

    #[test]
    fn explicit_exe_name_is_not_replaced_by_an_earlier_cmd() {
        let temp = tempfile::tempdir().unwrap();
        let poison = temp.path().join("poison");
        let native = temp.path().join("native");
        fs::create_dir_all(&poison).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(poison.join("tool.cmd"), b"@echo off\r\n").unwrap();
        fs::write(native.join("tool.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&poison, &native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool.exe"),
            Some(&search_path),
            Some(OsStr::new(".CMD;.EXE")),
            temp.path(),
        )
        .unwrap();

        assert_eq!(resolved, native.join("tool.exe").into_os_string());
    }

    #[test]
    fn bare_program_ignores_relative_path_entries_and_cwd_poisoning() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("workspace");
        let native = temp.path().join("native");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&native).unwrap();
        fs::write(cwd.join("cmd.exe"), b"workspace poison").unwrap();
        fs::write(native.join("cmd.exe"), b"trusted fixture").unwrap();
        let search_path = std::env::join_paths([
            std::path::Path::new("."),
            std::path::Path::new("relative-bin"),
            &native,
        ])
        .unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("cmd.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap();

        assert_eq!(resolved, native.join("cmd.exe").into_os_string());
    }

    #[test]
    fn dotted_bare_name_can_resolve_by_appending_a_native_extension() {
        let temp = tempfile::tempdir().unwrap();
        let native = temp.path().join("native");
        fs::create_dir_all(&native).unwrap();
        fs::write(native.join("tool.v2.exe"), b"fixture").unwrap();
        let search_path = std::env::join_paths([&native]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new("tool.v2"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            temp.path(),
        )
        .unwrap();

        assert!(
            resolved
                .to_string_lossy()
                .eq_ignore_ascii_case(&native.join("tool.v2.exe").to_string_lossy()),
            "{resolved:?}"
        );
    }

    #[test]
    fn explicit_native_path_with_spaces_and_unicode_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let program = temp.path().join("space dir").join("工具.exe");
        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::write(&program, b"fixture").unwrap();

        let resolved =
            resolve_windows_native_program_from(program.as_os_str(), None, None, temp.path())
                .unwrap();

        assert_eq!(resolved, program.into_os_string());
    }

    #[test]
    fn explicit_namespaced_native_path_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let program = temp.path().join("native.exe");
        fs::write(&program, b"fixture").unwrap();
        let namespaced = std::path::PathBuf::from(format!(r"\\?\{}", program.display()));

        let resolved =
            resolve_windows_native_program_from(namespaced.as_os_str(), None, None, temp.path())
                .unwrap();

        assert_eq!(resolved, namespaced.into_os_string());
    }

    #[test]
    fn script_programs_are_rejected_instead_of_entering_a_shell() {
        for program in ["tool.cmd", "tool.bat", "tool.ps1"] {
            let error = resolve_windows_native_program_from(
                OsStr::new(program),
                None,
                None,
                std::path::Path::new(r"C:\work"),
            )
            .unwrap_err();
            assert!(error.contains("script"), "{program}: {error}");
        }
    }

    #[test]
    fn missing_native_program_has_an_actionable_error() {
        let error = resolve_windows_native_program_from(
            OsStr::new("missing-tool"),
            Some(OsStr::new("")),
            Some(OsStr::new(".EXE;.COM")),
            std::path::Path::new(r"C:\work"),
        )
        .unwrap_err();

        assert!(error.contains("native .exe or .com"), "{error}");
    }

    #[test]
    fn explicit_relative_native_path_resolves_from_terminal_cwd_without_path_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("workspace");
        let path_dir = temp.path().join("path");
        fs::create_dir_all(cwd.join("bin")).unwrap();
        fs::create_dir_all(&path_dir).unwrap();
        fs::write(cwd.join("bin").join("tool.exe"), b"cwd fixture").unwrap();
        fs::write(path_dir.join("missing.exe"), b"path fixture").unwrap();
        let search_path = std::env::join_paths([&path_dir]).unwrap();

        let resolved = resolve_windows_native_program_from(
            OsStr::new(r"bin\tool.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap();
        assert_eq!(resolved, cwd.join("bin").join("tool.exe").into_os_string());

        let error = resolve_windows_native_program_from(
            OsStr::new(r"bin\missing.exe"),
            Some(&search_path),
            Some(OsStr::new(".EXE")),
            &cwd,
        )
        .unwrap_err();
        assert!(error.contains("was not found"), "{error}");
    }
}

#[cfg(all(test, not(windows)))]
mod non_windows_tests {
    use std::ffi::{OsStr, OsString};

    use super::resolve_terminal_program;

    #[test]
    fn terminal_program_is_unchanged_off_windows() {
        assert_eq!(
            resolve_terminal_program(
                OsStr::new("tool-without-an-extension"),
                std::path::Path::new("/work"),
            )
            .unwrap(),
            OsString::from("tool-without-an-extension")
        );
    }
}

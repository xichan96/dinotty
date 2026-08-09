use std::path::{Path, PathBuf};

/// 校验 SSH key 文件路径
///
/// - 必须是绝对路径
/// - 解析符号链接，防止路径穿越
/// - Unix 必须在 ~/.ssh/ 或 /etc/ssh/ 下，Windows 必须在 %USERPROFILE%\.ssh 下
/// - 文件权限不能过于宽松（Unix: 0600/0400）
pub(super) fn validate_key_path(key_path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(key_path);

    if !p.is_absolute() {
        return Err("Key path must be absolute".into());
    }

    let canonical = p.canonicalize().map_err(|e| format!("Cannot resolve key path: {e}"))?;

    let home_ssh = ssh_home_dir()
        .map(|h| h.join(".ssh"))
        .ok_or("Cannot determine home directory")?
        .canonicalize()
        .map_err(|e| format!("Cannot resolve ~/.ssh: {e}"))?;

    if !is_allowed_key_path(&canonical, &home_ssh) {
        return Err(allowed_key_path_error());
    }

    crate::platform::fs::validate_private_key_permissions(&canonical)?;

    Ok(canonical)
}

fn ssh_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
    }
    #[cfg(not(windows))]
    {
        dirs::home_dir()
    }
}

fn is_allowed_key_path(canonical: &Path, home_ssh: &Path) -> bool {
    if path_within_or_equal(canonical, home_ssh) {
        return true;
    }

    #[cfg(unix)]
    {
        path_within_or_equal(canonical, Path::new("/etc/ssh"))
    }

    #[cfg(not(unix))]
    {
        false
    }
}

fn allowed_key_path_error() -> String {
    #[cfg(windows)]
    {
        "Key file must be in %USERPROFILE%\\.ssh\\".into()
    }
    #[cfg(unix)]
    {
        "Key file must be in ~/.ssh/ or /etc/ssh/".into()
    }
    #[cfg(not(any(unix, windows)))]
    {
        "Key file must be in the user's .ssh directory".into()
    }
}

fn path_within_or_equal(path: &Path, dir: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = normalize_windows_path_for_compare(path);
        let dir = normalize_windows_path_for_compare(dir);
        let dir_with_sep = format!("{dir}\\");
        path == dir || path.starts_with(&dir_with_sep)
    }

    #[cfg(not(windows))]
    {
        path == dir || path.starts_with(dir)
    }
}

#[cfg(windows)]
fn normalize_windows_path_for_compare(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('/', "\\");
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    stripped.trim_end_matches('\\').to_ascii_lowercase()
}

#[cfg(test)]
mod key_path_tests {
    use super::is_allowed_key_path;
    #[cfg(windows)]
    use super::validate_key_path;
    use std::path::Path;

    #[cfg(windows)]
    fn with_temp_home<T>(f: impl FnOnce(&Path) -> T) -> T {
        let _env = crate::test_support::EnvGuard::new(&["HOME", "USERPROFILE"]);
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
        f(&home)
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_allows_windows_home_ssh_key() {
        with_temp_home(|home| {
            let key = home.join(".ssh").join("id_ed25519");
            std::fs::write(&key, "key").unwrap();

            let resolved = validate_key_path(&key.to_string_lossy()).unwrap();

            assert_eq!(resolved, key.canonicalize().unwrap());
        });
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_allows_windows_long_path_prefix() {
        with_temp_home(|home| {
            let key = home.join(".ssh").join("id_ed25519");
            std::fs::write(&key, "key").unwrap();
            let long_path = format!(r"\\?\{}", key.display());

            let resolved = validate_key_path(&long_path).unwrap();

            assert_eq!(resolved, key.canonicalize().unwrap());
        });
    }

    #[cfg(windows)]
    #[test]
    fn allowed_key_path_accepts_windows_long_path_prefix() {
        assert!(is_allowed_key_path(
            Path::new(r"\\?\C:\Users\me\.ssh\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    // 验证 .ssh_evil 这类前缀相似目录不能绕过 .ssh 边界。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_rejects_windows_ssh_prefix_sibling() {
        assert!(!is_allowed_key_path(
            Path::new(r"C:\Users\me\.ssh_evil\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    // 验证 Windows 路径比较兼容大小写差异和 /、\ 混用。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_accepts_windows_case_and_separator_variants() {
        assert!(is_allowed_key_path(
            Path::new(r"C:/USERS/me/.SSH/id_ed25519"),
            Path::new(r"c:\users\ME\.ssh"),
        ));
    }

    // 验证带 \\?\ 前缀的相似目录仍不能绕过 .ssh 边界。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_rejects_windows_long_path_prefix_sibling() {
        assert!(!is_allowed_key_path(
            Path::new(r"\\?\C:\Users\me\.ssh_evil\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_rejects_key_outside_home_ssh() {
        with_temp_home(|home| {
            let outside = home.parent().unwrap().join("outside_id_ed25519");
            std::fs::write(&outside, "key").unwrap();

            let err = validate_key_path(&outside.to_string_lossy()).unwrap_err();

            assert!(err.contains("%USERPROFILE%"));
        });
    }

    // 验证 Windows 下 USERPROFILE 优先于 HOME，HOME\.ssh 中的 key 不应放行。
    #[cfg(windows)]
    #[test]
    fn validate_key_path_prefers_userprofile_over_home() {
        let _env = crate::test_support::EnvGuard::new(&["HOME", "USERPROFILE"]);
        let tmp = tempfile::tempdir().unwrap();
        let userprofile = tmp.path().join("userprofile");
        let home = tmp.path().join("home");
        std::fs::create_dir_all(userprofile.join(".ssh")).unwrap();
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::env::set_var("USERPROFILE", &userprofile);
        std::env::set_var("HOME", &home);
        let home_key = home.join(".ssh").join("id_ed25519");
        std::fs::write(&home_key, "key").unwrap();

        let err = validate_key_path(&home_key.to_string_lossy()).unwrap_err();

        assert!(err.contains("%USERPROFILE%"), "unexpected error: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn allowed_key_path_allows_etc_ssh_on_unix() {
        assert!(is_allowed_key_path(
            Path::new("/etc/ssh/ssh_host_ed25519_key"),
            Path::new("/home/me/.ssh"),
        ));
    }
}

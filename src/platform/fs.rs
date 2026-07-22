#![allow(clippy::missing_errors_doc)]

use std::path::Path;

pub fn create_dir_symlink(src: &Path, link: &Path) -> Result<(), String> {
    create_dir_symlink_impl(src, link).map_err(|e| format_symlink_error(&e))
}

#[must_use]
pub fn path_exists_or_symlink(path: &Path) -> bool {
    path.exists() || std::fs::symlink_metadata(path).is_ok()
}

pub fn remove_symlink_or_file(path: &Path) -> Result<(), String> {
    remove_symlink_or_file_impl(path).map_err(|e| format!("remove symlink failed: {e}"))
}

pub fn remove_plugin_path(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || meta.file_type().is_file() {
        remove_symlink_or_file(path)
    } else {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
    }
}

pub fn set_executable(path: &Path) -> Result<(), String> {
    set_executable_impl(path).map_err(|e| e.to_string())
}

pub fn validate_private_key_permissions(path: &Path) -> Result<(), String> {
    validate_private_key_permissions_impl(path)
}

#[cfg(unix)]
pub fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
pub fn set_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn create_dir_symlink_impl(src: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, link)
}

#[cfg(windows)]
fn create_dir_symlink_impl(src: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(src, link)
}

#[cfg(not(any(unix, windows)))]
fn create_dir_symlink_impl(_src: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "directory symlinks are not supported on this platform",
    ))
}

#[cfg(unix)]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    let file_type = meta.file_type();
    if file_type.is_symlink() || file_type.is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(windows)]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::FileTypeExt;

    let meta = std::fs::symlink_metadata(path)?;
    let file_type = meta.file_type();
    if file_type.is_symlink_dir() {
        std::fs::remove_dir(path)
    } else if file_type.is_symlink_file() || file_type.is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(not(any(unix, windows)))]
fn remove_symlink_or_file_impl(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_file() {
        std::fs::remove_file(path)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "refusing to remove a real directory",
        ))
    }
}

#[cfg(unix)]
fn set_executable_impl(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut perms = std::fs::metadata(path)?.permissions();
    let current = perms.mode();
    let desired = current | 0o111;
    if current == desired {
        return Ok(());
    }
    perms.set_mode(desired);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn set_executable_impl(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn validate_private_key_permissions_impl(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let perms = std::fs::metadata(path)
        .map_err(|e| format!("Cannot read key file metadata: {e}"))?
        .permissions();
    if perms.mode() & 0o077 != 0 {
        return Err("Key file permissions are too open (should be 0600 or 0400)".into());
    }
    Ok(())
}

#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn validate_private_key_permissions_impl(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn format_symlink_error(e: &std::io::Error) -> String {
    #[cfg(windows)]
    {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            return format!(
                "symlink failed: {e}. On Windows, enable Developer Mode or run as Administrator."
            );
        }
    }

    format!("symlink failed: {e}")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::{create_dir_symlink, path_exists_or_symlink, remove_symlink_or_file};

    fn create_dir_symlink_or_skip(src: &std::path::Path, link: &std::path::Path) -> bool {
        match create_dir_symlink(src, link) {
            Ok(()) => true,
            Err(e) if e.contains("symlink failed") || e.contains("not supported") => {
                eprintln!("skipping symlink-dependent assertion: {e}");
                false
            }
            Err(e) => panic!("unexpected symlink creation error: {e}"),
        }
    }

    // 验证 remove_symlink_or_file 不会删除真实目录，避免误删插件源目录。
    #[test]
    fn remove_symlink_or_file_rejects_real_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let real_dir = tmp.path().join("real-dir");
        std::fs::create_dir(&real_dir).unwrap();

        let err = remove_symlink_or_file(&real_dir).unwrap_err();

        assert!(err.contains("refusing to remove a real directory"), "unexpected error: {err}");
        assert!(real_dir.is_dir());
    }

    // 验证删除目录 symlink 只移除链接本身，不影响目标目录。
    #[test]
    fn remove_symlink_or_file_removes_directory_symlink_without_touching_target() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        let link = tmp.path().join("link");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("sentinel.txt"), "still here").unwrap();

        if !create_dir_symlink_or_skip(&target, &link) {
            return;
        }

        remove_symlink_or_file(&link).unwrap();

        assert!(!path_exists_or_symlink(&link));
        assert!(target.join("sentinel.txt").is_file());
    }

    // 验证 broken symlink 仍被视为存在，便于后续扫描和清理。
    #[test]
    fn path_exists_or_symlink_treats_broken_symlink_as_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        let link = tmp.path().join("broken-link");
        std::fs::create_dir(&target).unwrap();

        if !create_dir_symlink_or_skip(&target, &link) {
            return;
        }
        std::fs::remove_dir(&target).unwrap();

        assert!(path_exists_or_symlink(&link));

        remove_symlink_or_file(&link).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn set_executable_preserves_permissions_and_skips_repeated_chmod() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let tmp = tempfile::tempdir().unwrap();
        let executable = tmp.path().join("tool");
        std::fs::write(&executable, b"tool").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o640)).unwrap();

        super::set_executable(&executable).unwrap();
        let first = std::fs::metadata(&executable).unwrap();
        assert_eq!(first.permissions().mode() & 0o777, 0o751);

        std::thread::sleep(std::time::Duration::from_millis(10));
        super::set_executable(&executable).unwrap();
        let second = std::fs::metadata(&executable).unwrap();
        assert_eq!((first.ctime(), first.ctime_nsec()), (second.ctime(), second.ctime_nsec()));
    }
}

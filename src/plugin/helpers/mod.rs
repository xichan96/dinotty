mod archive;
mod validation;

pub use archive::{extract_tar_gz, extract_zip};
pub use validation::{
    is_compatible, require_native_approval, resolve_binary, set_executable, validate_manifest,
    validate_min_app_version,
};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

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
    if name == "node_modules" {
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
    use super::copy_plugin_dir;

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
        assert!(!dest.join("node_modules").exists());
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

use crate::session::Session;

/// Resolve a relative path for SSH file browsing. SSH sessions have full shell
/// access, so the default tree root is `/` (not `cwd_state.cwd`).
///
/// - Empty path -> `/`  (tree root is the filesystem root)
/// - Absolute path -> as-is
/// - `~` / `~/…` -> remote home expansion
/// - Relative path -> joined against `/` (cwd param ignored - see below)
pub(super) fn resolve_remote_rel(session: &Session, rel: &str, _cwd: Option<&str>) -> String {
    let rel = rel.trim();
    if rel.is_empty() {
        return "/".to_string();
    }
    if rel.starts_with('/') {
        return rel.to_string();
    }
    if let Some(rest) = rel.strip_prefix("~/") {
        let home = session.remote_home.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let home_str =
            home.as_ref().map_or_else(|| "/".to_string(), |h| h.to_string_lossy().into_owned());
        return format!("{home_str}/{rest}");
    }
    if rel == "~" {
        let home = session.remote_home.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        return home.as_ref().map_or_else(|| "/".to_string(), |h| h.to_string_lossy().into_owned());
    }
    // SSH tree rel paths are always relative to / (the filesystem root).
    // The cwd parameter is ignored - using it as base would double-prefix
    // paths (e.g. /home/user + home/user/x -> /home/user/home/user/x).
    normalize_remote_join("/", rel)
}

pub(super) fn normalize_remote_join(root: &str, rel: &str) -> String {
    let rel = rel.trim().trim_start_matches('/');
    if rel.split('/').any(|p| p == "..") {
        return root.to_string(); // reject .. traversal
    }
    let mut out = root.trim_end_matches('/').to_string();
    for seg in rel.split('/').filter(|s| !s.is_empty() && *s != ".") {
        out.push('/');
        out.push_str(seg);
    }
    out
}

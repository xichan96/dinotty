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

/// Resolve a path emitted by terminal output (compiler/test/agent output) for
/// an SSH pane. Unlike [`resolve_remote_rel`], relative paths are anchored at
/// the pane's live cwd, because that is what the terminal process sees.
pub(super) fn resolve_remote_terminal_path(session: &Session, raw: &str) -> String {
    let cwd = session.cwd_for_workspace().map_or_else(
        || "/".to_string(),
        |p| p.to_string_lossy().replace('\\', "/"),
    );
    let home = session
        .remote_home
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .map(|h| h.to_string_lossy().replace('\\', "/"));
    resolve_remote_terminal_path_with(&cwd, home.as_deref(), raw)
}

fn resolve_remote_terminal_path_with(cwd: &str, home: Option<&str>, raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return cwd.to_string();
    }
    if raw.starts_with('/') {
        return raw.to_string();
    }
    if raw == "~" {
        return home.unwrap_or("/").to_string();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        let home = home.unwrap_or("/").trim_end_matches('/');
        return if home.is_empty() { format!("/{rest}") } else { format!("{home}/{rest}") };
    }
    normalize_remote_join(cwd, raw)
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

#[cfg(test)]
mod tests {
    use super::resolve_remote_terminal_path_with;

    #[test]
    fn terminal_relative_paths_join_cwd() {
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "src/a.rs"),
            "/home/u/proj/src/a.rs"
        );
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "./src/a.rs"),
            "/home/u/proj/src/a.rs"
        );
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "README.md"),
            "/home/u/proj/README.md"
        );
    }

    #[test]
    fn terminal_absolute_path_is_unchanged() {
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "/etc/hosts"),
            "/etc/hosts"
        );
    }

    #[test]
    fn terminal_tilde_uses_remote_home() {
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "~/notes.md"),
            "/home/u/notes.md"
        );
        assert_eq!(
            resolve_remote_terminal_path_with("/home/u/proj", Some("/home/u"), "~"),
            "/home/u"
        );
        assert_eq!(resolve_remote_terminal_path_with("/home/u/proj", None, "~/a"), "/a");
    }

    #[test]
    fn terminal_empty_path_uses_cwd() {
        assert_eq!(resolve_remote_terminal_path_with("/home/u/proj", None, ""), "/home/u/proj");
    }
}

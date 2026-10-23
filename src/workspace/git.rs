use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};

use crate::{platform::process::CommandNoWindowExt, session::SessionManager};

use super::util::try_res;
use super::{get_root, json_err, normalize_join, PanePathQuery, PaneQuery};

fn git_command() -> std::process::Command {
    let mut command = std::process::Command::new("git");
    command.no_window();
    command
}

#[derive(Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct GitStatusResponse {
    pub is_git_repo: bool,
    pub files: Vec<GitFileStatus>,
}

/// Collect workspace-relative git status entries for `root`.
///
/// `git status` reports paths relative to the repository root, while the file
/// tree keys are relative to the pane cwd (which may be a subdirectory). The
/// `--show-prefix` value (also root-relative) is stripped from each path so the
/// two coordinate systems agree. Returns `None` when `root` is not a git
/// repository (or `git` itself failed).
fn git_status_files(root: &Path) -> Option<Vec<GitFileStatus>> {
    let prefix_out =
        git_command().args(["rev-parse", "--show-prefix"]).current_dir(root).output().ok()?;
    if !prefix_out.status.success() {
        return None;
    }
    let prefix = String::from_utf8_lossy(&prefix_out.stdout);
    let prefix = prefix.trim_end_matches(['\r', '\n']);

    let status_out =
        git_command().args(["status", "--porcelain", "-z"]).current_dir(root).output().ok()?;
    if !status_out.status.success() {
        return None;
    }
    Some(parse_porcelain_z(&status_out.stdout, prefix))
}

/// Parse `git status --porcelain -z` output.
///
/// `-z` separates entries with NUL and reports paths verbatim (no C-quoting),
/// so non-ASCII names and names containing `" -> "` survive intact. Rename and
/// copy entries carry the destination path in the entry itself and the source
/// path as the following NUL-delimited record; the latter is consumed and
/// discarded.
fn parse_porcelain_z(stdout: &[u8], prefix: &str) -> Vec<GitFileStatus> {
    let mut files = Vec::new();
    let mut records = stdout.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let (x, y) = (record[0], record[1]);
        if x == b'R' || y == b'R' || x == b'C' || y == b'C' {
            records.next();
        }
        let raw_path = String::from_utf8_lossy(&record[3..]);
        let Some(path) = raw_path.strip_prefix(prefix) else {
            continue; // outside the pane's cwd
        };
        let status = match (x, y) {
            (b'?', b'?') => "untracked",
            (b'A', b' ') | (b'A', b'M') => "staged_new",
            (b'M', b' ') | (b'M', b'M') => "staged_modified",
            (b'D', b' ') => "staged_deleted",
            (b' ', b'D') => "deleted",
            (b'R', _) | (_, b'R') => "renamed",
            _ => "modified",
        };
        files.push(GitFileStatus { path: path.to_string(), status: status.to_string() });
    }
    files
}

pub async fn workspace_git_status(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PaneQuery>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let files = match tokio::task::spawn_blocking(move || git_status_files(&root)).await {
        Ok(Some(files)) => files,
        _ => return Json(GitStatusResponse { is_git_repo: false, files: vec![] }).into_response(),
    };
    Json(GitStatusResponse { is_git_repo: true, files }).into_response()
}

#[derive(Serialize)]
pub struct GitChange {
    #[serde(rename = "type")]
    pub change_type: String,
    pub modified_start: usize,
    pub modified_end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_end: Option<usize>,
}

#[derive(Serialize)]
pub struct GitDiffResponse {
    pub is_git_repo: bool,
    pub original_content: Option<String>,
    pub changes: Vec<GitChange>,
}

pub async fn workspace_git_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
    let no_git = || {
        Json(GitDiffResponse { is_git_repo: false, original_content: None, changes: vec![] })
            .into_response()
    };
    let root = try_res!(get_root(&manager, &q.pane_id));
    let git_check = tokio::task::spawn_blocking({
        let root = root.clone();
        move || git_command().args(["rev-parse", "--git-dir"]).current_dir(&root).output()
    })
    .await;
    match git_check {
        Ok(Ok(o)) if o.status.success() => {}
        _ => return no_git(),
    }
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return no_git();
    }
    let original = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.to_string();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original_content = match original {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return no_git(),
    };
    let target = try_res!(normalize_join(&root, rel));
    let Ok(current) = std::fs::read_to_string(&target) else { return no_git() };
    let diff = similar::TextDiff::from_lines(&original_content, &current);
    let mut changes: Vec<GitChange> = Vec::new();
    let mut orig_line = 1usize;
    let mut mod_line = 1usize;

    for op in diff.ops() {
        match op {
            similar::DiffOp::Equal { old_index: _, new_index: _, len } => {
                orig_line += len;
                mod_line += len;
            }
            similar::DiffOp::Insert { old_index: _, new_index: _, new_len } => {
                changes.push(GitChange {
                    change_type: "added".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line + new_len - 1,
                    original_start: Some(orig_line),
                    original_end: None,
                });
                mod_line += new_len;
            }
            similar::DiffOp::Delete { old_index: _, old_len, new_index: _ } => {
                changes.push(GitChange {
                    change_type: "deleted".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line,
                    original_start: Some(orig_line),
                    original_end: Some(orig_line + old_len - 1),
                });
                orig_line += old_len;
            }
            similar::DiffOp::Replace { old_index: _, old_len, new_index: _, new_len } => {
                changes.push(GitChange {
                    change_type: "modified".to_string(),
                    modified_start: mod_line,
                    modified_end: mod_line + new_len - 1,
                    original_start: Some(orig_line),
                    original_end: Some(orig_line + old_len - 1),
                });
                orig_line += old_len;
                mod_line += new_len;
            }
        }
    }

    Json(GitDiffResponse { is_git_repo: true, original_content: Some(original_content), changes })
        .into_response()
}

#[derive(Deserialize)]
pub struct GitStageBody {
    pub start_line: usize,
    pub end_line: usize,
}

#[allow(clippy::too_many_lines)]
pub async fn workspace_git_stage_lines(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<GitStageBody>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "path required");
    }
    let original_out = tokio::task::spawn_blocking({
        let root = root.clone();
        let rel = rel.to_string();
        move || git_command().args(["show", &format!("HEAD:{rel}")]).current_dir(&root).output()
    })
    .await;
    let original = match original_out {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => String::new(),
    };
    let target = try_res!(normalize_join(&root, rel));
    let current = match std::fs::read_to_string(&target) {
        Ok(c) => c,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let orig_lines: Vec<&str> = original.lines().collect();
    let cur_lines: Vec<&str> = current.lines().collect();
    let diff = similar::TextDiff::from_slices(&orig_lines, &cur_lines);
    let mut staged_lines: Vec<String> = Vec::new();
    let mut mod_line = 1usize;
    for op in diff.ops() {
        match op {
            similar::DiffOp::Equal { old_index, len, .. } => {
                for i in 0..*len {
                    staged_lines.push(orig_lines[old_index + i].to_string());
                }
                mod_line += len;
            }
            similar::DiffOp::Insert { new_index, new_len, .. } => {
                for i in 0..*new_len {
                    let line_num = mod_line + i;
                    if line_num >= body.start_line && line_num <= body.end_line {
                        staged_lines.push(cur_lines[new_index + i].to_string());
                    }
                }
                mod_line += new_len;
            }
            similar::DiffOp::Delete { old_index, old_len, .. } => {
                for i in 0..*old_len {
                    if mod_line >= body.start_line && mod_line <= body.end_line {
                        // staged: omit these lines (accept deletion)
                    } else {
                        staged_lines.push(orig_lines[old_index + i].to_string());
                    }
                }
            }
            similar::DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let in_range =
                    mod_line >= body.start_line && mod_line + new_len - 1 <= body.end_line;
                if in_range {
                    for i in 0..*new_len {
                        staged_lines.push(cur_lines[new_index + i].to_string());
                    }
                } else {
                    for i in 0..*old_len {
                        staged_lines.push(orig_lines[old_index + i].to_string());
                    }
                }
                mod_line += new_len;
            }
        }
    }
    let staged_content = staged_lines.join("\n");
    let mut patch = format!("--- a/{rel}\n+++ b/{rel}\n");
    let udiff = similar::TextDiff::from_lines(&original, &staged_content);
    for hunk in udiff.unified_diff().context_radius(3).iter_hunks() {
        patch.push_str(&hunk.to_string());
    }
    if patch.lines().count() <= 2 {
        return Json(serde_json::json!({ "ok": true })).into_response();
    }
    let result = tokio::task::spawn_blocking(move || {
        git_command()
            .args(["apply", "--cached", "--unidiff-zero"])
            .stdin(std::process::Stdio::piped())
            .current_dir(&root)
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(ref mut stdin) = child.stdin {
                    stdin.write_all(patch.as_bytes())?;
                }
                child.wait()
            })
    })
    .await;
    match result {
        Ok(Ok(s)) if s.success() => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(Ok(s)) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("git apply failed: {s}")),
        Ok(Err(e)) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct GitRevertBody {
    pub start_line: usize,
    pub end_line: usize,
    pub original_lines: String,
}

pub async fn workspace_git_revert_lines(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<GitRevertBody>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let rel = q.path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return json_err(StatusCode::BAD_REQUEST, "path required");
    }
    let target = try_res!(normalize_join(&root, rel));
    let current = match std::fs::read_to_string(&target) {
        Ok(c) => c,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let lines: Vec<&str> = current.lines().collect();
    let start = body.start_line.saturating_sub(1);
    let end = body.end_line.min(lines.len());
    let mut result_lines: Vec<&str> = Vec::new();
    result_lines.extend_from_slice(&lines[..start]);
    for l in body.original_lines.lines() {
        result_lines.push(l);
    }
    if end < lines.len() {
        result_lines.extend_from_slice(&lines[end..]);
    }
    let new_content = result_lines.join("\n");
    let trailing = current.ends_with('\n');
    let write_content = if trailing && !new_content.ends_with('\n') {
        format!("{new_content}\n")
    } else {
        new_content
    };
    if let Err(e) = std::fs::write(&target, write_content.as_bytes()) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        git(tmp.path(), &["init", "-q"]);
        git(tmp.path(), &["config", "user.email", "test@example.com"]);
        git(tmp.path(), &["config", "user.name", "test"]);
        tmp
    }

    /// Status entries as sorted `(path, status)` pairs.
    fn status_pairs(dir: &Path) -> Vec<(String, String)> {
        let mut files = git_status_files(dir).expect("expected a git repository");
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files.into_iter().map(|f| (f.path, f.status)).collect()
    }

    fn pair(path: &str, status: &str) -> (String, String) {
        (path.to_string(), status.to_string())
    }

    #[test]
    fn git_status_paths_are_relative_to_repo_root() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.txt"), "a\n").unwrap();
        fs::write(root.join("b.txt"), "b\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "init"]);

        fs::write(root.join("sub/a.txt"), "a2\n").unwrap();
        fs::write(root.join("new.txt"), "n\n").unwrap();

        assert_eq!(
            status_pairs(root),
            vec![pair("new.txt", "untracked"), pair("sub/a.txt", "modified")]
        );
    }

    #[test]
    fn git_status_from_subdirectory_is_relative_to_cwd() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.txt"), "a\n").unwrap();
        fs::write(root.join("b.txt"), "b\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "init"]);

        fs::write(root.join("sub/a.txt"), "a2\n").unwrap();
        fs::write(root.join("b.txt"), "b2\n").unwrap();

        let sub = root.join("sub");
        assert_eq!(status_pairs(&sub), vec![pair("a.txt", "modified")]);
    }

    #[test]
    fn git_status_rename_uses_destination_path() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::write(root.join("old.txt"), "content long enough for rename detection 0123456789\n")
            .unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "init"]);
        git(root, &["mv", "old.txt", "renamed.txt"]);

        assert_eq!(status_pairs(root), vec![pair("renamed.txt", "renamed")]);
    }

    #[test]
    fn git_status_rename_inside_subdirectory() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/old.txt"), "content long enough for rename detection 0123456789\n")
            .unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "init"]);
        git(root, &["mv", "sub/old.txt", "sub/new.txt"]);

        assert_eq!(status_pairs(&root.join("sub")), vec![pair("new.txt", "renamed")]);
    }

    #[test]
    fn git_status_preserves_unicode_paths() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::write(root.join("中文文件.txt"), "u\n").unwrap();

        assert_eq!(status_pairs(root), vec![pair("中文文件.txt", "untracked")]);
    }

    #[test]
    fn git_status_preserves_paths_containing_arrow() {
        let tmp = init_repo();
        let root = tmp.path();
        fs::write(root.join("weird -> name.txt"), "w\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "init"]);
        fs::write(root.join("weird -> name.txt"), "w2\n").unwrap();

        assert_eq!(status_pairs(root), vec![pair("weird -> name.txt", "modified")]);
    }

    #[test]
    fn git_status_outside_repository_is_none() {
        let tmp = TempDir::new().unwrap();
        assert!(git_status_files(tmp.path()).is_none());
    }
}

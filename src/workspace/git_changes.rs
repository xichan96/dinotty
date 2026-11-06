//! Read-only git data for the "Changes" panel.
//!
//! This module is intentionally separate from [`super::git`], which powers the
//! editor gutter diff and the stage/revert line actions. The endpoints here
//! describe repository changes relative to the pane cwd (`/git-changes`) and
//! return whole-file contents for the side-by-side changes view
//! (`/git-file-diff`).
//!
//! Everything that shells out to git runs inside `spawn_blocking`: these
//! handlers execute from the same async router as the rest of the workspace
//! API, and git can block for a while on a cold or networked checkout.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    process::Output,
    sync::Arc,
};

use crate::session::SessionManager;

use super::git::git_command;
use super::util::{json_err, ssh_session, try_res};
use super::{get_root, normalize_join, PaneQuery};

/// Hard-coded empty tree object, used as the diff base for an unborn HEAD.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/// Files are sniffed for NUL bytes in their first 8 KiB.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
/// Untracked files at or above this size are not line-counted.
const MAX_UNTRACKED_FILE_BYTES: u64 = 1024 * 1024;
/// Total bytes we are willing to read while counting untracked files.
const MAX_UNTRACKED_TOTAL_BYTES: u64 = 8 * 1024 * 1024;
/// Maximum number of untracked files we line-count per request.
const MAX_UNTRACKED_COUNTED_FILES: usize = 300;
/// Cap for the change list itself.
const MAX_CHANGE_FILES: usize = 2000;
/// Either side larger than this makes the whole diff "too large".
const MAX_DIFF_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct WorkspaceChangesSummary {
    pub files: usize,
    pub additions: u64,
    pub deletions: u64,
    pub counts_complete: bool,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceChangeFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub status: &'static str,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    pub conflicted: bool,
    pub submodule: bool,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceChangesResponse {
    pub is_git_repo: bool,
    pub repo_root: Option<String>,
    pub head: Option<String>,
    pub summary: WorkspaceChangesSummary,
    pub files: Vec<WorkspaceChangeFile>,
}

#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct WorkspaceGitFileDiffResponse {
    pub is_git_repo: bool,
    pub path: String,
    pub orig_path: Option<String>,
    pub base: String,
    pub original: Option<String>,
    pub modified: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub submodule: bool,
    pub conflicted: bool,
}

#[derive(Deserialize)]
pub struct GitFileDiffQuery {
    pub pane_id: String,
    pub path: String,
    #[serde(default)]
    pub orig_path: Option<String>,
    #[serde(default = "default_base")]
    pub base: String,
}

fn default_base() -> String {
    "head".to_string()
}

pub async fn workspace_git_changes(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PaneQuery>,
) -> Response {
    if ssh_session(&manager, &q.pane_id).is_some() {
        return json_err(StatusCode::CONFLICT, "git_unavailable_for_backend");
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    match tokio::task::spawn_blocking(move || collect_changes(&root)).await {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(e)) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

pub async fn workspace_git_file_diff(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<GitFileDiffQuery>,
) -> Response {
    if ssh_session(&manager, &q.pane_id).is_some() {
        return json_err(StatusCode::CONFLICT, "git_unavailable_for_backend");
    }
    if q.base != "head" {
        return json_err(StatusCode::BAD_REQUEST, "unsupported base");
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let result = tokio::task::spawn_blocking(move || {
        collect_file_diff(&root, &q.path, q.orig_path.as_deref())
    })
    .await;
    match result {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err((status, message))) => json_err(status, &message),
        Err(e) => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

fn run_git(dir: &Path, args: &[&str]) -> io::Result<Output> {
    git_command().args(args).current_dir(dir).output()
}

/// Run git and return stdout when it exited successfully, `None` on a normal
/// (non-success) exit such as `rev-parse --show-toplevel` outside a repo.
fn run_git_stdout(dir: &Path, args: &[&str]) -> io::Result<Option<Vec<u8>>> {
    let out = run_git(dir, args)?;
    Ok(out.status.success().then_some(out.stdout))
}

fn trim_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end_matches(['\r', '\n']).to_string()
}

struct RepoInfo {
    root: PathBuf,
    /// Value of `git rev-parse --show-prefix`: cwd relative to the repo root,
    /// with a trailing slash (empty at the root).
    prefix: String,
    head: Option<String>,
}

fn repo_info(dir: &Path) -> io::Result<Option<RepoInfo>> {
    let Some(top) = run_git_stdout(dir, &["rev-parse", "--show-toplevel"])? else {
        return Ok(None);
    };
    let root = PathBuf::from(trim_line(&top));
    let prefix = match run_git_stdout(dir, &["rev-parse", "--show-prefix"])? {
        Some(out) => trim_line(&out),
        None => String::new(),
    };
    let head = run_git_stdout(dir, &["rev-parse", "--verify", "HEAD"])?
        .map(|out| trim_line(&out))
        .filter(|sha| !sha.is_empty());
    Ok(Some(RepoInfo { root, prefix, head }))
}

// ---------------------------------------------------------------------------
// /git-changes
// ---------------------------------------------------------------------------

fn not_repo_changes() -> WorkspaceChangesResponse {
    WorkspaceChangesResponse {
        is_git_repo: false,
        repo_root: None,
        head: None,
        summary: WorkspaceChangesSummary {
            files: 0,
            additions: 0,
            deletions: 0,
            counts_complete: true,
            truncated: false,
        },
        files: Vec::new(),
    }
}

struct StatusEntry {
    path: String,
    orig_path: Option<String>,
    index_status: String,
    worktree_status: String,
    status: &'static str,
}

fn map_status(x: u8, y: u8) -> &'static str {
    match (x, y) {
        (b'?', b'?') => "untracked",
        (b'U', b'U' | b'A' | b'D') | (b'A' | b'D', b'U') | (b'A', b'A') | (b'D', b'D') => {
            "conflicted"
        }
        (b'R', _) | (_, b'R') => "renamed",
        (b'A', _) | (_, b'A') => "added",
        (b'D', _) | (_, b'D') => "deleted",
        (b'T', _) | (_, b'T') => "typechange",
        _ => "modified",
    }
}

/// Parse `git status --porcelain=v1 -z --untracked-files=all`.
///
/// `-z` keeps paths verbatim (no C-quoting), so unicode names and names
/// containing `" -> "` survive. Rename/copy entries put the destination in
/// the entry and the source in the following NUL-delimited record.
fn parse_status_z(stdout: &[u8], prefix: &str) -> Vec<StatusEntry> {
    let mut files = Vec::new();
    let mut records = stdout.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let (x, y) = (record[0], record[1]);
        let raw_path = String::from_utf8_lossy(&record[3..]);
        let raw_orig = if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            records.next().map(|r| String::from_utf8_lossy(r).into_owned())
        } else {
            None
        };
        // `git status` reports repo-root-relative paths; the explorer is
        // cwd-relative, so drop the `--show-prefix` value.
        let Some(path) = raw_path.strip_prefix(prefix) else {
            continue;
        };
        let orig_path =
            raw_orig.as_deref().and_then(|orig| orig.strip_prefix(prefix)).map(ToString::to_string);
        files.push(StatusEntry {
            path: path.to_string(),
            orig_path,
            index_status: (x as char).to_string(),
            worktree_status: (y as char).to_string(),
            status: map_status(x, y),
        });
    }
    files
}

struct NumStat {
    additions: Option<u64>,
    deletions: Option<u64>,
    binary: bool,
}

/// Parse `git diff --numstat -z`. Renames emit an empty path field followed by
/// the source and destination records; counts are keyed by the destination.
fn parse_numstat_z(stdout: &[u8]) -> HashMap<String, NumStat> {
    let mut map = HashMap::new();
    let mut records = stdout.split(|b| *b == 0);
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(3, |b| *b == b'\t');
        let (Some(add), Some(del), Some(path)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let stat = match (parse_count(add), parse_count(del)) {
            (Some(additions), Some(deletions)) => {
                NumStat { additions: Some(additions), deletions: Some(deletions), binary: false }
            }
            _ => NumStat { additions: None, deletions: None, binary: true },
        };
        if path.is_empty() {
            let Some(_source) = records.next() else { break };
            let Some(dest) = records.next() else { break };
            map.insert(String::from_utf8_lossy(dest).into_owned(), stat);
        } else {
            map.insert(String::from_utf8_lossy(path).into_owned(), stat);
        }
    }
    map
}

fn parse_count(bytes: &[u8]) -> Option<u64> {
    std::str::from_utf8(bytes).ok()?.parse().ok()
}

/// Collect paths whose index entry has mode `160000` (gitlink/submodule).
fn parse_submodule_paths(stdout: &[u8]) -> HashSet<String> {
    let mut paths = HashSet::new();
    for record in stdout.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let Some(tab) = record.iter().position(|b| *b == b'\t') else {
            continue;
        };
        let meta = String::from_utf8_lossy(&record[..tab]);
        if meta.split_whitespace().next() == Some("160000") {
            paths.insert(String::from_utf8_lossy(&record[tab + 1..]).into_owned());
        }
    }
    paths
}

fn sniff_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|b| *b == 0)
}

#[allow(clippy::naive_bytecount)] // `bytecount` is not a direct dependency.
fn count_lines(bytes: &[u8]) -> u64 {
    if bytes.is_empty() {
        return 0;
    }
    let newlines = u64::try_from(bytes.iter().filter(|b| **b == b'\n').count()).unwrap_or(u64::MAX);
    if bytes[bytes.len() - 1] == b'\n' {
        newlines
    } else {
        newlines.saturating_add(1)
    }
}

struct Counts {
    additions: Option<u64>,
    deletions: Option<u64>,
    binary: bool,
}

fn skipped_counts() -> Counts {
    Counts { additions: None, deletions: None, binary: false }
}

/// Line counters for untracked files, bounded by the module-level caps.
#[derive(Default)]
struct UntrackedCounter {
    total_bytes: u64,
    counted: usize,
    /// Some file could not be counted within the caps.
    incomplete: bool,
    /// A cumulative cap was reached; stop reading further files.
    exhausted: bool,
}

impl UntrackedCounter {
    fn count(&mut self, path: &Path) -> Counts {
        if self.exhausted {
            self.incomplete = true;
            return skipped_counts();
        }
        let Ok(meta) = std::fs::metadata(path) else {
            self.incomplete = true;
            return skipped_counts();
        };
        if !meta.is_file() {
            self.incomplete = true;
            return skipped_counts();
        }
        let size = meta.len();
        if size > MAX_UNTRACKED_FILE_BYTES {
            self.incomplete = true;
            return skipped_counts();
        }
        if self.counted >= MAX_UNTRACKED_COUNTED_FILES
            || self.total_bytes.saturating_add(size) > MAX_UNTRACKED_TOTAL_BYTES
        {
            self.exhausted = true;
            self.incomplete = true;
            return skipped_counts();
        }
        let Ok(bytes) = std::fs::read(path) else {
            self.incomplete = true;
            return skipped_counts();
        };
        self.total_bytes = self.total_bytes.saturating_add(size);
        self.counted += 1;
        if sniff_binary(&bytes) {
            return Counts { additions: None, deletions: None, binary: true };
        }
        Counts { additions: Some(count_lines(&bytes)), deletions: Some(0), binary: false }
    }
}

fn collect_changes(cwd: &Path) -> io::Result<WorkspaceChangesResponse> {
    let Some(info) = repo_info(cwd)? else {
        return Ok(not_repo_changes());
    };

    let status = run_git_stdout(cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?
        .ok_or_else(|| io::Error::other("git status failed"))?;
    let entries = parse_status_z(&status, &info.prefix);

    let base = info.head.as_deref().unwrap_or(EMPTY_TREE);
    let numstat = run_git_stdout(cwd, &["diff", "--numstat", "-z", base])?
        .map(|out| parse_numstat_z(&out))
        .unwrap_or_default();
    let submodules = run_git_stdout(cwd, &["ls-files", "-s", "-z"])?
        .map(|out| parse_submodule_paths(&out))
        .unwrap_or_default();

    let mut counter = UntrackedCounter::default();
    let mut files = Vec::with_capacity(entries.len());
    for entry in entries {
        let mut file = WorkspaceChangeFile {
            path: entry.path,
            orig_path: entry.orig_path,
            index_status: entry.index_status,
            worktree_status: entry.worktree_status,
            status: entry.status,
            additions: None,
            deletions: None,
            binary: false,
            conflicted: entry.status == "conflicted",
            submodule: false,
        };
        if file.status == "untracked" {
            let counts = counter.count(&cwd.join(&file.path));
            file.additions = counts.additions;
            file.deletions = counts.deletions;
            file.binary = counts.binary;
        } else {
            file.submodule = submodules.contains(&file.path);
            let key = repo_relative(&info.prefix, &file.path);
            if let Some(stat) = numstat.get(&key) {
                file.additions = stat.additions;
                file.deletions = stat.deletions;
                file.binary = stat.binary;
            }
        }
        files.push(file);
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    let truncated = files.len() > MAX_CHANGE_FILES;
    files.truncate(MAX_CHANGE_FILES);

    let mut summary = WorkspaceChangesSummary {
        files: files.len(),
        additions: 0,
        deletions: 0,
        counts_complete: !counter.incomplete,
        truncated,
    };
    for entry in &files {
        if let (Some(additions), Some(deletions)) = (entry.additions, entry.deletions) {
            summary.additions = summary.additions.saturating_add(additions);
            summary.deletions = summary.deletions.saturating_add(deletions);
        }
    }

    Ok(WorkspaceChangesResponse {
        is_git_repo: true,
        repo_root: Some(info.root.to_string_lossy().replace('\\', "/")),
        head: info.head,
        summary,
        files,
    })
}

// ---------------------------------------------------------------------------
// /git-file-diff
// ---------------------------------------------------------------------------

type DiffError = (StatusCode, String);

fn bad_request(message: &str) -> DiffError {
    (StatusCode::BAD_REQUEST, message.to_string())
}

#[allow(clippy::needless_pass_by_value)] // Used directly as a `map_err` handler.
fn internal_error(error: io::Error) -> DiffError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn not_repo_diff(path: &str, orig_path: Option<&str>) -> WorkspaceGitFileDiffResponse {
    WorkspaceGitFileDiffResponse {
        is_git_repo: false,
        path: path.to_string(),
        orig_path: orig_path.map(ToString::to_string),
        base: "head".to_string(),
        original: None,
        modified: None,
        binary: false,
        too_large: false,
        submodule: false,
        conflicted: false,
    }
}

/// Normalize a cwd-relative path without touching the filesystem. Returns
/// `None` when the path escapes upward through `..`.
fn normalize_rel_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('/');
    let mut segments = Vec::new();
    for segment in trimmed.split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            other => segments.push(other),
        }
    }
    Some(segments.join("/"))
}

fn repo_relative(prefix: &str, rel: &str) -> String {
    let prefix = prefix.trim_end_matches('/');
    if prefix.is_empty() {
        rel.to_string()
    } else {
        format!("{prefix}/{rel}")
    }
}

/// Build the absolute path for a repo-relative path and confirm (following
/// symlinks) that it stays inside the repository.
fn checked_repository_path(root: &Path, repo_rel: &str) -> Result<PathBuf, DiffError> {
    let candidate = normalize_join(root, repo_rel).map_err(|_| bad_request("invalid path"))?;
    let root_canon = root.canonicalize().map_err(internal_error)?;
    let mut probe = candidate.as_path();
    loop {
        match probe.canonicalize() {
            Ok(canon) => {
                if canon.starts_with(&root_canon) {
                    return Ok(candidate);
                }
                return Err((StatusCode::FORBIDDEN, "outside repository".to_string()));
            }
            Err(_) => match probe.parent() {
                Some(parent) => probe = parent,
                None => return Err(bad_request("invalid path")),
            },
        }
    }
}

/// XY columns for `repo_rel` from `git status`.
fn status_columns(root: &Path, repo_rel: &str) -> Result<Option<(u8, u8)>, DiffError> {
    let Some(stdout) =
        run_git_stdout(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])
            .map_err(internal_error)?
    else {
        return Ok(None);
    };
    let mut records = stdout.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let (x, y) = (record[0], record[1]);
        let path = String::from_utf8_lossy(&record[3..]);
        if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            records.next();
        }
        if path == repo_rel {
            return Ok(Some((x, y)));
        }
    }
    Ok(None)
}

/// Run `git ls-files` with `args` restricted to one literal pathspec and
/// report whether it produced any record.
fn ls_files_has(root: &Path, args: &[&str], repo_rel: &str) -> Result<bool, DiffError> {
    let spec = format!(":(literal){repo_rel}");
    let mut full = args.to_vec();
    full.push("--");
    full.push(&spec);
    let out = run_git_stdout(root, &full).map_err(internal_error)?;
    Ok(out.is_some_and(|stdout| !stdout.is_empty()))
}

fn index_is_submodule(root: &Path, repo_rel: &str) -> Result<bool, DiffError> {
    let spec = format!(":(literal){repo_rel}");
    let Some(stdout) =
        run_git_stdout(root, &["ls-files", "-s", "-z", "--", &spec]).map_err(internal_error)?
    else {
        return Ok(false);
    };
    Ok(!parse_submodule_paths(&stdout).is_empty())
}

/// Contents of `HEAD:<path>`, or `None` when HEAD is unborn, the file is
/// untracked, or the object does not exist in HEAD.
fn head_content(
    info: &RepoInfo,
    untracked: bool,
    repo_rel: &str,
    orig_repo_rel: Option<&str>,
) -> Result<Option<Vec<u8>>, DiffError> {
    if untracked {
        return Ok(None);
    }
    let Some(head) = info.head.as_deref() else {
        return Ok(None);
    };
    let show_path = orig_repo_rel.unwrap_or(repo_rel);
    let spec = format!("{head}:{show_path}");
    run_git_stdout(&info.root, &["show", &spec]).map_err(internal_error)
}

fn is_binary(bytes: &[u8]) -> bool {
    sniff_binary(bytes) || std::str::from_utf8(bytes).is_err()
}

#[allow(clippy::too_many_lines)]
fn collect_file_diff(
    root: &Path,
    path: &str,
    orig_path: Option<&str>,
) -> Result<WorkspaceGitFileDiffResponse, DiffError> {
    let Some(info) = repo_info(root).map_err(internal_error)? else {
        return Ok(not_repo_diff(path, orig_path));
    };

    let rel = normalize_rel_path(path).ok_or_else(|| bad_request("invalid path"))?;
    if rel.is_empty() {
        return Err(bad_request("path required"));
    }
    let repo_rel = repo_relative(&info.prefix, &rel);
    let full = checked_repository_path(&info.root, &repo_rel)?;

    let orig = match orig_path.map(str::trim).filter(|raw| !raw.is_empty()) {
        Some(raw) => {
            let normalized =
                normalize_rel_path(raw).ok_or_else(|| bad_request("invalid orig_path"))?;
            if normalized.is_empty() {
                return Err(bad_request("invalid orig_path"));
            }
            let repo_orig = repo_relative(&info.prefix, &normalized);
            checked_repository_path(&info.root, &repo_orig)?;
            Some((normalized, repo_orig))
        }
        None => None,
    };
    let orig_rel = orig.as_ref().map(|(normalized, _)| normalized.clone());

    let columns = status_columns(&info.root, &repo_rel)?;
    let untracked = columns == Some((b'?', b'?'));
    let deleted = columns.is_some_and(|(x, y)| x == b'D' || y == b'D');
    let conflicted = ls_files_has(&info.root, &["ls-files", "-u", "-z"], &repo_rel)?;
    let submodule = index_is_submodule(&info.root, &repo_rel)?;

    if submodule {
        return Ok(WorkspaceGitFileDiffResponse {
            is_git_repo: true,
            path: rel,
            orig_path: orig_rel,
            base: "head".to_string(),
            original: None,
            modified: None,
            binary: false,
            too_large: false,
            submodule: true,
            conflicted,
        });
    }

    let metadata = std::fs::metadata(&full).ok().filter(std::fs::Metadata::is_file);
    if metadata.is_none() && !deleted {
        return Err((StatusCode::NOT_FOUND, "file not found".to_string()));
    }
    let modified_size = metadata.as_ref().map_or(0, std::fs::Metadata::len);
    let original_bytes = head_content(
        &info,
        untracked,
        &repo_rel,
        orig.as_ref().map(|(_, repo_orig)| repo_orig.as_str()),
    )?;
    let original_size =
        original_bytes.as_ref().map_or(0, |bytes| u64::try_from(bytes.len()).unwrap_or(u64::MAX));

    if original_size > MAX_DIFF_BYTES || modified_size > MAX_DIFF_BYTES {
        return Ok(WorkspaceGitFileDiffResponse {
            is_git_repo: true,
            path: rel,
            orig_path: orig_rel,
            base: "head".to_string(),
            original: None,
            modified: None,
            binary: false,
            too_large: true,
            submodule: false,
            conflicted,
        });
    }

    let modified_bytes =
        if metadata.is_some() { std::fs::read(&full).map_err(internal_error)? } else { Vec::new() };
    let original_bytes = original_bytes.unwrap_or_default();
    if is_binary(&original_bytes) || is_binary(&modified_bytes) {
        return Ok(WorkspaceGitFileDiffResponse {
            is_git_repo: true,
            path: rel,
            orig_path: orig_rel,
            base: "head".to_string(),
            original: None,
            modified: None,
            binary: true,
            too_large: false,
            submodule: false,
            conflicted,
        });
    }

    let original =
        String::from_utf8(original_bytes).map_err(|e| internal_error(io::Error::other(e)))?;
    let modified =
        String::from_utf8(modified_bytes).map_err(|e| internal_error(io::Error::other(e)))?;
    Ok(WorkspaceGitFileDiffResponse {
        is_git_repo: true,
        path: rel,
        orig_path: orig_rel,
        base: "head".to_string(),
        original: Some(original),
        modified: Some(modified),
        binary: false,
        too_large: false,
        submodule: false,
        conflicted,
    })
}

#[cfg(test)]
#[path = "git_changes_tests.rs"]
mod tests;

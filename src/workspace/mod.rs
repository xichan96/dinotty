#![allow(clippy::unwrap_used, clippy::expect_used, clippy::result_large_err)]
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::platform::process::CommandNoWindowExt;
use crate::session::SessionManager;
use crate::settings::{default_upload_dir, Settings, SettingsState};
use crate::workspace_mgmt::is_sensitive;

mod git;
mod remote;
mod syntax;

pub use git::{
    workspace_git_diff, workspace_git_revert_lines, workspace_git_stage_lines,
    workspace_git_status, GitChange, GitDiffResponse, GitFileStatus, GitRevertBody, GitStageBody,
    GitStatusResponse,
};
pub use syntax::{workspace_syntax_check, SyntaxCheckBody, SyntaxCheckResponse, SyntaxDiagnostic};

pub(super) const MAX_TEXT_PREVIEW: usize = 512 * 1024;
pub(super) const MAX_DOWNLOAD: u64 = 500 * 1024 * 1024;
const UPLOAD_MARKER: &str = ".dinotty-uploads";
const INSUFFICIENT_STORAGE: &str = "Not enough disk space to store the upload.";

#[derive(Deserialize)]
pub struct PaneQuery {
    pub pane_id: String,
}

#[derive(Deserialize, Clone)]
pub struct PanePathQuery {
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct WorkspaceListQuery {
    #[serde(default)]
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
    pub root: Option<String>,
    #[serde(default)]
    pub free: bool,
}

#[derive(Deserialize, Clone)]
pub struct ResolveQuery {
    pub pane_id: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ResolveResponse {
    pub rel: String,
}

#[derive(Serialize)]
struct UploadDirStatus {
    managed: bool,
    foreign: bool,
    empty: bool,
}

struct UploadBase {
    path: PathBuf,
    managed: bool,
}

#[derive(Serialize)]
#[allow(clippy::struct_excessive_bools)]
struct UploadOpResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    saved: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted: Option<usize>,
    managed: bool,
    foreign: bool,
    empty: bool,
}

#[derive(Serialize)]
struct UploadDefaultDirResponse {
    default_dir: String,
}

struct UploadFileEntry {
    path: PathBuf,
    name: String,
    size: u64,
    modified: SystemTime,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct ListResponse {
    pub cwd: String,
    pub path: String,
    pub entries: Vec<DirEntry>,
}

#[derive(Serialize)]
pub struct MetaResponse {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

macro_rules! try_res {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => return e,
        }
    };
}

pub(super) fn json_err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

fn upload_io_err(e: &std::io::Error) -> Response {
    match e.raw_os_error() {
        Some(28 | 39 | 112) => json_err(StatusCode::INSUFFICIENT_STORAGE, INSUFFICIENT_STORAGE),
        _ => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

fn get_session(
    manager: &SessionManager,
    pane_id: &str,
) -> Result<Arc<crate::session::Session>, Response> {
    manager
        .sessions
        .get(pane_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| json_err(StatusCode::NOT_FOUND, "unknown pane"))
}

fn get_root(manager: &SessionManager, pane_id: &str) -> Result<PathBuf, Response> {
    let session = get_session(manager, pane_id)?;
    let state = session.cwd_state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(state.cwd.canonicalize().unwrap_or_else(|_| state.cwd.clone()))
}

/// Check if a session is SSH. Returns `Some(session)` if SSH, `None` if local.
fn ssh_session(manager: &SessionManager, pane_id: &str) -> Option<Arc<crate::session::Session>> {
    let session = manager.sessions.get(pane_id).map(|r| Arc::clone(r.value()))?;
    if session.is_ssh() {
        Some(session)
    } else {
        None
    }
}

impl MetaResponse {
    fn media(kind: &'static str, mime: &'static str) -> Self {
        Self {
            kind,
            content: None,
            language: None,
            truncated: false,
            mime: Some(mime.to_string()),
            message: None,
        }
    }
    fn unsupported() -> Self {
        Self {
            kind: "unsupported",
            content: None,
            language: None,
            truncated: false,
            mime: None,
            message: Some("binary file".into()),
        }
    }
}

fn normalize_join(root: &Path, rel: &str) -> Result<PathBuf, Response> {
    let rel = rel.trim().trim_start_matches('/');
    if rel.split('/').any(|p| p == "..") {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
    }
    let mut out = root.to_path_buf();
    for seg in rel.split('/').filter(|s| !s.is_empty() && *s != ".") {
        out.push(seg);
    }
    Ok(out)
}

fn path_must_be_under(root: &Path, candidate: &Path) -> Result<(), Response> {
    let root_canon = root.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "cwd"))?;
    let cand_canon =
        candidate.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "path"))?;
    if !cand_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

fn rel_from_root(root: &Path, full: &Path) -> Option<String> {
    full.strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
}

fn validate_entry_name(name: &str) -> Result<&str, Response> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid name"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid name"));
    }
    Ok(name)
}

fn parent_dir_must_be_in_workspace(root: &Path, file_path: &Path) -> Result<(), Response> {
    let root_canon = root.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "cwd"))?;
    let parent =
        file_path.parent().ok_or_else(|| json_err(StatusCode::BAD_REQUEST, "invalid path"))?;
    if !parent.exists() {
        return Err(json_err(StatusCode::NOT_FOUND, "parent not found"));
    }
    let parent_canon =
        parent.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "parent not found"))?;
    if !parent_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

fn resolve_user_path(home: Option<PathBuf>, raw: &str) -> PathBuf {
    let raw = raw.trim();
    if let Some(path) = expand_temp_token(raw) {
        return path;
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(h) = home.as_ref() {
            return h.join(rest);
        }
    }
    if raw == "~" {
        return home.unwrap_or_else(|| PathBuf::from("/"));
    }
    PathBuf::from(raw)
}

fn expand_temp_token(raw: &str) -> Option<PathBuf> {
    fn env_path(name: &str) -> PathBuf {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map_or_else(std::env::temp_dir, PathBuf::from)
    }

    fn token_remainder<'a>(raw: &'a str, token: &str, case_insensitive: bool) -> Option<&'a str> {
        let matches = if case_insensitive {
            raw.get(..token.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(token))
        } else {
            raw.starts_with(token)
        };
        if !matches {
            return None;
        }

        let rest = &raw[token.len()..];
        if rest.is_empty() {
            Some(rest)
        } else if rest.starts_with('/') || rest.starts_with('\\') {
            Some(rest.trim_start_matches(['/', '\\']))
        } else {
            None
        }
    }

    #[cfg(windows)]
    let tokens = [("%TEMP%", "TEMP", true), ("%TMP%", "TMP", true)];
    #[cfg(not(windows))]
    let tokens = [("$TMPDIR", "TMPDIR", false), ("${TMPDIR}", "TMPDIR", false)];

    for (token, env_name, case_insensitive) in tokens {
        if let Some(rest) = token_remainder(raw, token, case_insensitive) {
            let base = env_path(env_name);
            return Some(if rest.is_empty() { base } else { base.join(rest) });
        }
    }

    None
}

fn path_contains_parent_dir(path: &Path) -> bool {
    path.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

fn upload_marker_present(base: &Path) -> bool {
    std::fs::symlink_metadata(base.join(UPLOAD_MARKER)).is_ok_and(|m| m.file_type().is_file())
}

fn uploads_dir_has_any_entry(base: &Path) -> Result<bool, Response> {
    let mut entries = std::fs::read_dir(base)
        .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(entries
        .next()
        .transpose()
        .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .is_some())
}

fn uploads_dir_is_empty(base: &Path) -> Result<bool, Response> {
    for entry in std::fs::read_dir(base)
        .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    {
        let entry =
            entry.map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        if entry.file_name().to_string_lossy() == UPLOAD_MARKER {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

fn write_upload_marker(base: &Path) -> Result<(), Response> {
    path_must_be_under(base, base)?;
    let marker = base.join(UPLOAD_MARKER);
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&marker) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists && upload_marker_present(base) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {
            Err(json_err(StatusCode::CONFLICT, "uploads marker is not a regular file"))
        }
        Err(e) => Err(upload_io_err(&e)),
    }
}

fn upload_dir_status(base: &Path) -> Result<UploadDirStatus, Response> {
    let managed = upload_marker_present(base);
    let empty = uploads_dir_is_empty(base)?;
    Ok(UploadDirStatus { managed, foreign: !managed && !empty, empty })
}

fn prepare_upload_base(settings: &Settings) -> Result<UploadBase, Response> {
    let raw = settings.upload_dir.trim();
    if raw.is_empty() {
        return Err(json_err(StatusCode::BAD_REQUEST, "upload dir is empty"));
    }
    let base = resolve_user_path(dirs::home_dir(), raw);
    if path_contains_parent_dir(&base) {
        return Err(json_err(StatusCode::BAD_REQUEST, "upload dir must not contain .."));
    }
    let existed = base.exists();
    if existed && !base.is_dir() {
        return Err(json_err(StatusCode::BAD_REQUEST, "upload dir is not a directory"));
    }
    std::fs::create_dir_all(&base).map_err(|e| match e.raw_os_error() {
        Some(28 | 39 | 112) => upload_io_err(&e),
        _ => json_err(StatusCode::BAD_REQUEST, "upload dir is invalid or unavailable"),
    })?;
    let base = base
        .canonicalize()
        .map_err(|_| json_err(StatusCode::BAD_REQUEST, "upload dir is invalid or unavailable"))?;
    path_must_be_under(&base, &base)?;

    let had_entries = if existed { uploads_dir_has_any_entry(&base)? } else { false };
    if !upload_marker_present(&base) && (!existed || !had_entries) {
        write_upload_marker(&base)?;
    }

    Ok(UploadBase { path: base.clone(), managed: upload_dir_status(&base)?.managed })
}

fn sanitize_upload_basename(raw: &str) -> Result<String, Response> {
    if raw.is_empty() || raw == "." || raw == ".." || raw == UPLOAD_MARKER {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid filename"));
    }
    if raw.contains('/') || raw.contains('\\') || raw.chars().any(|c| c.is_ascii_control()) {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid filename"));
    }
    if Path::new(raw).components().any(|c| {
        matches!(
            c,
            std::path::Component::Prefix(_)
                | std::path::Component::RootDir
                | std::path::Component::CurDir
                | std::path::Component::ParentDir
        )
    }) {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid filename"));
    }
    Ok(raw.to_string())
}

fn suffixed_upload_name(base: &str, n: u32) -> String {
    const COMPOUND_EXTENSIONS: [&str; 4] = [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"];

    let lower = base.to_ascii_lowercase();
    for compound in COMPOUND_EXTENSIONS {
        if lower.ends_with(compound) {
            let stem_len = base.len().saturating_sub(compound.len());
            if stem_len > 0 {
                let stem = &base[..stem_len];
                let ext = &base[stem_len..];
                return format!("{stem} ({n}){ext}");
            }
            break;
        }
    }

    let path = Path::new(base);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    format!("{stem} ({n}){ext}")
}

async fn create_new_upload_file(
    dir: &Path,
    base: &str,
) -> Result<(PathBuf, tokio::fs::File), Response> {
    let mut n = 0u32;
    loop {
        let name = if n == 0 { base.to_string() } else { suffixed_upload_name(base, n) };
        let path = dir.join(name);
        let parent =
            path.parent().ok_or_else(|| json_err(StatusCode::BAD_REQUEST, "invalid filename"))?;
        path_must_be_under(dir, parent)?;
        match tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                n = n.checked_add(1).ok_or_else(|| {
                    json_err(StatusCode::CONFLICT, "too many filename collisions")
                })?;
            }
            Err(e) => return Err(upload_io_err(&e)),
        }
    }
}

fn collect_upload_files(base: &Path) -> Result<Vec<UploadFileEntry>, Response> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(base)
        .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    {
        let entry =
            entry.map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == UPLOAD_MARKER {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        if !file_type.is_file() {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|e| json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        files.push(UploadFileEntry {
            path: entry.path(),
            name,
            size: metadata.len(),
            modified: metadata.modified().unwrap_or(UNIX_EPOCH),
        });
    }
    Ok(files)
}

fn trim_uploads_dir(
    base: &Path,
    keep_paths: &[PathBuf],
    cap_mb: u64,
    cap_count: u32,
) -> Result<(), Response> {
    if !upload_marker_present(base) {
        return Ok(());
    }

    let keep: HashSet<PathBuf> = keep_paths.iter().cloned().collect();
    let files = collect_upload_files(base)?;
    let mut total_size = files.iter().map(|f| f.size).sum::<u64>();
    let mut total_count = files.len();
    let cap_bytes = cap_mb.saturating_mul(1024).saturating_mul(1024);
    let cap_count = cap_count as usize;
    let mut candidates: Vec<UploadFileEntry> =
        files.into_iter().filter(|f| !keep.contains(&f.path)).collect();
    candidates.sort_by(|a, b| a.modified.cmp(&b.modified).then_with(|| a.name.cmp(&b.name)));

    for candidate in candidates {
        if total_size <= cap_bytes && total_count <= cap_count {
            break;
        }
        match std::fs::remove_file(&candidate.path) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())),
        }
        total_size = total_size.saturating_sub(candidate.size);
        total_count = total_count.saturating_sub(1);
    }

    Ok(())
}

fn clear_uploads_dir(base: &Path) -> Result<usize, Response> {
    if !upload_marker_present(base) {
        return Err(json_err(StatusCode::CONFLICT, "uploads dir is not managed"));
    }
    let mut deleted = 0usize;
    for file in collect_upload_files(base)? {
        match std::fs::remove_file(&file.path) {
            Ok(()) => deleted += 1,
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())),
        }
    }
    Ok(deleted)
}

async fn rollback_uploads(written_paths: &[PathBuf], current_path: Option<&Path>) {
    for path in written_paths {
        let _ = tokio::fs::remove_file(path).await;
    }
    if let Some(path) = current_path {
        let _ = tokio::fs::remove_file(path).await;
    }
}

#[allow(clippy::unused_async)]
pub async fn workspace_resolve(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<ResolveQuery>,
) -> impl IntoResponse {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_resolve(session, q.path).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let joined = if Path::new(&q.path).is_absolute() {
        resolve_user_path(dirs::home_dir(), &q.path)
    } else {
        try_res!(normalize_join(&root, &q.path))
    };
    let canon =
        joined.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "path not found"));
    let canon = try_res!(canon);
    try_res!(path_must_be_under(&root, &canon));
    let Some(rel) = rel_from_root(&root, &canon) else {
        return json_err(StatusCode::BAD_REQUEST, "bad path");
    };
    Json(ResolveResponse { rel }).into_response()
}

pub async fn workspace_list(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<WorkspaceListQuery>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_list(session, q.clone()).await;
    }
    let outside_pane_jail = q.free || q.root.as_deref() == Some("/");
    let (raw_target, target, cwd_display) = if q.free {
        let requested = Path::new(q.path.trim());
        if !requested.is_absolute() {
            return json_err(StatusCode::BAD_REQUEST, "path must be absolute");
        }
        let raw = requested.to_path_buf();
        let Ok(target) = requested.canonicalize() else {
            return json_err(StatusCode::NOT_FOUND, "not found");
        };
        let cwd = target.to_string_lossy().into_owned();
        (raw, target, cwd)
    } else {
        let root = match q.root.as_deref() {
            Some("/") => PathBuf::from("/"),
            Some("~") => dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
            _ => try_res!(get_root(&manager, &q.pane_id)),
        };
        let raw_target = try_res!(normalize_join(&root, &q.path));
        if !raw_target.exists() {
            return json_err(StatusCode::NOT_FOUND, "not found");
        }
        try_res!(path_must_be_under(&root, &raw_target));
        let target = if outside_pane_jail {
            match raw_target.canonicalize() {
                Ok(p) => p,
                Err(_) => return json_err(StatusCode::NOT_FOUND, "not found"),
            }
        } else {
            raw_target.clone()
        };
        let cwd = root.to_string_lossy().into_owned();
        (raw_target, target, cwd)
    };
    // Sensitivity: check the raw (pre-canonicalize) path AND the canonical path.
    // macOS canonicalize rewrites /etc -> /private/etc, so the raw form is the
    // only reliable catch for a directly-named system dir; the canonical form
    // catches a symlink resolving into a sensitive dir (mirrors
    // validate_workspace_path dual check).
    if outside_pane_jail && (is_sensitive(&raw_target) || is_sensitive(&target)) {
        return json_err(StatusCode::FORBIDDEN, "sensitive system directory");
    }
    if !target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "not a directory");
    }
    let entries = match std::fs::read_dir(&target) {
        Ok(rd) => rd.filter_map(std::result::Result::ok).collect::<Vec<_>>(),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let mut list = entries
        .into_iter()
        .filter_map(|e| {
            let entry_path = if outside_pane_jail {
                let raw = e.path();
                if is_sensitive(&raw) {
                    return None;
                }
                let canonical = raw.canonicalize().ok()?;
                if is_sensitive(&canonical) {
                    return None;
                }
                canonical
            } else {
                e.path()
            };
            let meta = std::fs::metadata(entry_path).ok()?;
            Some(DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: meta.len(),
            })
        })
        .collect::<Vec<_>>();
    list.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
    let path_display = q.path.trim().trim_start_matches('/').to_string();
    Json(ListResponse { cwd: cwd_display, path: path_display, entries: list }).into_response()
}

#[derive(Deserialize)]
pub struct WorkspaceSearchBody {
    pub pane_id: String,
    pub path: String,
    pub query: String,
    #[serde(default)]
    pub file_pattern: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Serialize)]
pub struct SearchMatch {
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub line_text: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
}

/// Cross-workspace text search via ripgrep.
///
/// Returns 502 if ripgrep is not on PATH (Windows users must install it manually).
pub async fn workspace_search(
    State(manager): State<Arc<SessionManager>>,
    Json(body): Json<WorkspaceSearchBody>,
) -> Response {
    if ssh_session(&manager, &body.pane_id).is_some() {
        return json_err(StatusCode::BAD_REQUEST, "search not supported for SSH sessions");
    }
    if Path::new(&body.path).is_absolute() {
        return json_err(StatusCode::BAD_REQUEST, "path must be relative to workspace");
    }
    let root = try_res!(get_root(&manager, &body.pane_id));
    let target = try_res!(normalize_join(&root, &body.path));
    try_res!(path_must_be_under(&root, &target));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "path not found");
    }
    if !target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "not a directory");
    }
    let query = body.query.trim();
    if query.is_empty() {
        return Json(SearchResponse { matches: vec![] }).into_response();
    }
    let max = body.max_results.unwrap_or(100).clamp(1, 500);

    let mut cmd = tokio::process::Command::new("rg");
    cmd.no_window();
    cmd.current_dir(&root);
    cmd.args(["--json", "--word-regexp", "-F", query, body.path.trim().trim_start_matches('/')]);
    if let Some(ref pat) = body.file_pattern {
        cmd.args(["--glob", pat]);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }

    let timeout_dur = std::time::Duration::from_secs(10);
    let output = match tokio::time::timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            if e.kind() == ErrorKind::NotFound {
                return json_err(StatusCode::BAD_GATEWAY, "ripgrep not installed");
            }
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
        Err(_) => return json_err(StatusCode::GATEWAY_TIMEOUT, "search timeout"),
    };

    // rg exits non-zero when no matches; ignore exit code and parse stdout.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let matches = parse_rg_json(&stdout, max);
    Json(SearchResponse { matches }).into_response()
}

// Line numbers and byte offsets from ripgrep are always small (file-size bounded);
// narrowing to u32/usize is safe in practice.
#[allow(clippy::cast_possible_truncation)]
fn parse_rg_json(stdout: &str, max: usize) -> Vec<SearchMatch> {
    let mut results = Vec::with_capacity(max.min(256));
    for line in stdout.lines() {
        if results.len() >= max {
            break;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(serde_json::Value::as_str) != Some("match") {
            continue;
        }
        let Some(data) = v.get("data") else { continue };
        let file_path = data
            .pointer("/path/text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim_start_matches("./")
            .to_string();
        let line_number =
            data.get("line_number").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;
        let line_text = data
            .pointer("/lines/text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim_end_matches('\n')
            .to_string();
        let byte_offset_in_line =
            data.pointer("/submatches/0/start").and_then(serde_json::Value::as_u64).unwrap_or(0)
                as usize;
        let column = byte_offset_to_column(line_text.as_bytes(), byte_offset_in_line);

        results.push(SearchMatch { file_path, line: line_number, column, line_text });
    }
    results
}

/// Convert a UTF-8 byte offset (relative to line start) into a 1-based column
/// measured in UTF-16 code units (Monaco's coordinate system).
/// Falls back to byte index + 1 when input is pure ASCII.
fn byte_offset_to_column(line_bytes: &[u8], byte_offset: usize) -> u32 {
    let offset = byte_offset.min(line_bytes.len());
    let mut col: u32 = 1;
    let mut i = 0;
    while i < offset {
        // UTF-8 continuation byte: 0b10xxxxxx
        if line_bytes[i] & 0xC0 != 0x80 {
            col += 1;
        }
        i += 1;
    }
    col
}

pub(super) fn detect_language(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" | "tsx" => "typescript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" | "vue" => "xml",
        "html" | "htm" => "html",
        "css" | "scss" | "sass" => "css",
        "md" | "markdown" => "markdown",
        "sh" | "bash" | "zsh" => "bash",
        "sql" => "sql",
        _ => "plaintext",
    }
}

enum ByteRangeResult {
    Full,
    Partial { start: u64, end: u64 },
    NotSatisfiable,
}

fn resolve_byte_range(range_header: &str, size: u64) -> ByteRangeResult {
    if size == 0 {
        return ByteRangeResult::Full;
    }
    let Some(spec) = range_header.trim().strip_prefix("bytes=") else {
        return ByteRangeResult::Full;
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    if first.is_empty() {
        return ByteRangeResult::Full;
    }
    if let Some(suffix_len_s) = first.strip_prefix('-') {
        if suffix_len_s.is_empty() {
            return ByteRangeResult::Full;
        }
        let Ok(suffix_len) = suffix_len_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        if suffix_len == 0 {
            return ByteRangeResult::NotSatisfiable;
        }
        let start = size.saturating_sub(suffix_len);
        let end = size - 1;
        return ByteRangeResult::Partial { start, end };
    }
    let Some((from_s, to_s)) = first.split_once('-') else {
        return ByteRangeResult::Full;
    };
    let start = if from_s.is_empty() {
        0u64
    } else {
        let Ok(v) = from_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        v
    };
    let end = if to_s.is_empty() {
        size - 1
    } else {
        let Ok(v) = to_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        v
    };
    if start >= size {
        return ByteRangeResult::NotSatisfiable;
    }
    let end = end.min(size - 1);
    if end < start {
        return ByteRangeResult::NotSatisfiable;
    }
    ByteRangeResult::Partial { start, end }
}

pub(super) fn media_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "svg" => ("image", "image/svg+xml"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "webm" => ("video", "video/webm"),
        "mov" => ("video", "video/quicktime"),
        "ogv" => ("video", "video/ogg"),
        "3gp" | "3gpp" => ("video", "video/3gpp"),
        "mkv" => ("video", "video/x-matroska"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "ogg" | "oga" => ("audio", "audio/ogg"),
        "m4a" => ("audio", "audio/mp4"),
        "flac" => ("audio", "audio/flac"),
        "pdf" => ("pdf", "application/pdf"),
        // html/htm handled as text with preview toggle
        _ => return None,
    })
}

pub(super) fn skip_text_preview(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    matches!(ext.as_str(), "cube" | "lut" | "3dl" | "dat")
}

pub(super) fn office_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "doc" => ("office", "application/msword"),
        "docx" => {
            ("office", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        }
        "xls" => ("office", "application/vnd.ms-excel"),
        "xlsx" => ("office", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        _ => return None,
    })
}

#[allow(clippy::unused_async)]
pub async fn workspace_meta(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_meta(session, q.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.is_file() {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    try_res!(path_must_be_under(&root, &target));
    let meta = match std::fs::metadata(&target) {
        Ok(m) => m,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if meta.len() > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    if let Some((kind, mime)) = media_kind(&target) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if let Some((kind, mime)) = office_kind(&target) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if skip_text_preview(&target) {
        return Json(MetaResponse::unsupported()).into_response();
    }
    let bytes = match std::fs::read(&target) {
        Ok(b) => b,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let truncated = bytes.len() > MAX_TEXT_PREVIEW;
    let slice = if truncated { &bytes[..MAX_TEXT_PREVIEW] } else { &bytes[..] };
    let text = match std::str::from_utf8(slice) {
        Ok(t) => t.to_string(),
        Err(_) => return Json(MetaResponse::unsupported()).into_response(),
    };
    let lang = detect_language(&target);
    let kind = if lang == "markdown" {
        "markdown"
    } else if lang == "html" {
        "html"
    } else {
        "text"
    };
    Json(MetaResponse {
        kind,
        content: Some(text),
        language: Some(lang.into()),
        truncated,
        mime: None,
        message: truncated.then_some("truncated".into()),
    })
    .into_response()
}

pub async fn workspace_raw(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    req_headers: HeaderMap,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_raw(session, q.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.is_file() {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    try_res!(path_must_be_under(&root, &target));
    let meta = match tokio::fs::metadata(&target).await {
        Ok(m) => m,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if meta.len() > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    let len = meta.len();
    let mime = media_kind(&target).map_or_else(
        || mime_guess::from_path(&target).first_or_octet_stream().to_string(),
        |(_, m)| m.to_string(),
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    if len == 0 {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        return (StatusCode::OK, headers, Body::empty()).into_response();
    }

    let range = req_headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map_or(ByteRangeResult::Full, |r| resolve_byte_range(r, len));

    match range {
        ByteRangeResult::Partial { start, end } => {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut file = match tokio::fs::File::open(&target).await {
                Ok(f) => f,
                Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            };
            #[allow(clippy::cast_possible_truncation)]
            let chunk_len = (end - start + 1) as usize;
            let mut chunk = vec![0u8; chunk_len];
            if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            if let Err(e) = file.read_exact(&mut chunk).await {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            let cr = format!("bytes {start}-{end}/{len}");
            if let Ok(hv) = HeaderValue::from_str(&cr) {
                headers.insert(header::CONTENT_RANGE, hv);
            }
            headers.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&chunk_len.to_string())
                    .unwrap_or_else(|_| HeaderValue::from_static("0")),
            );
            (StatusCode::PARTIAL_CONTENT, headers, Body::from(chunk)).into_response()
        }
        ByteRangeResult::NotSatisfiable => {
            let cr = format!("bytes */{len}");
            if let Ok(hv) = HeaderValue::from_str(&cr) {
                headers.insert(header::CONTENT_RANGE, hv);
            }
            (StatusCode::RANGE_NOT_SATISFIABLE, headers, Body::empty()).into_response()
        }
        ByteRangeResult::Full => {
            let file = match tokio::fs::File::open(&target).await {
                Ok(f) => f,
                Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            };
            let stream = tokio_util::io::ReaderStream::new(file);
            headers.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&len.to_string())
                    .unwrap_or_else(|_| HeaderValue::from_static("0")),
            );
            (StatusCode::OK, headers, Body::from_stream(stream)).into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub pane_id: String,
    #[serde(default)]
    pub dir: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateEntryQuery {
    pub pane_id: String,
    #[serde(default)]
    pub parent: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateEntryBody {
    pub kind: String,
    pub name: String,
}

#[allow(clippy::unused_async)]
pub async fn workspace_create_entry(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<CreateEntryQuery>,
    Json(body): Json<CreateEntryBody>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_create_entry(
            session,
            q.parent.clone(),
            body.kind.clone(),
            body.name.clone(),
            q.cwd.clone(),
        )
        .await;
    }
    let name = try_res!(validate_entry_name(&body.name));
    let kind = body.kind.to_lowercase();
    if kind != "file" && kind != "dir" {
        return json_err(StatusCode::BAD_REQUEST, "invalid kind");
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let parent_dir = try_res!(normalize_join(&root, &q.parent));
    if !parent_dir.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "parent not a directory");
    }
    try_res!(path_must_be_under(&root, &parent_dir));
    let dest = parent_dir.join(name);
    if dest.exists() {
        return json_err(StatusCode::CONFLICT, "already exists");
    }
    if kind == "dir" {
        if let Err(e) = std::fs::create_dir(&dest) {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    } else if let Err(e) = std::fs::OpenOptions::new().create_new(true).write(true).open(&dest) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    let Some(rel) = rel_from_root(&root, &dest) else {
        return json_err(StatusCode::BAD_REQUEST, "bad path");
    };
    Json(serde_json::json!({ "rel": rel })).into_response()
}

#[derive(Deserialize)]
pub struct PutFileBody {
    pub content: String,
}

#[allow(clippy::unused_async)]
pub async fn workspace_put_file(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<PutFileBody>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_put_file(session, q.clone(), body.content.clone()).await;
    }
    if body.content.len() as u64 > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "content too large");
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if target.exists() && target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "is directory");
    }
    try_res!(parent_dir_must_be_in_workspace(&root, &target));
    if let Err(e) = std::fs::write(&target, body.content.as_bytes()) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[allow(clippy::unused_async)]
pub async fn workspace_reveal(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> Response {
    if ssh_session(&manager, &q.pane_id).is_some() {
        return json_err(StatusCode::BAD_REQUEST, "reveal not supported for SSH sessions");
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "not found");
    }
    try_res!(path_must_be_under(&root, &target));
    let target = dunce::simplified(&target);
    if let Err(e) = reveal_in_file_manager(target) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg("-R").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open").arg(parent).spawn().map(|_| ())
}

#[allow(clippy::unused_async)]
pub async fn workspace_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_delete(session, q.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "not found");
    }
    try_res!(path_must_be_under(&root, &target));
    let Ok(root_canon) = root.canonicalize() else {
        return json_err(StatusCode::NOT_FOUND, "cwd");
    };
    let Ok(cand_canon) = target.canonicalize() else {
        return json_err(StatusCode::NOT_FOUND, "not found");
    };
    if cand_canon == root_canon {
        return json_err(StatusCode::BAD_REQUEST, "cannot delete workspace root");
    }
    if target.is_file() {
        if let Err(e) = std::fs::remove_file(&target) {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    } else if target.is_dir() {
        if let Err(e) = std::fs::remove_dir_all(&target) {
            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
        }
    } else {
        return json_err(StatusCode::BAD_REQUEST, "not a file or directory");
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[derive(Deserialize)]
pub struct RenameBody {
    pub new_name: String,
}

#[allow(clippy::unused_async)]
pub async fn workspace_rename(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<RenameBody>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_rename(session, q.clone(), body.new_name.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "not found");
    }
    try_res!(path_must_be_under(&root, &target));
    let new_name = match validate_entry_name(&body.new_name) {
        Ok(n) => n.to_owned(),
        Err(e) => return e,
    };
    let parent = match target.parent() {
        Some(p) => p.to_path_buf(),
        None => return json_err(StatusCode::BAD_REQUEST, "invalid path"),
    };
    let dest = parent.join(&new_name);
    if dest.exists() {
        return json_err(StatusCode::CONFLICT, "already exists");
    }
    if let Err(e) = std::fs::rename(&target, &dest) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    let rel = rel_from_root(&root, &dest).unwrap_or_default();
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

#[derive(Deserialize)]
pub struct MoveBody {
    pub dest: String,
}

#[allow(clippy::unused_async)]
pub async fn workspace_move(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<MoveBody>,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_move(session, q.clone(), body.dest.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let source = try_res!(normalize_join(&root, &q.path));
    if !source.exists() {
        return json_err(StatusCode::NOT_FOUND, "source not found");
    }
    try_res!(path_must_be_under(&root, &source));
    let dest_dir = try_res!(normalize_join(&root, &body.dest));
    if !dest_dir.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "dest is not a directory");
    }
    try_res!(path_must_be_under(&root, &dest_dir));
    let file_name = match source.file_name() {
        Some(n) => n.to_owned(),
        None => return json_err(StatusCode::BAD_REQUEST, "invalid source path"),
    };
    let dest = dest_dir.join(&file_name);
    if dest.exists() {
        return json_err(StatusCode::CONFLICT, "already exists in destination");
    }
    if source.is_dir() {
        let dest_canon = dest_dir.canonicalize().unwrap_or_else(|_| dest_dir.clone());
        let source_canon = source.canonicalize().unwrap_or_else(|_| source.clone());
        if dest_canon.starts_with(&source_canon) {
            return json_err(StatusCode::BAD_REQUEST, "cannot move into itself");
        }
    }
    if let Err(e) = std::fs::rename(&source, &dest) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    let rel = rel_from_root(&root, &dest).unwrap_or_default();
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

fn unique_path(dir: &Path, base: &str) -> PathBuf {
    let dest = dir.join(base);
    if !dest.exists() {
        return dest;
    }
    let p = Path::new(base);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut n = 1u32;
    loop {
        let cand = dir.join(format!("{stem} ({n}){ext}"));
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}

pub async fn workspace_upload(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Response {
    if let Some(session) = ssh_session(&manager, &q.pane_id) {
        return remote::remote_upload(session, q.dir.clone(), multipart, q.cwd.clone()).await;
    }
    let root = try_res!(get_root(&manager, &q.pane_id));
    let dest_dir = try_res!(normalize_join(&root, &q.dir));
    if !dest_dir.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "target not a directory");
    }
    try_res!(path_must_be_under(&root, &dest_dir));
    let mut saved: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut pending_rel_path: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                errors.push(format!("multipart read error: {e}"));
                break;
            }
        };
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "path" {
            let text = match field.text().await {
                Ok(t) => t,
                Err(e) => return json_err(StatusCode::BAD_REQUEST, &e.to_string()),
            };
            if !text.is_empty() && text != "." {
                if pending_rel_path.is_some() {
                    tracing::warn!("upload: consecutive 'path' fields; overwriting previous value");
                }
                pending_rel_path = Some(text);
            }
            continue;
        }
        let Some(filename) = field.file_name().map(std::string::ToString::to_string) else {
            continue;
        };
        let rel = pending_rel_path.take().unwrap_or_else(|| filename.clone());
        let rel_path = Path::new(&rel);
        if rel_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return json_err(StatusCode::BAD_REQUEST, "path must not contain ..");
        }
        let file_dest_dir =
            if let Some(parent) = rel_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                let sub = try_res!(normalize_join(&dest_dir, &parent.to_string_lossy()));
                try_res!(path_must_be_under(&root, &sub));
                if let Err(e) = std::fs::create_dir_all(&sub) {
                    return upload_io_err(&e);
                }
                sub
            } else {
                dest_dir.clone()
            };
        let base = rel_path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        let path = unique_path(&file_dest_dir, base);
        {
            use tokio::io::AsyncWriteExt;
            let mut file = match tokio::fs::File::create(&path).await {
                Ok(f) => f,
                Err(e) => return upload_io_err(&e),
            };
            let mut stream = field;
            loop {
                match stream.chunk().await {
                    Ok(Some(chunk)) => {
                        if let Err(e) = file.write_all(&chunk).await {
                            drop(file);
                            let _ = std::fs::remove_file(&path);
                            return upload_io_err(&e);
                        }
                    }
                    Ok(None) => break,
                    Err(e) => return json_err(StatusCode::BAD_REQUEST, &e.to_string()),
                }
            }
            if let Err(e) = file.flush().await {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return upload_io_err(&e);
            }
        }
        if let Some(rel) = rel_from_root(&root, &path) {
            saved.push(rel);
        }
    }
    let mut resp = serde_json::json!({ "saved": saved });
    if !errors.is_empty() {
        resp["errors"] = serde_json::json!(errors);
    }
    Json(resp).into_response()
}

#[allow(clippy::too_many_lines)]
pub async fn workspace_uploads(
    State((_manager, settings_state)): State<(Arc<SessionManager>, SettingsState)>,
    mut multipart: Multipart,
) -> Response {
    let settings = settings_state.read().await.clone();
    let settings_for_base = settings.clone();
    let base =
        match tokio::task::spawn_blocking(move || prepare_upload_base(&settings_for_base)).await {
            Ok(Ok(v)) => v,
            Ok(Err(resp)) => return resp,
            Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
        };
    let cap_bytes = settings.upload_file_cap_mb.saturating_mul(1024 * 1024);
    let mut saved: Vec<String> = Vec::new();
    let mut written_paths: Vec<PathBuf> = Vec::new();

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                rollback_uploads(&written_paths, None).await;
                return json_err(StatusCode::BAD_REQUEST, &e.to_string());
            }
        };
        if field.name() == Some("path") {
            rollback_uploads(&written_paths, None).await;
            return json_err(StatusCode::BAD_REQUEST, "path field is not supported");
        }
        let Some(filename) = field.file_name().map(std::string::ToString::to_string) else {
            continue;
        };
        let filename = match sanitize_upload_basename(&filename) {
            Ok(filename) => filename,
            Err(resp) => {
                rollback_uploads(&written_paths, None).await;
                return resp;
            }
        };
        let (path, mut file) = match create_new_upload_file(&base.path, &filename).await {
            Ok(created) => created,
            Err(resp) => {
                rollback_uploads(&written_paths, None).await;
                return resp;
            }
        };
        {
            use tokio::io::AsyncWriteExt;
            let mut stream = field;
            let mut written = 0u64;
            loop {
                match stream.chunk().await {
                    Ok(Some(chunk)) => {
                        if cap_bytes > 0 && written + chunk.len() as u64 > cap_bytes {
                            drop(file);
                            rollback_uploads(&written_paths, Some(&path)).await;
                            return json_err(
                                StatusCode::PAYLOAD_TOO_LARGE,
                                "upload file too large",
                            );
                        }
                        written += chunk.len() as u64;
                        if let Err(e) = file.write_all(&chunk).await {
                            drop(file);
                            rollback_uploads(&written_paths, Some(&path)).await;
                            return upload_io_err(&e);
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        drop(file);
                        rollback_uploads(&written_paths, Some(&path)).await;
                        return json_err(StatusCode::BAD_REQUEST, &e.to_string());
                    }
                }
            }
            if let Err(e) = file.flush().await {
                drop(file);
                rollback_uploads(&written_paths, Some(&path)).await;
                return upload_io_err(&e);
            }
        }
        saved.push(path.to_string_lossy().to_string());
        written_paths.push(path);
    }

    if base.managed {
        let base_path = base.path.clone();
        let keep_paths = written_paths.clone();
        let upload_cap_mb = settings.upload_cap_mb;
        let upload_cap_count = settings.upload_cap_count;
        match tokio::task::spawn_blocking(move || {
            trim_uploads_dir(&base_path, &keep_paths, upload_cap_mb, upload_cap_count)
        })
        .await
        {
            Ok(Ok(v)) => v,
            Ok(Err(resp)) => return resp,
            Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
        }
    }
    let base_path = base.path.clone();
    let status = match tokio::task::spawn_blocking(move || upload_dir_status(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    Json(UploadOpResponse {
        ok: true,
        saved: Some(saved),
        deleted: None,
        managed: status.managed,
        foreign: status.foreign,
        empty: status.empty,
    })
    .into_response()
}

pub async fn uploads_status(
    State((_manager, settings_state)): State<(Arc<SessionManager>, SettingsState)>,
) -> Response {
    let settings = settings_state.read().await.clone();
    let base = match tokio::task::spawn_blocking(move || prepare_upload_base(&settings)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    let base_path = base.path.clone();
    let status = match tokio::task::spawn_blocking(move || upload_dir_status(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    Json(UploadOpResponse {
        ok: true,
        saved: None,
        deleted: None,
        managed: status.managed,
        foreign: status.foreign,
        empty: status.empty,
    })
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn uploads_default_dir() -> Response {
    Json(UploadDefaultDirResponse { default_dir: default_upload_dir() }).into_response()
}

pub async fn uploads_clear(
    State((_manager, settings_state)): State<(Arc<SessionManager>, SettingsState)>,
) -> Response {
    let settings = settings_state.read().await.clone();
    let base = match tokio::task::spawn_blocking(move || prepare_upload_base(&settings)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    let base_path = base.path.clone();
    let deleted = match tokio::task::spawn_blocking(move || clear_uploads_dir(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    let base_path = base.path.clone();
    let status = match tokio::task::spawn_blocking(move || upload_dir_status(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    Json(UploadOpResponse {
        ok: true,
        saved: None,
        deleted: Some(deleted),
        managed: status.managed,
        foreign: status.foreign,
        empty: status.empty,
    })
    .into_response()
}

pub async fn uploads_adopt(
    State((_manager, settings_state)): State<(Arc<SessionManager>, SettingsState)>,
) -> Response {
    let settings = settings_state.read().await.clone();
    let base = match tokio::task::spawn_blocking(move || prepare_upload_base(&settings)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    let base_path = base.path.clone();
    match tokio::task::spawn_blocking(move || write_upload_marker(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    }
    let base_path = base.path.clone();
    let status = match tokio::task::spawn_blocking(move || upload_dir_status(&base_path)).await {
        Ok(Ok(v)) => v,
        Ok(Err(resp)) => return resp,
        Err(_) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    };
    Json(UploadOpResponse {
        ok: true,
        saved: None,
        deleted: None,
        managed: status.managed,
        foreign: status.foreign,
        empty: status.empty,
    })
    .into_response()
}

#[cfg(test)]
mod tests;

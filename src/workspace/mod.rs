use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::session::SessionManager;

mod git;
mod syntax;

pub use git::{
    workspace_git_diff, workspace_git_revert_lines, workspace_git_stage_lines,
    workspace_git_status, GitChange, GitDiffResponse, GitFileStatus, GitRevertBody,
    GitStageBody, GitStatusResponse,
};
pub use syntax::{
    workspace_syntax_check, SyntaxCheckBody, SyntaxCheckResponse, SyntaxDiagnostic,
};

const MAX_TEXT_PREVIEW: usize = 512 * 1024;
const MAX_DOWNLOAD: u64 = 500 * 1024 * 1024;

#[derive(Deserialize)]
pub struct PaneQuery {
    pub pane_id: String,
}

#[derive(Deserialize)]
pub struct PanePathQuery {
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Deserialize)]
pub struct WorkspaceListQuery {
    #[serde(default)]
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
    pub root: Option<String>,
}

#[derive(Deserialize)]
pub struct ResolveQuery {
    pub pane_id: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ResolveResponse {
    pub rel: String,
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
    ($e:expr) => { match $e { Ok(v) => v, Err(e) => return e } };
}

fn json_err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

fn get_root(manager: &SessionManager, pane_id: &str) -> Result<PathBuf, Response> {
    let session = manager
        .sessions
        .get(pane_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| json_err(StatusCode::NOT_FOUND, "unknown pane"))?;
    let state = session.cwd_state.lock().unwrap();
    Ok(state.cwd.canonicalize().unwrap_or_else(|_| state.cwd.clone()))
}

impl MetaResponse {
    fn media(kind: &'static str, mime: &'static str) -> Self {
        Self { kind, content: None, language: None, truncated: false, mime: Some(mime.to_string()), message: None }
    }
    fn unsupported() -> Self {
        Self { kind: "unsupported", content: None, language: None, truncated: false, mime: None, message: Some("binary file".into()) }
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
    let cand_canon = candidate
        .canonicalize()
        .map_err(|_| json_err(StatusCode::NOT_FOUND, "path"))?;
    if !cand_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

fn rel_from_root(root: &Path, full: &Path) -> Option<String> {
    full.strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
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
    let parent = file_path
        .parent()
        .ok_or_else(|| json_err(StatusCode::BAD_REQUEST, "invalid path"))?;
    if !parent.exists() {
        return Err(json_err(StatusCode::NOT_FOUND, "parent not found"));
    }
    let parent_canon = parent
        .canonicalize()
        .map_err(|_| json_err(StatusCode::NOT_FOUND, "parent not found"))?;
    if !parent_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}


fn resolve_user_path(home: Option<PathBuf>, raw: &str) -> PathBuf {
    let raw = raw.trim();
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

pub async fn workspace_resolve(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<ResolveQuery>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let joined = if Path::new(&q.path).is_absolute() {
        resolve_user_path(dirs::home_dir(), &q.path)
    } else {
        try_res!(normalize_join(&root, &q.path))
    };
    let canon = joined.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "path not found"));
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
) -> impl IntoResponse {
    let root = match q.root.as_deref() {
        Some("/") => PathBuf::from("/"),
        Some("~") => dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
        _ => try_res!(get_root(&manager, &q.pane_id)),
    };
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "not found");
    }
    try_res!(path_must_be_under(&root, &target));
    if !target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "not a directory");
    }
    let mut entries = match std::fs::read_dir(&target) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .collect::<Vec<_>>(),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    entries.sort_by_key(|e| {
        let is_dir = e.path().is_dir();
        (!is_dir, e.file_name().to_string_lossy().to_lowercase())
    });
    let list = entries
        .into_iter()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: meta.len(),
            })
        })
        .collect::<Vec<_>>();
    let cwd_display = root.to_string_lossy().into_owned();
    let path_display = q.path.trim().trim_start_matches('/').to_string();
    Json(ListResponse {
        cwd: cwd_display,
        path: path_display,
        entries: list,
    })
    .into_response()
}

fn detect_language(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescript",
        "jsx" => "javascript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "css",
        "md" | "markdown" => "markdown",
        "sh" | "bash" | "zsh" => "bash",
        "sql" => "sql",
        "vue" => "xml",
        "txt" | "log" | "csv" => "plaintext",
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

fn media_kind(path: &Path) -> Option<(&'static str, &'static str)> {
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

fn skip_text_preview(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    matches!(ext.as_str(), "cube" | "lut" | "3dl" | "dat")
}

fn office_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "doc" => ("office", "application/msword"),
        "docx" => ("office", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xls" => ("office", "application/vnd.ms-excel"),
        "xlsx" => ("office", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        _ => return None,
    })
}

pub async fn workspace_meta(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
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
    let slice = if truncated {
        &bytes[..MAX_TEXT_PREVIEW]
    } else {
        &bytes[..]
    };
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
) -> impl IntoResponse {
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
    let mime = media_kind(&target)
        .map(|(_, m)| m.to_string())
        .unwrap_or_else(|| {
            mime_guess::from_path(&target)
                .first_or_octet_stream()
                .to_string()
        });
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    if len == 0 {
        headers.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_static("0"),
        );
        return (StatusCode::OK, headers, Body::empty()).into_response();
    }

    let range = req_headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|r| resolve_byte_range(r, len))
        .unwrap_or(ByteRangeResult::Full);

    match range {
        ByteRangeResult::Partial { start, end } => {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut file = match tokio::fs::File::open(&target).await {
                Ok(f) => f,
                Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            };
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
}

#[derive(Deserialize)]
pub struct CreateEntryQuery {
    pub pane_id: String,
    #[serde(default)]
    pub parent: String,
}

#[derive(Deserialize)]
pub struct CreateEntryBody {
    pub kind: String,
    pub name: String,
}

pub async fn workspace_create_entry(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<CreateEntryQuery>,
    Json(body): Json<CreateEntryBody>,
) -> impl IntoResponse {
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
    } else if let Err(e) = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&dest)
    {
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

pub async fn workspace_put_file(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<PutFileBody>,
) -> impl IntoResponse {
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

pub async fn workspace_delete(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
) -> impl IntoResponse {
    let root = try_res!(get_root(&manager, &q.pane_id));
    let target = try_res!(normalize_join(&root, &q.path));
    if !target.exists() {
        return json_err(StatusCode::NOT_FOUND, "not found");
    }
    try_res!(path_must_be_under(&root, &target));
    let root_canon = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => return json_err(StatusCode::NOT_FOUND, "cwd"),
    };
    let cand_canon = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => return json_err(StatusCode::NOT_FOUND, "not found"),
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

pub async fn workspace_rename(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<RenameBody>,
) -> impl IntoResponse {
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

pub async fn workspace_move(
    State(manager): State<Arc<SessionManager>>,
    Query(q): Query<PanePathQuery>,
    Json(body): Json<MoveBody>,
) -> impl IntoResponse {
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
        let dest_canon = dest_dir
            .canonicalize()
            .unwrap_or_else(|_| dest_dir.clone());
        let source_canon = source
            .canonicalize()
            .unwrap_or_else(|_| source.clone());
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
        let cand = dir.join(format!("{} ({}){}", stem, n, ext));
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
) -> impl IntoResponse {
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
        let Some(filename) = field.file_name().map(|s| s.to_string()) else {
            continue;
        };
        let rel = pending_rel_path.take().unwrap_or_else(|| filename.clone());
        let rel_path = Path::new(&rel);
        if rel_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return json_err(StatusCode::BAD_REQUEST, "path must not contain ..");
        }
        let file_dest_dir = if let Some(parent) = rel_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            let sub = try_res!(normalize_join(&dest_dir, &parent.to_string_lossy()));
            try_res!(path_must_be_under(&root, &sub));
            if let Err(e) = std::fs::create_dir_all(&sub) {
                return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            sub
        } else {
            dest_dir.clone()
        };
        let base = rel_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");
        let path = unique_path(&file_dest_dir, base);
        {
            use tokio::io::AsyncWriteExt;
            let mut file = match tokio::fs::File::create(&path).await {
                Ok(f) => f,
                Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            };
            let mut stream = field;
            loop {
                match stream.chunk().await {
                    Ok(Some(chunk)) => {
                        if let Err(e) = file.write_all(&chunk).await {
                            return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
                        }
                    }
                    Ok(None) => break,
                    Err(e) => return json_err(StatusCode::BAD_REQUEST, &e.to_string()),
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn normalize_join_rejects_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let result = normalize_join(tmp.path(), "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn normalize_join_rejects_nested_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let result = normalize_join(tmp.path(), "foo/../../etc");
        assert!(result.is_err());
    }

    #[test]
    fn normalize_join_accepts_normal_subdir() {
        let tmp = TempDir::new().unwrap();
        let result = normalize_join(tmp.path(), "subdir/file.txt").unwrap();
        assert_eq!(result, tmp.path().join("subdir").join("file.txt"));
    }

    #[test]
    fn normalize_join_handles_dot_and_empty() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(normalize_join(tmp.path(), ".").unwrap(), tmp.path().to_path_buf());
        assert_eq!(normalize_join(tmp.path(), "").unwrap(), tmp.path().to_path_buf());
    }

    #[test]
    fn normalize_join_strips_leading_slash() {
        let tmp = TempDir::new().unwrap();
        let result = normalize_join(tmp.path(), "/foo/bar").unwrap();
        assert_eq!(result, tmp.path().join("foo").join("bar"));
    }

    #[test]
    fn path_must_be_under_accepts_child() {
        let tmp = TempDir::new().unwrap();
        let child = tmp.path().join("sub");
        fs::create_dir(&child).unwrap();
        assert!(path_must_be_under(tmp.path(), &child).is_ok());
    }

    #[test]
    fn path_must_be_under_rejects_outside() {
        let tmp1 = TempDir::new().unwrap();
        let tmp2 = TempDir::new().unwrap();
        assert!(path_must_be_under(tmp1.path(), tmp2.path()).is_err());
    }
}

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

use crate::platform::process::CommandNoWindowExt;
use crate::session::SessionManager;
use crate::workspace_mgmt::is_sensitive;

use super::remote;
use super::types::{
    CreateEntryBody, CreateEntryQuery, DirEntry, ListResponse, MetaResponse, MoveBody,
    PanePathQuery, PutFileBody, RenameBody, ResolveQuery, ResolveResponse, SearchResponse,
    WorkspaceListQuery, WorkspaceSearchBody,
};
use super::util::{
    detect_language, get_root, json_err, media_kind, normalize_join, office_kind,
    parent_dir_must_be_in_workspace, parse_rg_json, path_must_be_under, rel_from_root,
    resolve_byte_range, resolve_user_path, skip_text_preview, ssh_session, try_res,
    ByteRangeResult, MAX_DOWNLOAD, MAX_TEXT_PREVIEW,
};

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
    let name = try_res!(super::util::validate_entry_name(&body.name));
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
        .no_window()
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").no_window().arg("-R").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open").no_window().arg(parent).spawn().map(|_| ())
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
    let new_name = match super::util::validate_entry_name(&body.new_name) {
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

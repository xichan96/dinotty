#![allow(clippy::result_large_err)]

use std::path::PathBuf;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Path as PathParam, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::settings::SettingsState;
use crate::workspace::{
    detect_language, json_err, resolve_user_path, try_res, validate_entry_name,
};
use crate::workspace_mgmt::is_sensitive;

use super::super::file_watcher::{FileWatcherState, WatchMessage};

#[derive(Deserialize)]
pub struct PluginPathQuery {
    pub path: String,
}

#[derive(Serialize)]
pub struct PluginStatResponse {
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<u64>,
}

#[derive(Deserialize)]
pub struct PluginPutFileBody {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct PluginMkdirBody {
    pub path: String,
}

#[derive(Deserialize)]
pub struct PluginRenameBody {
    pub path: String,
    pub new_name: String,
}

#[derive(Deserialize)]
pub struct PluginMoveBody {
    pub src: String,
    pub dest: String,
}

#[derive(Deserialize)]
pub struct PluginWatchQuery {
    pub path: String,
}

/// Resolve a plugin-supplied absolute path: expand `~`, canonicalize, and
/// reject sensitive system directories. Dual-check on raw + canonical mirrors
/// `workspace_list`'s defense against macOS `/etc` -> `/private/etc`.
fn resolve_plugin_path(raw: &str) -> Result<PathBuf, Response> {
    let raw_path = resolve_user_path(dirs::home_dir(), raw);
    if is_sensitive(&raw_path) {
        return Err(json_err(StatusCode::FORBIDDEN, "sensitive system directory"));
    }
    let canonical =
        raw_path.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "path not found"))?;
    if is_sensitive(&canonical) {
        return Err(json_err(StatusCode::FORBIDDEN, "sensitive system directory"));
    }
    Ok(canonical)
}

/// For write operations where the target may not exist yet, resolve the
/// parent and check sensitivity on both parent (raw + canonical) and target.
fn resolve_plugin_write_path(raw: &str) -> Result<PathBuf, Response> {
    let raw_path = resolve_user_path(dirs::home_dir(), raw);
    if is_sensitive(&raw_path) {
        return Err(json_err(StatusCode::FORBIDDEN, "sensitive system path"));
    }
    if let Some(parent) = raw_path.parent() {
        if is_sensitive(parent) {
            return Err(json_err(StatusCode::FORBIDDEN, "sensitive system directory"));
        }
        let parent_canon = parent
            .canonicalize()
            .map_err(|_| json_err(StatusCode::NOT_FOUND, "parent not found"))?;
        if is_sensitive(&parent_canon) {
            return Err(json_err(StatusCode::FORBIDDEN, "sensitive system directory"));
        }
    }
    Ok(raw_path)
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_read_dir(Query(q): Query<PluginPathQuery>) -> Response {
    let target = try_res!(resolve_plugin_path(&q.path));
    if !target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "not a directory");
    }
    let entries = match std::fs::read_dir(&target) {
        Ok(rd) => rd.filter_map(Result::ok).collect::<Vec<_>>(),
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let mut list = entries
        .into_iter()
        .filter_map(|e| {
            let entry_path = e.path();
            if is_sensitive(&entry_path) {
                return None;
            }
            let canonical = entry_path.canonicalize().ok()?;
            if is_sensitive(&canonical) {
                return None;
            }
            let meta = std::fs::metadata(&canonical).ok()?;
            Some(serde_json::json!({
                "name": e.file_name().to_string_lossy(),
                "is_dir": meta.is_dir(),
                "size": meta.len(),
            }))
        })
        .collect::<Vec<_>>();
    list.sort_by_key(|e| (!e["is_dir"].as_bool().unwrap_or(false), e["name"].to_string()));
    Json(serde_json::json!({
        "path": target.to_string_lossy(),
        "entries": list,
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_read_file(Query(q): Query<PluginPathQuery>) -> Response {
    let target = try_res!(resolve_plugin_path(&q.path));
    if !target.is_file() {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    let meta = match std::fs::metadata(&target) {
        Ok(m) => m,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    if meta.len() > crate::workspace::MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    let bytes = match std::fs::read(&target) {
        Ok(b) => b,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let max_preview = crate::workspace::MAX_TEXT_PREVIEW;
    let truncated = bytes.len() > max_preview;
    let slice = if truncated { &bytes[..max_preview] } else { &bytes[..] };
    let text = match std::str::from_utf8(slice) {
        Ok(t) => t.to_string(),
        Err(_) => {
            return Json(serde_json::json!({
                "kind": "binary",
                "content": null,
                "truncated": false,
                "language": null,
            }))
            .into_response();
        }
    };
    let lang = detect_language(&target);
    Json(serde_json::json!({
        "kind": "text",
        "content": text,
        "truncated": truncated,
        "language": lang,
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_put_file(Json(body): Json<PluginPutFileBody>) -> Response {
    if body.content.len() as u64 > crate::workspace::MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "content too large");
    }
    let target = try_res!(resolve_plugin_write_path(&body.path));
    if target.exists() && target.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "is directory");
    }
    if let Err(e) = std::fs::write(&target, body.content.as_bytes()) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_stat(Query(q): Query<PluginPathQuery>) -> Response {
    let target = try_res!(resolve_plugin_path(&q.path));
    let meta = match std::fs::metadata(&target) {
        Ok(m) => m,
        Err(e) => return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Json(PluginStatResponse { size: meta.len(), is_dir: meta.is_dir(), modified }).into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_mkdir(Json(body): Json<PluginMkdirBody>) -> Response {
    let target = try_res!(resolve_plugin_write_path(&body.path));
    if target.exists() {
        return json_err(StatusCode::CONFLICT, "already exists");
    }
    if let Err(e) = std::fs::create_dir_all(&target) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_delete(Query(q): Query<PluginPathQuery>) -> Response {
    let target = try_res!(resolve_plugin_path(&q.path));
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
pub async fn plugin_workspace_rename(Json(body): Json<PluginRenameBody>) -> Response {
    let target = try_res!(resolve_plugin_path(&body.path));
    let new_name = match validate_entry_name(&body.new_name) {
        Ok(n) => n.to_owned(),
        Err(e) => return e,
    };
    let parent = match target.parent() {
        Some(p) => p.to_path_buf(),
        None => return json_err(StatusCode::BAD_REQUEST, "invalid path"),
    };
    let dest = parent.join(&new_name);
    if is_sensitive(&dest) {
        return json_err(StatusCode::FORBIDDEN, "sensitive system path");
    }
    if dest.exists() {
        return json_err(StatusCode::CONFLICT, "already exists");
    }
    if let Err(e) = std::fs::rename(&target, &dest) {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_move(Json(body): Json<PluginMoveBody>) -> Response {
    let source = try_res!(resolve_plugin_path(&body.src));
    let dest_dir = try_res!(resolve_plugin_path(&body.dest));
    if !dest_dir.is_dir() {
        return json_err(StatusCode::BAD_REQUEST, "dest is not a directory");
    }
    let file_name = match source.file_name() {
        Some(n) => n.to_owned(),
        None => return json_err(StatusCode::BAD_REQUEST, "invalid source path"),
    };
    let dest = dest_dir.join(&file_name);
    if is_sensitive(&dest) {
        return json_err(StatusCode::FORBIDDEN, "sensitive system path");
    }
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
    Json(serde_json::json!({ "ok": true })).into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_workspace_watch(
    _plugin_id: PathParam<String>,
    ws: WebSocketUpgrade,
    Query(q): Query<PluginWatchQuery>,
    State(watcher_state): State<std::sync::Arc<FileWatcherState>>,
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> Response {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_plugin_watch_socket(socket, q.path, watcher_state))
        .into_response()
}

async fn handle_plugin_watch_socket(
    mut socket: WebSocket,
    path: String,
    watcher_state: std::sync::Arc<FileWatcherState>,
) {
    let raw_path = resolve_user_path(dirs::home_dir(), &path);
    if is_sensitive(&raw_path) {
        watch_send_error(&mut socket, "sensitive system directory").await;
        return;
    }
    let Ok(canonical) = raw_path.canonicalize() else {
        watch_send_error(&mut socket, "path not found").await;
        return;
    };
    if is_sensitive(&canonical) {
        watch_send_error(&mut socket, "sensitive system directory").await;
        return;
    }
    if !canonical.exists() {
        watch_send_error(&mut socket, "path not found").await;
        return;
    }

    let watch_key = canonical.to_string_lossy().to_string();
    let mut rx = watcher_state.subscribe(&watch_key).await;

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(event) => {
                        if let Ok(json) = serde_json::to_string(&event) {
                            if socket.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(_) => break,
                }
            }
            result = socket.next() => {
                match result {
                    Some(Ok(msg)) => {
                        if let Message::Close(_) = msg {
                            break;
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
    }
}

/// Send a `WatchMessage::Error` to the watch socket, ignoring send failures.
async fn watch_send_error(socket: &mut WebSocket, message: &str) {
    if let Ok(text) = serde_json::to_string(&WatchMessage::Error { message: message.to_string() }) {
        let _ = socket.send(Message::Text(text)).await;
    }
}

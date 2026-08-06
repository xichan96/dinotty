use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;
use russh_sftp::client::SftpSession;
use std::path::Path;
use std::sync::Arc;

use crate::session::Session;
use crate::ssh::sftp::{clear_sftp_cache, get_or_create_sftp, ssh_exec};
use crate::workspace::{
    detect_language, json_err, media_kind, office_kind, skip_text_preview, DirEntry, ListResponse,
    MetaResponse, PanePathQuery, ResolveResponse, WorkspaceListQuery, MAX_DOWNLOAD,
    MAX_TEXT_PREVIEW,
};

/// Get SFTP session, clearing cache on error and retrying once.
async fn sftp(session: &Session) -> Result<Arc<SftpSession>, Response> {
    match get_or_create_sftp(session).await {
        Ok(s) => Ok(s),
        Err(_e) => {
            clear_sftp_cache(session);
            // Retry once in case the cached session was stale
            get_or_create_sftp(session)
                .await
                .map_err(|e2| json_err(StatusCode::BAD_GATEWAY, &format!("SFTP error: {e2}")))
        }
    }
}

fn sftp_err(e: impl std::fmt::Display) -> Response {
    json_err(StatusCode::BAD_GATEWAY, &format!("SFTP: {e}"))
}

/// Detect the current PTY user by running `whoami` via SSH exec.
/// Caches the result in `session.remote_user`.
async fn detect_remote_user(session: &Session) -> Option<String> {
    // Check cache first
    {
        let cached = session.remote_user.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(ref user) = *cached {
            return Some(user.clone());
        }
    }
    // Detect via whoami
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    let (code, stdout, _) = ssh_exec(session, "whoami", &cwd).await.ok()?;
    if code != 0 {
        return None;
    }
    let user = stdout.trim().to_string();
    if user.is_empty() {
        return None;
    }
    *session.remote_user.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(user.clone());
    Some(user)
}

/// Check if the PTY user is likely elevated (root) compared to the SSH auth user.
/// Returns `true` if sudo fallback should be attempted.
async fn should_use_sudo(session: &Session) -> bool {
    let Some(pty_user) = detect_remote_user(session).await else { return false };
    // If PTY user is root, the SFTP session (running as original SSH user)
    // likely can't access the same directories
    pty_user == "root"
}

/// List directory via SSH exec with sudo as fallback.
/// Used when SFTP fails due to permission issues after user switch (e.g. `su root`).
async fn list_via_ssh_exec(session: &Session, target: &str) -> Result<Vec<DirEntry>, Response> {
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    // Use `sudo ls -la` to get file types and names
    let cmd = format!("sudo ls -la {}", shell_escape_path(target));
    let (code, stdout, stderr) = ssh_exec(session, &cmd, &cwd)
        .await
        .map_err(|e| json_err(StatusCode::BAD_GATEWAY, &format!("SSH exec error: {e}")))?;
    if code != 0 {
        return Err(json_err(
            StatusCode::FORBIDDEN,
            &format!("Permission denied (sudo exit {code}): {}", stderr.trim()),
        ));
    }
    let entries = parse_ls_la_entries(&stdout, target);
    Ok(entries)
}

/// Parse `ls -la` output into `DirEntry` list with proper type detection.
fn parse_ls_la_entries(output: &str, _target: &str) -> Vec<DirEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((name, is_dir, size)) = parse_ls_la_full(line) {
            if name != "." && name != ".." {
                entries.push(DirEntry { name, is_dir, size });
            }
        }
    }
    entries.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
    entries
}

/// Parse a full `ls -la` line to extract name, type, and size.
fn parse_ls_la_full(line: &str) -> Option<(String, bool, u64)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    let first = parts[0];
    if first.is_empty() {
        return None;
    }
    let ft_char = first.as_bytes()[0];
    if !b"-dlcbps".contains(&ft_char) {
        return None;
    }
    let is_dir = ft_char == b'd';
    let size: u64 = parts[4].parse().unwrap_or(0);
    let name = parts[8..].join(" ");
    let name = name.split(" -> ").next().unwrap_or(&name).to_string();
    Some((name, is_dir, size))
}

/// Read file via SSH exec with sudo. Returns the file content as bytes.
async fn read_via_ssh_exec(session: &Session, target: &str) -> Result<Vec<u8>, Response> {
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    let cmd = format!("sudo cat {}", shell_escape_path(target));
    let (code, stdout, stderr) = ssh_exec(session, &cmd, &cwd)
        .await
        .map_err(|e| json_err(StatusCode::BAD_GATEWAY, &format!("SSH exec error: {e}")))?;
    if code != 0 {
        return Err(json_err(
            StatusCode::FORBIDDEN,
            &format!("Permission denied (sudo exit {code}): {}", stderr.trim()),
        ));
    }
    Ok(stdout.into_bytes())
}

/// Shell-escape a file path for safe use in SSH exec commands.
fn shell_escape_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

/// Check if an SFTP error message indicates a permission denied error.
fn is_permission_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("permission denied")
        || lower.contains("access denied")
        || lower.contains("eperm")
        || lower.contains("eacces")
}

/// Resolve a relative path for SSH file browsing. SSH sessions have full shell
/// access, so the default tree root is `/` (not `cwd_state.cwd`).
///
/// - Empty path → `/`  (tree root is the filesystem root)
/// - Absolute path → as-is
/// - `~` / `~/…` → remote home expansion
/// - Relative path → joined against `/` (cwd param ignored - see below)
fn resolve_remote_rel(session: &Session, rel: &str, _cwd: Option<&str>) -> String {
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

// ── list ──────────────────────────────────────────────────────────────────

pub async fn remote_list(session: Arc<Session>, q: WorkspaceListQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    // SSH sessions have full shell access — no jail needed.
    // The frontend tree always sends `path` relative to the initial SSH root `/`,
    // regardless of the current browsing directory. The `root` parameter is
    // informational only (tracks cwdLabel) and must NOT be used for path joining.
    let target = if q.free {
        let path = q.path.trim();
        if path.is_empty() || !path.starts_with('/') {
            return json_err(StatusCode::BAD_REQUEST, "path must be absolute");
        }
        path.to_string()
    } else {
        resolve_remote_rel(&session, &q.path, None)
    };
    // Try SFTP first; fall back to SSH exec with sudo on permission errors
    // (e.g. after `su root` in the PTY, SFTP still runs as original user).
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                // Use raw target path since canonicalize failed
                target
            } else {
                return sftp_err(e);
            }
        }
    };
    match sftp.read_dir(&target).await {
        Ok(rd) => {
            let mut list: Vec<DirEntry> = rd
                .filter(|e| e.file_name() != "." && e.file_name() != "..")
                .map(|e| {
                    let ft = e.file_type();
                    let meta = e.metadata();
                    DirEntry {
                        name: e.file_name(),
                        is_dir: ft.is_dir(),
                        size: meta.size.unwrap_or(0),
                    }
                })
                .collect();
            list.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
            Json(ListResponse { cwd: target.clone(), path: String::new(), entries: list })
                .into_response()
        }
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                // Fallback: list via SSH exec with sudo
                match list_via_ssh_exec(&session, &target).await {
                    Ok(mut list) => {
                        list.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
                        Json(ListResponse {
                            cwd: target.clone(),
                            path: String::new(),
                            entries: list,
                        })
                        .into_response()
                    }
                    Err(resp) => resp,
                }
            } else {
                sftp_err(e)
            }
        }
    }
}

// ── meta ──────────────────────────────────────────────────────────────────

pub async fn remote_meta(session: Arc<Session>, q: PanePathQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    // Try SFTP; fall back to SSH exec on permission errors
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                target
            } else {
                return sftp_err(e);
            }
        }
    };
    // Try SFTP metadata; fall back to sudo stat/cat
    let (file_size, is_file) = match sftp.metadata(&target).await {
        Ok(m) => (m.size.unwrap_or(0), m.file_type().is_file()),
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                // Assume it's a file for meta purposes; we'll verify when reading
                (0, true)
            } else {
                return sftp_err(e);
            }
        }
    };
    if !is_file {
        return json_err(StatusCode::BAD_REQUEST, "not a file");
    }
    if file_size > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "file too large");
    }
    if let Some((kind, mime)) = media_kind(Path::new(&target)) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if let Some((kind, mime)) = office_kind(Path::new(&target)) {
        return Json(MetaResponse::media(kind, mime)).into_response();
    }
    if skip_text_preview(Path::new(&target)) {
        return Json(MetaResponse::unsupported()).into_response();
    }
    // Read file content for text preview
    let bytes = match sftp.read(&target).await {
        Ok(b) => b,
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                match read_via_ssh_exec(&session, &target).await {
                    Ok(b) => b,
                    Err(resp) => return resp,
                }
            } else {
                return sftp_err(e);
            }
        }
    };
    let truncated = bytes.len() > MAX_TEXT_PREVIEW;
    let slice = if truncated { &bytes[..MAX_TEXT_PREVIEW] } else { &bytes[..] };
    let text = match std::str::from_utf8(slice) {
        Ok(t) => t.to_string(),
        Err(_) => return Json(MetaResponse::unsupported()).into_response(),
    };
    let lang = detect_language(Path::new(&target));
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

// ── raw ───────────────────────────────────────────────────────────────────

pub async fn remote_raw(session: Arc<Session>, q: PanePathQuery) -> Response {
    tracing::info!("remote_raw: pane={} path={:?} cwd={:?}", q.pane_id, q.path, q.cwd);
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    tracing::info!("remote_raw: resolved target={:?}", target);
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => {
            tracing::info!("remote_raw: canonicalize ok -> {:?}", p);
            p
        }
        Err(e) => {
            let emsg = format!("{e}");
            tracing::warn!("remote_raw: canonicalize failed: {}", emsg);
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                target
            } else {
                return sftp_err(e);
            }
        }
    };
    // Check metadata for file type and size (skip on permission error — will try sudo)
    let mut use_sudo_fallback = false;
    match sftp.metadata(&target).await {
        Ok(m) => {
            if !m.file_type().is_file() {
                return json_err(StatusCode::BAD_REQUEST, "not a file");
            }
            let size = m.size.unwrap_or(0);
            if size > MAX_DOWNLOAD {
                return json_err(StatusCode::BAD_REQUEST, "file too large");
            }
        }
        Err(e) => {
            let emsg = format!("{e}");
            if is_permission_error(&emsg) && should_use_sudo(&session).await {
                use_sudo_fallback = true;
            } else {
                return sftp_err(e);
            }
        }
    }
    let mime = media_kind(Path::new(&target)).map_or_else(
        || mime_guess::from_path(&target).first_or_octet_stream().to_string(),
        |(_, m)| m.to_string(),
    );
    // Read full file and stream it
    let bytes = if use_sudo_fallback {
        match read_via_ssh_exec(&session, &target).await {
            Ok(b) => b,
            Err(resp) => return resp,
        }
    } else {
        match sftp.read(&target).await {
            Ok(b) => b,
            Err(e) => {
                let emsg = format!("{e}");
                if is_permission_error(&emsg) && should_use_sudo(&session).await {
                    match read_via_ssh_exec(&session, &target).await {
                        Ok(b) => b,
                        Err(resp) => return resp,
                    }
                } else {
                    return sftp_err(e);
                }
            }
        }
    };
    let len = bytes.len();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&len.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    (StatusCode::OK, headers, Body::from(bytes)).into_response()
}

// ── put file ──────────────────────────────────────────────────────────────

pub async fn remote_put_file(session: Arc<Session>, q: PanePathQuery, content: String) -> Response {
    if content.len() as u64 > MAX_DOWNLOAD {
        return json_err(StatusCode::BAD_REQUEST, "content too large");
    }
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    // Ensure parent exists by checking canonicalize
    let parent = Path::new(&target)
        .parent()
        .map_or_else(|| "/".to_string(), |p| p.to_string_lossy().into_owned());
    if sftp.canonicalize(&parent).await.is_err() {
        return json_err(StatusCode::NOT_FOUND, "parent directory not found");
    }
    match sftp.create(&target).await {
        Ok(mut file) => {
            use tokio::io::AsyncWriteExt;
            if let Err(e) = file.write_all(content.as_bytes()).await {
                return sftp_err(e);
            }
            if let Err(e) = file.shutdown().await {
                return sftp_err(e);
            }
        }
        Err(e) => return sftp_err(e),
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

// ── create entry ──────────────────────────────────────────────────────────

pub async fn remote_create_entry(
    session: Arc<Session>,
    parent: String,
    kind: String,
    name: String,
    cwd: Option<String>,
) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let parent_path = resolve_remote_rel(&session, &parent, cwd.as_deref());
    let parent_canon = match sftp.canonicalize(&parent_path).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    let dest = format!("{}/{}", parent_canon.trim_end_matches('/'), name);
    // Check if already exists
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if kind == "dir" {
        if let Err(e) = sftp.create_dir(&dest).await {
            return sftp_err(e);
        }
    } else {
        // Create empty file
        match sftp.create(&dest).await {
            Ok(mut file) => {
                use tokio::io::AsyncWriteExt;
                if let Err(e) = file.shutdown().await {
                    return sftp_err(e);
                }
            }
            Err(e) => return sftp_err(e),
        }
    }
    let rel = dest.trim_start_matches('/');
    Json(serde_json::json!({ "rel": rel })).into_response()
}

// ── delete ────────────────────────────────────────────────────────────────

pub async fn remote_delete(session: Arc<Session>, q: PanePathQuery) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    // Prevent deleting root
    if target.trim_end_matches('/') == "/" {
        return json_err(StatusCode::BAD_REQUEST, "cannot delete root");
    }
    let meta = match sftp.metadata(&target).await {
        Ok(m) => m,
        Err(e) => return sftp_err(e),
    };
    if meta.file_type().is_file() {
        if let Err(e) = sftp.remove_file(&target).await {
            return sftp_err(e);
        }
    } else if meta.file_type().is_dir() {
        if let Err(e) = remove_dir_recursive(&sftp, &target).await {
            return sftp_err(e);
        }
    } else {
        return json_err(StatusCode::BAD_REQUEST, "not a file or directory");
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

/// Recursively remove a directory via SFTP.
async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let entries = sftp.read_dir(path).await.map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{}/{}", path.trim_end_matches('/'), name);
        let meta = entry.metadata();
        if meta.file_type().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await.map_err(|e| format!("remove_file: {e}"))?;
        }
    }
    sftp.remove_dir(path).await.map_err(|e| format!("remove_dir: {e}"))
}

// ── rename ────────────────────────────────────────────────────────────────

pub async fn remote_rename(session: Arc<Session>, q: PanePathQuery, new_name: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    let target = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    let parent = Path::new(&target)
        .parent()
        .map_or_else(|| "/".to_string(), |p| p.to_string_lossy().into_owned());
    let dest = format!("{}/{}", parent.trim_end_matches('/'), new_name);
    // Check if destination exists
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if let Err(e) = sftp.rename(&target, &dest).await {
        return sftp_err(e);
    }
    let rel = dest.trim_start_matches('/');
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

// ── move ──────────────────────────────────────────────────────────────────

pub async fn remote_move(session: Arc<Session>, q: PanePathQuery, dest_dir: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let source = resolve_remote_rel(&session, &q.path, q.cwd.as_deref());
    let source = match sftp.canonicalize(&source).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    let dest_path = resolve_remote_rel(&session, &dest_dir, q.cwd.as_deref());
    let dest_canon = match sftp.canonicalize(&dest_path).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    let file_name = Path::new(&source)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dest = format!("{}/{}", dest_canon.trim_end_matches('/'), file_name);
    match sftp.try_exists(&dest).await {
        Ok(true) => return json_err(StatusCode::CONFLICT, "already exists in destination"),
        Ok(false) => {}
        Err(e) => return sftp_err(e),
    }
    if let Err(e) = sftp.rename(&source, &dest).await {
        return sftp_err(e);
    }
    let rel = dest.trim_start_matches('/');
    Json(serde_json::json!({ "ok": true, "rel": rel })).into_response()
}

// ── resolve ───────────────────────────────────────────────────────────────

pub async fn remote_resolve(session: Arc<Session>, path: String) -> Response {
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let target = resolve_remote_rel(&session, &path, None);
    let canon = match sftp.canonicalize(&target).await {
        Ok(p) => p,
        Err(e) => return sftp_err(e),
    };
    let rel = canon.trim_start_matches('/').to_string();
    Json(ResolveResponse { rel }).into_response()
}

// ── upload ────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_lines)]
pub async fn remote_upload(
    session: Arc<Session>,
    dir: String,
    mut multipart: Multipart,
    cwd: Option<String>,
) -> Response {
    tracing::info!("remote_upload: dir={:?} cwd={:?}", dir, cwd);
    let sftp = match sftp(&session).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("remote_upload: sftp setup failed: {:?}", e);
            return e;
        }
    };
    // When dir is empty (no directory selected), upload to the current
    // browsing directory (cwd). resolve_remote_rel("") returns "/", ignoring cwd.
    let dest_dir = if dir.trim().is_empty() {
        let base = cwd.as_deref().filter(|c| !c.trim().is_empty()).unwrap_or("/");
        resolve_remote_rel(&session, base, None)
    } else {
        resolve_remote_rel(&session, &dir, cwd.as_deref())
    };
    tracing::info!("remote_upload: resolved dest_dir={:?}", dest_dir);
    let dest_dir = match sftp.canonicalize(&dest_dir).await {
        Ok(p) => {
            tracing::info!("remote_upload: canonicalize ok -> {:?}", p);
            p
        }
        Err(e) => {
            tracing::warn!("remote_upload: canonicalize failed: {}", e);
            return sftp_err(e);
        }
    };
    let mut saved: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut pending_rel_path: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                tracing::warn!("remote_upload: multipart read error: {}", e);
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
        // Ensure parent directories exist on remote
        let file_dest_dir =
            if let Some(parent) = rel_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                let sub = normalize_remote_join(&dest_dir, &parent.to_string_lossy());
                if let Err(e) = sftp.create_dir(&sub).await {
                    // ignore "already exists" errors
                    if !format!("{e}").contains("exists") {
                        tracing::warn!("remote_upload: mkdir {} failed: {}", parent.display(), e);
                        errors.push(format!("mkdir {}: {e}", parent.display()));
                    }
                }
                sub
            } else {
                dest_dir.clone()
            };
        let base = rel_path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        let path = format!("{}/{}", file_dest_dir.trim_end_matches('/'), base);
        // Read all bytes from the multipart field
        let mut data = Vec::new();
        let mut stream = field;
        loop {
            match stream.chunk().await {
                Ok(Some(chunk)) => data.extend_from_slice(&chunk),
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!("remote_upload: read {} failed: {}", base, e);
                    errors.push(format!("read {base}: {e}"));
                    break;
                }
            }
        }
        tracing::info!("remote_upload: writing {} ({} bytes) to {:?}", base, data.len(), path);
        // sftp.write() uses OpenFlags::WRITE alone (no CREATE), so it fails with
        // NoSuchFile when uploading a new file. Use create() (CREATE|TRUNCATE|WRITE)
        // + write_all + shutdown so new files are created and existing ones overwritten.
        match sftp.create(&path).await {
            Ok(mut file) => {
                use tokio::io::AsyncWriteExt;
                if let Err(e) = file.write_all(&data).await {
                    tracing::warn!("remote_upload: write {} failed: {}", base, e);
                    errors.push(format!("write {base}: {e}"));
                    continue;
                }
                if let Err(e) = file.shutdown().await {
                    tracing::warn!("remote_upload: close {} failed: {}", base, e);
                    errors.push(format!("close {base}: {e}"));
                    continue;
                }
                let rel = path.trim_start_matches('/');
                tracing::info!("remote_upload: saved {}", rel);
                saved.push(rel.to_string());
            }
            Err(e) => {
                tracing::warn!("remote_upload: create {} failed: {}", base, e);
                errors.push(format!("create {base}: {e}"));
            }
        }
    }
    tracing::info!("remote_upload: done - {} saved, {} errors", saved.len(), errors.len());
    let mut resp = serde_json::json!({ "saved": saved });
    if !errors.is_empty() {
        resp["errors"] = serde_json::json!(errors);
    }
    Json(resp).into_response()
}

// ── helpers ───────────────────────────────────────────────────────────────

fn normalize_remote_join(root: &str, rel: &str) -> String {
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

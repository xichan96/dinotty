use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::Multipart;

use crate::session::SessionManager;
use crate::settings::{default_upload_dir, Settings, SettingsState};

use super::remote;
use super::types::{
    UploadBase, UploadDefaultDirResponse, UploadDirStatus, UploadFileEntry, UploadOpResponse,
    UploadQuery,
};
use super::util::{
    json_err, normalize_join, path_contains_parent_dir, path_must_be_under, try_res,
};

const UPLOAD_MARKER: &str = ".dinotty-uploads";
pub(crate) const INSUFFICIENT_STORAGE: &str = "Not enough disk space to store the upload.";

pub(crate) fn upload_io_err(e: &std::io::Error) -> Response {
    match e.raw_os_error() {
        Some(28 | 39 | 112) => json_err(StatusCode::INSUFFICIENT_STORAGE, INSUFFICIENT_STORAGE),
        _ => json_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

pub(crate) fn upload_cap_label_bytes(cap_bytes: u64) -> String {
    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * MB;
    if cap_bytes >= GB {
        format!("{} GB", cap_bytes / GB)
    } else if cap_bytes >= MB {
        format!("{} MB", cap_bytes / MB)
    } else {
        format!("{} KB", cap_bytes / 1024)
    }
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

pub(crate) fn write_upload_marker(base: &Path) -> Result<(), Response> {
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

pub(crate) fn upload_dir_status(base: &Path) -> Result<UploadDirStatus, Response> {
    let managed = upload_marker_present(base);
    let empty = uploads_dir_is_empty(base)?;
    Ok(UploadDirStatus { managed, foreign: !managed && !empty, empty })
}

pub(crate) fn prepare_upload_base(settings: &Settings) -> Result<UploadBase, Response> {
    let raw = settings.upload_dir.trim();
    if raw.is_empty() {
        return Err(json_err(StatusCode::BAD_REQUEST, "upload dir is empty"));
    }
    let base = super::util::resolve_user_path(dirs::home_dir(), raw);
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

pub(crate) fn sanitize_upload_basename(raw: &str) -> Result<String, Response> {
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

pub(crate) fn suffixed_upload_name(base: &str, n: u32) -> String {
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

pub(crate) fn unique_path(dir: &Path, base: &str) -> PathBuf {
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

#[allow(clippy::too_many_lines)]
pub async fn workspace_upload(
    State((manager, settings_state)): State<(Arc<SessionManager>, SettingsState)>,
    Query(q): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Response {
    let settings = settings_state.read().await.clone();
    let cap_bytes = settings.upload_file_cap_mb.saturating_mul(1024 * 1024);
    let is_ssh = super::util::ssh_session(&manager, &q.pane_id).is_some();
    tracing::info!(
        "workspace_upload: pane={} dir={:?} cwd={:?} ssh={}",
        q.pane_id,
        q.dir,
        q.cwd,
        is_ssh
    );
    if let Some(session) = super::util::ssh_session(&manager, &q.pane_id) {
        return remote::remote_upload(session, q.dir.clone(), multipart, q.cwd.clone(), cap_bytes)
            .await;
    }
    let root = try_res!(super::util::get_root(&manager, &q.pane_id));
    let dest_dir = try_res!(normalize_join(&root, &q.dir));
    if !dest_dir.is_dir() {
        tracing::warn!("workspace_upload: target not a directory: {:?}", dest_dir);
        return json_err(StatusCode::BAD_REQUEST, "target not a directory");
    }
    try_res!(path_must_be_under(&root, &dest_dir));
    tracing::info!("workspace_upload: local dest_dir={:?}", dest_dir);
    let mut saved: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut pending_rel_path: Option<String> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                tracing::warn!("workspace_upload: multipart read error: {}", e);
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
        tracing::info!("workspace_upload: writing {} to {:?}", rel, path);
        {
            use tokio::io::AsyncWriteExt;
            let mut file = match tokio::fs::File::create(&path).await {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("workspace_upload: create {} failed: {}", path.display(), e);
                    return upload_io_err(&e);
                }
            };
            let mut stream = field;
            let mut bytes_written: u64 = 0;
            loop {
                match stream.chunk().await {
                    Ok(Some(chunk)) => {
                        if cap_bytes > 0 && bytes_written + chunk.len() as u64 > cap_bytes {
                            drop(file);
                            let _ = std::fs::remove_file(&path);
                            tracing::warn!(
                                "workspace_upload: {} exceeds {} cap",
                                rel,
                                upload_cap_label_bytes(cap_bytes)
                            );
                            return json_err(
                                StatusCode::PAYLOAD_TOO_LARGE,
                                &format!(
                                    "file '{rel}' exceeds upload size limit of {}",
                                    upload_cap_label_bytes(cap_bytes)
                                ),
                            );
                        }
                        if let Err(e) = file.write_all(&chunk).await {
                            drop(file);
                            let _ = std::fs::remove_file(&path);
                            tracing::warn!(
                                "workspace_upload: write {} failed: {}",
                                path.display(),
                                e
                            );
                            return upload_io_err(&e);
                        }
                        bytes_written += chunk.len() as u64;
                    }
                    Ok(None) => break,
                    Err(e) => {
                        drop(file);
                        let _ = std::fs::remove_file(&path);
                        tracing::warn!("workspace_upload: read {} failed: {}", path.display(), e);
                        return json_err(StatusCode::BAD_REQUEST, &e.to_string());
                    }
                }
            }
            if let Err(e) = file.flush().await {
                drop(file);
                let _ = std::fs::remove_file(&path);
                tracing::warn!("workspace_upload: flush {} failed: {}", path.display(), e);
                return upload_io_err(&e);
            }
            tracing::info!("workspace_upload: saved {} ({} bytes)", rel, bytes_written);
        }
        if let Some(rel) = super::util::rel_from_root(&root, &path) {
            saved.push(rel);
        }
    }
    tracing::info!("workspace_upload: done - {} saved, {} errors", saved.len(), errors.len());
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

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::Multipart;
use tracing::{error, info};

use crate::session::SessionManager;

use super::io::{bg_image_path, migrate_settings, save_settings};
use super::normalize::{
    clamp_ime_keyboard_overlap_px, clamp_quick_send_threshold, clamp_text_config,
    clamp_theme_on_put, normalize_action_keyboards,
};
use super::types::CURRENT_SETTINGS_VERSION;
use super::{log_file_path, RemoteServer, Settings, SettingsState};

pub async fn get_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let mut settings = state.1.read().await.clone();
    if settings.log.path.is_empty() {
        settings.log.path = log_file_path().to_string_lossy().to_string();
    }
    // The token has to be in `settings.json` (see `RemoteServer::token`), which
    // means the same `Serialize` impl that writes the file would happily write
    // it into this response. Scrubbing here is what separates the two.
    settings.scrub_secrets();
    Json(settings)
}

pub async fn put_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    Json(mut new_settings): Json<Settings>,
) -> impl IntoResponse {
    let client_settings_version = new_settings.client_settings_version.take();
    let _ = migrate_settings(&mut new_settings);
    new_settings.settings_version = CURRENT_SETTINGS_VERSION;
    let _ = clamp_text_config(&mut new_settings.text);
    let _ = clamp_quick_send_threshold(&mut new_settings);
    let _ = clamp_ime_keyboard_overlap_px(&mut new_settings);
    let _ = clamp_theme_on_put(&mut new_settings);
    let _ = normalize_action_keyboards(&mut new_settings);
    // Preserve `active_workspace_id`: it is server-owned (mutated via
    // /api/workspace/activate and /api/workspace/deactivate) and absent from
    // the frontend's SettingsData payload. Without this, a full-overwrite PUT
    // would reset it to None (via #[serde(default)]) and clobber the user's
    // last-activated workspace - causing the next launch to land in the wrong
    // workspace.
    {
        let existing = state.1.read().await;
        preserve_current_settings_on_legacy_put(
            client_settings_version,
            &mut new_settings,
            &existing,
        );
        new_settings.active_workspace_id = existing.active_workspace_id.clone();
        merge_remote_server_tokens(&mut new_settings, &existing);
    }
    match save_settings(&new_settings) {
        Ok(()) => {
            *state.1.write().await = new_settings;
            StatusCode::OK
        }
        Err(e) => {
            error!("save settings: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

/// Merge the incoming remote-server roster with the stored one.
///
/// The list itself is a full replace - dropping an entry deletes it. Only the
/// tokens are inherited, and only per matching `id`: `None` means the client
/// never sent a `token` key (see [`RemoteServer::token`]), which is the normal
/// case because the GET handlers scrub the secret out of their responses and so
/// never hand it back. `Some("")` is the explicit "clear this token"
/// instruction and is left alone.
///
/// `has_token` is derived, never trusted: the client's value is overwritten
/// here so it cannot drift from the merged token.
pub(crate) fn merge_remote_server_tokens(incoming: &mut Settings, existing: &Settings) {
    inherit_remote_server_tokens(&mut incoming.remote_servers, &existing.remote_servers);
}

/// The roster half of [`merge_remote_server_tokens`], for callers that hold
/// the list rather than a whole `Settings` (the dedicated
/// `PUT /api/remote-servers` endpoint takes a bare `Vec<RemoteServer>`).
///
/// Same contract: the incoming list wins entry-for-entry, only a *missing*
/// `token` key inherits from the entry with the same `id`, and `has_token` is
/// recomputed from the merged token.
pub(crate) fn inherit_remote_server_tokens(
    incoming: &mut [RemoteServer],
    existing: &[RemoteServer],
) {
    for srv in incoming {
        if srv.token.is_none() {
            srv.token = existing.iter().find(|e| e.id == srv.id).and_then(|e| e.token.clone());
        }
        srv.refresh_has_token();
    }
}

pub(crate) fn preserve_current_settings_on_legacy_put(
    client_settings_version: Option<u32>,
    incoming: &mut Settings,
    existing: &Settings,
) {
    // Protection is field-versioned. Do not compare every field with the moving
    // CURRENT_SETTINGS_VERSION: v12 clients still understand and may edit v12
    // system-keyboard fields after the v13 overlap field is introduced.
    if client_settings_version.is_none_or(|version| version < 12) && existing.settings_version >= 12
    {
        incoming.system_keyboard.clone_from(&existing.system_keyboard);
        incoming.system_keyboard_user_default.clone_from(&existing.system_keyboard_user_default);
        incoming.system_toolbar_mode = existing.system_toolbar_mode;
    }
    if client_settings_version.is_none_or(|version| version < 13)
        && existing.settings_version >= 13
        && existing.ime_keyboard_overlap_px.is_some()
    {
        incoming.ime_keyboard_overlap_px = existing.ime_keyboard_overlap_px;
    }
    if client_settings_version.is_none_or(|version| version < 14) && existing.settings_version >= 14
    {
        incoming.inherit_cwd_for_new_tab = existing.inherit_cwd_for_new_tab;
    }
}

pub async fn upload_background(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let data = match field.bytes().await {
                Ok(d) => d,
                Err(e) => {
                    error!("read upload: {}", e);
                    return StatusCode::BAD_REQUEST;
                }
            };

            let dir = super::config_dir();
            let _ = std::fs::create_dir_all(&dir);

            // Try to decode and re-encode as WebP for compression
            match image::load_from_memory(&data) {
                Ok(img) => {
                    let resized = if img.width() > 2048 || img.height() > 2048 {
                        img.resize(2048, 2048, image::imageops::FilterType::Lanczos3)
                    } else {
                        img
                    };
                    if let Err(e) = resized.save(bg_image_path()) {
                        error!("save bg image: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
                Err(_) => {
                    // Can't decode as image - save raw
                    if let Err(e) = std::fs::write(bg_image_path(), &data) {
                        error!("save bg raw: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
            }

            // Update settings
            let mut settings = state.1.write().await;
            settings.background.has_image = true;
            settings.settings_version = CURRENT_SETTINGS_VERSION;
            let _ = save_settings(&settings);

            info!("Background image uploaded");
            return StatusCode::OK;
        }
    }
    StatusCode::BAD_REQUEST
}

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
#[allow(clippy::unused_async)]
pub async fn get_background() -> impl IntoResponse {
    let path = bg_image_path();
    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("no background"))
            .unwrap();
    }
    match std::fs::read(&path) {
        Ok(data) => Response::builder()
            .header(header::CONTENT_TYPE, "image/webp")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(data))
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("read error"))
            .unwrap(),
    }
}

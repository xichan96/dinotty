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
    clamp_quick_send_threshold, clamp_text_config, clamp_theme_on_put, normalize_action_keyboards,
};
use super::types::CURRENT_SETTINGS_VERSION;
use super::{log_file_path, Settings, SettingsState};

pub async fn get_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let mut settings = state.1.read().await.clone();
    if settings.log.path.is_empty() {
        settings.log.path = log_file_path().to_string_lossy().to_string();
    }
    Json(settings)
}

pub async fn put_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    Json(mut new_settings): Json<Settings>,
) -> impl IntoResponse {
    let _ = migrate_settings(&mut new_settings);
    new_settings.settings_version = CURRENT_SETTINGS_VERSION;
    let _ = clamp_text_config(&mut new_settings.text);
    let _ = clamp_quick_send_threshold(&mut new_settings);
    let _ = clamp_theme_on_put(&mut new_settings);
    let _ = normalize_action_keyboards(&mut new_settings);
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

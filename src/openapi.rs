use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::session::SessionManager;
use crate::settings::Settings;

type SettingsState = Arc<RwLock<Settings>>;

async fn check_open_api(
    settings: &SettingsState,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let s = settings.read().await;
    if s.open_api.enabled {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "open_api is disabled" }))))
    }
}

// ─── GET /api/sessions ───

pub async fn list_sessions(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    if let Err(e) = check_open_api(&settings).await {
        return e.into_response();
    }

    let mut sessions = Vec::new();
    for entry in &manager.sessions {
        let pane_id = entry.key().clone();
        let session = entry.value();

        let (cols, rows) = *session.size.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let status =
            match &*session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) {
                crate::session::SessionStatus::Connected => "connected",
                crate::session::SessionStatus::Detached { .. } => "detached",
            };
        let cwd = session.cwd_for_workspace().map(|path| path.display().to_string());

        // Find which tab this pane belongs to
        let mut tab_id = None;
        for tab_entry in &manager.tab_layouts {
            let layout = tab_entry.value();
            if find_pane_in_layout(layout, &pane_id) {
                tab_id = Some(tab_entry.key().clone());
                break;
            }
        }

        sessions.push(serde_json::json!({
            "pane_id": pane_id,
            "tab_id": tab_id,
            "shell_type": session.shell_type,
            "status": status,
            "size": { "cols": cols, "rows": rows },
            "cwd": cwd,
        }));
    }

    let active_pane_id =
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    Json(serde_json::json!({
        "sessions": sessions,
        "active_pane_id": active_pane_id,
    }))
    .into_response()
}

// ─── GET /api/sessions/:pane_id/screen ───

#[derive(Deserialize)]
pub struct FormatQuery {
    #[serde(default = "default_format")]
    format: String,
}

fn default_format() -> String {
    "plain".to_string()
}

pub async fn get_screen(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Path(pane_id): Path<String>,
    Query(q): Query<FormatQuery>,
) -> impl IntoResponse {
    if let Err(e) = check_open_api(&settings).await {
        return e.into_response();
    }

    let Some(session) = manager.sessions.get(&pane_id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" })))
            .into_response();
    };

    let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let (cols, rows) = (screen.cols(), screen.rows());

    let content = if q.format == "ansi" { screen.snapshot() } else { screen.snapshot_plain() };

    Json(serde_json::json!({
        "pane_id": pane_id,
        "content": content,
        "size": { "cols": cols, "rows": rows },
    }))
    .into_response()
}

// ─── GET /api/sessions/:pane_id/scrollback ───

#[derive(Deserialize)]
pub struct ScrollbackQuery {
    lines: Option<usize>,
    #[serde(default = "default_format")]
    format: String,
}

pub async fn get_scrollback(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Path(pane_id): Path<String>,
    Query(q): Query<ScrollbackQuery>,
) -> impl IntoResponse {
    if let Err(e) = check_open_api(&settings).await {
        return e.into_response();
    }

    let Some(session) = manager.sessions.get(&pane_id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" })))
            .into_response();
    };

    let screen = session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let total = screen.scrollback_len();

    if q.format == "ansi" {
        let chunks = screen.snapshot_scrollback_chunks(q.lines.unwrap_or(200));
        let lines: Vec<&str> = chunks.iter().flat_map(|c| c.lines()).collect();
        Json(serde_json::json!({
            "pane_id": pane_id,
            "lines": lines,
            "total": total,
        }))
        .into_response()
    } else {
        let lines = screen.snapshot_scrollback_plain(q.lines);
        Json(serde_json::json!({
            "pane_id": pane_id,
            "lines": lines,
            "total": total,
        }))
        .into_response()
    }
}

// ─── POST /api/sessions/:pane_id/input ───

#[derive(Deserialize)]
pub struct InputRequest {
    data: String,
}

pub async fn session_input(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Path(pane_id): Path<String>,
    Json(req): Json<InputRequest>,
) -> impl IntoResponse {
    if let Err(e) = check_open_api(&settings).await {
        return e.into_response();
    }

    let Some(session) = manager.sessions.get(&pane_id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" })))
            .into_response();
    };

    if session.write_input_sync(req.data.as_bytes()).is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write failed" })),
        )
            .into_response();
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── POST /api/sessions/:pane_id/resize ───

#[derive(Deserialize)]
pub struct ResizeRequest {
    cols: u16,
    rows: u16,
}

pub async fn session_resize(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Path(pane_id): Path<String>,
    Json(req): Json<ResizeRequest>,
) -> impl IntoResponse {
    if let Err(e) = check_open_api(&settings).await {
        return e.into_response();
    }

    let Some(session) = manager.sessions.get(&pane_id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" })))
            .into_response();
    };

    if req.cols == 0 || req.rows == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "cols and rows must be > 0" })),
        )
            .into_response();
    }

    if let Err(e) = session.resize(req.cols, req.rows) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
            .into_response();
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── Helpers ───

fn find_pane_in_layout(layout: &serde_json::Value, pane_id: &str) -> bool {
    if let Some(pid) = layout.get("paneId").and_then(|v| v.as_str()) {
        return pid == pane_id;
    }
    if let Some(children) = layout.get("children").and_then(|v| v.as_array()) {
        return children.iter().any(|c| find_pane_in_layout(c, pane_id));
    }
    false
}

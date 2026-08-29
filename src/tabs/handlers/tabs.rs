use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

use crate::platform::shell_probe::ShellProbeService;
use crate::session::{self, SessionManager, SyncMsg};
use crate::settings::SettingsState;

use super::super::service;
use super::super::types::CreateTabRequest;
use super::shell_error_response;

#[allow(clippy::unused_async)]
pub async fn list_tabs(State(manager): State<Arc<SessionManager>>) -> impl IntoResponse {
    let (tabs, active_pane_id) = manager.tab_list();
    Json(serde_json::json!({
        "tabs": tabs,
        "active_pane_id": active_pane_id,
    }))
}

#[derive(serde::Deserialize)]
pub struct RenameTabRequest {
    title: String,
}

#[allow(clippy::unused_async)]
pub async fn rename_tab(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<RenameTabRequest>,
) -> impl IntoResponse {
    let title = req.title.trim();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "title must not be empty" })),
        )
            .into_response();
    }
    if manager.rename_tab(&tab_id, title) {
        manager.broadcast_sync(&SyncMsg::TabRenamed { tab_id, title: title.to_string() });
        Json(serde_json::json!({ "ok": true })).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "tab not found" })))
            .into_response()
    }
}

pub async fn create_tab(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    State(shell_probe): State<Arc<ShellProbeService>>,
    Json(req): Json<CreateTabRequest>,
) -> impl IntoResponse {
    match super::super::service::create_tab(&manager, &settings, &shell_probe, req).await {
        Ok(outcome) => Json(serde_json::json!({
            "tab_id": outcome.tab_id,
            "pane_id": outcome.pane_id,
            "layout": outcome.layout,
            "cwd": outcome.cwd,
        }))
        .into_response(),
        Err(err) => match err {
            service::CreateTabError::Validation(e) => {
                (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))).into_response()
            }
            service::CreateTabError::ShellResolve(e) => shell_error_response(&e),
            service::CreateTabError::PtyCreate(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                    .into_response()
            }
            service::CreateTabError::SessionDiedEarly { argv_command } => {
                let message = if argv_command {
                    "command exited before tab creation completed"
                } else {
                    "session closed before tab creation completed"
                };
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": message })))
                    .into_response()
            }
        },
    }
}

#[allow(clippy::unused_async)]
pub async fn close_tab(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
) -> impl IntoResponse {
    // Get tab layout to find all leaf pane IDs
    let leaf_ids: Vec<String> = manager
        .tab_layouts
        .get(&tab_id)
        .and_then(|v| v.get("layout").cloned())
        .map(|layout| session::collect_leaf_pane_ids(&layout))
        .unwrap_or_default();

    // Each session close prunes its own leaf and emits the unified close protocol.
    for leaf_id in &leaf_ids {
        manager.kill_and_remove(leaf_id);
    }

    // Non-terminal-only tabs have no session close to remove the layout.
    if manager.remove_tab(&tab_id) {
        manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

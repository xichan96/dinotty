use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

use crate::session::{SessionManager, SyncMsg};

#[derive(Deserialize)]
pub struct EmitEventRequest {
    pub event_name: String,
    pub data: serde_json::Value,
    #[serde(default)]
    pub source_pane_id: Option<String>,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub target_plugin_id: Option<String>,
    /// sync WS `client_id` of the emitter, for echo suppression.
    /// If provided, event is broadcast to all clients except this one.
    #[serde(default)]
    pub client_id: Option<String>,
}

#[allow(clippy::unused_async)]
pub async fn emit_event(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<EmitEventRequest>,
) -> impl IntoResponse {
    let msg = SyncMsg::Event {
        source_pane_id: req.source_pane_id,
        plugin_id: req.plugin_id,
        target_plugin_id: req.target_plugin_id,
        event_name: req.event_name,
        data: req.data,
    };
    match req.client_id {
        Some(cid) => manager.broadcast_sync_others(&msg, &cid),
        None => manager.broadcast_sync(&msg),
    }
    StatusCode::OK
}

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::pty;
use crate::session::{self, SessionManager, SyncMsg};

// ─── Request/Response types ────────────────────────────────────────

#[derive(Deserialize)]
pub struct SplitPaneRequest {
    pub pane_id: String,
    pub direction: String, // "horizontal" or "vertical"
}

#[derive(Deserialize)]
pub struct UpdateLayoutRequest {
    pub layout: serde_json::Value,
    pub active_pane_id: String,
}

// ─── GET /api/tabs ─────────────────────────────────────────────────

pub async fn list_tabs(
    State(manager): State<Arc<SessionManager>>,
) -> impl IntoResponse {
    let (tabs, active_pane_id) = manager.tab_list();
    Json(serde_json::json!({
        "tabs": tabs,
        "active_pane_id": active_pane_id,
    }))
}

// ─── POST /api/tabs ────────────────────────────────────────────────

pub async fn create_tab(
    State(manager): State<Arc<SessionManager>>,
) -> impl IntoResponse {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    // Create PTY session
    let (_session, _shell_type) = match pty::create_session(
        Arc::clone(&manager),
        pane_id.clone(),
        None,
    ) {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create PTY: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response();
        }
    };

    // Create initial layout with single leaf
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": "Terminal",
        "ratio": 1,
        "zoomed": false,
    });

    // Store tab
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id,
        }),
    );

    // Set as active tab
    *manager.active_pane_id.lock().unwrap() = Some(pane_id.clone());

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
    });

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
    }))
    .into_response()
}

// ─── DELETE /api/tabs/{tab_id} ─────────────────────────────────────

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

    // Kill and remove all PTY sessions
    for leaf_id in &leaf_ids {
        manager.kill_and_remove(leaf_id);
    }

    // Remove tab
    manager.remove_tab(&tab_id);

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── POST /api/tabs/{tab_id}/pane ──────────────────────────────────

pub async fn split_pane(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<SplitPaneRequest>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "tab not found" })),
            )
                .into_response();
        }
    };

    let layout = match tab_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "tab has no layout" })),
            )
                .into_response();
        }
    };

    // Verify target pane exists in layout
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&req.pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    // Check max panes
    if leaf_ids.len() >= 6 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "maximum 6 panes per tab" })),
        )
            .into_response();
    }

    let new_pane_id = uuid::Uuid::new_v4().to_string();

    // Create PTY for new pane
    let (_session, _shell_type) = match pty::create_session(
        Arc::clone(&manager),
        new_pane_id.clone(),
        None,
    ) {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create PTY for split: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response();
        }
    };

    // Update layout tree
    let new_layout = match session::insert_pane_into_layout(
        &layout,
        &req.pane_id,
        &req.direction,
        &new_pane_id,
    ) {
        Some(l) => l,
        None => {
            // Clean up PTY if layout update fails
            manager.kill_and_remove(&new_pane_id);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "failed to update layout" })),
            )
                .into_response();
        }
    };

    // Store updated layout
    let active_pane_id = new_pane_id.clone();
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": new_layout.clone(),
            "active_pane_id": active_pane_id.clone(),
        }),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id,
        layout: new_layout.clone(),
        active_pane_id,
    });

    Json(serde_json::json!({
        "new_pane_id": new_pane_id,
        "layout": new_layout,
    }))
    .into_response()
}

// ─── DELETE /api/tabs/{tab_id}/pane/{pane_id} ──────────────────────

pub async fn close_pane(
    State(manager): State<Arc<SessionManager>>,
    Path((tab_id, pane_id)): Path<(String, String)>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "tab not found" })),
            )
                .into_response();
        }
    };

    let layout = match tab_val.get("layout") {
        Some(l) => l.clone(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "tab has no layout" })),
            )
                .into_response();
        }
    };

    // Verify pane exists in layout
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    // Kill and remove PTY session
    manager.kill_and_remove(&pane_id);

    // Update layout
    if leaf_ids.len() <= 1 {
        // Last pane - remove entire tab
        manager.remove_tab(&tab_id);

        // Broadcast tab closed
        manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });

        Json(serde_json::json!({ "ok": true, "tab_closed": true }))
    } else {
        // Remove pane from layout
        let new_layout = session::remove_pane_from_layout(&layout, &pane_id)
            .unwrap_or(serde_json::Value::Null);

        let new_leaf_ids = session::collect_leaf_pane_ids(&new_layout);
        let active = tab_val
            .get("active_pane_id")
            .and_then(|v| v.as_str());
        let active_pane_id = active
            .filter(|id| new_leaf_ids.iter().any(|lid| lid == *id))
            .or_else(|| new_leaf_ids.first().map(|s| s.as_str()))
            .unwrap_or("")
            .to_string();

        manager.insert_tab(
            tab_id.clone(),
            serde_json::json!({
                "layout": new_layout.clone(),
                "active_pane_id": active_pane_id.clone(),
            }),
        );

        // Broadcast layout updated
        manager.broadcast_sync(&SyncMsg::LayoutUpdated {
            pane_id: tab_id,
            layout: new_layout.clone(),
            active_pane_id: active_pane_id.clone(),
        });

        Json(serde_json::json!({ "ok": true, "tab_closed": false, "layout": new_layout, "active_pane_id": active_pane_id }))
    }
    .into_response()
}

// ─── PUT /api/tabs/{tab_id}/pane/{pane_id}/activate ────────────────

pub async fn activate_pane(
    State(manager): State<Arc<SessionManager>>,
    Path((tab_id, pane_id)): Path<(String, String)>,
) -> impl IntoResponse {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(&tab_id) {
        Some(v) => v.value().clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "tab not found" })),
            )
                .into_response();
        }
    };

    // Verify pane exists in layout
    let layout = tab_val.get("layout").cloned().unwrap_or(serde_json::Value::Null);
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&pane_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "pane not found in tab" })),
        )
            .into_response();
    }

    // Update active pane
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": pane_id,
        }),
    );

    // Update global active pane
    *manager.active_pane_id.lock().unwrap() = Some(pane_id.clone());

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id });

    Json(serde_json::json!({ "ok": true })).into_response()
}

// ─── PUT /api/tabs/{tab_id}/layout ─────────────────────────────────

pub async fn update_layout(
    State(manager): State<Arc<SessionManager>>,
    Path(tab_id): Path<String>,
    Json(req): Json<UpdateLayoutRequest>,
) -> impl IntoResponse {
    // Verify tab exists
    if !manager.tab_layouts.contains_key(&tab_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "tab not found" })),
        )
            .into_response();
    }

    // Store updated layout
    manager.insert_tab(
        tab_id.clone(),
        serde_json::json!({
            "layout": req.layout.clone(),
            "active_pane_id": req.active_pane_id.clone(),
        }),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id,
        layout: req.layout,
        active_pane_id: req.active_pane_id,
    });

    Json(serde_json::json!({ "ok": true })).into_response()
}

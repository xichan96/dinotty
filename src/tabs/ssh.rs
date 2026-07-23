use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};

use crate::session::{SessionManager, SshSessionParams, SyncMsg};
use crate::settings::SettingsState;
use crate::ssh;

// ─── POST /api/tabs/ssh/quick ────────────────────────────────────

pub async fn create_ssh_quick_tab(
    State(manager): State<Arc<SessionManager>>,
    Json(req): Json<ssh::SshConnectRequest>,
) -> impl IntoResponse {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    let params = req.to_params();

    // 创建 SSH 会话
    let (session, _shell_type) = match ssh::create_ssh_session(&manager, &pane_id, params, None)
        .await
    {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create SSH session: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };

    // 创建初始布局
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": format!("{}@{}", req.username, req.host),
        "shell_type": "ssh",
        "ratio": 1,
        "zoomed": false,
    });

    // 存储 tab
    if !manager.insert_tab_for_session(
        &pane_id,
        &session,
        tab_id.clone(),
        serde_json::json!({
            "layout": layout.clone(),
            "active_pane_id": pane_id.clone(),
        }),
        pane_id.clone(),
    ) {
        return (
            StatusCode::GONE,
            Json(serde_json::json!({ "error": "SSH session exited before tab publication" })),
        )
            .into_response();
    }

    // 广播
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: req.profile_id.clone(),
    });
    manager.recheck_publish_or_correct(&pane_id, &session);

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "connection_id": req.profile_id,
    }))
    .into_response()
}

// ─── POST /api/tabs/ssh ──────────────────────────────────────────

pub async fn create_ssh_tab(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<ssh::SshProfileConnectRequest>,
) -> impl IntoResponse {
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    // 从 settings 查找 profile
    let params = {
        let settings = settings.read().await;
        let profile = settings.ssh_profiles.iter().find(|p| p.id == req.profile_id);
        match profile {
            Some(profile) => SshSessionParams {
                host: profile.host.clone(),
                port: profile.port,
                username: profile.username.clone(),
                auth_method: profile.auth_method.clone(),
                default_command: profile.default_command.clone(),
                profile_id: Some(profile.id.clone()),
                initial_cwd: req.initial_cwd.clone(),
            },
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "profile not found" })),
                )
                    .into_response();
            }
        }
    };

    let tab_title = format!("{}@{}", params.username, params.host);

    // 创建 SSH 会话
    let (session, _shell_type) = match ssh::create_ssh_session(&manager, &pane_id, params, None)
        .await
    {
        Ok(x) => x,
        Err(e) => {
            tracing::error!("Failed to create SSH session: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e })))
                .into_response();
        }
    };

    // 创建初始布局
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": tab_title,
        "shell_type": "ssh",
        "ratio": 1,
        "zoomed": false,
    });

    // 存储 tab
    if !manager.insert_tab_for_session(
        &pane_id,
        &session,
        tab_id.clone(),
        serde_json::json!({
            "layout": layout.clone(),
            "active_pane_id": pane_id.clone(),
        }),
        pane_id.clone(),
    ) {
        return (
            StatusCode::GONE,
            Json(serde_json::json!({ "error": "SSH session exited before tab publication" })),
        )
            .into_response();
    }

    // 广播
    manager.broadcast_sync(&SyncMsg::TabCreated {
        tab_id: tab_id.clone(),
        pane_id: pane_id.clone(),
        layout: Some(layout.clone()),
        cwd: None,
        connection_id: Some(req.profile_id.clone()),
    });
    manager.recheck_publish_or_correct(&pane_id, &session);

    Json(serde_json::json!({
        "tab_id": tab_id,
        "pane_id": pane_id,
        "layout": layout,
        "connection_id": req.profile_id,
    }))
    .into_response()
}

use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};

use crate::history::HistoryState;
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::session::{SessionManager, SyncMsg};
use crate::settings::SettingsState;
use crate::workspace_mgmt::WorkspacesState;

use super::types::SyncClientMsg;

#[allow(clippy::unused_async)]
pub async fn sync_handler(
    ws: WebSocketUpgrade,
    State((manager, workspaces, settings)): State<(
        Arc<SessionManager>,
        WorkspacesState,
        SettingsState,
    )>,
    State(notifier): State<Arc<NotificationBroadcast>>,
    State(history): State<HistoryState>,
    State(monitor): State<MonitorState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| {
        handle_sync_socket(socket, manager, workspaces, settings, notifier, history, monitor)
    })
    .into_response()
}

async fn handle_sync_socket(
    socket: WebSocket,
    manager: Arc<SessionManager>,
    workspaces: WorkspacesState,
    settings: SettingsState,
    notifier: Arc<NotificationBroadcast>,
    history: HistoryState,
    monitor: MonitorState,
) {
    let (ws_tx, mut ws_rx) = socket.split();

    // Channel for all outbound WS messages
    let (ws_out_tx, mut ws_out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Writer task: reads from channel, writes to WebSocket sink
    let writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = ws_out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Ping sender task: keep connection alive through NAT/proxy
    // Tracks missed pongs - if 2 consecutive pings go unanswered (60s), close connection.
    let missed_pongs = Arc::new(AtomicU32::new(0));
    let ping_tx = ws_out_tx.clone();
    let pong_counter = Arc::clone(&missed_pongs);
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
            if pong_counter.fetch_add(1, Ordering::Relaxed) >= 2 {
                let _ = ping_tx.send(Message::Close(None));
                break;
            }
        }
    });

    // Register as sync client BEFORE sending tab_list so we don't miss any
    // broadcasts that happen between tab_list and registration.
    let (client_id, mut rx) = manager.add_sync_client();

    // Send client_id to the client first (for echo suppression in HTTP POST emit)
    let hello = serde_json::to_string(&SyncMsg::SyncHello { client_id: client_id.clone() })
        .expect("serialization is infallible");
    if ws_out_tx.send(Message::Text(hello)).is_err() {
        return;
    }

    // Register with the notification subsystem so the client receives its initial
    // attention-ledger snapshot and subsequent bell/notify/state_delta/mark_read_result
    // broadcasts via this sync WS (replaces the former /ws/notify channel).
    notifier.register_client(&client_id);

    // Send current tab list with active tab
    let (tabs, active_pane_id) = manager.tab_list();
    let tab_list = SyncMsg::TabList { tabs, active_pane_id };
    let msg = serde_json::to_string(&tab_list).expect("serialization is infallible");
    if ws_out_tx.send(Message::Text(msg)).is_err() {
        return;
    }

    // Send current history suggestions
    let items = history.query(None, 20).await;
    let suggestions_msg = SyncMsg::Suggestions { items };
    let msg = serde_json::to_string(&suggestions_msg).expect("serialization is infallible");
    if ws_out_tx.send(Message::Text(msg)).is_err() {
        return;
    }

    // Send current monitor history
    let history_data = monitor.snapshot_history_values().await;
    if !history_data.is_empty() {
        let monitor_msg = SyncMsg::MonitorHistory { data: history_data };
        let msg = serde_json::to_string(&monitor_msg).expect("serialization is infallible");
        if ws_out_tx.send(Message::Text(msg)).is_err() {
            return;
        }
    }

    // Send current workspace list with active workspace
    {
        let ws = workspaces.read().await;
        let active_workspace_id = settings.read().await.active_workspace_id.clone();
        let workspace_list = SyncMsg::WorkspaceList { workspaces: ws.clone(), active_workspace_id };
        let msg = serde_json::to_string(&workspace_list).expect("serialization is infallible");
        let _ = ws_out_tx.send(Message::Text(msg));
    }

    // Use mpsc channel to bridge broadcast messages and direct responses to the WebSocket
    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Forward broadcast messages into the shared channel
    let msg_tx_broadcast = msg_tx.clone();
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if msg_tx_broadcast.send(data).is_err() {
                break;
            }
        }
    });

    // Forward all messages from the shared channel to the WebSocket
    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd = tokio::spawn(async move {
        while let Some(data) = msg_rx.recv().await {
            if fwd_ws_out_tx.send(Message::Text(data)).is_err() {
                break;
            }
        }
    });

    // Monitor SSH keyboard-interactive auth prompts and forward to frontend
    let auth_mgr = Arc::clone(&manager);
    let auth_ws_out = ws_out_tx.clone();
    tokio::spawn(async move {
        let mut known_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let current_keys: std::collections::HashSet<String> =
                auth_mgr.pending_ssh_auth.iter().map(|r| r.key().clone()).collect();
            for key in &current_keys {
                if !known_keys.contains(key) {
                    known_keys.insert(key.clone());
                    let mgr = Arc::clone(&auth_mgr);
                    let ws_out = auth_ws_out.clone();
                    let pane_id = key.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            if !mgr.pending_ssh_auth.contains_key(&pane_id) {
                                break;
                            }
                            let prompt_data = {
                                let Some(auth) = mgr.pending_ssh_auth.get(&pane_id) else {
                                    break;
                                };
                                let mut rx = auth.prompts_rx.lock().await;
                                match rx.try_recv() {
                                    Ok(data) => Some(data),
                                    Err(tokio::sync::mpsc::error::TryRecvError::Empty) => None,
                                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                                        break
                                    }
                                }
                            };
                            if let Some(prompts) = prompt_data {
                                let msg = serde_json::json!({
                                    "type": "ssh_auth_prompt",
                                    "pane_id": pane_id,
                                    "prompts": prompts,
                                });
                                if ws_out.send(Message::Text(msg.to_string())).is_err() {
                                    break;
                                }
                            }
                        }
                    });
                }
            }
            known_keys.retain(|k| current_keys.contains(k));
        }
    });

    // Process incoming sync messages from this client
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(sync_msg) = serde_json::from_str::<SyncClientMsg>(&text) {
                    match sync_msg {
                        SyncClientMsg::ActivateTab { pane_id } => {
                            // Resolve leaf pane ID: pane_id may be a tab ID;
                            // look up the tab's stored active_pane_id for the actual leaf.
                            let leaf_id = manager
                                .tab_layouts
                                .get(&pane_id)
                                .and_then(|v| {
                                    v.get("active_pane_id")
                                        .and_then(|a| a.as_str())
                                        .map(String::from)
                                })
                                .unwrap_or(pane_id.clone());
                            manager.set_active_pane_id(Some(leaf_id));
                            manager.broadcast_sync_others(
                                &SyncMsg::TabActivated { pane_id },
                                &client_id,
                            );
                        }
                        SyncClientMsg::CreateTab { layout, tab_id, pane_id } => {
                            let tab_id = tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                            let leaf_id = pane_id
                                .or_else(|| crate::session::first_leaf_id(&layout))
                                .unwrap_or_else(|| tab_id.clone());
                            manager.update_layout(
                                tab_id.clone(),
                                serde_json::json!({
                                    "layout": layout,
                                    "active_pane_id": leaf_id.clone(),
                                }),
                                Some(leaf_id.clone()),
                            );
                            // Reply to the sender with server-generated IDs
                            let _ = msg_tx.send(
                                serde_json::to_string(&SyncMsg::TabCreated {
                                    tab_id: tab_id.clone(),
                                    pane_id: leaf_id.clone(),
                                    layout: Some(layout.clone()),
                                    cwd: None,
                                    connection_id: None,
                                })
                                .unwrap(),
                            );
                            // Broadcast to other clients
                            manager.broadcast_sync_others(
                                &SyncMsg::TabCreated {
                                    tab_id,
                                    pane_id: leaf_id,
                                    layout: Some(layout),
                                    cwd: None,
                                    connection_id: None,
                                },
                                &client_id,
                            );
                        }
                        SyncClientMsg::CloseTab { pane_id } => {
                            // Collect leaf pane IDs from the layout before removing it
                            let leaf_ids: Vec<String> = manager
                                .tab_layouts
                                .get(&pane_id)
                                .and_then(|v| v.get("layout").cloned())
                                .map(|layout| crate::session::collect_leaf_pane_ids(&layout))
                                .unwrap_or_default();
                            // Each session close prunes its leaf and emits the close protocol.
                            for leaf_id in &leaf_ids {
                                manager.close_pane(leaf_id);
                            }
                            // Non-terminal-only tabs have no session close to remove the layout.
                            if manager.remove_tab(&pane_id) {
                                manager.broadcast_sync_others(
                                    &SyncMsg::TabClosed { pane_id },
                                    &client_id,
                                );
                            }
                        }
                        SyncClientMsg::ClosePane { pane_id } => {
                            manager.close_pane(&pane_id);
                        }
                        SyncClientMsg::UpdateLayout { pane_id, layout, active_pane_id } => {
                            manager.update_layout(
                                pane_id.clone(),
                                serde_json::json!({
                                    "layout": layout,
                                    "active_pane_id": active_pane_id.clone(),
                                }),
                                Some(active_pane_id.clone()),
                            );
                            manager.broadcast_sync_others(
                                &SyncMsg::LayoutUpdated { pane_id, layout, active_pane_id },
                                &client_id,
                            );
                        }
                        SyncClientMsg::SshAuthResponse { pane_id, responses } => {
                            // 将用户输入的 responses 转发给 SSH handler
                            if let Some(auth) = manager.pending_ssh_auth.get(&pane_id) {
                                let _ = auth.responses_tx.send(responses);
                            }
                        }
                        SyncClientMsg::MarkRead { request } => {
                            notifier.apply_mark_read(&client_id, &request);
                        }
                    }
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Pong(_) => {
                missed_pongs.store(0, Ordering::Relaxed);
            }
            Message::Close(_) => break,
            Message::Binary(_) => {}
        }
    }
    fwd.abort();
    writer_task.abort();
    ping_task.abort();
    notifier.unregister_client(&client_id);
}

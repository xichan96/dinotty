use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use serde::{Deserialize, Serialize};
use std::{io::Write, sync::Arc};

use tracing::{error, info};

use crate::history::HistoryState;
use crate::session::{SessionManager, SessionStatus, SyncMsg};
use crate::notification::NotificationBroadcast;
use crate::settings::SettingsState;

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(rename = "paneId")]
    pane_id: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncClientMsg {
    ActivateTab { pane_id: String },
    CreateTab {
        layout: serde_json::Value,
        #[serde(default)]
        tab_id: Option<String>,
        #[serde(default)]
        pane_id: Option<String>,
    },
    CloseTab { pane_id: String },
    ClosePane { pane_id: String },
    UpdateLayout { pane_id: String, layout: serde_json::Value, active_pane_id: String },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg<'a> {
    Output { data: &'a str },
    ShellInfo { shell_type: &'a str },
    Reconnected { cols: u16, rows: u16 },
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(manager): State<Arc<SessionManager>>,
    State(history): State<HistoryState>,
) -> impl IntoResponse {
    let pane_id = q.pane_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, pane_id, manager, history))
}

pub async fn sync_handler(
    ws: WebSocketUpgrade,
    State(manager): State<Arc<SessionManager>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_sync_socket(socket, manager))
}

async fn handle_sync_socket(socket: WebSocket, manager: Arc<SessionManager>) {
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
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    // Register as sync client BEFORE sending tab_list so we don't miss any
    // broadcasts that happen between tab_list and registration.
    let (client_id, mut rx) = manager.add_sync_client();

    // Send current tab list with active tab
    let (tabs, active_pane_id) = manager.tab_list();
    let tab_list = SyncMsg::TabList { tabs, active_pane_id };
    let msg = serde_json::to_string(&tab_list).unwrap();
    if ws_out_tx.send(Message::Text(msg.into())).is_err() { return; }

    // Use mpsc channel to bridge broadcast messages and direct responses to the WebSocket
    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Forward broadcast messages into the shared channel
    let msg_tx_broadcast = msg_tx.clone();
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if msg_tx_broadcast.send(data).is_err() { break; }
        }
    });

    // Forward all messages from the shared channel to the WebSocket
    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd = tokio::spawn(async move {
        while let Some(data) = msg_rx.recv().await {
            if fwd_ws_out_tx.send(Message::Text(data.into())).is_err() { break; }
        }
    });

    // Process incoming sync messages from this client
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(sync_msg) = serde_json::from_str::<SyncClientMsg>(&text) {
                    match sync_msg {
                        SyncClientMsg::ActivateTab { pane_id } => {
                            *manager.active_pane_id.lock().unwrap() = Some(pane_id.clone());
                            manager.broadcast_sync_others(&SyncMsg::TabActivated { pane_id }, &client_id);
                        }
                        SyncClientMsg::CreateTab { layout, tab_id, pane_id } => {
                            let tab_id = tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                            let leaf_id = pane_id
                                .or_else(|| crate::session::first_leaf_id(&layout))
                                .unwrap_or_else(|| tab_id.clone());
                            *manager.active_pane_id.lock().unwrap() = Some(leaf_id.clone());
                            manager.insert_tab(tab_id.clone(), serde_json::json!({
                                "layout": layout,
                                "active_pane_id": leaf_id,
                            }));
                            // Reply to the sender with server-generated IDs
                            let _ = msg_tx.send(serde_json::to_string(&SyncMsg::TabCreated {
                                tab_id: tab_id.clone(),
                                pane_id: leaf_id.clone(),
                                layout: Some(layout.clone()),
                            }).unwrap());
                            // Broadcast to other clients
                            manager.broadcast_sync_others(&SyncMsg::TabCreated {
                                tab_id,
                                pane_id: leaf_id,
                                layout: Some(layout),
                            }, &client_id);
                        }
                        SyncClientMsg::CloseTab { pane_id } => {
                            // Collect leaf pane IDs from the layout before removing it
                            let leaf_ids: Vec<String> = manager.tab_layouts.get(&pane_id)
                                .and_then(|v| v.get("layout").cloned())
                                .map(|layout| crate::session::collect_leaf_pane_ids(&layout))
                                .unwrap_or_default();
                            // Kill and remove PTY sessions for all leaves in this tab
                            for leaf_id in &leaf_ids {
                                manager.kill_and_remove(leaf_id);
                            }
                            manager.remove_tab(&pane_id);
                            // Remove stale pane_id from any parent tab layouts
                            manager.purge_pane_from_layouts(&pane_id);
                            manager.broadcast_sync_others(&SyncMsg::TabClosed { pane_id }, &client_id);
                        }
                        SyncClientMsg::ClosePane { pane_id } => {
                            manager.kill_and_remove(&pane_id);
                            // Collect affected layouts before purging
                            let before_layouts: Vec<(String, serde_json::Value)> = manager.tab_layouts.iter()
                                .map(|e| (e.key().clone(), e.value().clone()))
                                .collect();
                            let emptied_tabs = manager.purge_pane_from_layouts(&pane_id);
                            // Broadcast layout changes to other clients
                            for (tab_id, old_val) in &before_layouts {
                                if let Some(new_val) = manager.tab_layouts.get(tab_id) {
                                    if *new_val.value() != *old_val {
                                        let layout = new_val.value().get("layout").cloned().unwrap_or(serde_json::Value::Null);
                                        let active = new_val.value().get("active_pane_id")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string();
                                        manager.broadcast_sync_others(&SyncMsg::LayoutUpdated {
                                            pane_id: tab_id.clone(),
                                            layout,
                                            active_pane_id: active,
                                        }, &client_id);
                                    }
                                }
                            }
                            // Broadcast TabClosed for tabs that became empty
                            for tab_id in emptied_tabs {
                                manager.broadcast_sync_others(&SyncMsg::TabClosed { pane_id: tab_id }, &client_id);
                            }
                        }
                        SyncClientMsg::UpdateLayout { pane_id, layout, active_pane_id } => {
                            manager.insert_tab(pane_id.clone(), serde_json::json!({
                                "layout": layout,
                                "active_pane_id": active_pane_id,
                            }));
                            manager.broadcast_sync_others(&SyncMsg::LayoutUpdated {
                                pane_id,
                                layout,
                                active_pane_id,
                            }, &client_id);
                        }
                    }
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    fwd.abort();
    writer_task.abort();
    ping_task.abort();
}

async fn handle_socket(socket: WebSocket, pane_id: String, manager: Arc<SessionManager>, history: HistoryState) {
    info!("WebSocket connected: pane={}", pane_id);
    let (ws_tx, mut ws_rx) = socket.split();
    let mut input_buffer = String::new();

    // Channel for all outbound WS messages (PTY output, Ping, Pong)
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
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    // Check if session already exists (reconnection / multi-client case)
    let existing_session = manager.sessions.get(&pane_id).map(|r| Arc::clone(r.value()));
    if let Some(session) = existing_session {
        info!("Joining existing session: pane={}", pane_id);

        *session.status.lock().unwrap() = SessionStatus::Connected;

        // Snapshot screen state and register for broadcast atomically
        // (holding the screen lock prevents PTY output from being both in the
        // snapshot AND queued to the broadcast channel)
        let (cols, rows, scrollback_chunks, snapshot, mut rx) = {
            let screen = session.screen.lock().unwrap();
            let (cols, rows) = *session.size.lock().unwrap();
            let chunks = screen.snapshot_scrollback_chunks(200);
            let snap = screen.snapshot();
            let rx = session.add_client();
            info!("Snapshot for pane={}: cols={}, rows={}, scrollback_chunks={}, snapshot_len={}", pane_id, cols, rows, chunks.len(), snap.len());
            (cols, rows, chunks, snap, rx)
        };

        // Send reconnected message
        let msg = serde_json::to_string(&ServerMsg::Reconnected { cols, rows }).unwrap();
        info!("Sending reconnected to pane={}: {}", pane_id, msg);
        if ws_out_tx.send(Message::Text(msg.into())).is_err() {
            error!("Failed to send reconnected msg to pane={}", pane_id);
            return;
        }
        for chunk in &scrollback_chunks {
            let msg = serde_json::to_string(&ServerMsg::Output { data: chunk }).unwrap();
            if ws_out_tx.send(Message::Text(msg.into())).is_err() { return; }
        }

        let msg = serde_json::to_string(&ServerMsg::Output { data: &snapshot }).unwrap();
        info!("Sending snapshot to pane={}: msg_len={}", pane_id, msg.len());
        if ws_out_tx.send(Message::Text(msg.into())).is_err() {
            error!("Failed to send snapshot to pane={}", pane_id);
            return;
        }
        info!("All initial messages sent to pane={}", pane_id);

        let pane_id_fwd = pane_id.clone();
        let fwd_ws_out_tx = ws_out_tx.clone();
        let fwd = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                info!("Forwarder: pane={}, data_len={}", pane_id_fwd, data.len());
                let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
                if fwd_ws_out_tx.send(Message::Text(msg.into())).is_err() {
                    error!("Forwarder: failed to send WS message for pane={}", pane_id_fwd);
                    break;
                }
            }
            info!("Forwarder: exited for pane={}", pane_id_fwd);
        });

        // Input channel: replaces old channel so only this connection writes to PTY
        let mut input_rx = session.replace_input_channel();
        let write_session = Arc::clone(&session);
        tokio::spawn(async move {
            while let Some(data) = input_rx.recv().await {
                let mut w = write_session.writer.lock().unwrap();
                let _ = w.write_all(data.as_bytes());
            }
        });

        // Read loop
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    match serde_json::from_str::<ClientMsg>(&text) {
                        Ok(ClientMsg::Input { data }) => {
                            for ch in data.chars() {
                                if ch == '\r' || ch == '\n' {
                                    let cmd = input_buffer.trim().to_string();
                                    if !cmd.is_empty() {
                                        let h = history.clone();
                                        tokio::spawn(async move { h.push_realtime(&cmd).await; });
                                    }
                                    input_buffer.clear();
                                } else if ch == '\x7f' || ch == '\x08' {
                                    input_buffer.pop();
                                } else if ch == '\x03' || ch == '\x15' {
                                    input_buffer.clear();
                                } else if !ch.is_control() {
                                    input_buffer.push(ch);
                                }
                            }
                            let tx = session.input_tx.lock().unwrap();
                            if let Some(tx) = tx.as_ref() {
                                let _ = tx.send(data);
                            }
                        }
                        Ok(ClientMsg::Resize { cols, rows }) => {
                            let m = session.master.lock().unwrap();
                            let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                            drop(m);
                            *session.size.lock().unwrap() = (cols, rows);
                            session.screen.lock().unwrap().resize(cols as usize, rows as usize);
                        }
                        Err(e) => error!("parse msg: {}", e),
                    }
                }
                Message::Ping(data) => {
                    let _ = ws_out_tx.send(Message::Pong(data));
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        fwd.abort();
        writer_task.abort();
        ping_task.abort();

        if !session.has_clients() {
            *session.status.lock().unwrap() = SessionStatus::Detached { since: std::time::Instant::now() };
            info!("Session detached (all clients gone): pane={}", pane_id);
        }
        return;
    }

    // ── New session ──
    info!("No existing session found for pane={}, creating new PTY session (this is unexpected for new tabs!)", pane_id);
    let (session, shell_type) = match crate::pty::create_session(Arc::clone(&manager), pane_id.clone(), None) {
        Ok(x) => x,
        Err(e) => {
            error!("{}", e);
            return;
        }
    };

    let mut rx = session.add_client();

    // Send shell info
    let shell_info = serde_json::to_string(&ServerMsg::ShellInfo { shell_type: &shell_type }).unwrap();
    let _ = ws_out_tx.send(Message::Text(shell_info.into()));

    // Forward PTY output to this WS client
    let pane_id_fwd = pane_id.clone();
    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            info!("Forwarder (new): pane={}, data_len={}", pane_id_fwd, data.len());
            let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
            if fwd_ws_out_tx.send(Message::Text(msg.into())).is_err() {
                error!("Forwarder (new): failed to send WS message for pane={}", pane_id_fwd);
                break;
            }
        }
        info!("Forwarder (new): exited for pane={}", pane_id_fwd);
    });

    // Input channel: dedicated write task reads from channel → PTY writer
    let mut input_rx = session.replace_input_channel();
    let write_session = Arc::clone(&session);
    tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            let mut w = write_session.writer.lock().unwrap();
            let _ = w.write_all(data.as_bytes());
        }
    });

    // WS read loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Input { data }) => {
                        for ch in data.chars() {
                            if ch == '\r' || ch == '\n' {
                                let cmd = input_buffer.trim().to_string();
                                if !cmd.is_empty() {
                                    let h = history.clone();
                                    tokio::spawn(async move { h.push_realtime(&cmd).await; });
                                }
                                input_buffer.clear();
                            } else if ch == '\x7f' || ch == '\x08' {
                                input_buffer.pop();
                            } else if ch == '\x03' || ch == '\x15' {
                                input_buffer.clear();
                            } else if !ch.is_control() {
                                input_buffer.push(ch);
                            }
                        }
                        let tx = session.input_tx.lock().unwrap();
                        if let Some(tx) = tx.as_ref() {
                            let _ = tx.send(data);
                        }
                    }
                    Ok(ClientMsg::Resize { cols, rows }) => {
                        let m = session.master.lock().unwrap();
                        let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                        drop(m);
                        *session.size.lock().unwrap() = (cols, rows);
                        session.screen.lock().unwrap().resize(cols as usize, rows as usize);
                    }
                    Err(e) => error!("parse msg: {}", e),
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    fwd.abort();
    writer_task.abort();
    ping_task.abort();

    if !session.has_clients() {
        *session.status.lock().unwrap() = SessionStatus::Detached { since: std::time::Instant::now() };
        info!("Session detached (all clients gone): pane={}", pane_id);
    }
}

pub async fn notification_ws_handler(
    ws: WebSocketUpgrade,
    State(notifier): State<Arc<NotificationBroadcast>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_notification_socket(socket, notifier))
}

async fn handle_notification_socket(socket: WebSocket, notifier: Arc<NotificationBroadcast>) {
    let (ws_tx, mut ws_rx) = socket.split();
    let mut rx = notifier.subscribe();

    // Channel for all outbound WS messages
    let (ws_out_tx, mut ws_out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Writer task
    let writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = ws_out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Ping sender task
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await;
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let json = serde_json::to_string(&event).unwrap();
            if fwd_ws_out_tx.send(Message::Text(json.into())).is_err() {
                break;
            }
        }
    });

    // Keep connection alive until client disconnects
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    fwd.abort();
    writer_task.abort();
    ping_task.abort();
}

#[derive(Deserialize)]
pub struct InputRequest {
    pub pane_id: Option<String>,
    pub data: String,
}

pub async fn post_input(
    State((manager, settings)): State<(Arc<SessionManager>, SettingsState)>,
    Json(req): Json<InputRequest>,
) -> impl IntoResponse {
    let s = settings.read().await;
    if !s.open_api.enabled {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "open_api is disabled" })));
    }
    drop(s);

    let pane_id = req.pane_id.clone().or_else(|| {
        manager.active_pane_id.lock().unwrap().clone()
    });

    let pane_id = match pane_id {
        Some(id) if manager.sessions.contains_key(&id) => id,
        _ => {
            // Fall back to first available session
            match manager.sessions.iter().next() {
                Some(entry) => entry.key().clone(),
                None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "no active pane" }))),
            }
        }
    };

    match manager.sessions.get(&pane_id) {
        Some(session) => {
            let mut w = session.writer.lock().unwrap();
            let _ = w.write_all(req.data.as_bytes());
            (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "pane not found" }))),
    }
}

pub async fn handle_open_api_ws(
    socket: WebSocket,
    manager: Arc<SessionManager>,
    pane_id: String,
) {
    let session = match manager.sessions.get(&pane_id) {
        Some(s) => Arc::clone(s.value()),
        None => return,
    };

    let (ws_tx, mut ws_rx) = socket.split();
    let (ws_out_tx, mut ws_out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Writer task
    let writer_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = ws_out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Ping task
    let ping_tx = ws_out_tx.clone();
    let ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await;
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![])).is_err() {
                break;
            }
        }
    });

    // Register as broadcast client
    let mut rx = session.add_client();

    // Forward broadcast output to WS
    let fwd_ws_out_tx = ws_out_tx.clone();
    let pane_id_fwd = pane_id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let msg = serde_json::to_string(&ServerMsg::Output { data: &data }).unwrap();
            if fwd_ws_out_tx.send(Message::Text(msg.into())).is_err() {
                break;
            }
        }
        let _ = pane_id_fwd; // keep for logging if needed
    });

    // Read loop: accept Input and Resize messages
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) {
                    match client_msg {
                        ClientMsg::Input { data } => {
                            let mut w = session.writer.lock().unwrap();
                            let _ = w.write_all(data.as_bytes());
                        }
                        ClientMsg::Resize { cols, rows } => {
                            let m = session.master.lock().unwrap();
                            let _ = m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                            drop(m);
                            *session.size.lock().unwrap() = (cols, rows);
                            session.screen.lock().unwrap().resize(cols as usize, rows as usize);
                        }
                    }
                }
            }
            Message::Ping(data) => {
                let _ = ws_out_tx.send(Message::Pong(data));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    fwd.abort();
    writer_task.abort();
    ping_task.abort();
}

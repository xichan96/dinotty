use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tracing::{error, info, warn};

use crate::history::HistoryState;
use crate::session::{SessionClientEvent, SessionManager, SessionStatus};
use crate::settings::SettingsState;

use super::types::{ClientMsg, ServerMsg, WsQuery};

#[allow(clippy::unused_async)]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(manager): State<Arc<SessionManager>>,
    State(history): State<HistoryState>,
    State(settings): State<SettingsState>,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    _headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // WebSocket connections only attach to panes already created through /api/tabs.
    // Reject argv explicitly so a reconnect can never silently turn into a spawn request.
    if q.argv.is_some() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    // paneId must reference a tab created via /api/tabs (or the sync WS
    // CreateTab message); otherwise an authenticated client could spawn
    // unbounded orphan PTYs by connecting with random/empty paneIds. Cookie
    // session auth (auth_middleware) handles access control; this check
    // prevents resource exhaustion.
    let Some(pane_id) = q.pane_id else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !manager.is_pane_in_any_tab(&pane_id) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, pane_id, manager, history, settings))
        .into_response()
}

async fn handle_socket(
    socket: WebSocket,
    pane_id: String,
    manager: Arc<SessionManager>,
    history: HistoryState,
    settings: SettingsState,
) {
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

    // Check if session already exists (reconnection / multi-client case)
    let existing_session = manager.session_for_attach(&pane_id);
    if let Some(session) = existing_session {
        info!("Joining existing session: pane={}", pane_id);

        *session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
            SessionStatus::Connected;
        if !manager.is_current_session(&pane_id, &session) {
            info!("Session closed during reconnect: pane={}", pane_id);
            let msg = serde_json::to_string(&ServerMsg::SessionExit)
                .expect("serialization is infallible");
            let _ = ws_out_tx.send(Message::Text(msg));
            ping_task.abort();
            drop(ws_out_tx);
            let _ = writer_task.await;
            return;
        }

        // Fit-then-snapshot handshake (proposal 3): send Reconnected with the
        // current session.size as info only - do NOT push scrollback/snapshot
        // yet. The client converges its local layout, fits once, and replies
        // with SnapshotRequest{cols, rows}; the server then resizes PTY+screen
        // to the client's final size atomically with the snapshot, and replies
        // with ReplayBegin -> chunks -> ReplayEnd. add_client sets
        // snapshot_pending=true so broadcast() drops live Output for this
        // client until ReplayEnd is enqueued (effect captured by snapshot).
        let (cols, rows, client_id, mut rx) = {
            let (cols, rows) =
                *session.size.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (client_id, rx) = session.add_client();
            info!(
                "Reconnected (snapshot pending) pane={}: info_cols={}, info_rows={}",
                pane_id, cols, rows
            );
            (cols, rows, client_id, rx)
        };

        // Send reconnected message - client should reset xterm, converge
        // layout, fit once, then send SnapshotRequest{cols, rows}.
        let msg = serde_json::to_string(&ServerMsg::Reconnected { cols, rows })
            .expect("serialization is infallible");
        info!("Sending reconnected to pane={}: {}", pane_id, msg);
        if ws_out_tx.send(Message::Text(msg)).is_err() {
            error!("Failed to send reconnected msg to pane={}", pane_id);
            return;
        }
        info!("Reconnected sent (snapshot pending SnapshotRequest), pane={}", pane_id);

        let fwd_ws_out_tx = ws_out_tx.clone();
        let fwd_pane = pane_id.clone();
        let fwd = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                let msg = match event {
                    SessionClientEvent::Output(data) => {
                        serde_json::to_string(&ServerMsg::Output { data: &data })
                    }
                    SessionClientEvent::Resize { cols, rows } => {
                        serde_json::to_string(&ServerMsg::Resize { cols, rows })
                    }
                    SessionClientEvent::SessionExit { pane_id: _, .. } => {
                        serde_json::to_string(&ServerMsg::SessionExit)
                    }
                    SessionClientEvent::SyncBegin => serde_json::to_string(&ServerMsg::SyncBegin),
                    SessionClientEvent::SyncEnd => serde_json::to_string(&ServerMsg::SyncEnd),
                    SessionClientEvent::ReplayBegin { cols, rows } => {
                        serde_json::to_string(&ServerMsg::ReplayBegin { cols, rows })
                    }
                    SessionClientEvent::ReplayEnd => serde_json::to_string(&ServerMsg::ReplayEnd),
                }
                .expect("serialization is infallible");
                if fwd_ws_out_tx.send(Message::Text(msg)).is_err() {
                    info!("WS forwarder (reconnect): send failed, exiting pane={}", fwd_pane);
                    break;
                }
            }
            info!("WS forwarder (reconnect): channel closed, exiting pane={}", fwd_pane);
        });

        // Input channel: replaces old channel so only this connection writes to PTY
        let mut input_rx = session.replace_input_channel();
        let write_session = Arc::clone(&session);
        let write_pane = pane_id.clone();
        let is_ssh = write_session.is_ssh();
        tokio::spawn(async move {
            while let Some(first) = input_rx.recv().await {
                if write_session.is_exited() {
                    break;
                }
                // Batch: drain all pending messages to minimize lock acquisitions
                let mut batch = first;
                while let Ok(data) = input_rx.try_recv() {
                    batch.push_str(&data);
                }
                let batch_len = batch.len();
                let result = if is_ssh {
                    write_session.write_input_async(batch.as_bytes()).await
                } else {
                    let ws = Arc::clone(&write_session);
                    tokio::task::spawn_blocking(move || ws.write_input_blocking(batch.as_bytes()))
                        .await
                        .unwrap_or_else(|e| Err(e.to_string()))
                };
                match result {
                    Ok(()) => {}
                    Err(e) => {
                        error!("PTY write error ({}B): {}, pane={}", batch_len, e, write_pane);
                        break;
                    }
                }
            }
            info!("PTY write task (reconnect) exited, pane={}", write_pane);
        });

        // Read loop
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(ClientMsg::Input { data }) => {
                        for ch in data.chars() {
                            if ch == '\r' || ch == '\n' {
                                let cmd = input_buffer.trim().to_string();
                                if !cmd.is_empty() {
                                    let h = history.clone();
                                    tokio::spawn(async move {
                                        h.push_realtime(&cmd).await;
                                    });
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
                        let tx = session
                            .input_tx
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if let Some(tx) = tx.as_ref() {
                            let _ = tx.send(data);
                        }
                    }
                    Ok(ClientMsg::Resize { cols, rows }) => {
                        session.resize_debounced(client_id, cols, rows);
                    }
                    Ok(ClientMsg::SnapshotRequest { cols, rows }) => {
                        if let Err(e) = session
                            .atomic_resize_and_snapshot_for_client(client_id, cols, rows)
                            .await
                        {
                            warn!("snapshot_request failed: {e}, pane={}", pane_id);
                        }
                    }
                    Err(e) => error!("parse msg: {}", e),
                },
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
        session.remove_client(client_id);

        if !session.has_clients() {
            *session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                SessionStatus::Detached { since: std::time::Instant::now() };
            info!("Session detached (all clients gone): pane={}", pane_id);
        }
        return;
    }

    // ── New session ──
    // If the pane belongs to a registered tab (e.g. SSH) but the session is gone,
    // the session must have exited. Don't silently create a local PTY.
    if manager.is_pane_in_any_tab(&pane_id) {
        info!("Pane {} belongs to a tab but session is gone - sending session_exit", pane_id);
        let msg =
            serde_json::to_string(&ServerMsg::SessionExit).expect("serialization is infallible");
        let _ = ws_out_tx.send(Message::Text(msg));
        // Keep the connection alive briefly so the client receives the message
        if let Some(Ok(_)) = ws_rx.next().await {}
        return;
    }

    info!("No existing session found for pane={}, creating new PTY session", pane_id);
    let cwd = settings.read().await.resolved_default_workspace_root();
    let (session, shell_type) =
        match crate::pty::create_session(&manager, &pane_id, None, None, cwd, None) {
            Ok(x) => x,
            Err(e) => {
                error!("{}", e);
                return;
            }
        };

    let (client_id, mut rx) = session.add_client();

    // Send shell info
    let shell_info = serde_json::to_string(&ServerMsg::ShellInfo { shell_type: &shell_type })
        .expect("serialization is infallible");
    let _ = ws_out_tx.send(Message::Text(shell_info));

    // Forward PTY output to this WS client
    let fwd_ws_out_tx = ws_out_tx.clone();
    let fwd_pane = pane_id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let msg = match event {
                SessionClientEvent::Output(data) => {
                    serde_json::to_string(&ServerMsg::Output { data: &data })
                }
                SessionClientEvent::Resize { cols, rows } => {
                    serde_json::to_string(&ServerMsg::Resize { cols, rows })
                }
                SessionClientEvent::SessionExit { pane_id: _, .. } => {
                    serde_json::to_string(&ServerMsg::SessionExit)
                }
                SessionClientEvent::SyncBegin => serde_json::to_string(&ServerMsg::SyncBegin),
                SessionClientEvent::SyncEnd => serde_json::to_string(&ServerMsg::SyncEnd),
                SessionClientEvent::ReplayBegin { cols, rows } => {
                    serde_json::to_string(&ServerMsg::ReplayBegin { cols, rows })
                }
                SessionClientEvent::ReplayEnd => serde_json::to_string(&ServerMsg::ReplayEnd),
            }
            .expect("serialization is infallible");
            if fwd_ws_out_tx.send(Message::Text(msg)).is_err() {
                info!("WS forwarder: send failed, exiting pane={}", fwd_pane);
                break;
            }
        }
        info!("WS forwarder: channel closed, exiting pane={}", fwd_pane);
    });

    // Input channel: dedicated write task reads from channel -> PTY writer
    let mut input_rx = session.replace_input_channel();
    let write_session = Arc::clone(&session);
    let write_pane = pane_id.clone();
    let is_ssh = write_session.is_ssh();
    tokio::spawn(async move {
        while let Some(first) = input_rx.recv().await {
            if write_session.is_exited() {
                break;
            }
            // Batch: drain all pending messages to minimize lock acquisitions
            let mut batch = first;
            while let Ok(data) = input_rx.try_recv() {
                batch.push_str(&data);
            }
            let batch_len = batch.len();
            let result = if is_ssh {
                write_session.write_input_async(batch.as_bytes()).await
            } else {
                let ws = Arc::clone(&write_session);
                tokio::task::spawn_blocking(move || ws.write_input_blocking(batch.as_bytes()))
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()))
            };
            match result {
                Ok(()) => {}
                Err(e) => {
                    error!("PTY write error ({}B): {}, pane={}", batch_len, e, write_pane);
                    break;
                }
            }
        }
        info!("PTY write task exited, pane={}", write_pane);
    });

    // WS read loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(ClientMsg::Input { data }) => {
                    for ch in data.chars() {
                        if ch == '\r' || ch == '\n' {
                            let cmd = input_buffer.trim().to_string();
                            if !cmd.is_empty() {
                                let h = history.clone();
                                tokio::spawn(async move {
                                    h.push_realtime(&cmd).await;
                                });
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
                    let tx =
                        session.input_tx.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    if let Some(tx) = tx.as_ref() {
                        let _ = tx.send(data);
                    }
                }
                Ok(ClientMsg::Resize { cols, rows }) => {
                    session.resize_debounced(client_id, cols, rows);
                }
                Ok(ClientMsg::SnapshotRequest { cols, rows }) => {
                    if let Err(e) =
                        session.atomic_resize_and_snapshot_for_client(client_id, cols, rows).await
                    {
                        warn!("snapshot_request failed: {e}, pane={}", pane_id);
                    }
                }
                Err(e) => error!("parse msg: {}", e),
            },
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
    session.remove_client(client_id);

    if !session.has_clients() {
        *session.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
            SessionStatus::Detached { since: std::time::Instant::now() };
        info!("Session detached (all clients gone): pane={}", pane_id);
    }
}

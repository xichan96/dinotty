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
use crate::mission_control::{MissionControlState, NavDir};
use crate::monitor::MonitorState;
use crate::notification::NotificationBroadcast;
use crate::session::{SessionManager, SyncMsg, TabInfo};
use crate::settings::SettingsState;
use crate::workspace_mgmt::{tab_workspace_id, Workspace, WorkspacesState};

use super::types::SyncClientMsg;

#[allow(clippy::unused_async, clippy::too_many_arguments)]
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
    State(mc): State<MissionControlState>,
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
        handle_sync_socket(socket, manager, workspaces, settings, notifier, history, monitor, mc)
    })
    .into_response()
}

#[allow(clippy::too_many_arguments)]
async fn handle_sync_socket(
    socket: WebSocket,
    manager: Arc<SessionManager>,
    workspaces: WorkspacesState,
    settings: SettingsState,
    notifier: Arc<NotificationBroadcast>,
    history: HistoryState,
    monitor: MonitorState,
    mc: MissionControlState,
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

    // Send current Mission Control snapshot. Sent after tab_list/workspace_list
    // so the client can resolve selected_workspace_id / selected_tab_id against
    // the just-received catalogues.
    {
        let mc_snap = mc.read().await.clone();
        let snapshot_msg = SyncMsg::McSnapshot {
            open: mc_snap.open,
            selected_workspace_id: mc_snap.selected_workspace_id,
            selected_tab_id: mc_snap.selected_tab_id,
        };
        let msg = serde_json::to_string(&snapshot_msg).expect("serialization is infallible");
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
                                    workspace_id: None,
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
                                    workspace_id: None,
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
                                    &SyncMsg::TabClosed { pane_id: pane_id.clone() },
                                    &client_id,
                                );
                            }
                            // If the closed tab was MC's selected one, clear the
                            // selection so the next Navigate starts fresh.
                            let selected_changed = {
                                let mut snap = mc.write().await;
                                if snap.selected_tab_id.as_deref() == Some(pane_id.as_str()) {
                                    snap.selected_tab_id = None;
                                    true
                                } else {
                                    false
                                }
                            };
                            if selected_changed {
                                let snap = mc.read().await.clone();
                                manager.broadcast_sync(&SyncMsg::SelectionChanged {
                                    selected_workspace_id: snap.selected_workspace_id,
                                    selected_tab_id: None,
                                    tab_title: None,
                                });
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
                        SyncClientMsg::RenameTab { tab_id, title } => {
                            if manager.rename_tab(&tab_id, &title) {
                                manager.broadcast_sync_others(
                                    &SyncMsg::TabRenamed { tab_id, title },
                                    &client_id,
                                );
                            }
                        }
                        SyncClientMsg::MissionControlOp { op } => {
                            handle_mission_control_op(op, &manager, &workspaces, &mc).await;
                        }
                        SyncClientMsg::Input { data } => {
                            // Safety net: if MC is open, drop terminal input so a
                            // buggy hardware-keyboard firmware cannot leak arrow
                            // keys into the PTY while the user is in the overview.
                            let mc_open = mc.read().await.open;
                            if mc_open {
                                continue;
                            }
                            let active = manager
                                .active_pane_id
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner)
                                .clone();
                            let Some(pane_id) = active else { continue };
                            let Some(session) =
                                manager.sessions.get(&pane_id).map(|e| Arc::clone(e.value()))
                            else {
                                continue;
                            };
                            tokio::spawn(async move {
                                let _ = session.write_input_async(data.as_bytes()).await;
                            });
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

/// Tab title for a given tab_id, read from the layout JSON's `title` field.
/// Returns None if the tab does not exist or has no title.
fn tab_title_for(manager: &SessionManager, tab_id: &str) -> Option<String> {
    manager
        .tab_layouts
        .get(tab_id)
        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(String::from))
}

/// Resolve the leaf pane id for a tab (the pane that should be activated when
/// the user confirms this tab in MC). Falls back to the tab_id itself.
fn tab_leaf_for(manager: &SessionManager, tab_id: &str) -> Option<String> {
    manager.tab_layouts.get(tab_id).and_then(|v| {
        v.get("active_pane_id")
            .and_then(|a| a.as_str())
            .map(String::from)
            .or_else(|| v.get("layout").and_then(crate::session::first_leaf_id))
    })
}

/// Pure tab navigation within a workspace. Filters `tabs` to those belonging
/// to `selected_workspace_id` (mirroring frontend `filteredCards`) and steps
/// `selected_tab_id` left/right within that filtered list. Returns `None`
/// when the highlight should land on the "add" card - this happens when:
///   - the workspace has no tabs, or
///   - the user arrows past the last tab (Right) or before the first tab
///     (Left), wrapping through the "add" card.
///
/// Wrap-around: from the "add" card, Right wraps to the first tab and Left
/// wraps to the last tab. This lets the keyboard cycle through every card
/// the user sees, including "add".
///
/// Extracted from `handle_mission_control_op` so the bug-fix path can be
/// unit-tested without spinning up a `SessionManager`.
fn navigate_tab_in_workspace(
    tabs: &[TabInfo],
    workspaces: &[Workspace],
    selected_workspace_id: Option<&str>,
    selected_tab_id: Option<&str>,
    dir: NavDir,
) -> Option<String> {
    let filtered_ids: Vec<&str> = tabs
        .iter()
        .filter(|t| {
            tab_workspace_id(workspaces, t.cwd.as_deref(), t.connection_id.as_deref()).as_deref()
                == selected_workspace_id
        })
        .map(|t| t.tab_id.as_str())
        .collect();
    if filtered_ids.is_empty() {
        return None;
    }
    let cur_idx = selected_tab_id.and_then(|id| filtered_ids.iter().position(|t| *t == id));
    match cur_idx {
        None => {
            // Currently on the "add" card (or stale). Wrap to the opposite
            // end of the filtered list.
            if dir == NavDir::Left {
                filtered_ids.last().map(std::string::ToString::to_string)
            } else {
                Some(filtered_ids[0].to_string())
            }
        }
        Some(i) => {
            if dir == NavDir::Left {
                if i == 0 {
                    None // First tab -> "add" card
                } else {
                    Some(filtered_ids[i - 1].to_string())
                }
            } else {
                if i + 1 >= filtered_ids.len() {
                    None // Last tab -> "add" card
                } else {
                    Some(filtered_ids[i + 1].to_string())
                }
            }
        }
    }
}

/// Apply a Mission Control operation. The lock is held only while mutating
/// `mc`; broadcasts happen after release so a slow WS write cannot block
/// other clients' mutations.
#[allow(clippy::too_many_lines)]
async fn handle_mission_control_op(
    op: crate::mission_control::McOp,
    manager: &Arc<SessionManager>,
    workspaces: &WorkspacesState,
    mc: &MissionControlState,
) {
    use crate::mission_control::McOp;

    match op {
        McOp::Toggle => {
            let mut snap = mc.write().await;
            snap.open = !snap.open;
            // On open, seed selection from the current active tab so the
            // highlight lands where the user expects. On close, leave
            // selected_* intact so re-opening restores the last position.
            if snap.open {
                let active = manager
                    .active_pane_id
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone();
                if let Some(active_id) = active {
                    // Resolve from active leaf -> tab id by scanning layouts.
                    let mut found_tab: Option<String> = None;
                    for entry in &manager.tab_layouts {
                        let v = entry.value();
                        let leaf = v
                            .get("active_pane_id")
                            .and_then(|a| a.as_str())
                            .map(String::from)
                            .or_else(|| v.get("layout").and_then(crate::session::first_leaf_id));
                        if leaf.as_deref() == Some(active_id.as_str()) || entry.key() == &active_id
                        {
                            found_tab = Some(entry.key().clone());
                            break;
                        }
                    }
                    snap.selected_tab_id = found_tab;
                    // selected_workspace_id left untouched on toggle-open.
                }
            }
            let open = snap.open;
            let selected_workspace_id = snap.selected_workspace_id.clone();
            let selected_tab_id = snap.selected_tab_id.clone();
            drop(snap);
            manager.broadcast_sync(&SyncMsg::MissionControlToggled {
                open,
                selected_workspace_id,
                selected_tab_id,
            });
        }
        McOp::Navigate { dir } => {
            // Snapshot the data we need, then release locks before broadcasting.
            let (selected_workspace_id, selected_tab_id, tab_title) = {
                let mut snap = mc.write().await;
                if !snap.open {
                    // Navigate while MC is closed is a no-op (hardware keyboard
                    // should be sending Input instead). Ignore silently.
                    return;
                }
                let (tabs, _) = manager.tab_list();
                match dir {
                    NavDir::Up | NavDir::Down => {
                        // Cycle through [None (=default workspace), ...workspace ids].
                        // Up/Down navigates the workspace list because workspaces are
                        // stacked vertically in the MC dual-panel layout.
                        let ws_ids: Vec<String> =
                            workspaces.read().await.iter().map(|w| w.id.clone()).collect();
                        let all_ids: Vec<Option<String>> =
                            std::iter::once(None).chain(ws_ids.into_iter().map(Some)).collect();
                        let cur = snap.selected_workspace_id.clone();
                        let cur_idx = all_ids
                            .iter()
                            .position(|id| id.as_deref() == cur.as_deref())
                            .unwrap_or(0);
                        let new_idx = if dir == NavDir::Up {
                            cur_idx.saturating_sub(1)
                        } else {
                            (cur_idx + 1).min(all_ids.len() - 1)
                        };
                        snap.selected_workspace_id.clone_from(&all_ids[new_idx]);
                        // Reset tab selection when crossing workspace boundary
                        // - the previous tab_id belongs to the old workspace.
                        snap.selected_tab_id = None;
                    }
                    NavDir::Left | NavDir::Right => {
                        // Left/Right navigates tabs within the current workspace -
                        // the tab grid is laid out horizontally. Filter to the
                        // selected workspace so the keyboard highlight stays on
                        // cards the user actually sees (frontend `filteredCards`
                        // filters the same way). Without this filter, tabs from
                        // other workspaces interleaved in `tab_order` would
                        // cause ArrowRight to land on an off-screen tab and the
                        // frontend's `focusedIndex` would fall through to the
                        // "add" card.
                        let selected_ws = snap.selected_workspace_id.clone();
                        let ws_snapshot = workspaces.read().await.clone();
                        snap.selected_tab_id = navigate_tab_in_workspace(
                            &tabs,
                            &ws_snapshot,
                            selected_ws.as_deref(),
                            snap.selected_tab_id.as_deref(),
                            dir,
                        );
                    }
                }
                let selected_workspace_id = snap.selected_workspace_id.clone();
                let selected_tab_id = snap.selected_tab_id.clone();
                let tab_title =
                    selected_tab_id.as_deref().and_then(|id| tab_title_for(manager, id));
                (selected_workspace_id, selected_tab_id, tab_title)
            };
            manager.broadcast_sync(&SyncMsg::SelectionChanged {
                selected_workspace_id,
                selected_tab_id,
                tab_title,
            });
        }
        McOp::Jump { workspace_id } => {
            let (selected_workspace_id, selected_tab_id, tab_title) = {
                let mut snap = mc.write().await;
                if !snap.open {
                    return;
                }
                snap.selected_workspace_id = workspace_id;
                snap.selected_tab_id = None;
                let selected_workspace_id = snap.selected_workspace_id.clone();
                let selected_tab_id = snap.selected_tab_id.clone();
                let tab_title = None;
                (selected_workspace_id, selected_tab_id, tab_title)
            };
            manager.broadcast_sync(&SyncMsg::SelectionChanged {
                selected_workspace_id,
                selected_tab_id,
                tab_title,
            });
        }
        McOp::Confirm => {
            // Resolve selected -> active, then close MC.
            let target_leaf = {
                let snap = mc.read().await;
                if !snap.open {
                    return;
                }
                snap.selected_tab_id.as_deref().and_then(|id| tab_leaf_for(manager, id))
            };
            if let Some(leaf) = target_leaf {
                manager.set_active_pane_id(Some(leaf.clone()));
                manager.broadcast_sync(&SyncMsg::TabActivated { pane_id: leaf });
            }
            // Close MC.
            {
                let mut snap = mc.write().await;
                snap.open = false;
                let selected_workspace_id = snap.selected_workspace_id.clone();
                let selected_tab_id = snap.selected_tab_id.clone();
                drop(snap);
                manager.broadcast_sync(&SyncMsg::MissionControlToggled {
                    open: false,
                    selected_workspace_id,
                    selected_tab_id,
                });
            }
        }
        McOp::Cancel => {
            let mut snap = mc.write().await;
            if !snap.open {
                return;
            }
            snap.open = false;
            let selected_workspace_id = snap.selected_workspace_id.clone();
            let selected_tab_id = snap.selected_tab_id.clone();
            drop(snap);
            manager.broadcast_sync(&SyncMsg::MissionControlToggled {
                open: false,
                selected_workspace_id,
                selected_tab_id,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_mgmt::Workspace;

    fn tab(tab_id: &str, cwd: Option<&str>, connection_id: Option<&str>) -> TabInfo {
        TabInfo {
            tab_id: tab_id.to_string(),
            pane_id: tab_id.to_string(),
            layout: None,
            active_pane_id: None,
            cwd: cwd.map(String::from),
            connection_id: connection_id.map(String::from),
            workspace_id: None,
            title: None,
        }
    }

    fn ws_local(id: &str, path: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: id.to_string(),
            path: path.to_string(),
            order: 0,
            connection_id: None,
            abbr: None,
            color: None,
        }
    }

    /// Reproduces the user-reported bug: with two tabs in the default
    /// workspace and one tab in another workspace interleaved in
    /// `tab_order`, ArrowRight from the first tab must land on the second
    /// tab of the same workspace, not skip to the "add" card because an
    /// off-workspace tab sits between them in the global order.
    #[test]
    fn navigate_right_skips_off_workspace_tabs_in_tab_order() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        // tab_order = [tab1_default, tab3_other, tab2_default]
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id = navigate_tab_in_workspace(
            &tabs,
            &workspaces,
            None, // selected_workspace_id = None (default)
            Some("tab1"),
            NavDir::Right,
        );
        assert_eq!(new_id.as_deref(), Some("tab2"));
    }

    /// ArrowRight on the last tab of a workspace lands on the "add" card
    /// (selected_tab_id = None) so the user can press Enter to create a new
    /// tab. Without this, the keyboard could never reach the "add" card.
    #[test]
    fn navigate_right_at_last_tab_goes_to_add_card() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id =
            navigate_tab_in_workspace(&tabs, &workspaces, None, Some("tab2"), NavDir::Right);
        assert!(new_id.is_none());
    }

    /// ArrowLeft on the first tab of a workspace lands on the "add" card
    /// (symmetric to ArrowRight on the last tab).
    #[test]
    fn navigate_left_at_first_tab_goes_to_add_card() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
        ];
        let new_id =
            navigate_tab_in_workspace(&tabs, &workspaces, None, Some("tab1"), NavDir::Left);
        assert!(new_id.is_none());
    }

    /// From the "add" card, ArrowRight wraps to the first tab of the
    /// workspace. This lets the keyboard cycle: tab1 -> ... -> tabN ->
    /// add card -> tab1 -> ...
    #[test]
    fn navigate_right_from_add_card_wraps_to_first() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id = navigate_tab_in_workspace(
            &tabs,
            &workspaces,
            None,
            None, // on add card
            NavDir::Right,
        );
        assert_eq!(new_id.as_deref(), Some("tab1"));
    }

    /// From the "add" card, ArrowLeft wraps to the last tab of the
    /// workspace (symmetric to ArrowRight wrap).
    #[test]
    fn navigate_left_from_add_card_wraps_to_last() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id = navigate_tab_in_workspace(
            &tabs,
            &workspaces,
            None,
            None, // on add card
            NavDir::Left,
        );
        assert_eq!(new_id.as_deref(), Some("tab2"));
    }

    #[test]
    fn navigate_left_within_default_workspace() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id =
            navigate_tab_in_workspace(&tabs, &workspaces, None, Some("tab2"), NavDir::Left);
        assert_eq!(new_id.as_deref(), Some("tab1"));
    }

    /// Tabs in a non-default workspace navigate independently of the
    /// default workspace's tabs.
    #[test]
    fn navigate_within_named_workspace() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
            tab("tab4", Some("/Users/me/other/y"), None),
            tab("tab2", Some("/tmp/default/2"), None),
        ];
        let new_id = navigate_tab_in_workspace(
            &tabs,
            &workspaces,
            Some("other"),
            Some("tab3"),
            NavDir::Right,
        );
        assert_eq!(new_id.as_deref(), Some("tab4"));
    }

    #[test]
    fn navigate_with_no_tabs_in_workspace_returns_none() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![tab("tab1", Some("/tmp/default"), None)];
        let new_id =
            navigate_tab_in_workspace(&tabs, &workspaces, Some("other"), None, NavDir::Right);
        assert!(new_id.is_none());
    }

    /// When `selected_tab_id` is stale (belongs to another workspace),
    /// navigation treats the highlight as being on the "add" card and
    /// wraps to the appropriate end of the filtered list.
    #[test]
    fn navigate_from_stale_selected_wraps_to_first_on_right() {
        let workspaces = vec![ws_local("other", "/Users/me/other")];
        let tabs = vec![
            tab("tab1", Some("/tmp/default"), None),
            tab("tab3", Some("/Users/me/other/x"), None),
        ];
        let new_id = navigate_tab_in_workspace(
            &tabs,
            &workspaces,
            None,         // default workspace
            Some("tab3"), // stale - from `other`
            NavDir::Right,
        );
        assert_eq!(new_id.as_deref(), Some("tab1"));
    }
}

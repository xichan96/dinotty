use super::layout::{
    collect_leaf_pane_ids, collect_terminal_leaf_pane_ids, ensure_leaf_kind, first_leaf_id,
    layout_has_pane, remove_pane_from_layout,
};
use super::Session;
use crate::attention::{MarkReadResult, Severity, Snapshot, StateDelta};
use crate::event_bus::{BusEvent, EventBus};
use crate::workspace_mgmt::Workspace;
use dashmap::DashMap;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicU16, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::{info, warn};

const SESSION_REAP_TICK: Duration = Duration::from_secs(30);
const SESSION_UNOWNED_GRACE: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug)]
pub enum CloseReason {
    Explicit,
    NaturalExit,
    Reaped,
    Shutdown,
}

struct LayoutUpdate {
    tab_id: String,
    layout: serde_json::Value,
    active_pane_id: String,
}

#[derive(Default)]
struct LayoutChanges {
    closed_tabs: Vec<String>,
    updates: Vec<LayoutUpdate>,
}

struct ClosePlan {
    session: Arc<Session>,
    closed_tabs: Vec<String>,
    layout_updates: Vec<LayoutUpdate>,
}

pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
}

pub struct SyncClient {
    pub id: String,
    pub tx: mpsc::UnboundedSender<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList {
        tabs: Vec<TabInfo>,
        active_pane_id: Option<String>,
    },
    TabCreated {
        tab_id: String,
        pane_id: String,
        layout: Option<serde_json::Value>,
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        connection_id: Option<String>,
    },
    TabClosed {
        pane_id: String,
    },
    TabActivated {
        pane_id: String,
    },
    LayoutUpdated {
        pane_id: String,
        layout: serde_json::Value,
        active_pane_id: String,
    },
    PluginChanged {
        plugin_id: String,
        change: String,
    },
    ProcessExited {
        plugin_id: String,
        pid: u32,
        exit_code: Option<i32>,
    },
    CommandFinished {
        pane_id: String,
        command: String,
        exit_code: i32,
        duration_ms: u64,
        stdout: String,
        method: String,
    },
    WorkspaceCreated {
        workspace: Workspace,
    },
    WorkspaceUpdated {
        workspace: Workspace,
    },
    WorkspaceDeleted {
        id: String,
    },
    WorkspaceActivated {
        id: Option<String>,
    },
    WorkspaceReordered {
        ids: Vec<String>,
    },
    WorkspaceList {
        workspaces: Vec<Workspace>,
        active_workspace_id: Option<String>,
    },
    Event {
        #[serde(skip_serializing_if = "Option::is_none")]
        source_pane_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_plugin_id: Option<String>,
        event_name: String,
        data: serde_json::Value,
    },
    SyncHello {
        client_id: String,
    },
    Bell {
        v: u64,
        pane_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    Notify {
        v: u64,
        pane_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        body: String,
        notification_type: String,
        #[serde(rename = "eventSeq")]
        event_seq: String,
        #[serde(rename = "occurredAt")]
        occurred_at: u64,
        severity: Severity,
        #[serde(rename = "notifId", skip_serializing_if = "Option::is_none")]
        notif_id: Option<String>,
    },
    StateDelta {
        #[serde(flatten)]
        delta: StateDelta,
    },
    Snapshot {
        #[serde(flatten)]
        snapshot: Snapshot,
    },
    MarkReadResult {
        #[serde(flatten)]
        result: MarkReadResult,
    },
    ResyncRequired {
        v: u64,
    },
    Suggestions {
        items: Vec<crate::history::SuggestionItem>,
    },
    MonitorData {
        data: serde_json::Value,
    },
    MonitorHistory {
        data: Vec<serde_json::Value>,
    },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub tab_id: String,
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// The `SshProfile.id` if this tab is an SSH session created from a profile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

#[derive(Default)]
struct ReapTickStats {
    total: usize,
    referenced: usize,
    unowned_grace: usize,
}

fn reconcile_unowned_since(
    session_ids: &[String],
    referenced_pane_ids: &HashSet<String>,
    unowned_since: &mut HashMap<String, Instant>,
    now: Instant,
) -> (ReapTickStats, Vec<(String, Instant)>) {
    let current_sessions: HashSet<&str> = session_ids.iter().map(String::as_str).collect();
    unowned_since.retain(|pane_id, _| current_sessions.contains(pane_id.as_str()));

    let mut stats = ReapTickStats { total: session_ids.len(), ..ReapTickStats::default() };
    let mut unowned = Vec::new();
    for pane_id in session_ids {
        if referenced_pane_ids.contains(pane_id) {
            stats.referenced += 1;
            unowned_since.remove(pane_id);
            continue;
        }

        let since = *unowned_since.entry(pane_id.clone()).or_insert(now);
        if now.saturating_duration_since(since) < SESSION_UNOWNED_GRACE {
            stats.unowned_grace += 1;
        }
        unowned.push((pane_id.clone(), since));
    }
    (stats, unowned)
}

fn session_is_reap_eligible(since: Instant, now: Instant, status: &SessionStatus) -> bool {
    now.saturating_duration_since(since) >= SESSION_UNOWNED_GRACE
        && !matches!(status, SessionStatus::Connected)
}

pub struct SessionManager {
    pub sessions: DashMap<String, Arc<Session>>,
    pub sync_clients: Arc<Mutex<Vec<SyncClient>>>,
    pub active_pane_id: Arc<Mutex<Option<String>>>,
    pub tab_layouts: DashMap<String, serde_json::Value>,
    pub pending_ssh_auth: DashMap<String, crate::session::backend::PendingSshAuth>,
    pub tab_order: Mutex<Vec<String>>,
    pub event_bus: EventBus,
    /// Guards membership and all composite mutations of `sessions`,
    /// `tab_layouts`, `tab_order`, `active_pane_id`, and `unowned_since`.
    ///
    /// Lock order rule: this lock and per-session locks (`exited`, `status`,
    /// and `backend`) are never held together in either order. Signals,
    /// broadcasts, disk I/O, and async work must also happen after release.
    lifecycle: Mutex<()>,
    unowned_since: Mutex<HashMap<String, Instant>>,
    notify_port: AtomicU16,
    /// Set once (via `register_notifier`) so any authoritative pane-removal site - including
    /// natural PTY/SSH exit, which never goes through `kill_and_remove` - can notify the
    /// attention ledger without threading a notifier handle through every call site.
    notifier: std::sync::OnceLock<Arc<crate::notification::NotificationBroadcast>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            sync_clients: Arc::new(Mutex::new(Vec::new())),
            active_pane_id: Arc::new(Mutex::new(None)),
            tab_layouts: DashMap::new(),
            tab_order: Mutex::new(Vec::new()),
            pending_ssh_auth: DashMap::new(),
            event_bus: EventBus::new(),
            lifecycle: Mutex::new(()),
            unowned_since: Mutex::new(HashMap::new()),
            notify_port: AtomicU16::new(0),
            notifier: std::sync::OnceLock::new(),
        }
    }

    /// Notifies the attention ledger that `pane_id` was authoritatively removed, if a notifier
    /// has been registered (via `register_notifier`). No-op otherwise (e.g. in unit tests that
    /// construct a bare `SessionManager`).
    pub(crate) fn pane_closed_notify(&self, pane_id: &str) {
        if let Some(notifier) = self.notifier.get() {
            notifier.pane_closed(pane_id);
        }
    }

    #[must_use]
    pub fn notify_port(&self) -> u16 {
        self.notify_port.load(Ordering::Relaxed)
    }

    pub fn set_notify_port(&self, port: u16) {
        self.notify_port.store(port, Ordering::Relaxed);
    }

    fn insert_tab_locked(&self, tab_id: String, value: serde_json::Value) {
        let mut order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !order.contains(&tab_id) {
            order.push(tab_id.clone());
        }
        drop(order);
        self.tab_layouts.insert(tab_id, value);
    }

    /// Insert a tab layout and record its order position.
    pub fn insert_tab(&self, tab_id: String, value: serde_json::Value) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.insert_tab_locked(tab_id, value);
    }

    fn remove_tab_locked(&self, tab_id: &str) -> bool {
        let removed = self.tab_layouts.remove(tab_id).is_some();
        let mut order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        order.retain(|id| id != tab_id);
        removed
    }

    /// Remove a tab layout and its order entry.
    pub fn remove_tab(&self, tab_id: &str) -> bool {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.remove_tab_locked(tab_id)
    }

    fn update_layout_locked(
        &self,
        tab_id: String,
        value: serde_json::Value,
        active_pane_id: Option<String>,
    ) {
        self.insert_tab_locked(tab_id, value);
        if let Some(active_pane_id) = active_pane_id {
            *self.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(active_pane_id);
        }
    }

    /// Atomically update a layout and, when supplied, the global active pane.
    pub fn update_layout(
        &self,
        tab_id: String,
        value: serde_json::Value,
        active_pane_id: Option<String>,
    ) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.update_layout_locked(tab_id, value, active_pane_id);
    }

    /// Publish a newly-created tab only if the exact session is still a member.
    pub fn insert_tab_for_session(
        &self,
        pane_id: &str,
        session: &Arc<Session>,
        tab_id: String,
        value: serde_json::Value,
        active_pane_id: String,
    ) -> bool {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let is_current =
            self.sessions.get(pane_id).is_some_and(|current| Arc::ptr_eq(current.value(), session));
        if is_current {
            self.update_layout_locked(tab_id, value, Some(active_pane_id));
        }
        is_current
    }

    pub fn set_active_pane_id(&self, pane_id: Option<String>) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        *self.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = pane_id;
    }

    pub fn insert_session(&self, pane_id: String, session: Arc<Session>) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.unowned_since
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&pane_id);
        self.sessions.insert(pane_id, session);
    }

    /// Clone a session only after synchronizing with lifecycle removal.
    pub fn session_for_attach(&self, pane_id: &str) -> Option<Arc<Session>> {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.sessions.get(pane_id).map(|session| Arc::clone(session.value()))
    }

    /// Revalidate that a cloned session is still the current member.
    pub fn is_current_session(&self, pane_id: &str, session: &Arc<Session>) -> bool {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.sessions.get(pane_id).is_some_and(|current| Arc::ptr_eq(current.value(), session))
    }

    /// Check if a `pane_id` belongs to any registered tab layout.
    /// Used to prevent creating fallback PTY sessions for SSH panes.
    pub fn is_pane_in_any_tab(&self, pane_id: &str) -> bool {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for entry in &self.tab_layouts {
            if let Some(layout) = entry.value().get("layout") {
                if layout_has_pane(layout, pane_id) {
                    return true;
                }
            }
        }
        false
    }

    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync(&self, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let mut clients =
            self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| c.tx.send(json.clone()).is_ok());
    }

    /// Broadcast to all sync clients except the one with the given ID.
    ///
    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync_others(&self, msg: &SyncMsg, exclude_id: &str) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let mut clients =
            self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        clients.retain(|c| {
            if c.id == exclude_id {
                true // keep in list but don't send
            } else {
                c.tx.send(json.clone()).is_ok()
            }
        });
    }

    /// Send a message to a single sync client by ID. Returns `true` if the client was found
    /// (the send may still fail silently if the client's channel is closed, in which case the
    /// client is reaped on the next broadcast). Used by the notification subsystem to route
    /// `MarkReadResult` back to the origin client.
    ///
    /// # Panics
    /// Panics if `SyncMsg` serialization fails (should be infallible).
    #[allow(clippy::expect_used)]
    pub fn broadcast_sync_to(&self, target_id: &str, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).expect("serialization is infallible");
        let clients = self.sync_clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for client in clients.iter() {
            if client.id == target_id {
                let _ = client.tx.send(json.clone());
                break;
            }
        }
    }

    pub fn add_sync_client(&self) -> (String, mpsc::UnboundedReceiver<String>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        self.sync_clients
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(SyncClient { id: id.clone(), tx });
        (id, rx)
    }

    pub fn broadcast_plugin_changed(&self, plugin_id: String, change: String) {
        self.broadcast_sync(&SyncMsg::PluginChanged { plugin_id, change });
    }

    /// Compatibility shim for explicit close callers.
    pub fn kill_and_remove(&self, pane_id: &str) -> bool {
        self.close_session(pane_id, CloseReason::Explicit, true, None)
    }

    /// Remove a `pane_id` from all parent tab layouts. If removing it causes
    /// a split to have only one child, the split collapses into that child.
    /// Returns the list of tab IDs whose layouts became empty (i.e. the pane
    /// was the last leaf) so the caller can broadcast `TabClosed` for them.
    pub fn purge_pane_from_layouts(&self, pane_id: &str) -> Vec<String> {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        self.purge_pane_from_layouts_locked(pane_id, true).closed_tabs
    }

    fn purge_pane_from_layouts_locked(
        &self,
        pane_id: &str,
        skip_matching_tab: bool,
    ) -> LayoutChanges {
        let mut updates: Vec<(String, serde_json::Value)> = Vec::new();
        let mut emptied_tabs: Vec<String> = Vec::new();

        for entry in &self.tab_layouts {
            let tab_pane_id = entry.key();
            if skip_matching_tab && tab_pane_id == pane_id {
                continue;
            }
            let val = entry.value();
            let Some(layout) = val.get("layout") else { continue };
            match remove_pane_from_layout(layout, pane_id) {
                None => {
                    // The pane was the only leaf - tab is now empty
                    emptied_tabs.push(tab_pane_id.clone());
                }
                Some(new_layout) if new_layout != *layout => {
                    let active = val.get("active_pane_id").and_then(|v| v.as_str());
                    let new_leaf_ids = collect_leaf_pane_ids(&new_layout);
                    let active_pane_id = active
                        .filter(|id| new_leaf_ids.iter().any(|lid| lid == *id))
                        .or_else(|| new_leaf_ids.first().map(String::as_str));
                    let mut new_val = serde_json::json!({ "layout": new_layout });
                    if let Some(a) = active_pane_id {
                        new_val["active_pane_id"] = serde_json::Value::String(a.to_string());
                    }
                    updates.push((tab_pane_id.clone(), new_val));
                }
                _ => {}
            }
        }

        let mut layout_updates = Vec::new();
        for (key, val) in updates {
            let layout = val.get("layout").cloned().unwrap_or(serde_json::Value::Null);
            let active_pane_id =
                val.get("active_pane_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            self.insert_tab_locked(key.clone(), val);
            layout_updates.push(LayoutUpdate { tab_id: key, layout, active_pane_id });
        }
        for tab_id in &emptied_tabs {
            self.remove_tab_locked(tab_id);
        }
        LayoutChanges { closed_tabs: emptied_tabs, updates: layout_updates }
    }

    pub fn tab_list(&self) -> (Vec<TabInfo>, Option<String>) {
        // Prune stale tab layouts whose terminal leaves no longer have PTY sessions.
        // Leaves with kind=plugin|files|web have no PTY and are exempt - a tab with
        // only non-terminal leaves is NOT stale.
        {
            let _lifecycle =
                self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let stale = self
                .tab_layouts
                .iter()
                .filter_map(|e| {
                    let v = e.value();
                    let layout = v.get("layout")?;
                    let all_leaf_ids = collect_leaf_pane_ids(layout);
                    if all_leaf_ids.is_empty() {
                        return Some(e.key().clone());
                    }
                    // Only terminal leaves require a live PTY session.
                    let terminal_ids = collect_terminal_leaf_pane_ids(layout);
                    if terminal_ids.iter().any(|id| !self.sessions.contains_key(id)) {
                        return Some(e.key().clone());
                    }
                    None
                })
                .collect::<Vec<_>>();
            for key in &stale {
                self.remove_tab_locked(key);
            }
        }

        let order = self.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let order_index = |tab_id: &str| -> usize {
            order.iter().position(|id| id == tab_id).unwrap_or(usize::MAX)
        };

        let mut tabs: Vec<TabInfo> = self
            .tab_layouts
            .iter()
            .map(|e| {
                let tab_id = e.key().clone();
                let v = e.value();
                let layout = v.get("layout").cloned().map(ensure_leaf_kind);
                let pane_id =
                    layout.as_ref().and_then(first_leaf_id).unwrap_or_else(|| tab_id.clone());
                let active_pane_id =
                    v.get("active_pane_id").and_then(|v| v.as_str()).map(String::from);
                let cwd = self.sessions.get(&pane_id).and_then(|s| {
                    s.cwd_state.lock().ok().map(|state| state.cwd.to_string_lossy().to_string())
                });
                let connection_id = self
                    .sessions
                    .get(&pane_id)
                    .and_then(|s| s.ssh_params.as_ref().and_then(|p| p.profile_id.clone()));
                TabInfo { tab_id, pane_id, layout, active_pane_id, cwd, connection_id }
            })
            .collect();

        tabs.sort_by_key(|t| order_index(&t.tab_id));
        drop(order);

        let active =
            self.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        (tabs, active)
    }

    fn on_pty_exited_locked(&self, leaf_pane_id: &str) -> LayoutChanges {
        self.purge_pane_from_layouts_locked(leaf_pane_id, false)
    }

    /// Legacy layout-only wrapper. Natural backend exits use `close_session`;
    /// this remains for callers that only need the guarded layout mutation.
    pub fn on_pty_exited(&self, leaf_pane_id: &str) -> Option<String> {
        let changes = {
            let _lifecycle =
                self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            self.on_pty_exited_locked(leaf_pane_id)
        };
        for update in changes.updates {
            self.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: update.tab_id,
                layout: update.layout,
                active_pane_id: update.active_pane_id,
            });
        }
        changes.closed_tabs.into_iter().next()
    }

    /// The single authoritative close chokepoint. Returns true only for the
    /// caller that removed the session membership under `lifecycle`.
    pub fn close_session(
        &self,
        pane_id: &str,
        reason: CloseReason,
        kill: bool,
        exit_code: Option<i32>,
    ) -> bool {
        let plan = {
            let _lifecycle =
                self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let Some((_, session)) = self.sessions.remove(pane_id) else {
                return false;
            };
            self.unowned_since
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(pane_id);

            let mut layout_changes = self.on_pty_exited_locked(pane_id);
            if layout_changes.closed_tabs.is_empty() && layout_changes.updates.is_empty() {
                // Layoutless creation paths are registered in Task 4. Until then,
                // preserve the close protocol's TabClosed fallback for them.
                layout_changes.closed_tabs.push(pane_id.to_string());
            }
            let mut active =
                self.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if active.as_deref() == Some(pane_id) {
                *active = None;
            }

            ClosePlan {
                session,
                closed_tabs: layout_changes.closed_tabs,
                layout_updates: layout_changes.updates,
            }
        };

        info!("Closing session: pane={pane_id}, reason={reason:?}, kill={kill}");
        let termination_confirmed = !kill || plan.session.kill_child_and_confirm();
        if termination_confirmed {
            // Task 3: ledger.remove only on confirmed termination
        } else {
            warn!(
                "Session backend termination unconfirmed; retaining future ledger entry: pane={pane_id}, reason={reason:?}"
            );
        }

        plan.session.input_tx.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
        let _ = plan.session.output_tx.send(Vec::new());
        let _ = plan.session.notify_exit_and_mark_exited(pane_id, exit_code);
        self.pane_closed_notify(pane_id);
        self.event_bus.publish(BusEvent::SessionClosed { pane_id: pane_id.to_string(), exit_code });
        for tab_id in plan.closed_tabs {
            self.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id });
        }
        for update in plan.layout_updates {
            self.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: update.tab_id,
                layout: update.layout,
                active_pane_id: update.active_pane_id,
            });
        }
        let callback = plan
            .session
            .tauri_on_exit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(callback) = callback {
            callback(pane_id.to_string(), exit_code);
        }
        true
    }

    /// Registers the notifier once, so `kill_and_remove` and natural PTY/SSH exit paths can
    /// notify the attention ledger directly via `pane_closed_notify` without threading a
    /// notifier handle through every call site. Safe to call before `start_cleanup_task` (the
    /// two are independent - a bind failure or startup ordering issue must never suppress the
    /// unowned-session reaper).
    pub fn register_notifier(&self, notifier: Arc<crate::notification::NotificationBroadcast>) {
        let _ = self.notifier.set(notifier);
    }

    pub fn start_cleanup_task(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(SESSION_REAP_TICK);
            loop {
                interval.tick().await;
                let now = Instant::now();
                let (stats, unowned) = manager.scan_unowned_sessions(now);
                let candidates = unowned
                    .into_iter()
                    .filter_map(|(pane_id, session, since)| {
                        let eligible = {
                            let status = session
                                .status
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner);
                            session_is_reap_eligible(since, now, &status)
                        };
                        eligible.then_some(pane_id)
                    })
                    .collect::<Vec<_>>();

                let mut reaped = 0;
                for pane_id in candidates {
                    if manager.final_reap_recheck(&pane_id, Instant::now())
                        && manager.close_session(&pane_id, CloseReason::Reaped, true, None)
                    {
                        reaped += 1;
                    }
                }

                if stats.referenced != stats.total || reaped > 0 {
                    info!(
                        total = stats.total,
                        referenced = stats.referenced,
                        unowned_grace = stats.unowned_grace,
                        reaped,
                        "Session cleanup sweep"
                    );
                }
            }
        });
    }

    fn referenced_pane_ids_locked(&self) -> HashSet<String> {
        self.tab_layouts
            .iter()
            .filter_map(|entry| entry.value().get("layout").cloned())
            .flat_map(|layout| collect_terminal_leaf_pane_ids(&layout))
            .collect()
    }

    fn pane_is_referenced_locked(&self, pane_id: &str) -> bool {
        self.tab_layouts.iter().any(|entry| {
            entry.value().get("layout").is_some_and(|layout| {
                collect_terminal_leaf_pane_ids(layout).iter().any(|id| id == pane_id)
            })
        })
    }

    fn scan_unowned_sessions(
        &self,
        now: Instant,
    ) -> (ReapTickStats, Vec<(String, Arc<Session>, Instant)>) {
        let _lifecycle = self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let referenced_pane_ids = self.referenced_pane_ids_locked();
        let session_ids = self.sessions.iter().map(|entry| entry.key().clone()).collect::<Vec<_>>();
        let (stats, unowned) = reconcile_unowned_since(
            &session_ids,
            &referenced_pane_ids,
            &mut self.unowned_since.lock().unwrap_or_else(std::sync::PoisonError::into_inner),
            now,
        );
        let unowned = unowned
            .into_iter()
            .filter_map(|(pane_id, since)| {
                self.sessions
                    .get(&pane_id)
                    .map(|session| (pane_id, Arc::clone(session.value()), since))
            })
            .collect();
        (stats, unowned)
    }

    fn final_reap_recheck(&self, pane_id: &str, now: Instant) -> bool {
        let candidate = {
            let _lifecycle =
                self.lifecycle.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if self.pane_is_referenced_locked(pane_id) {
                self.unowned_since
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(pane_id);
                return false;
            }

            let Some(session) = self.sessions.get(pane_id).map(|entry| Arc::clone(entry.value()))
            else {
                self.unowned_since
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(pane_id);
                return false;
            };
            let since = *self
                .unowned_since
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .entry(pane_id.to_string())
                .or_insert(now);
            if now.saturating_duration_since(since) < SESSION_UNOWNED_GRACE {
                return false;
            }
            (session, since)
        };

        let status = candidate.0.status.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        session_is_reap_eligible(candidate.1, now, &status)
    }
}

#[cfg(test)]
mod reap_tests {
    use super::*;

    #[test]
    fn referenced_session_is_never_reap_eligible() {
        let started = Instant::now();
        let later = started + SESSION_UNOWNED_GRACE + Duration::from_secs(1);
        let session_ids = vec!["pane-1".to_string()];
        let referenced = HashSet::from(["pane-1".to_string()]);
        let mut unowned_since = HashMap::from([("pane-1".to_string(), started)]);

        let (stats, unowned) =
            reconcile_unowned_since(&session_ids, &referenced, &mut unowned_since, later);

        assert_eq!(stats.referenced, 1);
        assert!(unowned.is_empty());
        assert!(unowned_since.is_empty());
    }

    #[test]
    fn unowned_session_remains_in_grace_before_sixty_seconds() {
        let started = Instant::now();
        let session_ids = vec!["pane-1".to_string()];
        let mut unowned_since = HashMap::new();
        let (stats, unowned) =
            reconcile_unowned_since(&session_ids, &HashSet::new(), &mut unowned_since, started);
        let since = unowned[0].1;
        let status = SessionStatus::Detached { since: started };

        assert_eq!(stats.unowned_grace, 1);
        assert!(!session_is_reap_eligible(since, started + Duration::from_secs(59), &status));
    }

    #[test]
    fn unowned_detached_session_is_eligible_at_sixty_seconds() {
        let started = Instant::now();

        assert!(session_is_reap_eligible(
            started,
            started + SESSION_UNOWNED_GRACE,
            &SessionStatus::Detached { since: started }
        ));
    }

    #[test]
    fn connected_session_is_exempt_after_unowned_grace() {
        let started = Instant::now();
        let after_grace = started + SESSION_UNOWNED_GRACE;

        assert!(!session_is_reap_eligible(started, after_grace, &SessionStatus::Connected));
        assert!(session_is_reap_eligible(
            started,
            after_grace,
            &SessionStatus::Detached { since: after_grace }
        ));
    }
}

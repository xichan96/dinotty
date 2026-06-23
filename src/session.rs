use crate::vt_screen::VirtualScreen;
use dashmap::DashMap;
use portable_pty::{Child, MasterPty};
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tracing::info;
use tokio::sync::mpsc;

pub enum SessionStatus {
    Connected,
    Detached { since: Instant },
}

pub struct CwdState {
    pub cwd: PathBuf,
    pub sniff_buf: Vec<u8>,
}

pub struct Session {
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    pub screen: Mutex<VirtualScreen>,
    pub clients: Mutex<Vec<mpsc::UnboundedSender<String>>>,
    pub input_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    pub status: Mutex<SessionStatus>,
    pub size: Mutex<(u16, u16)>,
    #[allow(dead_code)]
    pub shell_type: String,
    pub tauri_on_exit: Mutex<Option<Arc<dyn Fn(String) + Send + Sync>>>,
    pub cwd_state: Mutex<CwdState>,
}

impl Session {
    /// Explicitly kill the child process. Safe to call multiple times (idempotent).
    /// After this, the PTY reader task's `reader.read()` will return Err/Ok(0),
    /// causing it to exit and drop its `Arc<Session>`, which triggers `Drop`.
    pub fn kill_child(&self) {
        let mut child = self.child.lock().unwrap();
        let pid = child.process_id();
        let _ = child.kill();
        let _ = child.wait();
        info!("Session child killed: pid={:?}", pid);
    }

    pub fn on_pty_output(&self, data: &[u8]) {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let mut state = self.cwd_state.lock().unwrap();
        let CwdState { ref mut cwd, ref mut sniff_buf } = *state;
        sniff_cwd_from_title_osc(sniff_buf, data, &home, cwd);
    }

    /// Replace the input channel, closing the old one (if any) so the previous
    /// PTY write task exits. Returns the new receiver for the caller to spawn
    /// a write task on.
    pub fn replace_input_channel(&self) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        let old = self.input_tx.lock().unwrap().replace(tx);
        drop(old); // close old sender → old write task's recv() returns None
        rx
    }

    pub fn add_client(&self) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.clients.lock().unwrap().push(tx);
        rx
    }

    /// Remove all existing clients so old forwarder tasks exit cleanly.
    /// Must be called before `add_client` on reconnection to prevent
    /// duplicate output delivery.
    pub fn clear_clients(&self) {
        self.clients.lock().unwrap().clear();
    }

    pub fn broadcast(&self, msg: &str) {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|tx| tx.send(msg.to_string()).is_ok());
    }

    pub fn has_clients(&self) -> bool {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|tx| !tx.is_closed());
        !clients.is_empty()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap();
        let pid = child.process_id();
        let _ = child.kill();
        let _ = child.wait();
        info!("Session dropped, child reaped: pid={:?}", pid);
    }
}

const OSC_SNIFF_CAP: usize = 32768;

fn sniff_cwd_from_title_osc(buf: &mut Vec<u8>, chunk: &[u8], home: &Path, cwd: &mut PathBuf) {
    buf.extend_from_slice(chunk);
    if buf.len() > OSC_SNIFF_CAP {
        let drop = buf.len() - OSC_SNIFF_CAP;
        buf.drain(..drop);
    }
    let needle = b"\x1b]0;";
    loop {
        let Some(i) = find_subslice(buf, needle) else {
            break;
        };
        let payload_start = i + needle.len();
        let bel_pos = buf[payload_start..].iter().position(|&b| b == 0x07);
        let st_pos = buf[payload_start..].windows(2).position(|w| w == b"\x1b\\");
        let rel = match (bel_pos, st_pos) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        let terminator_len = if st_pos == Some(rel) { 2 } else { 1 };
        let title_end = payload_start + rel;
        let title = String::from_utf8_lossy(&buf[payload_start..title_end]);
        if let Some(p) = parse_title_cwd(&title, home) {
            if let Ok(c) = p.canonicalize() {
                *cwd = c;
            }
        }
        buf.drain(..title_end + terminator_len);
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

pub fn collect_leaf_pane_ids(layout: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    collect_leaf_ids_recursive(layout, &mut ids);
    ids
}

pub fn remove_pane_from_layout(node: &serde_json::Value, pane_id: &str) -> Option<serde_json::Value> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            if node.get("paneId")?.as_str()? == pane_id {
                None
            } else {
                Some(node.clone())
            }
        }
        "split" => {
            let children = node.get("children")?.as_array()?;
            let new_children: Vec<serde_json::Value> = children
                .iter()
                .filter_map(|c| remove_pane_from_layout(c, pane_id))
                .collect();
            match new_children.len() {
                0 => None,
                _ if new_children.len() == children.len() => {
                    // Children count unchanged — but a child may have changed internally
                    // (e.g. a nested split collapsed). Always use the updated children.
                    let mut result = node.clone();
                    result["children"] = serde_json::Value::Array(new_children);
                    Some(result)
                }
                1 => {
                    // Single-child split is degenerate — collapse by returning the child directly
                    Some(new_children.into_iter().next().unwrap())
                }
                _ => {
                    let mut result = node.clone();
                    result["children"] = serde_json::Value::Array(new_children);
                    // Rebalance ratios evenly
                    let n = result["children"].as_array().unwrap().len();
                    result["ratios"] = serde_json::Value::Array(
                        (0..n).map(|_| serde_json::Value::from(1.0 / n as f64)).collect()
                    );
                    Some(result)
                }
            }
        }
        _ => Some(node.clone()),
    }
}

fn collect_leaf_ids_recursive(node: &serde_json::Value, ids: &mut Vec<String>) {
    if let Some(node_type) = node.get("type").and_then(|v| v.as_str()) {
        if node_type == "leaf" {
            if let Some(pane_id) = node.get("paneId").and_then(|v| v.as_str()) {
                ids.push(pane_id.to_string());
            }
        } else if node_type == "split" {
            if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
                for child in children {
                    collect_leaf_ids_recursive(child, ids);
                }
            }
        }
    }
}

/// Insert a new pane into the layout tree by splitting the target pane.
/// Returns the updated layout, or None if the target pane was not found.
pub fn insert_pane_into_layout(
    layout: &serde_json::Value,
    target_pane_id: &str,
    direction: &str,
    new_pane_id: &str,
) -> Option<serde_json::Value> {
    let node_type = layout.get("type")?.as_str()?;
    match node_type {
        "leaf" => {
            let pane_id = layout.get("paneId")?.as_str()?;
            if pane_id == target_pane_id {
                // Found the target — wrap in a new split node
                let new_leaf = serde_json::json!({
                    "type": "leaf",
                    "paneId": new_pane_id,
                    "title": "Terminal",
                    "ratio": 1,
                    "zoomed": false,
                });
                let existing_leaf = layout.clone();
                let split_id = uuid::Uuid::new_v4().to_string();
                Some(serde_json::json!({
                    "type": "split",
                    "id": split_id,
                    "direction": direction,
                    "children": [existing_leaf, new_leaf],
                    "ratios": [0.5, 0.5],
                }))
            } else {
                Some(layout.clone())
            }
        }
        "split" => {
            let children = layout.get("children")?.as_array()?;
            let mut new_children = Vec::new();
            let mut found = false;
            for child in children {
                if let Some(updated) = insert_pane_into_layout(child, target_pane_id, direction, new_pane_id) {
                    if !found && updated != *child {
                        found = true;
                    }
                    new_children.push(updated);
                }
            }
            if !found {
                return Some(layout.clone());
            }
            let mut result = layout.clone();
            result["children"] = serde_json::Value::Array(new_children);
            Some(result)
        }
        _ => Some(layout.clone()),
    }
}

pub fn first_leaf_id(node: &serde_json::Value) -> Option<String> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "leaf" => node.get("paneId")?.as_str().map(String::from),
        "split" => {
            let children = node.get("children")?.as_array()?;
            for child in children {
                if let Some(id) = first_leaf_id(child) {
                    return Some(id);
                }
            }
            None
        }
        _ => None,
    }
}

fn parse_title_cwd(title: &str, home: &Path) -> Option<PathBuf> {
    let at = title.rfind('@')?;
    let tail = title.get(at + 1..)?;
    let colon = tail.find(':')?;
    let path_part = tail.get(colon + 1..)?.trim();
    if path_part.is_empty() {
        return None;
    }
    let path = if let Some(rest) = path_part.strip_prefix("~/") {
        home.join(rest)
    } else if path_part == "~" {
        home.to_path_buf()
    } else if path_part.starts_with('/') {
        PathBuf::from(path_part)
    } else {
        home.join(path_part)
    };
    Some(path)
}

pub struct SyncClient {
    pub id: String,
    pub tx: mpsc::UnboundedSender<String>,
}

pub struct SessionManager {
    pub sessions: DashMap<String, Arc<Session>>,
    pub sync_clients: Arc<Mutex<Vec<SyncClient>>>,
    pub active_pane_id: Arc<Mutex<Option<String>>>,
    pub tab_layouts: DashMap<String, serde_json::Value>,
    pub tab_order: Mutex<Vec<String>>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncMsg {
    TabList { tabs: Vec<TabInfo>, active_pane_id: Option<String> },
    TabCreated { tab_id: String, pane_id: String, layout: Option<serde_json::Value> },
    TabClosed { pane_id: String },
    TabActivated { pane_id: String },
    LayoutUpdated { pane_id: String, layout: serde_json::Value, active_pane_id: String },
    PluginChanged { plugin_id: String, change: String },
    ProcessExited { plugin_id: String, pid: u32, exit_code: Option<i32> },
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub tab_id: String,
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_pane_id: Option<String>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            sync_clients: Arc::new(Mutex::new(Vec::new())),
            active_pane_id: Arc::new(Mutex::new(None)),
            tab_layouts: DashMap::new(),
            tab_order: Mutex::new(Vec::new()),
        }
    }

    /// Insert a tab layout and record its order position.
    pub fn insert_tab(&self, tab_id: String, value: serde_json::Value) {
        let mut order = self.tab_order.lock().unwrap();
        if !order.contains(&tab_id) {
            order.push(tab_id.clone());
        }
        drop(order);
        self.tab_layouts.insert(tab_id, value);
    }

    /// Remove a tab layout and its order entry.
    pub fn remove_tab(&self, tab_id: &str) {
        self.tab_layouts.remove(tab_id);
        let mut order = self.tab_order.lock().unwrap();
        order.retain(|id| id != tab_id);
    }

    pub fn broadcast_sync(&self, msg: &SyncMsg) {
        let json = serde_json::to_string(msg).unwrap();
        let mut clients = self.sync_clients.lock().unwrap();
        clients.retain(|c| c.tx.send(json.clone()).is_ok());
    }

    /// Broadcast to all sync clients except the one with the given ID.
    pub fn broadcast_sync_others(&self, msg: &SyncMsg, exclude_id: &str) {
        let json = serde_json::to_string(msg).unwrap();
        let mut clients = self.sync_clients.lock().unwrap();
        clients.retain(|c| {
            if c.id == exclude_id {
                true // keep in list but don't send
            } else {
                c.tx.send(json.clone()).is_ok()
            }
        });
    }

    pub fn add_sync_client(&self) -> (String, mpsc::UnboundedReceiver<String>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        self.sync_clients.lock().unwrap().push(SyncClient { id: id.clone(), tx });
        (id, rx)
    }

    pub fn broadcast_plugin_changed(&self, plugin_id: String, change: String) {
        self.broadcast_sync(&SyncMsg::PluginChanged { plugin_id, change });
    }

    /// Remove a session from the DashMap and explicitly kill its child process.
    /// Returns true if the session existed.
    ///
    /// This is necessary because the PTY reader task holds an `Arc<Session>`,
    /// preventing `Drop` from firing when we only remove from the DashMap.
    /// By killing the child first, the reader's `read()` returns Err/Ok(0),
    /// causing it to exit and release its `Arc`.
    pub fn kill_and_remove(&self, pane_id: &str) -> bool {
        if let Some((_, session)) = self.sessions.remove(pane_id) {
            session.kill_child();
            // Drop the input channel sender so the writer task's recv() returns
            // None and the task exits, releasing its Arc<Session>.
            session.input_tx.lock().unwrap().take();
            true
        } else {
            false
        }
    }

    /// Remove a pane_id from all parent tab layouts. If removing it causes
    /// a split to have only one child, the split collapses into that child.
    /// Returns the list of tab IDs whose layouts became empty (i.e. the pane
    /// was the last leaf) so the caller can broadcast TabClosed for them.
    pub fn purge_pane_from_layouts(&self, pane_id: &str) -> Vec<String> {
        let mut updates: Vec<(String, serde_json::Value)> = Vec::new();
        let mut emptied_tabs: Vec<String> = Vec::new();

        for entry in self.tab_layouts.iter() {
            let tab_pane_id = entry.key();
            if tab_pane_id == pane_id {
                continue;
            }
            let val = entry.value();
            let Some(layout) = val.get("layout") else { continue };
            match remove_pane_from_layout(layout, pane_id) {
                None => {
                    // The pane was the only leaf — tab is now empty
                    emptied_tabs.push(tab_pane_id.clone());
                }
                Some(new_layout) if new_layout != *layout => {
                    let active = val.get("active_pane_id").and_then(|v| v.as_str());
                    let new_leaf_ids = collect_leaf_pane_ids(&new_layout);
                    let active_pane_id = active.filter(|id| new_leaf_ids.iter().any(|lid| lid == *id));
                    let mut new_val = serde_json::json!({ "layout": new_layout });
                    if let Some(a) = active_pane_id {
                        new_val["active_pane_id"] = serde_json::Value::String(a.to_string());
                    }
                    updates.push((tab_pane_id.clone(), new_val));
                }
                _ => {}
            }
        }

        for (key, val) in updates {
            self.insert_tab(key, val);
        }
        for tab_id in &emptied_tabs {
            self.remove_tab(tab_id);
        }
        emptied_tabs
    }

    pub fn tab_list(&self) -> (Vec<TabInfo>, Option<String>) {
        // Prune stale tab layouts whose leaf pane_ids no longer have sessions.
        // Without this, tab_layouts entries accumulate forever (phantom tabs).
        let stale: Vec<String> = {
            self.tab_layouts.iter().filter_map(|e| {
                let v = e.value();
                let layout = v.get("layout")?;
                let leaf_ids = collect_leaf_pane_ids(layout);
                if leaf_ids.is_empty() || !leaf_ids.iter().any(|id| self.sessions.contains_key(id)) {
                    Some(e.key().clone())
                } else {
                    None
                }
            }).collect()
        };
        for key in &stale {
            self.tab_layouts.remove(key);
        }
        if !stale.is_empty() {
            let mut order = self.tab_order.lock().unwrap();
            order.retain(|id| !stale.contains(id));
        }

        let order = self.tab_order.lock().unwrap();
        let order_index = |tab_id: &str| -> usize {
            order.iter().position(|id| id == tab_id).unwrap_or(usize::MAX)
        };

        let mut tabs: Vec<TabInfo> = self.tab_layouts.iter().filter_map(|e| {
            let tab_id = e.key().clone();
            let v = e.value();
            let layout = v.get("layout").cloned();
            let pane_id = layout.as_ref()
                .and_then(|l| first_leaf_id(l))
                .unwrap_or_else(|| tab_id.clone());
            let active_pane_id = v.get("active_pane_id").and_then(|v| v.as_str()).map(String::from);
            Some(TabInfo { tab_id, pane_id, layout, active_pane_id })
        }).collect();

        tabs.sort_by_key(|t| order_index(&t.tab_id));
        drop(order);

        // Include sessions that don't belong to any existing tab (neither as tab id nor as a leaf)
        let leaf_ids: std::collections::HashSet<String> = tabs.iter()
            .filter_map(|t| t.layout.as_ref())
            .flat_map(|layout| collect_leaf_pane_ids(layout))
            .collect();
        for entry in self.sessions.iter() {
            let pane_id = entry.key().clone();
            if !tabs.iter().any(|t| t.pane_id == pane_id) && !leaf_ids.contains(&pane_id) {
                tabs.push(TabInfo { tab_id: pane_id.clone(), pane_id, layout: None, active_pane_id: None });
            }
        }

        let active = self.active_pane_id.lock().unwrap().clone();
        (tabs, active)
    }

    /// When a PTY exits, find the parent tab and either remove it (single-pane)
    /// or update the layout (multi-pane). Returns the tab-level pane_id for
    /// single-pane tabs so the caller can broadcast TabClosed.
    pub fn on_pty_exited(&self, leaf_pane_id: &str) -> Option<String> {
        // Find the tab layout that contains this leaf
        let mut found_tab_id: Option<String> = None;
        for entry in self.tab_layouts.iter() {
            let tab_id = entry.key();
            let val = entry.value();
            if let Some(layout) = val.get("layout") {
                let leaf_ids = collect_leaf_pane_ids(layout);
                if leaf_ids.iter().any(|id| id == leaf_pane_id) {
                    found_tab_id = Some(tab_id.clone());
                    break;
                }
            }
        }

        let tab_id = found_tab_id?;

        // Get the current layout for this tab
        let tab_val = self.tab_layouts.get(&tab_id)?;
        let layout = tab_val.value().get("layout")?.clone();
        let leaf_ids = collect_leaf_pane_ids(&layout);

        if leaf_ids.len() <= 1 {
            // Single-pane tab — remove the whole tab
            drop(tab_val);
            self.remove_tab(&tab_id);
            Some(tab_id)
        } else {
            // Multi-pane tab — update the layout by removing the exited pane
            let new_layout = remove_pane_from_layout(&layout, leaf_pane_id)?;
            let new_leaf_ids = collect_leaf_pane_ids(&new_layout);
            let active = tab_val.value().get("active_pane_id").and_then(|v| v.as_str());
            let active_pane_id = active
                .filter(|id| new_leaf_ids.iter().any(|lid| lid == *id))
                .or_else(|| new_leaf_ids.first().map(|s| s.as_str()))
                .unwrap_or("")
                .to_string();
            drop(tab_val);

            self.insert_tab(tab_id.clone(), serde_json::json!({
                "layout": new_layout.clone(),
                "active_pane_id": active_pane_id,
            }));
            self.broadcast_sync(&SyncMsg::LayoutUpdated {
                pane_id: tab_id,
                layout: new_layout,
                active_pane_id,
            });
            None
        }
    }

    pub fn start_cleanup_task(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                let timeout = std::time::Duration::from_secs(300);
                // Two-pass: collect stale IDs first, then kill_and_remove.
                // Can't use retain() because we need to kill child processes.
                let stale: Vec<String> = manager.sessions.iter().filter_map(|entry| {
                    let status = entry.value().status.lock().unwrap();
                    match *status {
                        SessionStatus::Detached { since } if since.elapsed() >= timeout => {
                            Some(entry.key().clone())
                        }
                        _ => None,
                    }
                }).collect();
                for pane_id in stale {
                    // Re-check status before killing — the session may have been
                    // reconnected between the collect pass and now.
                    let should_kill = manager.sessions.get(&pane_id).map(|entry| {
                        let status = entry.value().status.lock().unwrap();
                        matches!(*status, SessionStatus::Detached { since } if since.elapsed() >= timeout)
                    }).unwrap_or(false);

                    if should_kill {
                        info!("Cleanup: removing detached session: pane={}", pane_id);
                        manager.kill_and_remove(&pane_id);
                    }
                }
            }
        });
    }
}

//! Session restore on startup.
//!
//! Reads a [`SessionSnapshot`] and recreates each tab's PTY sessions and
//! layout in the given [`SessionManager`]. Phase 1: only local (non-SSH) tabs
//! are restored; SSH tabs are skipped (the user reconnects manually).
//!
//! Two-phase per tab (mirrors `templates/apply.rs`): spawn every terminal leaf
//! first, and only commit the layout if all spawns succeed. A failed spawn
//! rolls back any sessions already created for that tab, so `tab_list()` never
//! sees a terminal leaf without a live session (which would be pruned on the
//! next sync).

use std::path::PathBuf;
use std::sync::Arc;

use tracing::{info, warn};

use crate::pty::{self, LaunchCwd};
use crate::session::{SessionManager, SessionSnapshot, TabSnapshot};

const MAX_RESTORE_TABS: usize = 20;

/// Restore tabs/panes from a snapshot into the given manager.
///
/// Phase 1: only restores local (non-SSH) tabs. SSH tabs are skipped.
/// Errors per-tab are logged and do not abort the whole restore.
pub async fn restore_session(manager: &Arc<SessionManager>, snapshot: &SessionSnapshot) {
    let restore_tabs: Vec<&TabSnapshot> =
        snapshot.tabs.iter().filter(|t| t.connection_id.is_none()).take(MAX_RESTORE_TABS).collect();

    let mut restored = 0;
    for tab in &restore_tabs {
        match restore_single_tab(manager, tab) {
            Ok(()) => restored += 1,
            Err(e) => warn!("restore tab {} failed: {}", tab.tab_id, e),
        }
    }

    // Restore global active_pane_id (only if the pane still exists).
    if let Some(active) = &snapshot.active_pane_id {
        if manager.sessions.contains_key(active) {
            manager.set_active_pane_id(Some(active.clone()));
        }
    }

    if restored > 0 {
        info!("Restored {} tabs from snapshot", restored);
    }
}

fn restore_single_tab(manager: &Arc<SessionManager>, tab: &TabSnapshot) -> Result<(), String> {
    let leaves = collect_terminal_leaves_with_cwd(&tab.layout);

    if leaves.is_empty() {
        // No terminal leaves (e.g. plugin-only tab) - just commit the layout.
        manager.insert_tab(
            tab.tab_id.clone(),
            serde_json::json!({
                "layout": tab.layout,
                "active_pane_id": tab.active_pane_id,
            }),
        );
        return Ok(());
    }

    // Phase 1: spawn all PTYs. Rollback on any failure.
    let mut spawned: Vec<String> = Vec::new();
    for (pane_id, cwd) in &leaves {
        match spawn_pane(manager, pane_id, cwd.as_deref()) {
            Ok(()) => spawned.push(pane_id.clone()),
            Err(e) => {
                for p in &spawned {
                    manager.kill_and_remove(p);
                }
                return Err(format!("spawn {pane_id} failed: {e}"));
            }
        }
    }

    // Phase 2: commit layout.
    manager.insert_tab(
        tab.tab_id.clone(),
        serde_json::json!({
            "layout": tab.layout,
            "active_pane_id": tab.active_pane_id,
        }),
    );
    Ok(())
}

fn spawn_pane(
    manager: &Arc<SessionManager>,
    pane_id: &str,
    cwd: Option<&str>,
) -> Result<(), String> {
    let cwd = cwd.filter(|p| !p.is_empty()).map(|p| LaunchCwd::Host(PathBuf::from(p)));

    pty::create_session(
        manager, pane_id, None, // tab_id
        None, // tauri_on_exit
        cwd, None, // argv
        None, // shell_spec - use default shell (reads settings.shell)
    )
    .map(|_| ())
}

/// Walk a layout tree and collect `(pane_id, cwd)` for every terminal leaf.
/// Non-terminal leaves (plugin/files/web) are skipped - they have no PTY.
fn collect_terminal_leaves_with_cwd(layout: &serde_json::Value) -> Vec<(String, Option<String>)> {
    let mut leaves = Vec::new();
    collect_leaves_rec(layout, &mut leaves);
    leaves
}

fn collect_leaves_rec(v: &serde_json::Value, leaves: &mut Vec<(String, Option<String>)>) {
    let Some(obj) = v.as_object() else {
        return;
    };
    let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if node_type == "leaf" {
        let kind = obj.get("kind").and_then(|k| k.as_str()).unwrap_or("terminal");
        if kind == "terminal" {
            if let Some(pane_id) = obj.get("paneId").and_then(|p| p.as_str()) {
                let cwd = obj.get("cwd").and_then(|c| c.as_str()).map(str::to_string);
                leaves.push((pane_id.to_string(), cwd));
            }
        }
        return;
    }
    if node_type == "split" {
        if let Some(children) = obj.get("children").and_then(|c| c.as_array()) {
            for child in children {
                collect_leaves_rec(child, leaves);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collect_leaves_single_terminal() {
        let layout = json!({
            "type": "leaf",
            "kind": "terminal",
            "paneId": "p1",
            "cwd": "/tmp"
        });
        let leaves = collect_terminal_leaves_with_cwd(&layout);
        assert_eq!(leaves, vec![("p1".to_string(), Some("/tmp".to_string()))]);
    }

    #[test]
    fn collect_leaves_skips_non_terminal() {
        let layout = json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {"type": "leaf", "kind": "terminal", "paneId": "p1", "cwd": "/a"},
                {"type": "leaf", "kind": "plugin", "paneId": "p2"}
            ]
        });
        let leaves = collect_terminal_leaves_with_cwd(&layout);
        assert_eq!(leaves.len(), 1);
        assert_eq!(leaves[0].0, "p1");
    }

    #[test]
    fn collect_leaves_handles_missing_cwd() {
        let layout = json!({
            "type": "leaf",
            "kind": "terminal",
            "paneId": "p1"
        });
        let leaves = collect_terminal_leaves_with_cwd(&layout);
        assert_eq!(leaves, vec![("p1".to_string(), None)]);
    }

    #[test]
    fn collect_leaves_empty_for_plugin_only_tab() {
        let layout = json!({
            "type": "leaf",
            "kind": "plugin",
            "paneId": "p1"
        });
        let leaves = collect_terminal_leaves_with_cwd(&layout);
        assert!(leaves.is_empty());
    }

    #[test]
    fn collect_leaves_nested_split() {
        let layout = json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {"type": "leaf", "kind": "terminal", "paneId": "p1", "cwd": "/a"},
                {"type": "split", "direction": "vertical", "children": [
                    {"type": "leaf", "kind": "terminal", "paneId": "p2", "cwd": "/b"},
                    {"type": "leaf", "kind": "terminal", "paneId": "p3"}
                ]}
            ]
        });
        let leaves = collect_terminal_leaves_with_cwd(&layout);
        assert_eq!(leaves.len(), 3);
        assert_eq!(leaves[0].0, "p1");
        assert_eq!(leaves[1].0, "p2");
        assert_eq!(leaves[2].0, "p3");
        assert_eq!(leaves[2].1, None);
    }

    /// End-to-end: `restore_session` spawns a real PTY and writes the layout.
    /// Verifies the two-phase commit: layout is committed only after the
    /// session exists, so `tab_list()` won't prune it as stale.
    #[tokio::test]
    async fn restore_session_spawns_pty_and_commits_layout() {
        use crate::session::SessionManager;
        let manager = Arc::new(SessionManager::new());

        let snapshot = SessionSnapshot {
            version: 1,
            saved_at: 0,
            active_pane_id: Some("restore-pane-1".into()),
            tab_order: vec!["restore-tab-1".into()],
            tabs: vec![TabSnapshot {
                tab_id: "restore-tab-1".into(),
                pane_id: "restore-pane-1".into(),
                layout: json!({
                    "type": "leaf",
                    "kind": "terminal",
                    "paneId": "restore-pane-1",
                    "cwd": "/tmp",
                    "ratio": 1,
                    "zoomed": false
                }),
                active_pane_id: Some("restore-pane-1".into()),
                connection_id: None,
                workspace_id: None,
                custom_title: None,
                broadcast_mode: None,
            }],
        };

        restore_session(&manager, &snapshot).await;

        // Layout committed.
        assert!(manager.tab_layouts.contains_key("restore-tab-1"));
        // Session spawned.
        assert!(manager.sessions.contains_key("restore-pane-1"));
        // Active pane restored.
        assert_eq!(manager.active_pane_id.lock().unwrap().as_deref(), Some("restore-pane-1"));

        // Cleanup: kill the spawned PTY so the test doesn't leak processes.
        manager.kill_and_remove("restore-pane-1");
    }

    /// SSH tabs (`connection_id` set) are skipped in Phase 1.
    #[tokio::test]
    async fn restore_session_skips_ssh_tabs() {
        use crate::session::SessionManager;
        let manager = Arc::new(SessionManager::new());

        let snapshot = SessionSnapshot {
            version: 1,
            saved_at: 0,
            active_pane_id: None,
            tab_order: vec!["ssh-tab".into()],
            tabs: vec![TabSnapshot {
                tab_id: "ssh-tab".into(),
                pane_id: "ssh-pane".into(),
                layout: json!({
                    "type": "leaf",
                    "kind": "terminal",
                    "paneId": "ssh-pane",
                    "cwd": "/tmp",
                    "shell_type": "ssh"
                }),
                active_pane_id: Some("ssh-pane".into()),
                connection_id: Some("profile-1".into()),
                workspace_id: None,
                custom_title: None,
                broadcast_mode: None,
            }],
        };

        restore_session(&manager, &snapshot).await;

        // SSH tab should NOT be restored (no layout, no session).
        assert!(!manager.tab_layouts.contains_key("ssh-tab"));
        assert!(!manager.sessions.contains_key("ssh-pane"));
    }

    /// A failed spawn (invalid cwd doesn't fail - pty falls back to home -
    /// so we test the rollback path by giving an already-existing `pane_id`).
    #[tokio::test]
    async fn restore_session_rollback_on_duplicate_pane() {
        use crate::session::SessionManager;
        let manager = Arc::new(SessionManager::new());

        // Pre-create a session with the same pane_id so restore's spawn fails.
        let cwd = Some(LaunchCwd::Host(PathBuf::from("/tmp")));
        pty::create_session(&manager, "dup-pane", None, None, cwd, None, None)
            .expect("pre-create should succeed");

        let snapshot = SessionSnapshot {
            version: 1,
            saved_at: 0,
            active_pane_id: None,
            tab_order: vec!["dup-tab".into()],
            tabs: vec![TabSnapshot {
                tab_id: "dup-tab".into(),
                pane_id: "dup-pane".into(),
                layout: json!({
                    "type": "leaf",
                    "kind": "terminal",
                    "paneId": "dup-pane",
                    "cwd": "/tmp"
                }),
                active_pane_id: Some("dup-pane".into()),
                connection_id: None,
                workspace_id: None,
                custom_title: None,
                broadcast_mode: None,
            }],
        };

        // restore_session logs the error and continues (does not panic).
        restore_session(&manager, &snapshot).await;

        // Cleanup.
        manager.kill_and_remove("dup-pane");
    }
}

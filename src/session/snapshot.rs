//! Session snapshot persistence.
//!
//! Stores the tab/pane layout to disk so it can be restored on next startup.
//! Uses `tempfile::NamedTempFile::persist` for atomic writes (same pattern as
//! `templates/store.rs`): a crash mid-write never leaves a half-written file.
//!
//! File location: `<config_dir>/session.json` (alongside `settings.json`).
//!
//! On read, a corrupt or unreadable file is logged and replaced with an empty
//! snapshot -- session restore is best-effort and must never block startup.

#![allow(clippy::module_name_repetitions)]

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use tracing::warn;

use crate::settings::config_dir;

const SNAPSHOT_VERSION: u32 = 1;
const SNAPSHOT_FILENAME: &str = "session.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SessionSnapshot {
    pub version: u32,
    pub saved_at: u64,
    pub active_pane_id: Option<String>,
    pub tab_order: Vec<String>,
    pub tabs: Vec<TabSnapshot>,
}

impl SessionSnapshot {
    fn new_now() -> Self {
        let saved_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0));
        Self {
            version: SNAPSHOT_VERSION,
            saved_at,
            active_pane_id: None,
            tab_order: Vec::new(),
            tabs: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TabSnapshot {
    pub tab_id: String,
    pub pane_id: String,
    pub layout: serde_json::Value,
    pub active_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub broadcast_mode: Option<String>,
}

/// File-backed session snapshot storage. Production code uses [`new`][Self::new];
/// tests inject a base dir via [`new_with_base`][Self::new_with_base].
#[derive(Clone, Debug)]
pub struct SessionSnapshotStore {
    base_dir: PathBuf,
}

impl SessionSnapshotStore {
    #[must_use]
    pub fn new() -> Self {
        Self { base_dir: config_dir() }
    }

    #[cfg(test)]
    pub fn new_with_base(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    #[must_use]
    pub fn path(&self) -> PathBuf {
        self.base_dir.join(SNAPSHOT_FILENAME)
    }

    /// Load the snapshot. Returns an empty default if the file does not exist
    /// or is corrupt (corrupt files are removed so the next save can write fresh).
    #[must_use]
    pub fn load(&self) -> SessionSnapshot {
        let path = self.path();
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return SessionSnapshot::default();
            }
            Err(e) => {
                warn!("session snapshot read failed ({}): {}", path.display(), e);
                return SessionSnapshot::default();
            }
        };
        match serde_json::from_slice::<SessionSnapshot>(&bytes) {
            Ok(s) => s,
            Err(e) => {
                warn!("session snapshot corrupt ({}), removing: {}", e, path.display());
                let _ = std::fs::remove_file(&path);
                SessionSnapshot::default()
            }
        }
    }

    /// Atomically write the snapshot to disk.
    ///
    /// # Errors
    /// Returns an error if the file cannot be written (directory creation,
    /// serialization, temp file creation, or persist rename fails).
    pub fn save(&self, snapshot: &SessionSnapshot) -> std::io::Result<()> {
        let path = self.path();
        atomic_write_json(&path, snapshot)
    }

    /// Build a fresh snapshot from the current manager state, then save it.
    /// Reads `tab_layouts`, `tab_order`, `active_pane_id`, and each session's
    /// current cwd (via `Session::cwd_for_workspace()`) to populate leaf `cwd`.
    ///
    /// # Errors
    /// Returns an error if the save fails.
    pub fn build_and_save(&self, manager: &crate::session::SessionManager) -> std::io::Result<()> {
        let snapshot = build_snapshot(manager);
        self.save(&snapshot)
    }
}

impl Default for SessionSnapshotStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Atomically write a JSON value to `path` via a temp file in the same directory.
/// `persist` is atomic on POSIX (rename(2)) and Windows (`MoveFileEx`).
fn atomic_write_json(path: &Path, value: &SessionSnapshot) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "snapshot path has no parent")
    })?;
    std::fs::create_dir_all(dir)?;

    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let mut tmp = NamedTempFile::new_in(dir)?;
    tmp.write_all(&bytes)?;
    tmp.flush()?;
    tmp.persist(path).map_err(|e| std::io::Error::other(format!("persist failed: {e}")))?;
    Ok(())
}

/// Build a snapshot from the current manager state.
fn build_snapshot(manager: &crate::session::SessionManager) -> SessionSnapshot {
    let mut snapshot = SessionSnapshot::new_now();
    let active_pane_id =
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    snapshot.active_pane_id.clone_from(&active_pane_id);
    drop(active_pane_id);

    let order = manager.tab_order.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();

    for tab_id in &order {
        let Some(layout_entry) = manager.tab_layouts.get(tab_id) else {
            continue;
        };
        let layout_obj = layout_entry.value().clone();
        let layout = layout_obj.get("layout").cloned().unwrap_or(serde_json::Value::Null);
        let active_pane_id =
            layout_obj.get("active_pane_id").and_then(|v| v.as_str()).map(str::to_string);
        drop(layout_entry);

        let enriched_layout = enrich_leaf_cwd(&layout, manager);

        let tab_snapshot = TabSnapshot {
            tab_id: tab_id.clone(),
            pane_id: active_pane_id.clone().unwrap_or_else(|| tab_id.clone()),
            layout: enriched_layout,
            active_pane_id,
            connection_id: None,
            workspace_id: None,
            custom_title: None,
            broadcast_mode: None,
        };
        snapshot.tabs.push(tab_snapshot);
    }

    snapshot.tab_order = order;
    snapshot
}

/// Recursively walk a layout tree and fill in `cwd` on every terminal leaf
/// from the live session's `cwd_for_workspace()`. Non-terminal leaves and
/// leaves whose session is gone are left untouched.
fn enrich_leaf_cwd(
    layout: &serde_json::Value,
    manager: &crate::session::SessionManager,
) -> serde_json::Value {
    let mut v = layout.clone();
    enrich_leaf_cwd_in_place(&mut v, manager);
    v
}

fn enrich_leaf_cwd_in_place(v: &mut serde_json::Value, manager: &crate::session::SessionManager) {
    let Some(obj) = v.as_object_mut() else {
        return;
    };
    let is_leaf = obj.get("type").and_then(|t| t.as_str()).is_some_and(|t| t == "leaf");
    if is_leaf {
        let kind = obj.get("kind").and_then(|k| k.as_str()).unwrap_or("terminal");
        if kind != "terminal" {
            return;
        }
        let Some(pane_id) = obj.get("paneId").and_then(|p| p.as_str()) else {
            return;
        };
        if let Some(session) = manager.sessions.get(pane_id) {
            if let Some(cwd) = session.cwd_for_workspace() {
                obj.insert(
                    "cwd".to_string(),
                    serde_json::Value::String(cwd.to_string_lossy().into_owned()),
                );
            }
        }
        return;
    }
    if let Some(children) = obj.get_mut("children").and_then(|c| c.as_array_mut()) {
        for child in children.iter_mut() {
            enrich_leaf_cwd_in_place(child, manager);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fresh_store() -> SessionSnapshotStore {
        let dir = tempdir().unwrap().keep();
        SessionSnapshotStore::new_with_base(dir)
    }

    #[test]
    fn load_missing_returns_empty_default() {
        let store = fresh_store();
        let snap = store.load();
        assert!(snap.tabs.is_empty());
        assert!(snap.tab_order.is_empty());
        assert_eq!(snap.version, 0);
    }

    #[test]
    fn save_load_roundtrip() {
        let store = fresh_store();
        let snap = SessionSnapshot {
            version: SNAPSHOT_VERSION,
            saved_at: 12345,
            active_pane_id: Some("pane-1".into()),
            tab_order: vec!["tab-1".into()],
            tabs: vec![TabSnapshot {
                tab_id: "tab-1".into(),
                pane_id: "pane-1".into(),
                layout: serde_json::json!({
                    "type": "leaf",
                    "paneId": "pane-1",
                    "shell_type": "zsh",
                    "cwd": "/tmp",
                    "ratio": 1,
                    "zoomed": false
                }),
                active_pane_id: Some("pane-1".into()),
                connection_id: None,
                workspace_id: Some("ws-1".into()),
                custom_title: None,
                broadcast_mode: None,
            }],
        };
        store.save(&snap).expect("save should succeed");
        let loaded = store.load();
        assert_eq!(loaded.version, SNAPSHOT_VERSION);
        assert_eq!(loaded.saved_at, 12345);
        assert_eq!(loaded.active_pane_id.as_deref(), Some("pane-1"));
        assert_eq!(loaded.tab_order, vec!["tab-1".to_string()]);
        assert_eq!(loaded.tabs.len(), 1);
        assert_eq!(loaded.tabs[0].tab_id, "tab-1");
        assert_eq!(loaded.tabs[0].workspace_id.as_deref(), Some("ws-1"));
    }

    #[test]
    fn corrupt_file_is_removed_and_returns_default() {
        let store = fresh_store();
        let path = store.path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"not valid json").unwrap();
        let snap = store.load();
        assert!(snap.tabs.is_empty());
        assert!(!path.exists(), "corrupt file should be removed");
    }

    #[test]
    fn enrich_leaf_cwd_skips_missing_sessions() {
        let manager = crate::session::SessionManager::new();
        let layout = serde_json::json!({
            "type": "split",
            "direction": "horizontal",
            "children": [
                {"type": "leaf", "kind": "terminal", "paneId": "missing", "ratio": 0.5},
                {"type": "leaf", "kind": "plugin", "paneId": "p2", "ratio": 0.5}
            ]
        });
        let enriched = enrich_leaf_cwd(&layout, &manager);
        let children = enriched.get("children").unwrap().as_array().unwrap();
        assert!(children[0].get("cwd").is_none());
        assert!(children[1].get("cwd").is_none());
    }

    #[test]
    fn build_snapshot_from_empty_manager() {
        let manager = crate::session::SessionManager::new();
        let store = fresh_store();
        store.build_and_save(&manager).expect("save should succeed");
        let loaded = store.load();
        assert!(loaded.tabs.is_empty());
        assert!(loaded.tab_order.is_empty());
        assert_eq!(loaded.version, SNAPSHOT_VERSION);
    }
}

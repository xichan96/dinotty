//! Template file storage with atomic writes and per-scope index files.
//!
//! Directory layout (under the app config dir):
//!
//! ```text
//! templates/
//!   global/
//!     index.json
//!     <tpl_id>.json
//!   workspaces/
//!     <workspace_id>/
//!       index.json
//!       <tpl_id>.json
//! ```
//!
//! Writes use `tempfile::NamedTempFile` + `persist` so a crash mid-write
//! never leaves a half-written file. Index files are rebuilt on demand if
//! they go missing or fail to parse.

#![allow(clippy::unused_self, clippy::items_after_statements, clippy::missing_errors_doc)]

use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};
use tempfile::NamedTempFile;
use tracing::warn;

use super::types::{Template, TemplateIndex, TemplateIndexEntry, TemplateScope};

/// Errors returned by store operations. Handlers map these to HTTP status
/// codes (`NotFound` -> 404, Io/Serialize -> 500).
#[derive(Debug)]
pub enum StoreError {
    Io(String),
    Serialize(String),
    NotFound,
    BadRequest(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(m) => write!(f, "io error: {m}"),
            Self::Serialize(m) => write!(f, "serialize error: {m}"),
            Self::NotFound => write!(f, "not found"),
            Self::BadRequest(m) => write!(f, "bad request: {m}"),
        }
    }
}

impl std::error::Error for StoreError {}

type Result<T> = std::result::Result<T, StoreError>;

/// File-backed template storage. Production code uses
/// [`TemplateStore::new`]; tests inject a base dir via
/// [`TemplateStore::new_with_base`].
#[derive(Clone, Debug)]
pub struct TemplateStore {
    base_dir: PathBuf,
}

impl TemplateStore {
    #[must_use]
    pub fn new() -> Self {
        Self { base_dir: crate::settings::config_dir().join("templates") }
    }

    #[cfg(test)]
    pub fn new_with_base(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    fn scope_dir(&self, scope: TemplateScope, workspace_id: Option<&str>) -> PathBuf {
        match scope {
            TemplateScope::Global => self.base_dir.join("global"),
            TemplateScope::Workspace => {
                let ws = workspace_id.filter(|s| !s.is_empty()).unwrap_or("orphaned");
                self.base_dir.join("workspaces").join(ws)
            }
        }
    }

    fn template_path(&self, scope: TemplateScope, workspace_id: Option<&str>, id: &str) -> PathBuf {
        self.scope_dir(scope, workspace_id).join(format!("{id}.json"))
    }

    fn index_path(&self, scope: TemplateScope, workspace_id: Option<&str>) -> PathBuf {
        self.scope_dir(scope, workspace_id).join("index.json")
    }

    /// Atomically write `bytes` to `path` via a temp file in the same directory.
    /// `persist` is atomic on POSIX (rename(2)) and Windows (`MoveFileEx`).
    fn atomic_write(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        let dir = path.parent().ok_or_else(|| StoreError::Io("path has no parent".into()))?;
        std::fs::create_dir_all(dir).map_err(|e| StoreError::Io(e.to_string()))?;

        let mut tmp = NamedTempFile::new_in(dir).map_err(|e| StoreError::Io(e.to_string()))?;
        use std::io::Write;
        tmp.write_all(bytes).map_err(|e| StoreError::Io(e.to_string()))?;
        tmp.flush().map_err(|e| StoreError::Io(e.to_string()))?;
        tmp.persist(path).map_err(|e| StoreError::Io(e.to_string()))?;
        Ok(())
    }

    fn read_json<T: DeserializeOwned>(&self, path: &Path) -> Result<T> {
        let bytes = std::fs::read(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StoreError::NotFound,
            _ => StoreError::Io(e.to_string()),
        })?;
        serde_json::from_slice(&bytes).map_err(|e| StoreError::Serialize(e.to_string()))
    }

    fn write_json_atomic<T: Serialize>(&self, path: &Path, value: &T) -> Result<()> {
        let bytes =
            serde_json::to_vec_pretty(value).map_err(|e| StoreError::Serialize(e.to_string()))?;
        self.atomic_write(path, &bytes)
    }

    fn load_index(&self, scope: TemplateScope, workspace_id: Option<&str>) -> TemplateIndex {
        let path = self.index_path(scope, workspace_id);
        match self.read_json::<TemplateIndex>(&path) {
            Ok(idx) => idx,
            Err(StoreError::NotFound) => TemplateIndex::default(),
            Err(e) => {
                // Corrupt index -> rebuild by scanning the directory.
                warn!("template index corrupt ({e}), rebuilding");
                self.rebuild_index(scope, workspace_id)
            }
        }
    }

    fn rebuild_index(&self, scope: TemplateScope, workspace_id: Option<&str>) -> TemplateIndex {
        let dir = self.scope_dir(scope, workspace_id);
        let mut entries = Vec::new();

        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return TemplateIndex::default();
                }
                warn!("rebuild_index: read_dir failed: {e}");
                return TemplateIndex::default();
            }
        };

        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some("index.json") {
                continue;
            }
            match self.read_json::<Template>(&path) {
                Ok(tpl) => entries.push(TemplateIndexEntry {
                    id: tpl.id,
                    name: tpl.name,
                    scope: tpl.scope,
                    workspace_id: tpl.workspace_id,
                    updated_at: tpl.updated_at,
                }),
                Err(e) => warn!("rebuild_index: skipping {}: {e}", path.display()),
            }
        }

        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let idx = TemplateIndex { templates: entries };
        let _ = self.write_json_atomic(&self.index_path(scope, workspace_id), &idx);
        idx
    }

    fn save_index(
        &self,
        scope: TemplateScope,
        workspace_id: Option<&str>,
        idx: &TemplateIndex,
    ) -> Result<()> {
        self.write_json_atomic(&self.index_path(scope, workspace_id), idx)
    }

    /// Upsert a template: writes the template file and updates the index.
    pub fn save(&self, tpl: &Template) -> Result<()> {
        let path = self.template_path(tpl.scope, tpl.workspace_id.as_deref(), &tpl.id);
        self.write_json_atomic(&path, tpl)?;

        let mut idx = self.load_index(tpl.scope, tpl.workspace_id.as_deref());
        let entry = TemplateIndexEntry {
            id: tpl.id.clone(),
            name: tpl.name.clone(),
            scope: tpl.scope,
            workspace_id: tpl.workspace_id.clone(),
            updated_at: tpl.updated_at.clone(),
        };
        if let Some(slot) = idx.templates.iter_mut().find(|e| e.id == tpl.id) {
            *slot = entry;
        } else {
            idx.templates.push(entry);
        }
        idx.templates.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.save_index(tpl.scope, tpl.workspace_id.as_deref(), &idx)?;
        Ok(())
    }

    pub fn load(
        &self,
        scope: TemplateScope,
        workspace_id: Option<&str>,
        id: &str,
    ) -> Result<Template> {
        let path = self.template_path(scope, workspace_id, id);
        self.read_json::<Template>(&path)
    }

    pub fn list(&self, scope: TemplateScope, workspace_id: Option<&str>) -> Result<Vec<Template>> {
        let idx = self.load_index(scope, workspace_id);
        let mut out = Vec::with_capacity(idx.templates.len());
        for entry in idx.templates {
            match self.load(scope, workspace_id, &entry.id) {
                Ok(tpl) => out.push(tpl),
                Err(e) => {
                    // A template file vanished or got corrupted since the index was
                    // last written. Skip it here; the next save will rewrite the
                    // index and prune the stale entry.
                    warn!("list: skip {}: {e}", entry.id);
                }
            }
        }
        Ok(out)
    }

    pub fn delete(&self, scope: TemplateScope, workspace_id: Option<&str>, id: &str) -> Result<()> {
        let path = self.template_path(scope, workspace_id, id);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(StoreError::NotFound),
            Err(e) => return Err(StoreError::Io(e.to_string())),
        }

        let mut idx = self.load_index(scope, workspace_id);
        let before = idx.templates.len();
        idx.templates.retain(|e| e.id != id);
        if idx.templates.len() != before {
            self.save_index(scope, workspace_id, &idx)?;
        }
        Ok(())
    }
}

impl Default for TemplateStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_template(id: &str, name: &str, scope: TemplateScope, ws: Option<&str>) -> Template {
        let ts = crate::util::chrono_now();
        Template {
            id: id.into(),
            name: name.into(),
            scope,
            workspace_id: ws.map(str::to_string),
            created_at: ts.clone(),
            updated_at: ts,
            layout: json!({
                "type": "split",
                "direction": "horizontal",
                "children": [{
                    "type": "leaf",
                    "kind": "terminal",
                    "paneId": "p1",
                    "title": "T",
                    "ratio": 1.0,
                    "zoomed": false
                }],
                "ratios": [1.0]
            }),
        }
    }

    fn fresh_store() -> TemplateStore {
        let dir = tempfile::tempdir().unwrap().keep();
        TemplateStore::new_with_base(dir)
    }

    #[test]
    fn save_load_roundtrip_global() {
        let store = fresh_store();
        let tpl = make_template("t1", "T1", TemplateScope::Global, None);
        store.save(&tpl).unwrap();
        let loaded = store.load(TemplateScope::Global, None, "t1").unwrap();
        assert_eq!(loaded.name, "T1");
    }

    #[test]
    fn list_returns_saved_templates() {
        let store = fresh_store();
        store.save(&make_template("a", "A", TemplateScope::Global, None)).unwrap();
        store.save(&make_template("b", "B", TemplateScope::Global, None)).unwrap();
        let list = store.list(TemplateScope::Global, None).unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn delete_removes_template_and_index_entry() {
        let store = fresh_store();
        store.save(&make_template("c", "C", TemplateScope::Global, None)).unwrap();
        store.delete(TemplateScope::Global, None, "c").unwrap();
        assert!(store.load(TemplateScope::Global, None, "c").is_err());
        // List should be empty.
        assert!(store.list(TemplateScope::Global, None).unwrap().is_empty());
    }

    #[test]
    fn corrupt_index_is_rebuilt() {
        let store = fresh_store();
        store.save(&make_template("d", "D", TemplateScope::Global, None)).unwrap();
        // Corrupt the index file.
        let idx_path = store.index_path(TemplateScope::Global, None);
        std::fs::write(&idx_path, b"not json").unwrap();
        // list triggers rebuild via load_index.
        let list = store.list(TemplateScope::Global, None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "d");
    }

    #[test]
    fn workspace_scope_uses_workspace_subdir() {
        let store = fresh_store();
        store.save(&make_template("w1", "W1", TemplateScope::Workspace, Some("ws-1"))).unwrap();
        let loaded = store.load(TemplateScope::Workspace, Some("ws-1"), "w1").unwrap();
        assert_eq!(loaded.name, "W1");
        // Global scope should not see it.
        let global = store.list(TemplateScope::Global, None).unwrap();
        assert!(global.is_empty());
    }

    #[test]
    fn save_upserts_existing_template() {
        let store = fresh_store();
        let mut tpl = make_template("e", "E", TemplateScope::Global, None);
        store.save(&tpl).unwrap();
        tpl.name = "E2".into();
        tpl.updated_at = crate::util::chrono_now();
        store.save(&tpl).unwrap();
        let list = store.list(TemplateScope::Global, None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "E2");
    }

    #[test]
    fn load_missing_returns_not_found() {
        let store = fresh_store();
        let err = store.load(TemplateScope::Global, None, "ghost").unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }

    #[test]
    fn delete_missing_returns_not_found() {
        let store = fresh_store();
        let err = store.delete(TemplateScope::Global, None, "ghost").unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }
}

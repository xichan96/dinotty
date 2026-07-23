//! Layout template data types.
//!
//! A template is a frozen snapshot of a tab's layout tree (with terminal
//! `cwd` / `startup_command`, plugin `plugin_options`, etc.) that can be
//! re-applied later to create a new tab with the same structure.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Template scope: `workspace`-scoped templates are only visible when that
/// workspace is active; `global` templates are visible from any context.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TemplateScope {
    Workspace,
    Global,
}

/// A saved layout template. The `layout` field holds the layout tree (same
/// schema as `SessionManager.tab_layouts`) with runtime-only fields stripped.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub scope: TemplateScope,
    /// Present when `scope == Workspace`. Absent for global templates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    /// ISO 8601 timestamp from `util::chrono_now()`.
    pub created_at: String,
    pub updated_at: String,
    pub layout: Value,
}

/// Metadata stored in `index.json` alongside each scope's template directory.
/// Keeps list operations cheap without scanning every template file.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TemplateIndexEntry {
    pub id: String,
    pub name: String,
    pub scope: TemplateScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TemplateIndex {
    pub templates: Vec<TemplateIndexEntry>,
}

/// `POST /api/templates` body.
#[derive(Deserialize)]
pub struct CreateTemplateBody {
    pub name: String,
    pub scope: TemplateScope,
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Source tab to clone the layout from.
    pub source_tab_id: String,
    /// Per-pane overrides keyed by the source tab's paneId.
    #[serde(default)]
    pub pane_overrides: std::collections::HashMap<String, PaneOverride>,
}

/// `PUT /api/templates/{id}` body. All fields optional; absent fields keep
/// the existing template value.
#[derive(Deserialize)]
pub struct UpdateTemplateBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub source_tab_id: Option<String>,
    #[serde(default)]
    pub pane_overrides: Option<std::collections::HashMap<String, PaneOverride>>,
}

/// Per-pane override applied when cloning a tab's layout into a template.
/// Only fields present in the override are replaced; other leaf fields keep
/// their source-tab value.
#[derive(Deserialize, Default)]
pub struct PaneOverride {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub startup_command: Option<String>,
    /// Override the leaf's `title` field.
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub plugin_options: Option<Value>,
}

/// `GET /api/templates?scope=...&workspace_id=...` query.
#[derive(Deserialize)]
pub struct ListTemplatesQuery {
    pub scope: TemplateScope,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// `POST /api/templates/apply` body. Phase 2 will implement the apply logic;
/// Phase 1 only stubs the route.
#[derive(Deserialize)]
pub struct ApplyTemplateBody {
    pub template_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

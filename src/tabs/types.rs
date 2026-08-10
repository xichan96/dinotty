use std::path::PathBuf;

use serde::{Deserialize, Deserializer};

#[derive(Deserialize)]
pub struct SplitPaneRequest {
    pub pane_id: String,
    pub direction: String, // "horizontal" or "vertical"
    /// When true, always create a local PTY even if the source pane is SSH.
    #[serde(default)]
    pub force_local: bool,
    /// Optional CWD override for the new pane. Honored for local PTY splits
    /// (including non-`force_local`); falls back to the source pane's CWD when absent.
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateLayoutRequest {
    pub layout: serde_json::Value,
    pub active_pane_id: String,
}

#[derive(Deserialize)]
pub struct CreateTabRequest {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_argv")]
    pub argv: Option<Vec<String>>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct CreatePluginPaneRequest {
    pub plugin_id: String,
    pub target_pane_id: String,
    pub direction: String,
}

#[derive(Deserialize)]
pub struct CreateFilesPaneRequest {
    pub path: String,
    pub target_pane_id: String,
    pub direction: String,
}

#[derive(Deserialize)]
pub struct CreateWebPaneRequest {
    pub url: String,
    pub target_pane_id: String,
    pub direction: String,
}

#[derive(Deserialize)]
pub struct MovePaneRequest {
    pub source_tab_id: String,
    /// When present, Mode B (single pane move). When absent, Mode A (whole tab as subtree).
    #[serde(default)]
    pub source_pane_id: Option<String>,
    pub target_pane_id: String,
    pub direction: String,
}

#[derive(Deserialize)]
pub struct ExtractPaneRequest {
    pub source_tab_id: String,
    pub pane_id: String,
}

#[derive(Deserialize)]
pub struct CreatePluginTabRequest {
    pub plugin_id: String,
    #[serde(default)]
    pub title: Option<String>,
    /// Optional tab ID to reuse (used when migrating frontend-only plugin
    /// tabs so they gain a backend `tab_layouts` entry without changing
    /// paneId). If omitted, a new UUID is generated.
    #[serde(default)]
    pub tab_id: Option<String>,
}

pub(super) fn deserialize_optional_argv<'de, D>(
    deserializer: D,
) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Vec::<String>::deserialize(deserializer).map(Some)
}

pub(super) fn validate_create_tab_request(
    req: &CreateTabRequest,
) -> Result<Option<PathBuf>, String> {
    if let Some(argv) = req.argv.as_ref() {
        if argv.is_empty() {
            return Err("argv must be a non-empty array".to_string());
        }
        if argv[0].is_empty() {
            return Err("argv[0] must be a non-empty string".to_string());
        }
        if argv.iter().any(|arg| arg.contains('\0')) {
            return Err("argv entries must not contain NUL bytes".to_string());
        }
    }

    req.cwd.as_ref().map(PathBuf::from).map_or(Ok(None), |cwd| {
        if cwd.is_dir() {
            Ok(Some(cwd))
        } else {
            Err("cwd must exist and be a directory".to_string())
        }
    })
}

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Deserialize)]
pub struct PaneQuery {
    pub pane_id: String,
}

#[derive(Deserialize, Clone)]
pub struct PanePathQuery {
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct WorkspaceListQuery {
    #[serde(default)]
    pub pane_id: String,
    #[serde(default)]
    pub path: String,
    pub root: Option<String>,
    #[serde(default)]
    pub free: bool,
}

#[derive(Deserialize, Clone)]
pub struct ResolveQuery {
    pub pane_id: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ResolveResponse {
    pub rel: String,
}

#[derive(Serialize)]
pub struct ResolveAbsResponse {
    pub abs: String,
}

#[derive(Serialize)]
pub(crate) struct UploadDirStatus {
    pub(crate) managed: bool,
    pub(crate) foreign: bool,
    pub(crate) empty: bool,
}

pub(crate) struct UploadBase {
    pub(crate) path: PathBuf,
    pub(crate) managed: bool,
}

#[derive(Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub(crate) struct UploadOpResponse {
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) saved: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) deleted: Option<usize>,
    pub(crate) managed: bool,
    pub(crate) foreign: bool,
    pub(crate) empty: bool,
}

#[derive(Serialize)]
pub(crate) struct UploadDefaultDirResponse {
    pub(crate) default_dir: String,
}

pub(crate) struct UploadFileEntry {
    pub(crate) path: PathBuf,
    pub(crate) name: String,
    pub(crate) size: u64,
    pub(crate) modified: SystemTime,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct ListResponse {
    pub cwd: String,
    pub path: String,
    pub entries: Vec<DirEntry>,
}

#[derive(Serialize)]
pub struct MetaResponse {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl MetaResponse {
    pub(crate) fn media(kind: &'static str, mime: &'static str) -> Self {
        Self {
            kind,
            content: None,
            language: None,
            truncated: false,
            mime: Some(mime.to_string()),
            message: None,
        }
    }

    pub(crate) fn unsupported() -> Self {
        Self {
            kind: "unsupported",
            content: None,
            language: None,
            truncated: false,
            mime: None,
            message: Some("binary file".into()),
        }
    }
}

#[derive(Deserialize)]
pub struct WorkspaceSearchBody {
    pub pane_id: String,
    pub path: String,
    pub query: String,
    #[serde(default)]
    pub file_pattern: Option<String>,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Serialize)]
pub struct SearchMatch {
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub line_text: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub pane_id: String,
    #[serde(default)]
    pub dir: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateEntryQuery {
    pub pane_id: String,
    #[serde(default)]
    pub parent: String,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateEntryBody {
    pub kind: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct PutFileBody {
    pub content: String,
}

#[derive(Deserialize)]
pub struct RenameBody {
    pub new_name: String,
}

#[derive(Deserialize)]
pub struct MoveBody {
    pub dest: String,
}

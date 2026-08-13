#![allow(clippy::unwrap_used, clippy::expect_used, clippy::result_large_err)]

mod git;
mod handlers;
mod remote;
mod syntax;
mod types;
mod upload;
mod util;

pub use git::{
    workspace_git_diff, workspace_git_revert_lines, workspace_git_stage_lines,
    workspace_git_status, GitChange, GitDiffResponse, GitFileStatus, GitRevertBody, GitStageBody,
    GitStatusResponse,
};
pub use syntax::{workspace_syntax_check, SyntaxCheckBody, SyntaxCheckResponse, SyntaxDiagnostic};

pub use handlers::{
    workspace_create_entry, workspace_cwd, workspace_delete, workspace_list, workspace_meta,
    workspace_move, workspace_put_file, workspace_raw, workspace_rename, workspace_resolve,
    workspace_reveal, workspace_search,
};
pub use types::{
    CreateEntryBody, CreateEntryQuery, DirEntry, ListResponse, MetaResponse, MoveBody,
    PanePathQuery, PaneQuery, PutFileBody, RenameBody, ResolveQuery, ResolveResponse, SearchMatch,
    SearchResponse, UploadQuery, WorkspaceListQuery, WorkspaceSearchBody,
};
pub use upload::{
    uploads_adopt, uploads_clear, uploads_default_dir, uploads_status, workspace_upload,
    workspace_uploads,
};

// Re-export helpers that `remote.rs` consumes via `crate::workspace::{...}`
// and that `git.rs` consumes via `super::{...}`. Visibility is `pub(crate)`
// (visible to the whole crate, including `src/` which is workspace's parent)
// matching the original `pub(super)` semantics of the un-split module.
pub(crate) use util::{
    detect_language, get_root, json_err, media_kind, normalize_join, office_kind,
    resolve_user_path, skip_text_preview, try_res, validate_entry_name, MAX_DOWNLOAD,
    MAX_TEXT_PREVIEW,
};

// Re-export helpers that `tests.rs` consumes via `use super::*`. Gated on
// `#[cfg(test)]` since the non-test lib build has no other consumer and would
// otherwise flag these as unused imports.
#[cfg(test)]
pub(crate) use upload::{
    prepare_upload_base, suffixed_upload_name, upload_cap_label_bytes, upload_io_err,
    INSUFFICIENT_STORAGE,
};
#[cfg(test)]
pub(crate) use util::{byte_offset_to_column, parse_rg_json, path_must_be_under};

#[cfg(test)]
mod tests;

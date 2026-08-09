mod non_terminal;
mod panes;
mod tabs;

pub use non_terminal::{create_files_pane, create_plugin_pane, create_plugin_tab, create_web_pane};
pub use panes::{activate_pane, close_pane, extract_pane, move_pane, split_pane, update_layout};
pub use tabs::{close_tab, create_tab, list_tabs, rename_tab};

use axum::{http::StatusCode, response::IntoResponse, Json};

use crate::platform::shell::ShellResolveError;

fn shell_error_response(error: &ShellResolveError) -> axum::response::Response {
    let status = match error.code {
        "wsl_timeout" | "wsl_list_failed" => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::CONFLICT,
    };
    (status, Json(serde_json::json!({ "error": { "code": error.code } }))).into_response()
}

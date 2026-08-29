#![allow(clippy::items_after_test_module)]

mod handlers;
pub(crate) mod service;
mod ssh;
mod types;

pub use handlers::{
    activate_pane, close_pane, close_tab, create_files_pane, create_plugin_pane, create_plugin_tab,
    create_tab, create_web_pane, extract_pane, list_tabs, move_pane, rename_tab, split_pane,
    update_layout,
};
pub use ssh::{create_ssh_quick_tab, create_ssh_tab};
pub use types::{
    CreateFilesPaneRequest, CreatePluginPaneRequest, CreatePluginTabRequest, CreateTabRequest,
    CreateWebPaneRequest, ExtractPaneRequest, MovePaneRequest, SplitPaneRequest,
    UpdateLayoutRequest,
};

#[cfg(test)]
mod tests;

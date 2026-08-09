mod crud;
mod crypto;
mod exec;
mod helpers;
mod install_git;
mod manager;
mod registry;
mod storage;
mod subscriptions;
mod types;
mod workspace;

#[cfg(test)]
mod tests;

pub use crud::{
    delete_plugin, dev_link_plugin, install_from_dir, install_plugin, list_plugins, plugin_asset,
    plugin_detail, update_plugin,
};
pub use crypto::{plugin_crypto_hash, plugin_crypto_hmac};
pub use exec::{
    plugin_exec, plugin_process_list, plugin_process_start, plugin_process_stop,
    plugin_process_stop_all, plugin_spawn_ws,
};
pub use install_git::install_from_git;
pub use manager::{PluginManager, PluginManagerState};
pub use registry::{get_market_readme, get_market_registry};
pub use storage::{
    plugin_storage_delete, plugin_storage_get, plugin_storage_list, plugin_storage_set,
};
pub use subscriptions::{has_subscriber, subscribe, unsubscribe, SubscriptionRegistry};
pub use types::*;
pub use workspace::{
    plugin_workspace_delete, plugin_workspace_mkdir, plugin_workspace_move,
    plugin_workspace_put_file, plugin_workspace_read_dir, plugin_workspace_read_file,
    plugin_workspace_rename, plugin_workspace_stat, plugin_workspace_watch,
};

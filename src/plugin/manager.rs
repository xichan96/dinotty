use dashmap::DashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::Duration;

use crate::platform::fs as platform_fs;
use crate::session::SessionManager;

use super::helpers::{
    copy_plugin_dir, extract_tar_gz, require_native_approval, resolve_binary, set_executable,
    validate_manifest, validate_min_app_version,
};
use super::types::{
    HostTarget, ManagedProcess, PluginInfo, PluginManifest, PluginStateValue, ProcessControl,
    ProcessLifecycleScope, ProcessState,
};

// ─── PluginManager ──────────────────────────────────────────────────────────

pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

fn now_unix_seconds() -> Option<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

pub(super) fn collect_affected_plugin_ids(
    plugin_dir: &Path,
    staging_dir: &Path,
    event: &notify::Event,
    affected_ids: &mut HashSet<String>,
) -> bool {
    if event.paths.is_empty() {
        return true;
    }

    let mut needs_full_reload = false;
    for path in &event.paths {
        if path.starts_with(staging_dir) {
            continue;
        }
        let Ok(relative) = path.strip_prefix(plugin_dir) else {
            needs_full_reload = true;
            continue;
        };
        let Some(std::path::Component::Normal(first)) = relative.components().next() else {
            needs_full_reload = true;
            continue;
        };
        let Some(plugin_id) = first.to_str() else {
            needs_full_reload = true;
            continue;
        };
        if !plugin_id.starts_with('.') {
            affected_ids.insert(plugin_id.to_string());
        }
    }
    needs_full_reload
}

pub struct PluginManager {
    pub plugin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub registry: DashMap<String, PluginInfo>,
    pub processes: DashMap<String, DashMap<String, ManagedProcess>>,
    pub operation_locks: DashMap<String, Weak<tokio::sync::RwLock<()>>>,
    pub host_target: Option<HostTarget>,
    pub host_origin: String,
    pub host_version: String,
    pub host_mode: String,
}

pub type PluginManagerState = Arc<PluginManager>;

impl PluginManager {
    #[must_use]
    pub fn new(host_origin: String, host_mode: String) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            plugin_dir: home.join(".dinotty/plugins"),
            data_dir: home.join(".dinotty/plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
            operation_locks: DashMap::new(),
            host_target: HostTarget::current(),
            host_origin,
            host_version: HOST_VERSION.into(),
            host_mode,
        }
    }

    #[must_use]
    pub fn operation_lock(&self, plugin_id: &str) -> Arc<tokio::sync::RwLock<()>> {
        self.operation_locks.retain(|_, lock| lock.strong_count() > 0);
        let mut entry = self.operation_locks.entry(plugin_id.to_string()).or_default();
        if let Some(lock) = entry.upgrade() {
            return lock;
        }
        let lock = Arc::new(tokio::sync::RwLock::new(()));
        *entry = Arc::downgrade(&lock);
        lock
    }

    /// # Errors
    /// Returns an error if any managed process does not stop before its bounded deadline.
    pub async fn kill_plugin_processes(&self, plugin_id: &str) -> Result<(), String> {
        self.kill_plugin_processes_with_scope(plugin_id, None).await
    }

    /// # Errors
    /// Returns an error if a matching managed process does not stop before its bounded deadline.
    pub async fn kill_plugin_processes_with_scope(
        &self,
        plugin_id: &str,
        scope: Option<ProcessLifecycleScope>,
    ) -> Result<(), String> {
        let Some(proc_map) = self.processes.get(plugin_id) else {
            return Ok(());
        };
        let processes: Vec<_> = proc_map
            .iter()
            .filter(|entry| scope.is_none_or(|scope| entry.scope == scope))
            .map(|entry| (entry.key().clone(), entry.control.clone(), entry.stop_timeout))
            .collect();
        drop(proc_map);

        let mut waiters = Vec::with_capacity(processes.len());
        let mut failed = Vec::new();
        for (process_id, control, stop_timeout) in processes {
            let (finished, wait) = tokio::sync::oneshot::channel();
            match control.try_send(ProcessControl::Stop { finished }) {
                Ok(()) => waiters.push((process_id, stop_timeout, wait)),
                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                    if let Some(proc_map) = self.processes.get(plugin_id) {
                        proc_map.remove(&process_id);
                    }
                }
                Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                    failed.push(process_id);
                }
            }
        }

        let results = futures_util::future::join_all(waiters.into_iter().map(
            |(process_id, stop_timeout, wait)| async move {
                (process_id, tokio::time::timeout(stop_timeout, wait).await)
            },
        ))
        .await;
        for (process_id, result) in results {
            let already_stopped = self.processes.get(plugin_id).is_none_or(|proc_map| {
                proc_map
                    .get(&process_id)
                    .is_none_or(|entry| matches!(&entry.info.state, ProcessState::Exited))
            });
            if matches!(result, Ok(Ok(()))) || already_stopped {
                if let Some(proc_map) = self.processes.get(plugin_id) {
                    proc_map.remove(&process_id);
                }
            } else {
                tracing::error!(
                    plugin_id,
                    process_id,
                    "failed to stop managed plugin process before its deadline"
                );
                failed.push(process_id);
            }
        }
        if failed.is_empty() {
            Ok(())
        } else {
            Err(format!("failed to stop plugin processes: {}", failed.join(", ")))
        }
    }

    pub async fn shutdown_all(&self) {
        let plugin_ids: Vec<String> =
            self.processes.iter().map(|entry| entry.key().clone()).collect();
        let results = futures_util::future::join_all(
            plugin_ids.iter().map(|plugin_id| self.kill_plugin_processes(plugin_id)),
        )
        .await;
        for (plugin_id, result) in plugin_ids.iter().zip(results) {
            if let Err(error) = result {
                tracing::error!(plugin_id, error, "failed to stop plugin during host shutdown");
            }
        }
    }

    pub fn request_shutdown_all(&self) {
        for plugin in &self.processes {
            for process in plugin.value() {
                let (finished, _wait) = tokio::sync::oneshot::channel();
                let _ = process.control.try_send(ProcessControl::Stop { finished });
            }
        }
    }

    /// # Errors
    /// Returns an error when the host target or selected entry is unsupported or unsafe.
    pub fn resolve_plugin_binary(
        &self,
        plugin_id: &str,
        manifest: &PluginManifest,
    ) -> Result<PathBuf, String> {
        let target = self
            .host_target
            .ok_or_else(|| "native plugins are unsupported on this host target".to_string())?;
        let bin = manifest.bin.as_ref().ok_or_else(|| "plugin has no CLI bin".to_string())?;
        resolve_binary(&self.plugin_dir.join(plugin_id), bin, target)
    }

    pub(super) fn validate_for_host(&self, manifest: &PluginManifest) -> Result<(), String> {
        validate_manifest(manifest)?;
        validate_min_app_version(manifest, &self.host_version)
    }

    pub(super) fn prepare_binary(
        &self,
        plugin_root: &std::path::Path,
        manifest: &PluginManifest,
    ) -> Result<(), String> {
        if let Some(bin) = &manifest.bin {
            let target = self
                .host_target
                .ok_or_else(|| "native plugins are unsupported on this host target".to_string())?;
            let path = resolve_binary(plugin_root, bin, target)?;
            set_executable(&path)?;
        }
        Ok(())
    }

    pub(super) fn staging_dir(&self, prefix: &str) -> Result<tempfile::TempDir, String> {
        let root = self.plugin_dir.join(".staging");
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("failed to create plugin staging directory: {e}"))?;
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(root)
            .map_err(|e| format!("failed to create plugin staging directory: {e}"))
    }

    pub(super) fn replace_with_staged(
        &self,
        id: &str,
        staged: &std::path::Path,
    ) -> Result<(), String> {
        let plugin_path = self.plugin_dir.join(id);
        let backup_slot = self.staging_dir(&format!("backup-{id}-"))?;
        let backup_path = backup_slot.path().to_path_buf();
        backup_slot.close().map_err(|e| format!("failed to reserve plugin backup path: {e}"))?;

        let had_old = platform_fs::path_exists_or_symlink(&plugin_path);
        if had_old {
            std::fs::rename(&plugin_path, &backup_path)
                .map_err(|e| format!("failed to stage existing plugin: {e}"))?;
        }

        if let Err(install_error) = std::fs::rename(staged, &plugin_path) {
            if had_old {
                if let Err(rollback_error) = std::fs::rename(&backup_path, &plugin_path) {
                    return Err(format!(
                        "failed to install update: {install_error}; rollback failed: {rollback_error}"
                    ));
                }
            }
            return Err(format!("failed to install update: {install_error}"));
        }

        if had_old {
            if let Err(error) = platform_fs::remove_plugin_path(&backup_path) {
                tracing::warn!(
                    plugin_id = id,
                    %error,
                    backup = %backup_path.display(),
                    "updated plugin but failed to remove backup"
                );
            }
        }
        Ok(())
    }

    pub fn scan(&self) {
        if !self.plugin_dir.exists() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(&self.plugin_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();

            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }

            // Skip broken symlinks
            if path.is_symlink() && !path.exists() {
                tracing::warn!("Removing broken symlink: {:?}", path);
                let _ = platform_fs::remove_symlink_or_file(&path);
                continue;
            }

            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("plugin.json");
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                    if manifest.id != entry.file_name().to_string_lossy() {
                        continue;
                    }
                    let install_date = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());
                    let is_dev_link = entry.path().is_symlink();
                    let validation_error = self.validate_for_host(&manifest).err().or_else(|| {
                        manifest
                            .bin
                            .as_ref()
                            .and_then(|_| self.prepare_binary(&path, &manifest).err())
                    });
                    self.registry.insert(
                        manifest.id.clone(),
                        PluginInfo {
                            manifest,
                            install_date,
                            state: if validation_error.is_some() {
                                PluginStateValue::Error
                            } else {
                                PluginStateValue::Active
                            },
                            error: validation_error,
                            is_dev_link,
                        },
                    );
                }
            }
        }
    }

    #[must_use]
    pub fn list(&self) -> Vec<PluginInfo> {
        let mut items: Vec<PluginInfo> = self.registry.iter().map(|r| r.value().clone()).collect();
        items.sort_by_key(|a| a.manifest.name.to_lowercase());
        items
    }

    pub fn watch_changes(self: &Arc<Self>, manager: Arc<SessionManager>) {
        if !self.plugin_dir.exists() {
            return;
        }
        let plugin_dir = self.plugin_dir.clone();
        let staging_dir = plugin_dir.join(".staging");
        let this = Arc::clone(self);

        tokio::spawn(async move {
            use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

            let mut watcher = match RecommendedWatcher::new(
                move |res: Result<notify::Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx.send(event);
                    }
                },
                Config::default().with_poll_interval(Duration::from_secs(1)),
            ) {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("Failed to create plugin watcher: {}", e);
                    return;
                }
            };

            if let Err(e) = watcher.watch(&plugin_dir, RecursiveMode::Recursive) {
                tracing::error!("Failed to watch plugin dir: {}", e);
                return;
            }

            tracing::info!("Plugin file watcher started on {:?}", plugin_dir);

            while let Some(event) = rx.recv().await {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }

                let mut affected_ids = HashSet::new();
                let mut needs_full_reload = collect_affected_plugin_ids(
                    &plugin_dir,
                    &staging_dir,
                    &event,
                    &mut affected_ids,
                );

                let debounce = tokio::time::sleep(Duration::from_millis(500));
                tokio::pin!(debounce);
                loop {
                    tokio::select! {
                        () = &mut debounce => break,
                        next = rx.recv() => {
                            let Some(next) = next else { return; };
                            if !matches!(next.kind, EventKind::Access(_)) {
                                needs_full_reload |= collect_affected_plugin_ids(
                                    &plugin_dir,
                                    &staging_dir,
                                    &next,
                                    &mut affected_ids,
                                );
                            }
                        }
                    }
                }

                if affected_ids.is_empty() && !needs_full_reload {
                    continue;
                }

                let old_ids: HashSet<String> =
                    this.registry.iter().map(|e| e.key().clone()).collect();

                this.registry.clear();
                this.scan();

                let new_ids: HashSet<String> =
                    this.registry.iter().map(|e| e.key().clone()).collect();

                for id in &new_ids {
                    if !old_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "added".into());
                    } else if needs_full_reload || affected_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "updated".into());
                    }
                }
                for id in &old_ids {
                    if !new_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "deleted".into());
                    }
                }
            }
        });
    }

    // ─── Lifecycle Methods ───────────────────────────────────────────────────

    /// # Errors
    /// Returns `Err` if the archive cannot be extracted, the manifest is invalid,
    /// or the plugin directory operations fail.
    pub async fn install(&self, archive: &[u8]) -> Result<PluginManifest, String> {
        self.install_with_approval(archive, false).await
    }

    /// Install an archive after the caller has explicitly approved native capabilities.
    ///
    /// # Errors
    /// Returns `Err` if validation, approval, extraction, or installation fails.
    pub(super) async fn install_with_approval(
        &self,
        archive: &[u8],
        approve_native: bool,
    ) -> Result<PluginManifest, String> {
        std::fs::create_dir_all(&self.plugin_dir).map_err(|e| e.to_string())?;
        let tmp = self.staging_dir("install-")?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest_path = tmp.path().join("plugin.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|_| "plugin.json not found in archive".to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&content).map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        require_native_approval(&manifest, approve_native)?;
        self.prepare_binary(tmp.path(), &manifest)?;

        let operation_lock = self.operation_lock(&manifest.id);
        let _operation = operation_lock.write_owned().await;
        let dest = self.plugin_dir.join(&manifest.id);
        if self.registry.contains_key(&manifest.id) || platform_fs::path_exists_or_symlink(&dest) {
            return Err(format!("plugin '{}' already installed, use update instead", manifest.id));
        }

        std::fs::rename(tmp.path(), &dest).map_err(|e| e.to_string())?;

        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: now_unix_seconds(),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );

        Ok(manifest)
    }

    /// # Errors
    /// Returns `Err` if the manifest is invalid or the directory operations fail.
    pub async fn install_from_dir(
        &self,
        src: &std::path::Path,
        dev_link: bool,
    ) -> Result<PluginManifest, String> {
        self.install_from_dir_with_approval(src, dev_link, false).await
    }

    /// Install a folder after the caller has explicitly approved native capabilities.
    ///
    /// # Errors
    /// Returns `Err` if validation, approval, copying, or linking fails.
    pub(super) async fn install_from_dir_with_approval(
        &self,
        src: &std::path::Path,
        dev_link: bool,
        approve_native: bool,
    ) -> Result<PluginManifest, String> {
        let manifest_path = src.join("plugin.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|_| "plugin.json not found in directory".to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&content).map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        require_native_approval(&manifest, approve_native)?;
        self.prepare_binary(src, &manifest)?;

        std::fs::create_dir_all(&self.plugin_dir)
            .map_err(|e| format!("failed to create plugin directory: {e}"))?;

        let staged = if dev_link {
            None
        } else {
            let staged = self.staging_dir("folder-install-")?;
            if let Err(error) = copy_plugin_dir(src, staged.path()) {
                return Err(format!("failed to copy plugin files: {error}"));
            }
            if let Err(error) = self.prepare_binary(staged.path(), &manifest) {
                return Err(format!("failed to validate copied plugin files: {error}"));
            }
            Some(staged)
        };

        let operation_lock = self.operation_lock(&manifest.id);
        let _operation = operation_lock.write_owned().await;
        let dest = self.plugin_dir.join(&manifest.id);
        if self.registry.contains_key(&manifest.id) || platform_fs::path_exists_or_symlink(&dest) {
            return Err(format!("plugin '{}' already installed, use update instead", manifest.id));
        }

        if let Some(staged) = staged {
            std::fs::rename(staged.path(), &dest)
                .map_err(|e| format!("failed to install copied plugin files: {e}"))?;
        } else {
            platform_fs::create_dir_symlink(src, &dest)
                .map_err(|e| format!("failed to create development link: {e}"))?;
        }

        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: now_unix_seconds(),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: dev_link,
            },
        );

        Ok(manifest)
    }

    /// Install or update a packaged plugin directory using the same-filesystem staging area.
    ///
    /// # Errors
    /// Returns `Err` when validation, process shutdown, or filesystem replacement fails.
    pub(super) async fn upsert_from_dir(
        &self,
        src: &std::path::Path,
        manifest: PluginManifest,
        approve_native: bool,
    ) -> Result<PluginManifest, String> {
        self.validate_for_host(&manifest)?;
        require_native_approval(&manifest, approve_native)?;
        std::fs::create_dir_all(&self.plugin_dir)
            .map_err(|e| format!("failed to create plugin directory: {e}"))?;
        let staged = self.staging_dir("git-install-")?;
        copy_plugin_dir(src, staged.path())?;
        self.prepare_binary(staged.path(), &manifest)?;

        let operation_lock = self.operation_lock(&manifest.id);
        let _operation = operation_lock.write_owned().await;
        let old_info = self.registry.get(&manifest.id).map(|info| info.clone());
        if old_info.is_some()
            || platform_fs::path_exists_or_symlink(&self.plugin_dir.join(&manifest.id))
        {
            self.kill_plugin_processes(&manifest.id).await?;
        }
        self.replace_with_staged(&manifest.id, staged.path())?;

        let install_date = old_info.and_then(|info| info.install_date).or_else(now_unix_seconds);
        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date,
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );
        Ok(manifest)
    }

    /// # Errors
    /// Returns `Err` if the plugin is not installed, the archive cannot be extracted,
    /// the manifest is invalid, or the directory operations fail.
    pub async fn update(&self, id: &str, archive: &[u8]) -> Result<PluginManifest, String> {
        self.update_with_approval(id, archive, false).await
    }

    /// Update an archive after the caller has explicitly approved native capabilities.
    ///
    /// # Errors
    /// Returns `Err` if validation, approval, process shutdown, or replacement fails.
    pub(super) async fn update_with_approval(
        &self,
        id: &str,
        archive: &[u8],
        approve_native: bool,
    ) -> Result<PluginManifest, String> {
        std::fs::create_dir_all(&self.plugin_dir).map_err(|e| e.to_string())?;
        let tmp = self.staging_dir("update-")?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest: PluginManifest = serde_json::from_str(
            &std::fs::read_to_string(tmp.path().join("plugin.json"))
                .map_err(|_| "plugin.json not found".to_string())?,
        )
        .map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        require_native_approval(&manifest, approve_native)?;
        if manifest.id != id {
            return Err("plugin id in archive does not match".into());
        }
        self.prepare_binary(tmp.path(), &manifest)?;

        let operation_lock = self.operation_lock(id);
        let _operation = operation_lock.write_owned().await;
        let old_info =
            self.registry.get(id).ok_or_else(|| format!("plugin '{id}' not installed"))?.clone();
        if old_info.is_dev_link {
            return Err(
                "cannot update a dev-link plugin; unlink it and install a packaged plugin instead"
                    .into(),
            );
        }
        self.kill_plugin_processes(id).await?;

        self.replace_with_staged(id, tmp.path())?;

        self.registry.insert(
            id.to_string(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: old_info.install_date,
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );

        Ok(manifest)
    }

    /// # Errors
    /// Returns `Err` if the plugin directory cannot be removed.
    pub async fn delete(&self, id: &str, keep_data: bool) -> Result<(), String> {
        let operation_lock = self.operation_lock(id);
        let _operation = operation_lock.write_owned().await;
        self.kill_plugin_processes(id).await?;

        let plugin_path = self.plugin_dir.join(id);
        if platform_fs::path_exists_or_symlink(&plugin_path) {
            platform_fs::remove_plugin_path(&plugin_path)?;
        }

        if !keep_data {
            let data_path = self.data_dir.join(id);
            if data_path.exists() {
                std::fs::remove_dir_all(&data_path).map_err(|e| e.to_string())?;
            }
        }

        self.registry.remove(id);
        Ok(())
    }
}

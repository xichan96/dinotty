#![allow(clippy::unwrap_used, clippy::expect_used)]
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::platform::fs as platform_fs;
use crate::session::SessionManager;

use super::helpers::{
    copy_dir_all, copy_plugin_dir, extract_tar_gz, resolve_binary, set_executable,
    validate_manifest, validate_min_app_version,
};
use super::types::{
    HostTarget, ManagedProcess, PluginInfo, PluginManifest, PluginStateValue, ProcessControl,
};

// ─── PluginManager ──────────────────────────────────────────────────────────

pub struct PluginManager {
    pub plugin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub registry: DashMap<String, PluginInfo>,
    pub processes: DashMap<String, DashMap<String, ManagedProcess>>,
    pub host_target: Option<HostTarget>,
    pub host_origin: String,
    pub host_version: String,
    pub host_mode: String,
}

pub type PluginManagerState = Arc<PluginManager>;

impl PluginManager {
    #[must_use]
    pub fn new(host_origin: String, host_version: String, host_mode: String) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            plugin_dir: home.join(".dinotty/plugins"),
            data_dir: home.join(".dinotty/plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
            host_target: HostTarget::current(),
            host_origin,
            host_version,
            host_mode,
        }
    }

    pub async fn kill_plugin_processes(&self, plugin_id: &str) {
        if let Some((_, proc_map)) = self.processes.remove(plugin_id) {
            let controls: Vec<_> = proc_map.iter().map(|entry| entry.control.clone()).collect();
            let mut waiters = Vec::with_capacity(controls.len());
            for control in controls {
                let (finished, wait) = tokio::sync::oneshot::channel();
                if control.send(ProcessControl::Stop { finished }).await.is_ok() {
                    waiters.push(wait);
                }
            }
            let _ = tokio::time::timeout(Duration::from_secs(16), async move {
                for wait in waiters {
                    let _ = wait.await;
                }
            })
            .await;
        }
    }

    pub async fn shutdown_all(&self) {
        let plugin_ids: Vec<String> =
            self.processes.iter().map(|entry| entry.key().clone()).collect();
        for plugin_id in plugin_ids {
            self.kill_plugin_processes(&plugin_id).await;
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

    pub fn scan(&self) {
        if !self.plugin_dir.exists() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(&self.plugin_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();

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
        self.registry.iter().map(|r| r.value().clone()).collect()
    }

    pub fn watch_changes(self: &Arc<Self>, manager: Arc<SessionManager>) {
        if !self.plugin_dir.exists() {
            return;
        }
        let plugin_dir = self.plugin_dir.clone();
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

                let debounce = tokio::time::sleep(Duration::from_millis(500));
                tokio::pin!(debounce);
                loop {
                    tokio::select! {
                        () = &mut debounce => break,
                        next = rx.recv() => {
                            if next.is_none() { return; }
                        }
                    }
                }

                let old_ids: Vec<String> = this.registry.iter().map(|e| e.key().clone()).collect();

                this.registry.clear();
                this.scan();

                let new_ids: Vec<String> = this.registry.iter().map(|e| e.key().clone()).collect();

                for id in &new_ids {
                    if old_ids.contains(id) {
                        manager.broadcast_plugin_changed(id.clone(), "updated".into());
                    } else {
                        manager.broadcast_plugin_changed(id.clone(), "added".into());
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
    ///
    /// # Panics
    /// Panics if `SystemTime::now()` fails (which should not happen).
    pub fn install(&self, archive: &[u8]) -> Result<PluginManifest, String> {
        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest_path = tmp.path().join("plugin.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|_| "plugin.json not found in archive".to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&content).map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        self.prepare_binary(tmp.path(), &manifest)?;

        let dest = self.plugin_dir.join(&manifest.id);
        if platform_fs::path_exists_or_symlink(&dest) {
            return Err(format!("plugin '{}' already installed, use update instead", manifest.id));
        }

        std::fs::create_dir_all(&self.plugin_dir).map_err(|e| e.to_string())?;
        std::fs::rename(tmp.path(), &dest).map_err(|e| e.to_string())?;

        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                ),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: false,
            },
        );

        Ok(manifest)
    }

    /// # Errors
    /// Returns `Err` if the manifest is invalid or the directory operations fail.
    ///
    /// # Panics
    /// Panics if `SystemTime::now()` fails (which should not happen).
    pub fn install_from_dir(
        &self,
        src: &std::path::Path,
        dev_link: bool,
    ) -> Result<PluginManifest, String> {
        let manifest_path = src.join("plugin.json");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|_| "plugin.json not found in directory".to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&content).map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        self.prepare_binary(src, &manifest)?;

        let dest = self.plugin_dir.join(&manifest.id);
        if platform_fs::path_exists_or_symlink(&dest) {
            return Err(format!("plugin '{}' already installed, use update instead", manifest.id));
        }

        std::fs::create_dir_all(&self.plugin_dir)
            .map_err(|e| format!("failed to create plugin directory: {e}"))?;

        if dev_link {
            platform_fs::create_dir_symlink(src, &dest)
                .map_err(|e| format!("failed to create development link: {e}"))?;
        } else {
            if let Err(error) = copy_plugin_dir(src, &dest) {
                let _ = platform_fs::remove_plugin_path(&dest);
                return Err(format!("failed to copy plugin files: {error}"));
            }
            if let Err(error) = self.prepare_binary(&dest, &manifest) {
                let _ = platform_fs::remove_plugin_path(&dest);
                return Err(format!("failed to validate copied plugin files: {error}"));
            }
        }

        self.registry.insert(
            manifest.id.clone(),
            PluginInfo {
                manifest: manifest.clone(),
                install_date: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs(),
                ),
                state: PluginStateValue::Active,
                error: None,
                is_dev_link: dev_link,
            },
        );

        Ok(manifest)
    }

    /// # Errors
    /// Returns `Err` if the plugin is not installed, the archive cannot be extracted,
    /// the manifest is invalid, or the directory operations fail.
    pub fn update(&self, id: &str, archive: &[u8]) -> Result<PluginManifest, String> {
        let old_info =
            self.registry.get(id).ok_or_else(|| format!("plugin '{id}' not installed"))?.clone();
        if old_info.is_dev_link {
            return Err(
                "cannot update a dev-link plugin; unlink it and install a packaged plugin instead"
                    .into(),
            );
        }

        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        extract_tar_gz(archive, tmp.path())?;

        let manifest: PluginManifest = serde_json::from_str(
            &std::fs::read_to_string(tmp.path().join("plugin.json"))
                .map_err(|_| "plugin.json not found".to_string())?,
        )
        .map_err(|e| format!("invalid plugin.json: {e}"))?;

        self.validate_for_host(&manifest)?;
        if manifest.id != id {
            return Err("plugin id in archive does not match".into());
        }
        self.prepare_binary(tmp.path(), &manifest)?;

        let plugin_path = self.plugin_dir.join(id);
        let backup = tempfile::tempdir().map_err(|e| e.to_string())?;
        if platform_fs::path_exists_or_symlink(&plugin_path) {
            copy_dir_all(&plugin_path, backup.path())?;
            platform_fs::remove_plugin_path(&plugin_path)?;
        }

        if let Err(e) = std::fs::rename(tmp.path(), &plugin_path) {
            if platform_fs::path_exists_or_symlink(&plugin_path) {
                let _ = platform_fs::remove_plugin_path(&plugin_path);
            }
            if backup.path().exists() {
                let _ = std::fs::rename(backup.path(), &plugin_path);
            }
            return Err(format!("failed to install update: {e}"));
        }

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
        self.kill_plugin_processes(id).await;

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

#[cfg(test)]
mod tests {
    use super::PluginManager;
    use crate::platform::fs as platform_fs;
    use dashmap::DashMap;
    use std::path::{Path, PathBuf};

    fn test_manager(root: &Path) -> PluginManager {
        PluginManager {
            plugin_dir: root.join("plugins"),
            data_dir: root.join("plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
            host_target: crate::plugin::HostTarget::current(),
            host_origin: "http://127.0.0.1:8999".into(),
            host_version: env!("CARGO_PKG_VERSION").into(),
            host_mode: "test".into(),
        }
    }

    fn write_plugin_source(root: &Path, id: &str) -> PathBuf {
        let src = root.join("src").join(id);
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("plugin.json"),
            format!(r#"{{"id":"{id}","name":"Test Plugin","version":"1.0.0"}}"#),
        )
        .unwrap();
        std::fs::write(src.join("source.txt"), "source stays").unwrap();
        src
    }

    fn unwrap_or_skip_symlink<T>(result: Result<T, String>) -> Option<T> {
        match result {
            Ok(value) => Some(value),
            Err(e) if e.contains("symlink failed") || e.contains("not supported") => {
                eprintln!("skipping symlink-dependent assertion: {e}");
                None
            }
            Err(e) => panic!("unexpected error: {e}"),
        }
    }

    fn create_broken_plugin_symlink_or_skip(
        plugin_dir: &Path,
        id: &str,
        root: &Path,
    ) -> Option<PathBuf> {
        let target = root.join("missing-target");
        let link = plugin_dir.join(id);
        std::fs::create_dir_all(plugin_dir).unwrap();
        std::fs::create_dir(&target).unwrap();
        unwrap_or_skip_symlink(platform_fs::create_dir_symlink(&target, &link))?;
        std::fs::remove_dir(&target).unwrap();
        Some(link)
    }

    // 验证 dev-link 安装后 registry 会标记 is_dev_link。
    #[test]
    fn install_from_dir_dev_link_marks_registry_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = test_manager(tmp.path());
        let src = write_plugin_source(tmp.path(), "dev-plugin");

        let Some(manifest) = unwrap_or_skip_symlink(manager.install_from_dir(&src, true)) else {
            return;
        };

        assert_eq!(manifest.id, "dev-plugin");
        assert!(manager.plugin_dir.join("dev-plugin").is_symlink());
        assert!(manager.registry.get("dev-plugin").unwrap().is_dev_link);
    }

    // 验证删除 dev-link 只移除插件目录中的链接，不删除源目录。
    #[tokio::test]
    async fn delete_dev_link_removes_link_without_removing_source() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = test_manager(tmp.path());
        let src = write_plugin_source(tmp.path(), "linked-plugin");

        if unwrap_or_skip_symlink(manager.install_from_dir(&src, true)).is_none() {
            return;
        }
        manager.delete("linked-plugin", true).await.unwrap();

        assert!(!platform_fs::path_exists_or_symlink(&manager.plugin_dir.join("linked-plugin")));
        assert!(src.join("plugin.json").is_file());
        assert!(src.join("source.txt").is_file());
        assert!(!manager.registry.contains_key("linked-plugin"));
    }

    // 验证扫描到 broken symlink 时会清理链接且不会加入 registry。
    #[test]
    fn scan_removes_broken_symlink_without_registry_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = test_manager(tmp.path());
        let Some(link) =
            create_broken_plugin_symlink_or_skip(&manager.plugin_dir, "broken-plugin", tmp.path())
        else {
            return;
        };

        manager.scan();

        assert!(!platform_fs::path_exists_or_symlink(&link));
        assert!(!manager.registry.contains_key("broken-plugin"));
    }

    // 验证已有 broken symlink 时 dev-link 安装会拒绝，避免状态不一致。
    #[test]
    fn install_from_dir_dev_link_rejects_existing_broken_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = test_manager(tmp.path());
        let src = write_plugin_source(tmp.path(), "stale-plugin");
        let Some(link) =
            create_broken_plugin_symlink_or_skip(&manager.plugin_dir, "stale-plugin", tmp.path())
        else {
            return;
        };

        let err = manager.install_from_dir(&src, true).unwrap_err();

        assert!(err.contains("already installed"), "unexpected error: {err}");
        assert!(platform_fs::path_exists_or_symlink(&link));
        assert!(src.join("plugin.json").is_file());
    }
}

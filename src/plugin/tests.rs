use super::manager::{collect_affected_plugin_ids, PluginManager};
use crate::platform::fs as platform_fs;
use crate::plugin::{
    ManagedProcess, PluginInfo, PluginManifest, PluginStateValue, ProcessInfo, ProcessState,
};
use dashmap::DashMap;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

fn test_manager(root: &Path) -> PluginManager {
    PluginManager {
        plugin_dir: root.join("plugins"),
        data_dir: root.join("plugin-data"),
        registry: DashMap::new(),
        processes: DashMap::new(),
        operation_locks: DashMap::new(),
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

fn register_plugin(manager: &PluginManager, id: &str) {
    manager.registry.insert(
        id.into(),
        PluginInfo {
            manifest: PluginManifest {
                id: id.into(),
                name: "Test Plugin".into(),
                version: "1.0.0".into(),
                min_app_version: None,
                description: None,
                icon: None,
                entry: None,
                bin: None,
                commands: None,
                styles: None,
                permissions: None,
                category: None,
                targets: None,
                show_in_toolbar: None,
                events: None,
            },
            install_date: None,
            state: PluginStateValue::Active,
            error: None,
            is_dev_link: false,
        },
    );
}

fn register_fake_process(
    manager: &PluginManager,
    plugin_id: &str,
    stop_timeout: Duration,
) -> tokio::sync::mpsc::Receiver<crate::plugin::ProcessControl> {
    let (control, receiver) = tokio::sync::mpsc::channel(1);
    manager.processes.entry(plugin_id.into()).or_insert_with(DashMap::new).insert(
        "42".into(),
        ManagedProcess {
            info: ProcessInfo {
                pid: 42,
                command: "test".into(),
                args: Vec::new(),
                state: ProcessState::Running,
                exit_code: None,
            },
            scope: crate::plugin::ProcessLifecycleScope::Ui,
            control,
            stop_timeout,
            stdout: Arc::new(tokio::sync::Mutex::new(VecDeque::new())),
            stderr: Arc::new(tokio::sync::Mutex::new(VecDeque::new())),
        },
    );
    receiver
}

#[test]
fn operation_locks_release_unknown_plugin_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let lock = manager.operation_lock("missing-one");
    assert!(manager.operation_locks.contains_key("missing-one"));
    drop(lock);

    let _next = manager.operation_lock("missing-two");
    assert!(!manager.operation_locks.contains_key("missing-one"));
    assert!(manager.operation_locks.contains_key("missing-two"));
}

#[test]
fn watcher_collects_only_plugins_named_by_event_paths() {
    let root = PathBuf::from("plugins");
    let staging = root.join(".staging");
    let event = notify::Event::new(notify::EventKind::Any)
        .add_path(root.join("plugin-a").join("main.js"))
        .add_path(staging.join("install-123").join("plugin.json"));
    let mut affected = HashSet::new();

    let needs_full_reload = collect_affected_plugin_ids(&root, &staging, &event, &mut affected);

    assert!(!needs_full_reload);
    assert_eq!(affected, HashSet::from(["plugin-a".to_string()]));
}

#[test]
fn watcher_falls_back_for_unmapped_or_root_events() {
    let root = PathBuf::from("plugins");
    let staging = root.join(".staging");
    for path in [root.clone(), PathBuf::from("external/plugin-a/main.js")] {
        let event = notify::Event::new(notify::EventKind::Any).add_path(path);
        let mut affected = HashSet::new();

        assert!(collect_affected_plugin_ids(&root, &staging, &event, &mut affected));
        assert!(affected.is_empty());
    }
}

#[tokio::test]
async fn folder_install_waits_for_the_plugin_operation_lock() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = Arc::new(test_manager(tmp.path()));
    let src = write_plugin_source(tmp.path(), "locked-plugin");
    let operation_lock = manager.operation_lock("locked-plugin");
    let operation = operation_lock.write_owned().await;

    let install_manager = Arc::clone(&manager);
    let mut install =
        tokio::spawn(async move { install_manager.install_from_dir(&src, false).await });
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut install).await.is_err(),
        "folder install committed without waiting for the operation lock"
    );

    drop(operation);
    let manifest = install.await.unwrap().unwrap();
    assert_eq!(manifest.id, "locked-plugin");
    assert!(manager.registry.contains_key("locked-plugin"));
    assert!(manager.plugin_dir.join("locked-plugin").is_dir());
}

#[test]
fn staged_replace_swaps_plugin_and_removes_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let installed = manager.plugin_dir.join("swap-plugin");
    std::fs::create_dir_all(&installed).unwrap();
    std::fs::write(installed.join("old.txt"), "old").unwrap();

    let staged = manager.staging_dir("test-swap-").unwrap();
    std::fs::write(staged.path().join("new.txt"), "new").unwrap();
    manager.replace_with_staged("swap-plugin", staged.path()).unwrap();

    assert!(!installed.join("old.txt").exists());
    assert_eq!(std::fs::read_to_string(installed.join("new.txt")).unwrap(), "new");
    assert!(std::fs::read_dir(manager.plugin_dir.join(".staging")).unwrap().next().is_none());
}

#[tokio::test]
async fn scoped_stop_does_not_signal_host_processes() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let mut control = register_fake_process(&manager, "host-plugin", Duration::from_millis(20));
    manager.processes.get("host-plugin").unwrap().get_mut("42").unwrap().scope =
        crate::plugin::ProcessLifecycleScope::Host;

    manager
        .kill_plugin_processes_with_scope(
            "host-plugin",
            Some(crate::plugin::ProcessLifecycleScope::Ui),
        )
        .await
        .unwrap();

    assert!(control.try_recv().is_err());
    assert!(manager.processes.get("host-plugin").unwrap().contains_key("42"));
}

#[tokio::test]
async fn invalid_update_does_not_stop_existing_process() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    register_plugin(&manager, "running-plugin");
    let mut control = register_fake_process(&manager, "running-plugin", Duration::from_millis(20));

    assert!(manager.update("running-plugin", b"not a tar archive").await.is_err());
    assert!(control.try_recv().is_err());
    assert!(manager.processes.get("running-plugin").unwrap().contains_key("42"));
}

#[tokio::test]
async fn stop_timeout_keeps_process_tracked() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let _control = register_fake_process(&manager, "stuck-plugin", Duration::from_millis(20));

    assert!(manager.kill_plugin_processes("stuck-plugin").await.is_err());

    assert!(manager.processes.get("stuck-plugin").unwrap().contains_key("42"));
}

#[tokio::test]
async fn acknowledged_stop_removes_process() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let mut control = register_fake_process(&manager, "clean-plugin", Duration::from_millis(100));
    tokio::spawn(async move {
        if let Some(crate::plugin::ProcessControl::Stop { finished }) = control.recv().await {
            let _ = finished.send(());
        }
    });

    manager.kill_plugin_processes("clean-plugin").await.unwrap();

    assert!(!manager.processes.get("clean-plugin").unwrap().contains_key("42"));
}

#[tokio::test]
async fn dropped_stop_acknowledgement_keeps_process_tracked() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let mut control = register_fake_process(&manager, "failed-plugin", Duration::from_millis(100));
    tokio::spawn(async move {
        if let Some(crate::plugin::ProcessControl::Stop { finished }) = control.recv().await {
            drop(finished);
        }
    });

    assert!(manager.kill_plugin_processes("failed-plugin").await.is_err());

    assert!(manager.processes.get("failed-plugin").unwrap().contains_key("42"));
}

#[tokio::test]
async fn full_stop_channel_keeps_process_tracked() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let _control = register_fake_process(&manager, "busy-plugin", Duration::from_millis(100));
    let sender = manager.processes.get("busy-plugin").unwrap().get("42").unwrap().control.clone();
    let (finished, _wait) = tokio::sync::oneshot::channel();
    sender.try_send(crate::plugin::ProcessControl::Stop { finished }).unwrap();

    assert!(manager.kill_plugin_processes("busy-plugin").await.is_err());

    assert!(manager.processes.get("busy-plugin").unwrap().contains_key("42"));
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
#[tokio::test]
async fn install_from_dir_dev_link_marks_registry_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let src = write_plugin_source(tmp.path(), "dev-plugin");

    let Some(manifest) = unwrap_or_skip_symlink(manager.install_from_dir(&src, true).await) else {
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

    if unwrap_or_skip_symlink(manager.install_from_dir(&src, true).await).is_none() {
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
#[tokio::test]
async fn install_from_dir_dev_link_rejects_existing_broken_symlink() {
    let tmp = tempfile::tempdir().unwrap();
    let manager = test_manager(tmp.path());
    let src = write_plugin_source(tmp.path(), "stale-plugin");
    let Some(link) =
        create_broken_plugin_symlink_or_skip(&manager.plugin_dir, "stale-plugin", tmp.path())
    else {
        return;
    };

    let err = manager.install_from_dir(&src, true).await.unwrap_err();

    assert!(err.contains("already installed"), "unexpected error: {err}");
    assert!(platform_fs::path_exists_or_symlink(&link));
    assert!(src.join("plugin.json").is_file());
}

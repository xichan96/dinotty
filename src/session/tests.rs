use super::*;
use portable_pty::{Child, ChildKiller, ExitStatus, NativePtySystem, PtySize, PtySystem};
use std::io;

use super::layout_tests::{leaf, split};

#[derive(Debug)]
struct TestChild;

impl ChildKiller for TestChild {
    fn kill(&mut self) -> io::Result<()> {
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self)
    }
}

impl Child for TestChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(None)
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        Ok(ExitStatus::with_exit_code(0))
    }

    fn process_id(&self) -> Option<u32> {
        None
    }

    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        None
    }
}

fn local_session_for_write_input() -> Arc<Session> {
    local_session_with_launch(crate::platform::shell::ShellLaunchKind::Native)
}

fn local_session_with_launch(
    shell_launch_kind: crate::platform::shell::ShellLaunchKind,
) -> Arc<Session> {
    let pair = NativePtySystem::default()
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .unwrap();
    drop(pair.slave);

    let (resize_tx, _resize_rx) = watch::channel(None);
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Local {
            writer: Box::new(io::sink()),
            master: pair.master,
            child: Box::new(TestChild),
        }),
        ssh_params: None,
        screen: Mutex::new(VirtualScreen::new(80, 24)),
        clients: Mutex::new(Vec::new()),
        next_client_id: AtomicU64::new(1),
        tauri_client_id: Mutex::new(None),
        input_tx: Mutex::new(None),
        status: Mutex::new(SessionStatus::Connected),
        is_connected: AtomicBool::new(true),
        size: Mutex::new((80, 24)),
        exited: Mutex::new(false),
        shell_type: "test".to_string(),
        tauri_on_exit: Mutex::new(None),
        shell_launch_kind,
        cwd_state: Mutex::new(CwdState {
            cwd: PathBuf::from("/"),
            host_cwd: Some(PathBuf::from("/")),
            sniff_buf: Vec::new(),
        }),
        sync: Mutex::new(SyncState::default()),
        sync_disable_hook: Mutex::new(None),
        resize_tx,
        ssh_cmd_tx: Mutex::new(None),
        ssh_handle: tokio::sync::Mutex::new(None),
        sftp_session: Mutex::new(None),
        remote_home: Mutex::new(None),
        remote_user: Mutex::new(None),
        output_tx,
        output_rx: Mutex::new(Some(output_rx)),
        pending_results: Mutex::new(Vec::new()),
    })
}

#[test]
fn kill_child_releases_local_backend_resources() {
    let session = local_session_for_write_input();

    session.kill_child();

    assert!(session.is_exited());
    assert!(matches!(
        *session.backend.try_lock().expect("backend lock remains available"),
        SessionBackend::Exited
    ));
}

/// Reproduction for PR #196: `write_input_sync` uses `try_lock` and reports
/// routine contention as a fatal error. The four long-lived writer tasks
/// treat any `Err` as fatal and `break`, so one unlucky moment kills the
/// keyboard for that pane permanently. This test pins the root cause:
/// when the backend lock is held (as happens every 200ms per pane during
/// child polling, and during resize), `write_input_sync` returns
/// `Err("backend lock held")`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_input_sync_errors_on_backend_contention() {
    let session = local_session_for_write_input();
    let _backend = session.backend.lock().await;

    let write_session = Arc::clone(&session);
    let result = tokio::task::spawn_blocking(move || write_session.write_input_sync(b"x"))
        .await
        .expect("spawn_blocking panicked");

    assert_eq!(result, Err("backend lock held".to_string()));
}

/// PR #196 fix: `write_input_blocking` uses `blocking_lock` so that routine
/// contention becomes a short wait instead of a fatal error. While the
/// backend lock is held, the call must NOT return within 50ms; once the
/// lock is released, it must complete with `Ok(())`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_input_blocking_waits_for_backend_lock() {
    let session = local_session_for_write_input();
    let backend = session.backend.lock().await;

    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let write_session = Arc::clone(&session);
    let mut writer = tokio::task::spawn_blocking(move || {
        let _ = started_tx.send(());
        write_session.write_input_blocking(b"blocking")
    });
    started_rx.await.unwrap();

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut writer).await.is_err(),
        "write_input_blocking returned while backend lock was held"
    );

    drop(backend);
    assert_eq!(writer.await.expect("spawn_blocking panicked"), Ok(()));
}

// ── SessionManager tab operations ───────────────────────────────

#[test]
fn insert_tab_and_list() {
    let manager = SessionManager::new();
    manager
        .insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1"), "active_pane_id": "p1"}));
    manager
        .insert_tab("t2".into(), serde_json::json!({"layout": leaf("p2"), "active_pane_id": "p2"}));

    // tab_layouts should have both
    assert!(manager.tab_layouts.contains_key("t1"));
    assert!(manager.tab_layouts.contains_key("t2"));

    // tab_order should have both in insertion order
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(*order, vec!["t1", "t2"]);
    drop(order);
}

#[test]
fn insert_tab_idempotent() {
    let manager = SessionManager::new();
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1")}));
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1-updated")}));

    // Should not have duplicate entries in order
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(order.len(), 1);
    drop(order);

    // Layout should be updated
    let val = manager.tab_layouts.get("t1").unwrap();
    assert_eq!(val.get("layout").unwrap().get("paneId").unwrap(), "p1-updated");
}

#[test]
fn remove_tab_cleans_up() {
    let manager = SessionManager::new();
    manager.insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1")}));
    manager.insert_tab("t2".into(), serde_json::json!({"layout": leaf("p2")}));
    manager.remove_tab("t1");

    assert!(!manager.tab_layouts.contains_key("t1"));
    let order = manager.tab_order.lock().unwrap();
    assert_eq!(*order, vec!["t2"]);
}

#[test]
fn remove_nonexistent_tab_no_panic() {
    let manager = SessionManager::new();
    manager.remove_tab("nonexistent"); // should not panic
}

// ── SessionManager::purge_pane_from_layouts ─────────────────────

#[test]
fn purge_pane_removes_from_layout() {
    let manager = SessionManager::new();
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": "p1",
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p2");
    assert!(emptied.is_empty()); // p1 still exists

    let val = manager.tab_layouts.get("t1").unwrap();
    let remaining = collect_leaf_pane_ids(val.get("layout").unwrap());
    assert_eq!(remaining, vec!["p1"]);
}

#[test]
fn purge_last_pane_marks_tab_empty() {
    let manager = SessionManager::new();
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
            "active_pane_id": "p1",
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p1");
    assert_eq!(emptied, vec!["t1"]);
    assert!(!manager.tab_layouts.contains_key("t1"));
}

#[test]
fn purge_pane_ignores_tab_matching_pane_id() {
    // tab_layouts key == pane_id means it's a pseudo-tab from orphan sessions
    let manager = SessionManager::new();
    manager.insert_tab(
        "p1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
        }),
    );

    let emptied = manager.purge_pane_from_layouts("p1");
    // The entry with key "p1" is skipped (tab_pane_id == pane_id guard)
    assert!(emptied.is_empty());
}

// ── SessionManager::broadcast_sync ──────────────────────────────

#[test]
fn broadcast_sync_delivers_to_clients() {
    let manager = SessionManager::new();
    let (id, mut rx) = manager.add_sync_client();
    assert!(!id.is_empty());

    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id: "p1".into() });

    let msg = rx.try_recv().unwrap();
    assert!(msg.contains("TabActivated") || msg.contains("tab_activated"));
}

#[test]
fn broadcast_sync_others_excludes_client() {
    let manager = SessionManager::new();
    let (id1, mut rx1) = manager.add_sync_client();
    let (_id2, mut rx2) = manager.add_sync_client();

    manager.broadcast_sync_others(&SyncMsg::TabActivated { pane_id: "p1".into() }, &id1);

    // id1 should NOT receive the message
    assert!(rx1.try_recv().is_err());
    // id2 SHOULD receive the message
    assert!(rx2.try_recv().is_ok());
}

#[test]
fn broadcast_sync_removes_closed_clients() {
    let manager = SessionManager::new();
    let (_id, rx) = manager.add_sync_client();
    drop(rx); // close the receiver

    manager.broadcast_sync(&SyncMsg::TabActivated { pane_id: "p1".into() });

    // Client should have been pruned
    let clients = manager.sync_clients.lock().unwrap();
    assert!(clients.is_empty());
}

// ── SessionManager::on_pty_exited ───────────────────────────────

#[test]
fn on_pty_exited_single_pane_removes_tab() {
    let manager = SessionManager::new();
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": leaf("p1"),
            "active_pane_id": "p1",
        }),
    );

    let result = manager.on_pty_exited("p1");
    assert_eq!(result, Some("t1".into()));
    assert!(!manager.tab_layouts.contains_key("t1"));
}

#[test]
fn on_pty_exited_multi_pane_updates_layout() {
    let manager = SessionManager::new();
    let layout = split("horizontal", vec![leaf("p1"), leaf("p2")]);
    manager.insert_tab(
        "t1".into(),
        serde_json::json!({
            "layout": layout,
            "active_pane_id": "p1",
        }),
    );

    let result = manager.on_pty_exited("p2");
    assert!(result.is_none()); // tab still exists

    let val = manager.tab_layouts.get("t1").unwrap();
    let remaining = collect_leaf_pane_ids(val.get("layout").unwrap());
    assert_eq!(remaining, vec!["p1"]);
}

#[test]
fn on_pty_exited_unknown_pane_returns_none() {
    let manager = SessionManager::new();
    assert!(manager.on_pty_exited("nonexistent").is_none());
}

// ── Tab list operations ────────────────────────────────────────────

#[test]
fn tab_list_prunes_stale_tabs() {
    let manager = SessionManager::new();
    // Insert tab without a matching session - tab_list should prune it
    manager
        .insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1"), "active_pane_id": "p1"}));
    let (tabs, _) = manager.tab_list();
    assert!(tabs.is_empty(), "tab without session should be pruned");
}

#[test]
fn tab_list_returns_empty_for_no_tabs() {
    let manager = SessionManager::new();
    let (tabs, active) = manager.tab_list();
    assert!(tabs.is_empty());
    assert!(active.is_none());
}

#[test]
fn tab_list_restores_ssh_workspace_assignment_from_session() {
    let manager = SessionManager::new();
    let mut session = local_session_for_write_input();
    Arc::get_mut(&mut session).unwrap().ssh_params = Some(SshSessionParams {
        host: "example.test".into(),
        port: 22,
        username: "user".into(),
        auth_method: crate::settings::SshAuthMethod::default(),
        default_command: None,
        profile_id: Some("shared-profile".into()),
        workspace_id: Some("workspace-b".into()),
        initial_cwd: Some("/srv/b".into()),
    });
    manager.sessions.insert("p1".into(), session);
    manager
        .insert_tab("t1".into(), serde_json::json!({"layout": leaf("p1"), "active_pane_id": "p1"}));

    let (tabs, _) = manager.tab_list();

    assert_eq!(tabs.len(), 1);
    assert_eq!(tabs[0].connection_id.as_deref(), Some("shared-profile"));
    assert_eq!(tabs[0].workspace_id.as_deref(), Some("workspace-b"));
}

// ── CWD state tracking ─────────────────────────────────────────────

#[test]
fn wsl_output_does_not_replace_host_cwd_with_guest_path() {
    let session = local_session_with_launch(crate::platform::shell::ShellLaunchKind::Wsl {
        distro: Some("Ubuntu".to_string()),
    });

    session.on_pty_output(b"\x1b]0;user@host:/home/user/project\x07");

    assert_eq!(session.host_cwd(), Some(PathBuf::from("/")));
    let state = session.cwd_state.lock().unwrap();
    assert!(state.sniff_buf.is_empty());
}

#[test]
fn tab_created_serializes_explicit_workspace_assignment() {
    let msg = SyncMsg::TabCreated {
        tab_id: "tab-1".into(),
        pane_id: "pane-1".into(),
        layout: None,
        cwd: None,
        connection_id: Some("shared-profile".into()),
        workspace_id: Some("workspace-b".into()),
    };

    let value = serde_json::to_value(msg).unwrap();

    assert_eq!(value["workspace_id"], "workspace-b");
}

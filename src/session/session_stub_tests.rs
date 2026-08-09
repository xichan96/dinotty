/// Session regressions that use a stub with `SessionBackend::Exited` to avoid
/// spawning a real PTY/child process.
use super::*;
use crate::notification::NotificationBroadcast;
use std::sync::atomic::AtomicU64;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

fn stub_session() -> Arc<Session> {
    let (resize_tx, _resize_rx) = watch::channel(None);
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Exited),
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
        shell_launch_kind: crate::platform::shell::ShellLaunchKind::Native,
        tauri_on_exit: Mutex::new(None),
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

fn add_ready_client(session: &Session) -> mpsc::Receiver<SessionClientEvent> {
    let (client_id, rx) = session.add_client();
    let clients = session.clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    clients
        .iter()
        .find(|client| client.id == client_id)
        .expect("newly added client must exist")
        .snapshot_pending
        .store(false, Ordering::Relaxed);
    rx
}

fn assert_output(event: SessionClientEvent, expected: &str) {
    match event {
        SessionClientEvent::Output(output) => assert_eq!(output, expected),
        _ => panic!("expected Output event"),
    }
}

#[test]
fn layoutless_session_registration_adds_terminal_leaf_and_broadcasts() {
    let manager = SessionManager::new();
    let pane_id = "fallback-pane";
    let session = stub_session();
    manager.insert_session(pane_id, Arc::clone(&session));
    let (_client_id, mut rx) = manager.add_sync_client();

    assert!(manager.register_singleton_tab(pane_id, &session, &session.shell_type));

    let tab = manager.tab_layouts.get(pane_id).expect("singleton tab must be registered");
    let layout = tab.get("layout").expect("singleton tab must contain a layout");
    assert_eq!(collect_terminal_leaf_pane_ids(layout), vec![pane_id]);
    assert_eq!(first_leaf_id(layout).as_deref(), Some(pane_id));
    drop(tab);

    let created: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("tab_created must be broadcast")).unwrap();
    assert_eq!(created["type"], "tab_created");
    assert_eq!(created["tab_id"], pane_id);
    assert_eq!(created["pane_id"], pane_id);

    assert!(
        !manager.register_singleton_tab(pane_id, &session, &session.shell_type),
        "an existing terminal-leaf reference must not be duplicated"
    );
    assert!(rx.try_recv().is_err(), "no duplicate tab_created should be broadcast");

    assert!(manager.remove_tab(pane_id));
    assert!(
        manager.register_singleton_tab(pane_id, &session, &session.shell_type),
        "a live session missing its terminal-leaf reference must be repaired"
    );
    let repaired: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("repair must broadcast tab_created")).unwrap();
    assert_eq!(repaired["type"], "tab_created");
}

#[test]
fn close_session_removes_singleton_tab_without_ghost() {
    let manager = SessionManager::new();
    let pane_id = "fallback-pane";
    let session = stub_session();
    manager.insert_session(pane_id, Arc::clone(&session));
    let (_client_id, mut rx) = manager.add_sync_client();
    assert!(manager.register_singleton_tab(pane_id, &session, &session.shell_type));
    let _created = rx.try_recv().expect("tab_created must be broadcast");

    assert!(manager.close_session(pane_id, CloseReason::NaturalExit, false, Some(0)));
    assert!(!manager.sessions.contains_key(pane_id));
    assert!(!manager.tab_layouts.contains_key(pane_id));
    assert!(!manager
        .tab_order
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .any(|tab_id| tab_id == pane_id));

    let closed: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("tab_closed must be broadcast")).unwrap();
    assert_eq!(closed["type"], "tab_closed");
    assert_eq!(closed["pane_id"], pane_id);
    assert!(rx.try_recv().is_err(), "no ghost-tab layout update should follow closure");
}

#[test]
fn reap_claim_removes_exact_detached_generation_under_lifecycle() {
    let manager = SessionManager::new();
    let pane_id = "reap-pane";
    let session = stub_session();
    assert!(manager.insert_session(pane_id, Arc::clone(&session)));
    session.set_status(SessionStatus::Detached { since: std::time::Instant::now() });
    let since = std::time::Instant::now()
        .checked_sub(Duration::from_secs(61))
        .expect("Instant can subtract 61s within monotonic range");
    manager.age_unowned_for_test(pane_id, since);

    assert!(manager.try_reap_session_for_test(pane_id, &session, since + Duration::from_secs(61)));
    assert!(!manager.sessions.contains_key(pane_id));
}

#[test]
fn layout_only_close_prunes_non_terminal_leaves_and_broadcasts() {
    let manager = SessionManager::new();
    let tab_id = "tools-tab";
    manager.update_layout(
        tab_id.to_string(),
        serde_json::json!({
            "layout": {
                "type": "split",
                "direction": "horizontal",
                "children": [
                    {"type": "leaf", "paneId": "plugin-pane", "kind": "plugin"},
                    {"type": "leaf", "paneId": "web-pane", "kind": "web"}
                ]
            },
            "active_pane_id": "plugin-pane"
        }),
        Some("plugin-pane".to_string()),
    );
    let (_client_id, mut rx) = manager.add_sync_client();

    assert!(manager.close_pane("plugin-pane"));
    let updated: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("layout_updated must be broadcast")).unwrap();
    assert_eq!(updated["type"], "layout_updated");
    assert_eq!(updated["pane_id"], tab_id);
    assert_eq!(updated["active_pane_id"], "web-pane");
    assert_eq!(
        manager.active_pane_id.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_deref(),
        None
    );

    assert!(manager.close_pane("web-pane"));
    let closed: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("tab_closed must be broadcast")).unwrap();
    assert_eq!(closed["type"], "tab_closed");
    assert_eq!(closed["pane_id"], tab_id);
    assert!(!manager.tab_layouts.contains_key(tab_id));
}

#[test]
fn stale_generation_cannot_replace_or_close_current_session() {
    let manager = Arc::new(SessionManager::new());
    let pane_id = "generation-pane";
    let current = stub_session();
    let stale = stub_session();
    let reservation = manager.reserve_session(pane_id).unwrap();
    assert!(manager.reserve_session(pane_id).is_err());
    assert!(!manager.insert_session(pane_id, Arc::clone(&stale)));
    assert!(reservation.publish(Arc::clone(&current)));
    assert!(!manager.insert_session(pane_id, Arc::clone(&stale)));

    assert!(!manager.close_session_for_session(
        pane_id,
        &stale,
        CloseReason::NaturalExit,
        false,
        Some(0)
    ));
    assert!(manager
        .sessions
        .get(pane_id)
        .is_some_and(|session| Arc::ptr_eq(session.value(), &current)));
}

#[test]
fn flush_sync_buffer_preserves_multibyte_across_chunk_boundary() {
    let session = stub_session();
    let mut rx = add_ready_client(&session);

    // 65535 'a's + `界` (3 bytes) + "tail" = 65542 bytes.
    // FLUSH_CHUNK_SIZE (65536) splits `界` mid-character.
    let input = format!("{}界tail", "a".repeat(FLUSH_CHUNK_SIZE - 1));
    {
        let mut sync = session.sync.lock().unwrap();
        sync.buffer.push(input.clone());
        sync.bytes += input.len();
    }

    session.flush_sync_buffer();

    let received: String = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|event| match event {
            SessionClientEvent::Output(data) => Some(data),
            _ => None,
        })
        .collect();
    assert!(!received.contains('\u{FFFD}'), "flushed output contains U+FFFD replacement character");
    assert_eq!(received, input);
}

#[test]
fn sync_wire_order_is_begin_buffer_end_live() {
    let session = stub_session();
    let mut rx = add_ready_client(&session);

    session.set_sync_mode(true);
    session.broadcast("BUF");
    session.set_sync_mode(false);
    session.broadcast("LIVE");

    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncBegin)));
    assert_output(rx.try_recv().expect("buffered output"), "BUF");
    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncEnd)));
    assert_output(rx.try_recv().expect("live output"), "LIVE");
    assert!(matches!(rx.try_recv(), Err(mpsc::error::TryRecvError::Empty)));
}

#[test]
fn sync_teardown_blocks_concurrent_broadcast_until_after_sync_end() {
    let session = stub_session();
    let mut rx = add_ready_client(&session);
    session.set_sync_mode(true);
    session.broadcast("BUF");

    let weak_session = Arc::downgrade(&session);
    let (started_tx, started_rx) = std_mpsc::channel();
    let (finished_tx, finished_rx) = std_mpsc::channel();
    let thread_handle = Arc::new(Mutex::new(None));
    let hook_thread_handle = Arc::clone(&thread_handle);
    *session.sync_disable_hook.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some(Box::new(move || {
            let broadcast_session = weak_session.upgrade().expect("session remains alive");
            let handle = std::thread::spawn(move || {
                started_tx.send(()).expect("teardown hook remains alive");
                broadcast_session.broadcast("LIVE");
                let _ = finished_tx.send(());
            });
            *hook_thread_handle.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(handle);

            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("concurrent broadcaster must start");
            assert!(
                matches!(
                    finished_rx.recv_timeout(Duration::from_millis(100)),
                    Err(std_mpsc::RecvTimeoutError::Timeout)
                ),
                "concurrent broadcast passed the sync guard before teardown completed"
            );
        }));

    session.set_sync_mode(false);
    thread_handle
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
        .expect("hook spawned broadcaster")
        .join()
        .expect("concurrent broadcaster completed");

    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncBegin)));
    assert_output(rx.try_recv().expect("buffered output"), "BUF");
    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncEnd)));
    assert_output(rx.try_recv().expect("live output"), "LIVE");
    assert!(matches!(rx.try_recv(), Err(mpsc::error::TryRecvError::Empty)));
}

#[test]
fn double_sync_disable_emits_exactly_one_sync_end() {
    let session = stub_session();
    let mut rx = add_ready_client(&session);

    session.set_sync_mode(true);
    session.set_sync_mode(false);
    session.set_sync_mode(false);

    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncBegin)));
    assert!(matches!(rx.try_recv(), Ok(SessionClientEvent::SyncEnd)));
    assert!(matches!(rx.try_recv(), Err(mpsc::error::TryRecvError::Empty)));
}

#[tokio::test]
async fn kill_and_remove_notifies_attention_ledger_with_a_single_removal_delta() {
    let manager = Arc::new(SessionManager::new());
    let notifier = Arc::new(NotificationBroadcast::new(
        Arc::clone(&manager.sync_clients),
        manager.event_bus.clone(),
    ));
    manager.register_notifier(Arc::clone(&notifier));

    let pane_id = "stub-pane";
    manager.insert_session(pane_id, stub_session());
    // Seed the ledger with an event for the pane so pane_closed produces a removal delta.
    notifier.send_bell(pane_id);

    let (client_id, mut rx) = manager.add_sync_client();
    notifier.register_client(&client_id);
    // Drain the initial snapshot so the next message we read is the removal delta.
    let snapshot_msg = rx.recv().await.expect("snapshot must arrive on register");
    let snapshot_value: serde_json::Value = serde_json::from_str(&snapshot_msg).unwrap();
    assert_eq!(snapshot_value["type"], "snapshot");

    assert!(manager.kill_and_remove(pane_id));

    let msg = rx.recv().await.expect("removal delta must be broadcast");
    let delta_value: serde_json::Value = serde_json::from_str(&msg).unwrap();
    assert_eq!(
        delta_value["type"], "state_delta",
        "expected exactly one removal delta, got {delta_value:?}"
    );
    let panes = delta_value["panes"].as_array().expect("panes array");
    assert!(
        panes.iter().any(|p| p["paneId"] == pane_id && p["removed"] == true),
        "expected a removal delta for {pane_id}, got {panes:?}"
    );
    // Unified close also emits the layoutless TabClosed fallback, but the
    // attention ledger still emits exactly one removal delta.
    let tab_closed: serde_json::Value =
        serde_json::from_str(&rx.try_recv().expect("tab_closed must follow")).unwrap();
    assert_eq!(tab_closed["type"], "tab_closed");
    assert!(rx.try_recv().is_err(), "no further messages expected after the removal delta");
}

//! Shared test fixtures: stub sessions that avoid spawning real PTYs.
use super::*;
use std::sync::atomic::AtomicU64;

pub(crate) fn stub_session() -> Arc<Session> {
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

/// Add a client whose snapshot replay already completed (`snapshot_pending`
/// cleared), so `broadcast()` delivers live output to it immediately.
pub(crate) fn add_ready_client(session: &Session) -> (u64, mpsc::Receiver<SessionClientEvent>) {
    let (client_id, rx) = session.add_client();
    let clients = session.clients.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    clients
        .iter()
        .find(|client| client.id == client_id)
        .expect("newly added client must exist")
        .snapshot_pending
        .store(false, Ordering::Relaxed);
    (client_id, rx)
}

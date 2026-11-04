//! Shared test fixtures: stub sessions that avoid spawning real PTYs.
use super::*;
use std::sync::atomic::AtomicU64;

pub(crate) fn stub_session() -> Arc<Session> {
    stub_session_impl(PathBuf::from("/"), None)
}

/// Stub session whose workspace root is `cwd` (local, no PTY).
pub(crate) fn stub_session_with_cwd(cwd: PathBuf) -> Arc<Session> {
    stub_session_impl(cwd, None)
}

/// Stub SSH session. `workspace_root` only matters for tests that inspect the
/// remote cwd; viewer resolution must reject SSH before touching it.
pub(crate) fn stub_ssh_session() -> Arc<Session> {
    let ssh_params = SshSessionParams {
        host: "example.invalid".into(),
        port: 22,
        username: "tester".into(),
        auth_method: crate::settings::SshAuthMethod::default(),
        default_command: None,
        profile_id: None,
        workspace_id: None,
        initial_cwd: None,
    };
    stub_session_impl(PathBuf::from("/"), Some(ssh_params))
}

fn stub_session_impl(cwd: PathBuf, ssh_params: Option<SshSessionParams>) -> Arc<Session> {
    let (resize_tx, _resize_rx) = watch::channel(None);
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Exited),
        ssh_params,
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
            cwd: cwd.clone(),
            host_cwd: Some(cwd),
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

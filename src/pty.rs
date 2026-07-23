#![allow(clippy::too_many_lines)]
use crate::event_bus::BusEvent;
use crate::platform::shell;
use crate::session::{
    CloseReason, Session, SessionBackend, SessionManager, SessionStatus, SyncMsg, SyncState,
};
use crate::vt_screen::VirtualScreen;
use portable_pty::{Child, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};

struct PendingSpawn<'a> {
    child: Option<Box<dyn Child + Send + Sync>>,
    pane_id: &'a str,
    pid: Option<u32>,
    pgid: Option<u32>,
    armed: bool,
}

impl<'a> PendingSpawn<'a> {
    fn new(child: Box<dyn Child + Send + Sync>, pane_id: &'a str) -> Self {
        let process_id = child.process_id();
        let process_group = process_id.and_then(crate::session::ledger::process_group_id);
        Self { child: Some(child), pane_id, pid: process_id, pgid: process_group, armed: true }
    }

    fn take_child(&mut self) -> Result<Box<dyn Child + Send + Sync>, String> {
        self.child.take().ok_or_else(|| "pending spawn child is missing".to_string())
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingSpawn<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }

        warn!(pane_id = self.pane_id, pid = ?self.pid, "Rolling back unregistered PTY spawn");
        #[cfg(unix)]
        if let Some(pgid) = self.pgid.and_then(|pgid| i32::try_from(pgid).ok()) {
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
        if let Some(child) = &mut self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Err(error) = crate::session::ledger::remove_entry(self.pane_id) {
            warn!(pane_id = self.pane_id, %error, "Failed to remove rolled-back spawn from PID ledger");
        }
    }
}

/// Broadcast task: 转发 PTY/SSH 输出到所有客户端
/// 与传输无关，可被 Local 和 SSH 后端共用
pub async fn broadcast_task(session: Arc<Session>, pane_id: String, manager: Arc<SessionManager>) {
    info!("Broadcast task started, pane={}", pane_id);
    let Some(mut output_rx) =
        session.output_rx.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
    else {
        error!("Broadcast task: output_rx already taken, pane={}", pane_id);
        return;
    };

    let sync_timeout = std::time::Duration::from_millis(500);
    let mut sync_started_at: Option<std::time::Instant> = None;
    let mut utf8_tail: Vec<u8> = Vec::new();

    // Watchdog timer: force-flush the sync buffer if the PTY goes silent
    // mid-sync-mode. Without this, the timeout check below only fires when
    // output_rx.recv() returns a new message — a silent PTY (e.g. Claude
    // Code waiting on an API response mid-redraw) leaves sync mode active
    // forever, buffering all subsequent output and freezing the client
    // until a manual refresh. Polling every 100ms is cheap and well below
    // the 500ms timeout threshold.
    let mut sync_watch = tokio::time::interval(std::time::Duration::from_millis(100));
    sync_watch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // Discard the immediate first tick so we don't check before any PTY
    // output has had a chance to arrive.
    let _ = sync_watch.tick().await;

    loop {
        tokio::select! {
            msg = output_rx.recv() => {
                let Some(first) = msg else { break };
                if session.is_exited() {
                    break;
                }

                let mut batch = first;
                while let Ok(data) = output_rx.try_recv() {
                    batch.extend_from_slice(&data);
                }

                if session.is_sync_active() {
                    if let Some(started) = sync_started_at {
                        if started.elapsed() > sync_timeout {
                            tracing::warn!(
                                "Sync mode timeout ({}ms), force-flushing, pane={}",
                                started.elapsed().as_millis(),
                                pane_id
                            );
                            session.set_sync_mode(false);
                            sync_started_at = None;
                        }
                    } else {
                        sync_started_at = Some(std::time::Instant::now());
                    }
                } else {
                    sync_started_at = None;
                }

                let results: Vec<crate::session::PendingCommandResult> = {
                    let mut pending = session
                        .pending_results
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    std::mem::take(&mut *pending)
                };
                for result in results {
                    manager.event_bus.publish(BusEvent::CommandFinished {
                        pane_id: pane_id.clone(),
                        command: String::new(),
                        exit_code: result.exit_code,
                        duration_ms: result.duration_ms,
                        stdout: result.stdout,
                        method: result.method.clone(),
                    });
                    manager.broadcast_sync(&SyncMsg::CommandFinished {
                        pane_id: pane_id.clone(),
                        command: String::new(),
                        exit_code: result.exit_code,
                        duration_ms: result.duration_ms,
                        stdout: String::new(),
                        method: result.method,
                    });
                }

                utf8_tail.extend_from_slice(&batch);
                let valid_up_to = match std::str::from_utf8(&utf8_tail) {
                    Ok(s) => {
                        session.broadcast(s);
                        utf8_tail.clear();
                        continue;
                    }
                    Err(e) => e.valid_up_to(),
                };
                if valid_up_to > 0 {
                    let s = unsafe { std::str::from_utf8_unchecked(&utf8_tail[..valid_up_to]) };
                    session.broadcast(s);
                }
                utf8_tail.drain(..valid_up_to);
                if utf8_tail.len() > 3 {
                    session.broadcast("\u{FFFD}");
                    utf8_tail.clear();
                }
            }
            _ = sync_watch.tick() => {
                if session.is_exited() {
                    break;
                }
                // PTY-silent watchdog: if sync mode is still active past the
                // timeout with no new output, force-flush so the client
                // unblocks. This is the path that was missing before.
                if session.is_sync_active() {
                    if let Some(started) = sync_started_at {
                        if started.elapsed() > sync_timeout {
                            tracing::warn!(
                                "Sync mode timeout ({}ms, PTY silent), force-flushing, pane={}",
                                started.elapsed().as_millis(),
                                pane_id
                            );
                            session.set_sync_mode(false);
                            sync_started_at = None;
                        }
                    }
                } else {
                    sync_started_at = None;
                }
            }
        }
    }
    info!("Broadcast task exited, pane={}", pane_id);
}

fn cleanup_exited_pty_session(
    _session: &Arc<Session>,
    pane_id: &str,
    manager: &Arc<SessionManager>,
    exit_code: Option<i32>,
) {
    manager.close_session(pane_id, CloseReason::NaturalExit, false, exit_code);
}

fn notify_url_for(port: u16) -> Option<String> {
    (port != 0).then(|| format!("http://127.0.0.1:{port}"))
}

/// Create a new PTY session and register it with the session manager.
///
/// # Errors
/// Returns `Err` if the PTY cannot be opened, the shell cannot be spawned,
/// or the reader/writer cannot be obtained.
///
/// # Panics
/// Panics if the internal mutex is poisoned in the PTY reader task.
pub fn create_session(
    manager: &Arc<SessionManager>,
    pane_id: &str,
    tab_id: Option<&str>,
    tauri_on_exit: Option<Arc<dyn Fn(String, Option<i32>) + Send + Sync>>,
    cwd: Option<PathBuf>,
    argv: Option<Vec<String>>,
) -> Result<(Arc<Session>, String), String> {
    if argv.as_ref().is_some_and(Vec::is_empty) {
        return Err("argv must be non-empty when provided".to_string());
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    #[allow(clippy::single_match_else)]
    let (mut cmd, shell_type) = match argv {
        Some(argv) => {
            let mut cmd = CommandBuilder::new(&argv[0]);
            cmd.args(&argv[1..]);
            (cmd, "command".to_string())
        }
        None => {
            let shell_spec = shell::default_shell();
            let mut cmd = CommandBuilder::new(&shell_spec.program);
            cmd.args(&shell_spec.args);
            (cmd, shell_spec.shell_type.clone())
        }
    };
    for key in claude_session_env_keys_to_strip() {
        cmd.env_remove(&key);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("DINOTTY_PANE_ID", pane_id);
    cmd.env(
        "DINOTTY_INSTANCE",
        option_env!("DINOTTY_CONFIG_SUFFIX").filter(|suffix| !suffix.is_empty()).unwrap_or("prod"),
    );
    cmd.env_remove("DINOTTY_URL");
    if let Some(url) = notify_url_for(manager.notify_port()) {
        cmd.env("DINOTTY_URL", url);
    }
    if let Some(tid) = tab_id {
        cmd.env("DINOTTY_TAB_ID", tid);
    }
    configure_utf8_locale(&mut cmd);

    let home_path = shell::home_dir();

    let effective_cwd = cwd.filter(|p| p.is_dir()).unwrap_or_else(|| home_path.clone());
    cmd.cwd(&effective_cwd);

    // Shell-specific hooks depend on HOME-style prompt expansion.
    if matches!(shell_type.as_str(), "zsh" | "bash") {
        let home =
            std::env::var("HOME").unwrap_or_else(|_| home_path.to_string_lossy().into_owned());
        if std::env::var_os("HOME").is_none() {
            cmd.env("HOME", &home);
        }
        match shell_type.as_str() {
            "zsh" => {
                if let Some(zdotdir) = setup_zsh_title_hooks(&home) {
                    cmd.env("ZDOTDIR", &zdotdir);
                }
            }
            "bash" => {
                cmd.env(
                    "PROMPT_COMMAND",
                    r#"history -a; history -r; printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD/#$HOME/~}"; printf "\033]133;A\033\\"; printf "\033]133;D;%d\033\\" $?"#,
                );
                // Inject preexec-like trap for command start detection
                cmd.env("BASH_ENV", r#"trap 'printf "\033]133;B\033\\"' DEBUG"#);
            }
            _ => {}
        }
    }

    let home_for_cwd = effective_cwd;

    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn shell: {e}"))?;
    let mut pending_spawn = PendingSpawn::new(child, pane_id);
    drop(pair.slave);

    if let Some((pid, pgid, proc_start_time)) = pending_spawn.pid.and_then(|pid| {
        Some((pid, pending_spawn.pgid?, crate::session::ledger::process_start_time(pid)?))
    }) {
        if let Err(error) = crate::session::ledger::add_entry(pane_id, pid, pgid, proc_start_time) {
            warn!(pane_id, pid, pgid, %error, "Failed to add spawned PTY to PID ledger; continuing without crash recovery");
        }
    } else {
        warn!(pane_id, pid = ?pending_spawn.pid, "Failed to identify spawned PTY; continuing without crash recovery");
    }

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Strip the \\?\ verbatim prefix that std::canonicalize adds on Windows.
    // PowerShell renders verbatim paths as `Microsoft.PowerShell.Core\FileSystem::\\?\D:\...`
    // which breaks tools that parse $PWD (e.g. pi agent). dunce::simplified is a
    // no-op on non-Windows.
    let initial_cwd =
        dunce::simplified(&home_for_cwd.canonicalize().unwrap_or_else(|_| home_for_cwd.clone()))
            .to_path_buf();
    let (resize_tx, resize_rx) = tokio::sync::watch::channel(None);
    let (output_tx, output_rx) = tokio::sync::mpsc::unbounded_channel();
    let registered_child = pending_spawn.take_child()?;

    let session = Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Local {
            writer,
            master: pair.master,
            child: registered_child,
        }),
        ssh_params: None,
        screen: std::sync::Mutex::new(VirtualScreen::new(80, 24)),
        clients: std::sync::Mutex::new(Vec::new()),
        next_client_id: std::sync::atomic::AtomicU64::new(1),
        tauri_client_id: std::sync::Mutex::new(None),
        input_tx: std::sync::Mutex::new(None),
        status: std::sync::Mutex::new(SessionStatus::Connected),
        size: std::sync::Mutex::new((80, 24)),
        exited: std::sync::Mutex::new(false),
        shell_type: shell_type.clone(),
        tauri_on_exit: std::sync::Mutex::new(tauri_on_exit),
        cwd_state: std::sync::Mutex::new(crate::session::CwdState {
            cwd: initial_cwd,
            sniff_buf: Vec::new(),
        }),
        sync: std::sync::Mutex::new(SyncState::default()),
        #[cfg(test)]
        sync_disable_hook: std::sync::Mutex::new(None),
        resize_tx,
        ssh_cmd_tx: std::sync::Mutex::new(None),
        ssh_handle: tokio::sync::Mutex::new(None),
        sftp_session: std::sync::Mutex::new(None),
        remote_home: std::sync::Mutex::new(None),
        remote_user: std::sync::Mutex::new(None),
        output_tx,
        output_rx: std::sync::Mutex::new(Some(output_rx)),
        pending_results: std::sync::Mutex::new(Vec::new()),
    });
    manager.insert_session(pane_id.to_string(), Arc::clone(&session));
    pending_spawn.disarm();

    // Spawn resize debounce task: waits 25ms after last change, then applies.
    // The actual resize runs in spawn_blocking to avoid blocking the tokio worker
    // thread when the screen mutex is held by the PTY reader's feed() call.
    {
        let session_weak = Arc::downgrade(&session);
        tokio::spawn(async move {
            let mut rx = resize_rx;
            loop {
                if rx.changed().await.is_err() {
                    break;
                }
                let pending = *rx.borrow_and_update();
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                let latest = *rx.borrow();
                if latest == pending {
                    if let Some((origin, cols, rows)) = pending {
                        if let Some(session) = session_weak.upgrade() {
                            let _ = tokio::task::spawn_blocking(move || {
                                session.apply_and_broadcast_resize(origin, cols, rows);
                            })
                            .await;
                        } else {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Publish session created event
    manager.event_bus.publish(BusEvent::SessionCreated {
        pane_id: pane_id.to_string(),
        shell_type: shell_type.clone(),
    });

    let session_clone = Arc::clone(&session);
    let pane_id_clone = pane_id.to_string();
    let manager_clone = Arc::clone(manager);

    // ── PTY reader: reads bytes, feeds VTE, extracts results, notifies ──
    // Same architecture as mainstream terminals (Alacritty, Kitty, iTerm2):
    // the reader thread parses directly into screen state. No intermediate channel.
    // The broadcast task reads the latest screen state at its own pace.
    let reader_session = Arc::clone(&session);
    let reader_pane = pane_id.to_string();
    let reader_manager = Arc::clone(manager);
    tokio::task::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = vec![0u8; 65536]; // 64KB — fewer read() syscalls
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    info!("PTY reader: EOF, pane={}", reader_pane);
                    break;
                }
                Err(e) => {
                    error!("PTY reader: read error: {:?}, pane={}", e, reader_pane);
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];

                    // CWD sniffing (before lock, uses its own cwd_state lock)
                    reader_session.on_pty_output(data);

                    // Feed to virtual screen + extract command results + collect sync events
                    let feed_result = {
                        let mut screen = reader_session
                            .screen
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            screen.feed(data);
                            let results = screen.drain_command_results();
                            let outputs: Vec<String> =
                                (0..results.len()).map(|_| screen.take_command_output()).collect();
                            let sync = screen.drain_sync_events();
                            (results.into_iter().zip(outputs).collect::<Vec<_>>(), sync)
                        }))
                    };
                    match feed_result {
                        Ok((command_results, sync_events)) => {
                            // Apply sync transitions before publishing this read to output_tx.
                            // The broadcast task cannot observe these bytes until send() below.
                            for event in sync_events {
                                match event {
                                    crate::vt_screen::SyncEvent::Start => {
                                        reader_session.set_sync_mode(true);
                                    }
                                    crate::vt_screen::SyncEvent::Stop => {
                                        reader_session.set_sync_mode(false);
                                    }
                                }
                            }
                            // Queue command results for broadcast task
                            if !command_results.is_empty() {
                                let mut pending = reader_session
                                    .pending_results
                                    .lock()
                                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                                for (result, stdout) in command_results {
                                    pending.push(crate::session::PendingCommandResult {
                                        exit_code: result.exit_code,
                                        duration_ms: result.duration_ms,
                                        stdout,
                                        method: result.method,
                                    });
                                }
                            }
                        }
                        Err(e) => {
                            let msg = e
                                .downcast_ref::<String>()
                                .map(String::as_str)
                                .or_else(|| e.downcast_ref::<&str>().copied())
                                .unwrap_or("unknown");
                            error!("feed() PANICKED: {}, {}B, pane={}", msg, n, reader_pane);
                        }
                    }

                    // Send raw data for xterm.js rendering
                    let _ = reader_session.output_tx.send(data.to_vec());
                }
            }
        }
        error!("PTY reader exiting, running cleanup, pane={}", reader_pane);
        cleanup_exited_pty_session(&reader_session, &reader_pane, &reader_manager, None);
        info!("PTY exited, session removed: pane={}", reader_pane);
    });

    // On Windows ConPTY may leave the reader blocked after the shell process
    // exits. Poll the child handle so `exit` closes the tab even without EOF.
    {
        let watcher_session = Arc::clone(&session);
        let watcher_manager = Arc::clone(manager);
        let watcher_pane = pane_id.to_string();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(200));
            loop {
                interval.tick().await;
                if watcher_session.is_exited() {
                    break;
                }

                let mut should_stop = false;
                let status = {
                    let mut backend = watcher_session.backend.lock().await;
                    let status = match &mut *backend {
                        SessionBackend::Local { child, .. } => {
                            match child.try_wait() {
                                Ok(Some(status)) => Some(status),
                                Ok(None) => None,
                                Err(e) => {
                                    error!("PTY child watcher: try_wait failed: {e}, pane={watcher_pane}");
                                    should_stop = true;
                                    None
                                }
                            }
                        }
                        SessionBackend::Ssh | SessionBackend::Exited => {
                            should_stop = true;
                            None
                        }
                    };
                    if status.is_some() {
                        *backend = SessionBackend::Exited;
                    }
                    status
                };

                if let Some(status) = status {
                    let exit_code = i32::try_from(status.exit_code()).ok();
                    info!("PTY child exited: status={status:?}, pane={watcher_pane}");
                    cleanup_exited_pty_session(
                        &watcher_session,
                        &watcher_pane,
                        &watcher_manager,
                        exit_code,
                    );
                    break;
                }

                if should_stop {
                    break;
                }
            }
        });
    }

    // ── Broadcast task: forwards raw PTY data + handles commands ──
    // Reads raw PTY bytes from the output channel and broadcasts to clients
    // (WS / Tauri forwarders). Also handles sync timeout and command events
    // that were extracted by the PTY reader during feed().
    //
    // The PTY reader does inline feed() (like mainstream terminals), so VTE
    // parsing and screen updates happen immediately. This task only needs to
    // forward the raw bytes for xterm.js rendering.
    {
        let bcast_session = Arc::clone(&session_clone);
        let bcast_manager = Arc::clone(&manager_clone);
        let bcast_pane = pane_id_clone.clone();
        tokio::spawn(async move {
            broadcast_task(bcast_session, bcast_pane, bcast_manager).await;
        });
    }

    Ok((session, shell_type))
}

#[must_use]
pub fn setup_zsh_title_hooks(home: &str) -> Option<std::path::PathBuf> {
    let zdotdir = std::env::temp_dir().join(format!("dinotty_zsh_{}", std::process::id()));
    std::fs::create_dir_all(&zdotdir).ok()?;

    let zshenv = format!(
        r#"[[ -f "{home}/.zshenv" ]] && source "{home}/.zshenv"
"#
    );

    let zshrc = format!(
        r#"# dinotty title injection — loaded via ZDOTDIR
ZDOTDIR=  # reset so child shells behave normally

[[ -f "{home}/.zshrc" ]] && source "{home}/.zshrc"

# Ensure history is saved — fallback if user config doesn't set these
[[ $HISTSIZE -gt 0 ]] || HISTSIZE=10000
[[ $SAVEHIST -gt 0 ]] || SAVEHIST=10000
[[ -n "$HISTFILE" ]] || HISTFILE="$HOME/.zsh_history"
setopt INC_APPEND_HISTORY SHARE_HISTORY

function _dinotty_precmd {{
  printf "\033]0;%s@%s:%s\007" "${{USER}}" "${{HOST%%.*}}" "${{PWD/#$HOME/~}}"
  printf "\033]133;A\033\\"
  printf "\033]133;D;%d\033\\" $?
}}

function _dinotty_preexec {{
  printf "\033]0;%s\007" "$1"
  printf "\033]133;B\033\\"
}}

if [[ -z "${{precmd_functions[(r)_dinotty_precmd]}}" ]]; then
  precmd_functions+=(_dinotty_precmd)
fi
if [[ -z "${{preexec_functions[(r)_dinotty_preexec]}}" ]]; then
  preexec_functions+=(_dinotty_preexec)
fi
"#
    );

    let zprofile = format!(
        r#"[[ -f "{home}/.zprofile" ]] && source "{home}/.zprofile"
"#
    );

    std::fs::write(zdotdir.join(".zshenv"), zshenv).ok()?;
    std::fs::write(zdotdir.join(".zshrc"), zshrc).ok()?;
    std::fs::write(zdotdir.join(".zprofile"), zprofile).ok()?;
    Some(zdotdir)
}

#[derive(Debug, PartialEq, Eq)]
enum LocaleAdjustment {
    Preserve,
    SetCtype,
    RemoveAllAndSetCtype,
}

fn is_utf8_locale(value: &str) -> bool {
    let normalized = value.trim().to_ascii_uppercase();
    normalized.contains("UTF-8") || normalized.contains("UTF8")
}

fn is_default_locale(value: &str) -> bool {
    matches!(value.trim().to_ascii_uppercase().as_str(), "" | "C" | "POSIX")
}

fn locale_adjustment(
    lc_all: Option<&str>,
    lc_ctype: Option<&str>,
    lang: Option<&str>,
) -> LocaleAdjustment {
    if let Some(value) = lc_all.filter(|value| !value.trim().is_empty()) {
        if is_utf8_locale(value) {
            return LocaleAdjustment::Preserve;
        }
        return if is_default_locale(value) {
            LocaleAdjustment::RemoveAllAndSetCtype
        } else {
            LocaleAdjustment::Preserve
        };
    }

    if let Some(value) = lc_ctype.filter(|value| !value.trim().is_empty()) {
        if is_utf8_locale(value) {
            return LocaleAdjustment::Preserve;
        }
        return if is_default_locale(value) {
            LocaleAdjustment::SetCtype
        } else {
            LocaleAdjustment::Preserve
        };
    }

    match lang {
        Some(value) if is_utf8_locale(value) => LocaleAdjustment::Preserve,
        Some(value) if !is_default_locale(value) => LocaleAdjustment::Preserve,
        _ => LocaleAdjustment::SetCtype,
    }
}

/// Env keys inherited from a parent Claude Code session that must NOT leak into
/// the spawned terminal — otherwise an interactive `claude` inside the terminal
/// treats itself as a child session and never persists its transcript.
pub(crate) fn claude_session_env_keys_to_strip() -> Vec<String> {
    std::env::vars_os()
        .filter_map(|(k, _)| k.into_string().ok())
        .filter(|k| is_claude_session_env_key(k))
        .collect()
}

/// True if `key` is a Claude Code SESSION-scoped env var that must be stripped
/// from spawned child processes (case-insensitive; generic CLAUDE_* like
/// `CLAUDE_CONFIG_DIR` is preserved).
fn is_claude_session_env_key(key: &str) -> bool {
    let ku = key.to_ascii_uppercase();
    ku.starts_with("CLAUDE_CODE_") || ku == "CLAUDECODE" || ku == "CLAUDE_SESSION_ID"
}

fn configure_utf8_locale(cmd: &mut CommandBuilder) {
    let lc_all = std::env::var("LC_ALL").ok();
    let lc_ctype = std::env::var("LC_CTYPE").ok();
    let lang = std::env::var("LANG").ok();

    match locale_adjustment(lc_all.as_deref(), lc_ctype.as_deref(), lang.as_deref()) {
        LocaleAdjustment::Preserve => {}
        LocaleAdjustment::SetCtype => cmd.env("LC_CTYPE", "C.UTF-8"),
        LocaleAdjustment::RemoveAllAndSetCtype => {
            cmd.env_remove("LC_ALL");
            cmd.env("LC_CTYPE", "C.UTF-8");
        }
    }
}

#[must_use]
pub fn get_shell() -> String {
    shell::default_shell().program
}

#[must_use]
pub fn get_shell_type(shell: &str) -> String {
    shell::shell_type(shell)
}

#[must_use]
pub fn get_shell_args(shell: &str) -> Vec<String> {
    shell::shell_args(shell)
}

#[cfg(test)]
mod tests {
    use super::{is_claude_session_env_key, locale_adjustment, notify_url_for, LocaleAdjustment};

    #[test]
    fn builds_notify_url_for_bound_port() {
        assert_eq!(notify_url_for(8999), Some("http://127.0.0.1:8999".to_string()));
        assert_eq!(notify_url_for(0), None);
    }

    #[test]
    fn strips_claude_session_keys_case_insensitive() {
        for k in [
            "CLAUDE_CODE_CHILD_SESSION",
            "claude_code_child_session",
            "CLAUDECODE",
            "claudecode",
            "CLAUDE_SESSION_ID",
            "Claude_Session_Id",
            "CLAUDE_CODE_ENTRYPOINT",
        ] {
            assert!(is_claude_session_env_key(k), "should strip {k}");
        }
    }

    #[test]
    fn preserves_generic_and_dinotty_keys() {
        for k in [
            "CLAUDE_CONFIG_DIR",
            "DINOTTY_PANE_ID",
            "DINOTTY_TAB_ID",
            "PATH",
            "HOME",
            "TERM",
            "CLAUDECODEX",
        ] {
            assert!(!is_claude_session_env_key(k), "should preserve {k}");
        }
    }

    #[test]
    fn locale_defaults_to_utf8_ctype_when_environment_is_missing() {
        assert_eq!(locale_adjustment(None, None, None), LocaleAdjustment::SetCtype);
    }

    #[test]
    fn locale_fixes_applications_launch_environment() {
        assert_eq!(locale_adjustment(Some(""), Some("C"), Some("")), LocaleAdjustment::SetCtype);
    }

    #[test]
    fn locale_removes_c_lc_all_override() {
        assert_eq!(
            locale_adjustment(Some("POSIX"), Some("C.UTF-8"), Some("")),
            LocaleAdjustment::RemoveAllAndSetCtype
        );
    }

    #[test]
    fn locale_preserves_existing_utf8_environment() {
        assert_eq!(
            locale_adjustment(None, Some("zh_CN.UTF-8"), Some("C")),
            LocaleAdjustment::Preserve
        );
        assert_eq!(
            locale_adjustment(Some("C.UTF8"), Some("C"), Some("C")),
            LocaleAdjustment::Preserve
        );
    }

    #[test]
    fn locale_preserves_explicit_non_utf8_environment() {
        assert_eq!(
            locale_adjustment(None, Some("zh_CN.GB2312"), Some("")),
            LocaleAdjustment::Preserve
        );
        assert_eq!(
            locale_adjustment(Some("en_US.ISO8859-1"), Some("C"), Some("")),
            LocaleAdjustment::Preserve
        );
    }
}

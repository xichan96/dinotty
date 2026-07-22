#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use base64::Engine;
use dinotty_server::pty;
use dinotty_server::session::{SessionClientEvent, SessionManager, SessionStatus, SyncMsg};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

mod embedded_server;

static EMBEDDED_HTTP_PORT: OnceLock<u16> = OnceLock::new();
static DESKTOP_SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);
const BUILT_IN_DEFAULT_PORT: u16 = 8999;

fn default_port() -> u16 {
    option_env!("DINOTTY_DEFAULT_PORT")
        .and_then(|s| s.parse().ok())
        .unwrap_or(BUILT_IN_DEFAULT_PORT)
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    pane_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyResize {
    pane_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    pane_id: String,
}

/// DEC mode 2026 transaction boundary marker. `active: true` = SyncBegin,
/// `active: false` = SyncEnd. Emitted to the frontend as `pty-sync` event.
#[derive(Clone, Serialize)]
struct PtySyncControl {
    pane_id: String,
    active: bool,
}

fn spawn_tauri_output_forwarder(
    app: AppHandle,
    pane_id: String,
    session: Arc<dinotty_server::session::Session>,
) {
    let (client_id, mut rx) = session.add_client();
    *session.tauri_client_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(client_id);
    let fwd_session = Arc::clone(&session);
    // Use a dedicated OS thread instead of tokio async task.
    // app.emit() may block when the WKWebView IPC queue is full — if this
    // happened on a tokio worker thread it would freeze the entire runtime,
    // killing all terminals and the embedded Axum server.
    match std::thread::Builder::new().name(format!("fwd-{}", pane_id)).spawn(move || {
        let mut pending = None;
        while let Some(event) = pending.take().or_else(|| rx.blocking_recv()) {
            match event {
                SessionClientEvent::Output(mut batch) => {
                    loop {
                        match rx.try_recv() {
                            Ok(SessionClientEvent::Output(data)) => batch.push_str(&data),
                            Ok(
                                event @ (SessionClientEvent::Resize { .. }
                                | SessionClientEvent::SessionExit { .. }
                                | SessionClientEvent::SyncBegin
                                | SessionClientEvent::SyncEnd
                                | SessionClientEvent::ReplayBegin { .. }
                                | SessionClientEvent::ReplayEnd),
                            ) => {
                                pending = Some(event);
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                    if app
                        .emit("pty-output", PtyOutput { pane_id: pane_id.clone(), data: batch })
                        .is_err()
                    {
                        break;
                    }
                }
                SessionClientEvent::Resize { cols, rows } => {
                    if app
                        .emit("pty-resize", PtyResize { pane_id: pane_id.clone(), cols, rows })
                        .is_err()
                    {
                        break;
                    }
                }
                SessionClientEvent::SessionExit { pane_id: exit_pane_id } => {
                    let _ = app.emit("pty-exit", PtyExit { pane_id: exit_pane_id });
                    break;
                }
                SessionClientEvent::SyncBegin => {
                    let _ = app.emit(
                        "pty-sync",
                        PtySyncControl { pane_id: pane_id.clone(), active: true },
                    );
                }
                SessionClientEvent::SyncEnd => {
                    let _ = app.emit(
                        "pty-sync",
                        PtySyncControl { pane_id: pane_id.clone(), active: false },
                    );
                }
                SessionClientEvent::ReplayBegin { cols, rows } => {
                    let _ = app.emit(
                        "pty-replay-begin",
                        serde_json::json!({ "pane_id": pane_id, "cols": cols, "rows": rows }),
                    );
                }
                SessionClientEvent::ReplayEnd => {
                    let _ = app.emit("pty-replay-end", serde_json::json!({ "pane_id": pane_id }));
                }
            }
        }
        fwd_session.remove_client(client_id);
        fwd_session.clear_tauri_client_if(client_id);
    }) {
        Ok(_) => {}
        Err(_) => {
            session.remove_client(client_id);
            session.clear_tauri_client_if(client_id);
        }
    }
}

/// Spawn a dedicated write task for the session that reads from the input channel
/// and writes to the PTY. This avoids the thread-leak problem where each `pty_write`
/// command spawned a `spawn_blocking` with a timeout — if `write_all` blocked (PTY
/// input buffer full), the timeout fired but the thread was never reclaimed.
fn spawn_tauri_write_task(session: Arc<dinotty_server::session::Session>, pane_id: String) {
    let mut input_rx = session.replace_input_channel();
    let write_session = Arc::clone(&session);
    let write_pane = pane_id.clone();
    tauri::async_runtime::spawn(async move {
        let is_ssh = write_session.is_ssh();
        while let Some(first) = input_rx.recv().await {
            if write_session.is_exited() {
                break;
            }
            // Batch: drain all pending messages to minimize lock acquisitions
            let mut batch = first;
            while let Ok(data) = input_rx.try_recv() {
                batch.push_str(&data);
            }
            let batch_len = batch.len();
            let result = if is_ssh {
                write_session.write_input_async(batch.as_bytes()).await
            } else {
                let ws = Arc::clone(&write_session);
                tokio::task::spawn_blocking(move || ws.write_input_blocking(batch.as_bytes()))
                    .await
                    .unwrap_or_else(|e| Err(e.to_string()))
            };
            match result {
                Ok(()) => {}
                Err(e) => {
                    tracing::error!("PTY write error ({}B): {}, pane={}", batch_len, e, write_pane);
                    break;
                }
            }
        }
        tracing::info!("PTY write task exited, pane={}", write_pane);
    });
}

/// Emit `pty-reconnected` only — does NOT push a snapshot. The frontend will
/// converge its layout, fit once, then invoke `pty_snapshot_request` to get
/// the scrollback+snapshot via the replay transaction (pty-replay-begin →
/// pty-output chunks → pty-replay-end). This is the Tauri side of the
/// fit-then-snapshot handshake (proposal 3), mirroring ws/mod.rs.
fn emit_reconnected(
    app: &AppHandle,
    pane_id: &str,
    session: &Arc<dinotty_server::session::Session>,
) {
    let (cols, rows) = *session.size.lock().unwrap_or_else(|e| e.into_inner());
    let _ = app.emit(
        "pty-reconnected",
        serde_json::json!({ "pane_id": pane_id, "cols": cols, "rows": rows }),
    );
}

#[tauri::command]
fn pty_spawn(
    pane_id: String,
    app: AppHandle,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    let manager = state.inner().clone();
    let app_cb = app.clone();
    let exit_cb: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |pid: String| {
        let _ = app_cb.emit("pty-exit", PtyExit { pane_id: pid });
    });

    if let Some(entry) = manager.sessions.get(&pane_id) {
        let session = Arc::clone(entry.value());
        *session.status.lock().unwrap_or_else(|e| e.into_inner()) = SessionStatus::Connected;
        {
            let mut g = session.tauri_on_exit.lock().unwrap_or_else(|e| e.into_inner());
            if g.is_none() {
                *g = Some(Arc::clone(&exit_cb));
            }
        }
        // Remove only the prior Tauri forwarder; WebSocket clients remain attached.
        if let Some(client_id) =
            session.tauri_client_id.lock().unwrap_or_else(|e| e.into_inner()).take()
        {
            session.remove_client(client_id);
        }
        // Spawn forwarder BEFORE emit_reconnected so the new client
        // (snapshot_pending=true via add_client) is registered before the
        // frontend receives pty-reconnected and (after converging) calls
        // pty_snapshot_request. The snapshot_pending flag drops live Output
        // for this client until ReplayEnd is enqueued.
        spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));
        emit_reconnected(&app, &pane_id, &session);
        // Set up channel-based write task (replaces old input channel, if any)
        spawn_tauri_write_task(Arc::clone(&session), pane_id.clone());
        return Ok(session.shell_type.clone());
    }

    let (session, shell_type) =
        pty::create_session(&manager, &pane_id, None, Some(Arc::clone(&exit_cb)), None, None)?;

    spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));
    spawn_tauri_write_task(Arc::clone(&session), pane_id.clone());

    Ok(shell_type)
}

#[tauri::command]
async fn pty_write(
    pane_id: String,
    data: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let session = state.sessions.get(&pane_id).ok_or("session not found")?.value().clone();
    if session.is_exited() {
        return Err("session exited".into());
    }
    // Send through the input channel — the dedicated write task handles the actual
    // PTY write. This avoids the old pattern of spawn_blocking + timeout which leaked
    // a thread per call when write_all blocked (PTY input buffer full).
    let tx = session.input_tx.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = tx.as_ref() {
        tx.send(data).map_err(|_| "input channel closed".to_string())?;
        Ok(())
    } else {
        Err("input channel not initialized".to_string())
    }
}

#[tauri::command]
fn pty_resize(
    pane_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let sessions = &state.sessions;
    let session = sessions.get(&pane_id).ok_or("session not found")?;
    // Use debounced resize to coalesce rapid resize events (e.g. window drag)
    // and avoid blocking the Tauri command thread on the screen mutex.
    let origin_id = session
        .tauri_client_id
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .ok_or("tauri client not connected")?;
    session.resize_debounced(origin_id, cols, rows);
    Ok(())
}

/// Fit-then-snapshot handshake (proposal 3): client converged its local layout,
/// fit once, and is now asking the server to resize PTY+screen to (cols, rows)
/// and emit the scrollback+snapshot as a replay transaction. Server runs the
/// atomic resize+snapshot in one critical section and emits pty-replay-begin
/// → pty-output (scrollback+snapshot chunks via SessionClientEvent::Output) →
/// pty-replay-end, then clears the client's snapshot_pending so future live
/// Output is delivered normally. Mirrors the WS path in ws/mod.rs.
#[tauri::command]
async fn pty_snapshot_request(
    pane_id: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let session = state.sessions.get(&pane_id).ok_or("session not found")?.value().clone();
    let origin_id = session
        .tauri_client_id
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .ok_or("tauri client not connected")?;
    // atomic_resize_and_snapshot_for_client enqueues ReplayBegin/End via the
    // session's per-client mpsc channel; the Tauri output forwarder task
    // (spawn_tauri_output_forwarder) consumes the channel and emits the
    // corresponding pty-* events. So we just call it and let the forwarder
    // handle the wire events.
    session.atomic_resize_and_snapshot_for_client(origin_id, cols, rows).await.map_err(|e| {
        tracing::warn!("pty_snapshot_request failed: {e}, pane={pane_id}");
        e
    })?;
    let _ = app; // app not needed — forwarder emits events
    Ok(())
}

#[tauri::command]
fn pty_kill(pane_id: String, state: State<'_, Arc<SessionManager>>) -> Result<(), String> {
    state.kill_and_remove(&pane_id);
    state.broadcast_sync(&SyncMsg::TabClosed { pane_id: pane_id.clone() });
    // Collect affected layouts before purging
    let before_layouts: Vec<(String, serde_json::Value)> =
        state.tab_layouts.iter().map(|e| (e.key().clone(), e.value().clone())).collect();
    state.purge_pane_from_layouts(&pane_id);
    // Broadcast layout changes to all clients
    for (tab_id, old_val) in &before_layouts {
        if let Some(new_val) = state.tab_layouts.get(tab_id) {
            if *new_val.value() != *old_val {
                let layout =
                    new_val.value().get("layout").cloned().unwrap_or(serde_json::Value::Null);
                let active = new_val
                    .value()
                    .get("active_pane_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                state.broadcast_sync(&SyncMsg::LayoutUpdated {
                    pane_id: tab_id.clone(),
                    layout,
                    active_pane_id: active,
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn pty_detach(pane_id: String, state: State<'_, Arc<SessionManager>>) -> Result<(), String> {
    if let Some(entry) = state.sessions.get(&pane_id) {
        let session = Arc::clone(entry.value());
        if !session.has_clients() {
            *session.status.lock().unwrap_or_else(|e| e.into_inner()) =
                SessionStatus::Detached { since: std::time::Instant::now() };
        }
    }
    Ok(())
}

#[tauri::command]
fn embedded_http_origin() -> String {
    let port = EMBEDDED_HTTP_PORT.get().copied().unwrap_or_else(default_port);
    format!("http://127.0.0.1:{port}")
}

#[derive(Serialize)]
struct FetchResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

#[tauri::command]
async fn tauri_fetch(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<FetchResponse, String> {
    let client = reqwest::Client::new();
    let method: Method = method.parse().map_err(|_| "invalid method")?;
    let mut req = client.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(FetchResponse { status, headers, body })
}

#[derive(Deserialize)]
struct UploadFile {
    name: String,
    path: String,
    data: String, // base64-encoded
}

#[tauri::command]
async fn tauri_read_file(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
async fn tauri_download(
    url: String,
    filename: String,
    headers: Vec<(String, String)>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let dialog =
        rfd::AsyncFileDialog::new().set_title("Save File").set_file_name(&filename).save_file();
    let file = dialog.await.ok_or("cancelled")?;
    tokio::fs::write(file.path(), &bytes).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn tauri_save_text(filename: String, content: String) -> Result<(), String> {
    let dialog =
        rfd::AsyncFileDialog::new().set_title("Save File").set_file_name(&filename).save_file();
    let file = dialog.await.ok_or("cancelled")?;
    tokio::fs::write(file.path(), content.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn pick_upload_dir() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_workspace_dir(base: Option<String>) -> Option<String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    let resolved = base
        .and_then(|base| {
            if let Some(rest) = base.strip_prefix("~/") {
                std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(rest))
            } else if base == "~" {
                std::env::var_os("HOME").map(std::path::PathBuf::from)
            } else {
                Some(std::path::PathBuf::from(base))
            }
        })
        .and_then(|path| path.canonicalize().ok().map(|c| dunce::simplified(&c).to_path_buf()))
        .filter(|path| path.is_dir())
        .or_else(|| {
            std::env::var_os("HOME").map(std::path::PathBuf::from).filter(|path| path.is_dir())
        });
    if let Some(dir) = resolved {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_folder().await.map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn tauri_upload(
    pane_id: String,
    dir: String,
    files: Vec<UploadFile>,
    cwd: Option<String>,
    token: Option<String>,
) -> Result<FetchResponse, String> {
    let port = EMBEDDED_HTTP_PORT.get().copied().unwrap_or_else(default_port);
    let mut url = format!(
        "http://127.0.0.1:{port}/api/workspace/upload?pane_id={}&dir={}",
        urlencoding::encode(&pane_id),
        urlencoding::encode(&dir),
    );
    if let Some(c) = cwd.as_deref().filter(|c| !c.is_empty()) {
        url.push_str("&cwd=");
        url.push_str(&urlencoding::encode(c));
    }

    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new();

    for f in &files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&f.data)
            .map_err(|e| format!("base64 decode error for {}: {e}", f.name))?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(f.name.clone())
            .mime_str("application/octet-stream")
            .map_err(|e| e.to_string())?;
        // path must precede file: backend reads fields in order and pairs
        // each path with the next file field.
        form = form.text("path", f.path.clone());
        form = form.part("file", part);
    }

    let mut req = client.post(&url).multipart(form);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(FetchResponse { status, headers, body })
}

#[tauri::command]
fn set_window_title(title: String, window: tauri::Window) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_window(window: tauri::Window) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn reveal_webview_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        reveal_webview_window(&window);
    }
}

fn toggle_webview_window(window: &tauri::WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        reveal_webview_window(window);
    }
}

fn terminate_sessions_once(manager: &SessionManager) {
    if DESKTOP_SHUTDOWN_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let pane_ids: Vec<String> = manager.sessions.iter().map(|entry| entry.key().clone()).collect();
    tracing::info!("Desktop shutdown: terminating {} session(s)", pane_ids.len());
    for pane_id in pane_ids {
        manager.kill_and_remove(&pane_id);
    }
}

fn quit_desktop_app(app: &AppHandle, manager: &SessionManager) {
    terminate_sessions_once(manager);
    if let Err(e) = app.global_shortcut().unregister_all() {
        tracing::warn!("Failed to unregister global shortcuts during shutdown: {e}");
    }
    app.exit(0);
}

#[tauri::command]
fn close_window(app: AppHandle, state: State<'_, Arc<SessionManager>>) {
    quit_desktop_app(&app, state.inner().as_ref());
}

/// macOS-specific: GUI-launched apps inherit LaunchServices' minimal PATH, so
/// argv tabs (e.g. `claude --resume`) fail to spawn. Import the user's
/// login-shell PATH once at startup, before any PTY spawn or thread exists.
#[cfg(target_os = "macos")]
fn import_login_shell_path() {
    use dinotty_server::platform::process::CommandNoWindowExt;

    const START_MARKER: &[u8] = b"__DINOTTY_PATH_START__";
    const END_MARKER: &[u8] = b"__DINOTTY_PATH_END__";

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let Ok(out) = std::process::Command::new(&shell)
        .no_window()
        .args(["-lc", "printf '__DINOTTY_PATH_START__%s__DINOTTY_PATH_END__' \"$PATH\""])
        .output()
    else {
        return;
    };
    if !out.status.success() {
        return;
    }

    let Some(start) =
        out.stdout.windows(START_MARKER.len()).position(|window| window == START_MARKER)
    else {
        return;
    };
    let value_start = start + START_MARKER.len();
    let Some(end) =
        out.stdout[value_start..].windows(END_MARKER.len()).position(|window| window == END_MARKER)
    else {
        return;
    };

    if let Ok(path) = std::str::from_utf8(&out.stdout[value_start..value_start + end]) {
        let path = path.trim();
        if !path.is_empty() {
            std::env::set_var("PATH", path);
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    import_login_shell_path();
    let _log_guard = dinotty_server::settings::init_logging();

    let args: Vec<String> = std::env::args().collect();
    let requested_port = parse_port(&args);
    let port = if requested_port == 0 {
        let port = match default_port() {
            0 => BUILT_IN_DEFAULT_PORT,
            port => port,
        };
        tracing::warn!("Port 0 is not supported; falling back to default port {port}");
        port
    } else {
        requested_port
    };
    let _ = EMBEDDED_HTTP_PORT.set(port);

    let manager = Arc::new(SessionManager::new());

    if args.contains(&"--server".to_string()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mgr = Arc::clone(&manager);
        rt.block_on(async move {
            let listener = embedded_server::bind_listener(port)
                .unwrap_or_else(|e| panic!("failed to bind embedded server on port {port}: {e}"));
            // The reaper must run unconditionally — a bind failure or notifier-registration
            // ordering issue must never suppress it. Notification GC simply no-ops until
            // run_server registers a notifier.
            mgr.start_cleanup_task();
            embedded_server::run_server(listener, mgr).await
        });
        return;
    }

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _runtime_enter = runtime.enter();
    manager.start_cleanup_task();

    let run_manager = Arc::clone(&manager);

    tauri::Builder::default()
        // Keep one desktop instance so a second launch focuses the hidden/tray window instead
        // of racing the first process for the same port and global shortcut.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tracing::info!("Second Dinotty launch detected; focusing existing window");
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(manager.clone())
        .setup(move |app| {
            let mgr = Arc::clone(&manager);
            match embedded_server::bind_listener(port) {
                Ok(listener) => {
                    let actual = listener.local_addr().expect("bound listener").port();
                    // Redundant-by-design: run_server() also sets notify_port from its own
                    // local_addr once its future is first polled. We set it here too — synchronously,
                    // before spawn — so a Tauri `pty_spawn` IPC that fires before the spawned task's
                    // first poll still reads the real port (not 0). Do NOT remove either set.
                    mgr.set_notify_port(actual);
                    tauri::async_runtime::spawn(embedded_server::run_server(listener, mgr));
                    tracing::info!("Desktop mode: embedded server on port {}", actual);
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to bind embedded server on port {}: {}; notifications disabled",
                        port,
                        e
                    );
                }
            }

            // Register global shortcut for Quake-mode toggle (Ctrl+Shift+`)
            let win = app.get_webview_window("main").expect("no main window");
            let win_clone = win.clone();
            app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Backquote),
                move |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_webview_window(&win_clone);
                    }
                },
            )?;

            // Build tray icon with context menu
            let show_item = MenuItemBuilder::with_id("show", "Show/Hide").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build()?;
            let quit_manager = Arc::clone(&manager);
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            toggle_webview_window(&window);
                        }
                    }
                    "quit" => {
                        quit_desktop_app(app, quit_manager.as_ref());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            toggle_webview_window(&window);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::DragDrop(drag_event) => match drag_event {
                tauri::DragDropEvent::Enter { .. } => {
                    let _ = window.emit("file-drop-active", true);
                }
                tauri::DragDropEvent::Leave => {
                    let _ = window.emit("file-drop-active", false);
                }
                tauri::DragDropEvent::Drop { paths, position } => {
                    let _ = window.emit("file-drop-active", false);
                    let path_strings: Vec<String> =
                        paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    let payload = serde_json::json!({
                        "paths": path_strings,
                        "position": { "x": position.x, "y": position.y }
                    });
                    let _ = window.emit("file-drop-paths", &payload);
                }
                _ => {}
            },
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if DESKTOP_SHUTDOWN_STARTED.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("window-close-requested", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_snapshot_request,
            pty_kill,
            pty_detach,
            embedded_http_origin,
            tauri_fetch,
            tauri_upload,
            tauri_read_file,
            tauri_download,
            tauri_save_text,
            pick_upload_dir,
            pick_workspace_dir,
            close_window,
            toggle_window,
            set_window_title,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(move |app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                terminate_sessions_once(run_manager.as_ref());
            }

            #[cfg(not(target_os = "macos"))]
            let _ = app_handle;
        });
}

fn parse_port(args: &[String]) -> u16 {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if let Some(v) = args.get(i + 1) {
                    return v.parse().unwrap_or_else(|_| default_port());
                }
            }
            s if s.starts_with("--port=") => {
                return s[7..].parse().unwrap_or_else(|_| default_port());
            }
            _ => {}
        }
        i += 1;
    }
    default_port()
}

use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, State};
use dinotty_server::pty;
use dinotty_server::session::{SessionManager, SessionStatus, SyncMsg};
use reqwest::Method;
use base64::Engine;

mod embedded_server;

static EMBEDDED_HTTP_PORT: OnceLock<u16> = OnceLock::new();

#[derive(Clone, Serialize)]
struct PtyOutput {
    pane_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    pane_id: String,
}

fn spawn_tauri_output_forwarder(app: AppHandle, pane_id: String, session: Arc<dinotty_server::session::Session>) {
    let mut rx = session.add_client();
    let app2 = app.clone();
    let pid = pane_id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            let _ = app2.emit(
                "pty-output",
                PtyOutput {
                    pane_id: pid.clone(),
                    data,
                },
            );
        }
    });
}

fn emit_join_sync(app: &AppHandle, pane_id: &str, session: &Arc<dinotty_server::session::Session>) {
    let (cols, rows) = *session.size.lock().unwrap();
    let _ = app.emit(
        "pty-reconnected",
        serde_json::json!({ "pane_id": pane_id, "cols": cols, "rows": rows }),
    );
    let snapshot = {
        let screen = session.screen.lock().unwrap();
        screen.snapshot()
    };
    let _ = app.emit(
        "pty-output",
        PtyOutput {
            pane_id: pane_id.to_string(),
            data: snapshot,
        },
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
        *session.status.lock().unwrap() = SessionStatus::Connected;
        {
            let mut g = session.tauri_on_exit.lock().unwrap();
            if g.is_none() {
                *g = Some(Arc::clone(&exit_cb));
            }
        }
        // Clear old output forwarders to prevent duplicate output on reconnection
        session.clear_clients();
        emit_join_sync(&app, &pane_id, &session);
        spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));
        return Ok(session.shell_type.clone());
    }

    let (session, shell_type) =
        pty::create_session(Arc::clone(&manager), pane_id.clone(), Some(Arc::clone(&exit_cb)))?;

    spawn_tauri_output_forwarder(app.clone(), pane_id.clone(), Arc::clone(&session));

    Ok(shell_type)
}

#[tauri::command]
fn pty_write(
    pane_id: String,
    data: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    use std::io::Write;
    let sessions = &state.sessions;
    let session = sessions.get(&pane_id).ok_or("session not found")?;
    let mut w = session.writer.lock().unwrap();
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_resize(
    pane_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    use portable_pty::PtySize;
    let sessions = &state.sessions;
    let session = sessions.get(&pane_id).ok_or("session not found")?;
    let m = session.master.lock().unwrap();
    m.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| e.to_string())?;
    drop(m);
    *session.size.lock().unwrap() = (cols, rows);
    session
        .screen
        .lock()
        .unwrap()
        .resize(cols as usize, rows as usize);
    Ok(())
}

#[tauri::command]
fn pty_kill(pane_id: String, state: State<'_, Arc<SessionManager>>) -> Result<(), String> {
    state.kill_and_remove(&pane_id);
    state.broadcast_sync(&SyncMsg::TabClosed {
        pane_id: pane_id.clone(),
    });
    // Collect affected layouts before purging
    let before_layouts: Vec<(String, serde_json::Value)> = state.tab_layouts.iter()
        .map(|e| (e.key().clone(), e.value().clone()))
        .collect();
    state.purge_pane_from_layouts(&pane_id);
    // Broadcast layout changes to all clients
    for (tab_id, old_val) in &before_layouts {
        if let Some(new_val) = state.tab_layouts.get(tab_id) {
            if *new_val.value() != *old_val {
                let layout = new_val.value().get("layout").cloned().unwrap_or(serde_json::Value::Null);
                let active = new_val.value().get("active_pane_id")
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
            *session.status.lock().unwrap() = SessionStatus::Detached {
                since: std::time::Instant::now(),
            };
        }
    }
    Ok(())
}

#[tauri::command]
fn embedded_http_origin() -> String {
    let port = EMBEDDED_HTTP_PORT.get().copied().unwrap_or(8999);
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
async fn tauri_upload(
    pane_id: String,
    dir: String,
    files: Vec<UploadFile>,
    token: Option<String>,
) -> Result<FetchResponse, String> {
    let port = EMBEDDED_HTTP_PORT.get().copied().unwrap_or(8999);
    let url = format!(
        "http://127.0.0.1:{port}/api/workspace/upload?pane_id={}&dir={}",
        urlencoding::encode(&pane_id),
        urlencoding::encode(&dir),
    );

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
        form = form.part("file", part);
        form = form.text("path", f.path.clone());
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

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::new(
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
            ),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let port = parse_port(&args);
    let _ = EMBEDDED_HTTP_PORT.set(port);

    let manager = Arc::new(SessionManager::new());

    if args.contains(&"--server".to_string()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mgr = Arc::clone(&manager);
        rt.block_on(async move {
            mgr.start_cleanup_task();
            embedded_server::run_server(port, mgr).await
        });
        return;
    }

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _runtime_enter = runtime.enter();
    manager.start_cleanup_task();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(manager.clone())
        .setup(move |_app| {
            let mgr = Arc::clone(&manager);
            tauri::async_runtime::spawn(embedded_server::run_server(port, mgr));
            tracing::info!("Desktop mode: embedded server on port {}", port);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let path_strings: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = window.emit("file-drop-paths", &path_strings);
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_detach,
            embedded_http_origin,
            tauri_fetch,
            tauri_upload,
            tauri_read_file,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}

fn parse_port(args: &[String]) -> u16 {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" => {
                if let Some(v) = args.get(i + 1) {
                    return v.parse().unwrap_or(8999);
                }
            }
            s if s.starts_with("--port=") => {
                return s[7..].parse().unwrap_or(8999);
            }
            _ => {}
        }
        i += 1;
    }
    8999
}

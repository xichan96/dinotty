#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
mod managed;

pub use managed::{
    plugin_process_list, plugin_process_start, plugin_process_stop, plugin_process_stop_all,
};

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::platform::process::CommandNoWindowExt;

use super::helpers::plugin_err;
use super::manager::PluginManagerState;
use super::types::{
    ExecRequest, ExecResult, ManagedProcess, PluginStateValue, ProcessControl, ProcessInfo,
    ProcessLifecycleConfig, ProcessState, SpawnOptions, SpawnQuery,
};

pub(super) const PROCESS_LOG_BUFFER_BYTES: usize = 64 * 1024;
pub(super) const PROCESS_REAP_GRACE: Duration = Duration::from_secs(5);

pub(super) fn managed_process_stop_timeout(lifecycle: &ProcessLifecycleConfig) -> Duration {
    Duration::from_millis(lifecycle.force_kill_after_ms)
        + PROCESS_REAP_GRACE
        + Duration::from_secs(2)
}

pub(super) fn configure_plugin_command(
    cmd: &mut Command,
    pm: &PluginManagerState,
    plugin_id: &str,
    requested_env: Option<&std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    if requested_env.is_some_and(|env| {
        env.keys()
            .any(|key| key.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case("DINOTTY_")))
    }) {
        return Err("DINOTTY_* environment variables are reserved by the host".into());
    }

    let plugin_dir = pm.plugin_dir.join(plugin_id);
    let data_dir = pm.data_dir.join(plugin_id);
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("failed to create plugin data directory: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("failed to protect plugin data directory: {e}"))?;
    }

    for key in crate::pty::claude_session_env_keys_to_strip() {
        cmd.env_remove(key);
    }
    if let Some(env) = requested_env {
        cmd.envs(env);
    }
    cmd.current_dir(&plugin_dir);
    cmd.env("DINOTTY_PLUGIN_ID", plugin_id)
        .env("DINOTTY_PLUGIN_DIR", &plugin_dir)
        .env("DINOTTY_PLUGIN_DATA_DIR", &data_dir)
        .env("DINOTTY_HOST_TARGET", pm.host_target.map_or("unsupported", |target| target.as_str()))
        .env("DINOTTY_ORIGIN", &pm.host_origin)
        .env("DINOTTY_HOST_VERSION", &pm.host_version)
        .env("DINOTTY_HOST_MODE", &pm.host_mode)
        .env("DINOTTY_PARENT_PID", std::process::id().to_string());
    Ok(())
}

pub(super) async fn drain_process_output<R>(
    mut reader: R,
    ring: Arc<tokio::sync::Mutex<std::collections::VecDeque<u8>>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut chunk = [0_u8; 4096];
    loop {
        let Ok(read) = reader.read(&mut chunk).await else {
            return;
        };
        if read == 0 {
            return;
        }
        let mut ring = ring.lock().await;
        ring.extend(&chunk[..read]);
        while ring.len() > PROCESS_LOG_BUFFER_BYTES {
            ring.pop_front();
        }
    }
}

pub async fn plugin_exec(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
    Json(body): Json<ExecRequest>,
) -> Response {
    if !pm.registry.contains_key(&id) {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    }
    let operation_lock = pm.operation_lock(&id);
    let _operation_guard = operation_lock.read_owned().await;
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    if info.state != PluginStateValue::Active {
        return plugin_err(
            StatusCode::CONFLICT,
            info.error.as_deref().unwrap_or("plugin is not active"),
        );
    }
    match &info.manifest.bin {
        Some(b) if b.mode == "cli" => {}
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    }

    let bin_path = match pm.resolve_plugin_binary(&id, &info.manifest) {
        Ok(path) => path,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e),
    };
    let mut cmd = Command::new(&bin_path);
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    if let Err(e) = configure_plugin_command(&mut cmd, &pm, &id, body.env.as_ref()) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }

    let timeout_ms = body.timeout.unwrap_or(30_000);
    let timeout_dur = std::time::Duration::from_millis(timeout_ms);

    match tokio::time::timeout(timeout_dur, cmd.output()).await {
        Ok(Ok(output)) => Json(ExecResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
        .into_response(),
        Ok(Err(e)) => plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        Err(_) => Json(ExecResult {
            code: -1,
            stdout: String::new(),
            stderr: format!("timeout after {timeout_ms}ms"),
        })
        .into_response(),
    }
}

/// # Panics
/// Panics if the child process stdout cannot be captured.
#[allow(clippy::unused_async)]
pub async fn plugin_spawn_ws(
    Path(id): Path<String>,
    Query(params): Query<SpawnQuery>,
    State(pm): State<PluginManagerState>,
    State(settings): State<crate::settings::SettingsState>,
    ws: axum::extract::WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> Response {
    let s = settings.read().await;
    let allowed_origins = s.auth.allowed_origins.clone();
    let trusted_proxies = s.auth.trusted_proxies.clone();
    drop(s);
    let real_ip = crate::auth::real_client_ip(&headers, addr.ip(), &trusted_proxies);
    if !crate::auth::check_ws_origin(&headers, &allowed_origins, real_ip, &trusted_proxies) {
        return plugin_err(StatusCode::FORBIDDEN, "origin not allowed");
    }
    if !pm.registry.contains_key(&id) {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    }
    let operation_lock = pm.operation_lock(&id);
    let operation_guard = operation_lock.read_owned().await;
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    if info.state != PluginStateValue::Active {
        return plugin_err(
            StatusCode::CONFLICT,
            info.error.as_deref().unwrap_or("plugin is not active"),
        );
    }
    let lifecycle = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b.lifecycle.clone().unwrap_or_default(),
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };
    let bin_path = match pm.resolve_plugin_binary(&id, &info.manifest) {
        Ok(path) => path,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e),
    };
    drop(info);

    let args: Vec<String> = match serde_json::from_str(&params.args) {
        Ok(a) => a,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid args: {e}")),
    };
    let options: SpawnOptions = match params.options.as_deref() {
        Some(options) => match serde_json::from_str(options) {
            Ok(options) => options,
            Err(e) => {
                return plugin_err(StatusCode::BAD_REQUEST, &format!("invalid options: {e}"));
            }
        },
        None => SpawnOptions::default(),
    };

    ws.on_upgrade(move |mut socket| async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let mut cmd = Command::new(&bin_path);
        cmd.no_window();
        if let Err(e) = configure_plugin_command(&mut cmd, &pm, &id, options.env.as_ref()) {
            let _ = socket
                .send(axum::extract::ws::Message::Text(
                    serde_json::json!({"type": "stderr", "data": e}).to_string(),
                ))
                .await;
            return;
        }
        cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        if let Some(cwd) = &options.cwd {
            cmd.current_dir(cwd);
        }
        if lifecycle.stdin_lease {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "stderr", "data": e.to_string()}).to_string(),
                    ))
                    .await;
                let _ = socket
                    .send(axum::extract::ws::Message::Text(
                        serde_json::json!({"type": "done"}).to_string(),
                    ))
                    .await;
                return;
            }
        };

        let Some(pid) = child.id() else {
            let _ = socket
                .send(axum::extract::ws::Message::Text(
                    serde_json::json!({"type": "stderr", "data": "failed to get process id"})
                        .to_string(),
                ))
                .await;
            return;
        };
        let process_id = pid.to_string();
        let mut stdin = child.stdin.take();

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let tx2 = tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                if tx2
                    .send(serde_json::json!({"type": "stdout", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                if tx
                    .send(serde_json::json!({"type": "stderr", "data": line + "\n"}).to_string())
                    .is_err()
                {
                    break;
                }
            }
        });

        let (control, mut control_rx) = tokio::sync::mpsc::channel(4);
        pm.processes.entry(id.clone()).or_insert_with(DashMap::new).insert(
            process_id.clone(),
            ManagedProcess {
                info: ProcessInfo {
                    pid,
                    command: bin_path.to_string_lossy().into_owned(),
                    args: args.clone(),
                    state: ProcessState::Running,
                    exit_code: None,
                },
                scope: lifecycle.scope,
                control,
                stop_timeout: managed_process_stop_timeout(&lifecycle),
                stdout: Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new())),
                stderr: Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new())),
            },
        );
        drop(operation_guard);

        let mut stop_waiter = None;
        let mut send_done = false;
        let exit_code = loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    if socket.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
                        let _ = child.kill().await;
                        break None;
                    }
                }
                msg = socket.recv() => {
                    if msg.is_none() {
                        let _ = child.kill().await;
                        break None;
                    }
                }
                status = child.wait() => {
                    send_done = true;
                    break status.ok().and_then(|s| s.code());
                }
                control = control_rx.recv() => {
                    match control {
                        Some(ProcessControl::Stop { finished }) => {
                            stop_waiter = Some(finished);
                            send_done = true;
                            break managed::stop_managed_child(
                                &mut child,
                                &mut stdin,
                                &lifecycle,
                                &id,
                                pid,
                            ).await;
                        }
                        None => {
                            let _ = child.kill().await;
                            break None;
                        }
                    }
                }
            }
        };

        if let Some(proc_map) = pm.processes.get(&id) {
            proc_map.remove(&process_id);
        }
        if let Some(finished) = stop_waiter {
            let _ = finished.send(());
        }
        if send_done {
            let _ = socket
                .send(axum::extract::ws::Message::Text(
                    serde_json::json!({"type": "done", "code": exit_code.unwrap_or(-1)})
                        .to_string(),
                ))
                .await;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{configure_plugin_command, drain_process_output, PROCESS_LOG_BUFFER_BYTES};
    use crate::platform::process::CommandNoWindowExt;
    use crate::plugin::manager::PluginManager;
    use dashmap::DashMap;
    use std::path::Path;
    use std::sync::Arc;
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;

    fn test_manager(root: &Path) -> Arc<PluginManager> {
        Arc::new(PluginManager {
            plugin_dir: root.join("plugins"),
            data_dir: root.join("plugin-data"),
            registry: DashMap::new(),
            processes: DashMap::new(),
            operation_locks: DashMap::new(),
            host_target: crate::plugin::HostTarget::current(),
            host_origin: "http://127.0.0.1:8999".into(),
            host_version: env!("CARGO_PKG_VERSION").into(),
            host_mode: "test".into(),
        })
    }

    #[test]
    fn plugin_cannot_override_reserved_host_environment() {
        let tmp = tempfile::tempdir().unwrap();
        let pm = test_manager(tmp.path());
        std::fs::create_dir_all(pm.plugin_dir.join("test-plugin")).unwrap();
        let mut command = Command::new("unused");
        command.no_window();
        let env = std::collections::HashMap::from([(
            "dinotty_origin".to_string(),
            "http://attacker.invalid".to_string(),
        )]);
        assert!(configure_plugin_command(&mut command, &pm, "test-plugin", Some(&env)).is_err());
    }

    #[tokio::test]
    async fn managed_process_output_ring_is_bounded() {
        let (mut writer, reader) = tokio::io::duplex(128 * 1024);
        let ring = Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new()));
        let drain = tokio::spawn(drain_process_output(reader, Arc::clone(&ring)));
        writer.write_all(&vec![b'x'; PROCESS_LOG_BUFFER_BYTES + 4096]).await.unwrap();
        drop(writer);
        drain.await.unwrap();
        assert_eq!(ring.lock().await.len(), PROCESS_LOG_BUFFER_BYTES);
    }
}

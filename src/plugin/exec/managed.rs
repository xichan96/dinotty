use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::{platform::process::CommandNoWindowExt, session::SessionManager};

use super::{configure_plugin_command, drain_process_output, managed_process_stop_timeout};
use crate::plugin::helpers::plugin_err;
use crate::plugin::manager::PluginManagerState;
use crate::plugin::types::{
    ManagedProcess, PluginStateValue, ProcessControl, ProcessInfo, ProcessLifecycleConfig,
    ProcessStartRequest, ProcessState, ProcessStopAllQuery,
};

struct ManagedProcessContext {
    pm: PluginManagerState,
    manager: Arc<SessionManager>,
    plugin_id: String,
    process_id: String,
    pid: u32,
}

pub(super) async fn stop_managed_child(
    child: &mut tokio::process::Child,
    stdin: &mut Option<tokio::process::ChildStdin>,
    lifecycle: &ProcessLifecycleConfig,
    plugin_id: &str,
    pid: u32,
) -> Option<i32> {
    if lifecycle.stdin_lease {
        if let Some(mut stdin) = stdin.take() {
            let frame = serde_json::json!({
                "type": "shutdown",
                "deadlineMs": lifecycle.shutdown_deadline_ms,
            });
            let _ = stdin.write_all(frame.to_string().as_bytes()).await;
            let _ = stdin.write_all(b"\n").await;
            let _ = stdin.shutdown().await;
        }
        let force_after = Duration::from_millis(lifecycle.force_kill_after_ms);
        if let Ok(status) = tokio::time::timeout(force_after, child.wait()).await {
            return status.ok().and_then(|status| status.code());
        }
        tracing::warn!(plugin_id, pid, "plugin process exceeded graceful shutdown deadline");
    }
    let _ = child.start_kill();
    tokio::time::timeout(super::PROCESS_REAP_GRACE, child.wait())
        .await
        .ok()
        .and_then(Result::ok)
        .and_then(|status| status.code())
}

async fn wait_for_managed_child(
    mut child: tokio::process::Child,
    mut control_rx: tokio::sync::mpsc::Receiver<ProcessControl>,
    lifecycle: &ProcessLifecycleConfig,
    plugin_id: &str,
    pid: u32,
) -> (Option<i32>, Option<tokio::sync::oneshot::Sender<()>>) {
    // Child::wait closes child.stdin, so the lifetime lease must be held separately.
    let mut stdin = child.stdin.take();
    tokio::select! {
        status = child.wait() => (status.ok().and_then(|status| status.code()), None),
        control = control_rx.recv() => {
            match control {
                Some(ProcessControl::Stop { finished }) => (
                    stop_managed_child(
                        &mut child,
                        &mut stdin,
                        lifecycle,
                        plugin_id,
                        pid,
                    ).await,
                    Some(finished),
                ),
                None => {
                    drop(stdin.take());
                    let _ = child.kill().await;
                    (child.wait().await.ok().and_then(|status| status.code()), None)
                }
            }
        }
    }
}

async fn supervise_managed_process(
    child: tokio::process::Child,
    control_rx: tokio::sync::mpsc::Receiver<ProcessControl>,
    lifecycle: ProcessLifecycleConfig,
    context: ManagedProcessContext,
) {
    let (exit_code, stop_waiter) =
        wait_for_managed_child(child, control_rx, &lifecycle, &context.plugin_id, context.pid)
            .await;

    if let Some(proc_map) = context.pm.processes.get(&context.plugin_id) {
        if let Some(mut entry) = proc_map.get_mut(&context.process_id) {
            entry.info.state = ProcessState::Exited;
            entry.info.exit_code = exit_code;
        }
    }
    context.manager.broadcast_sync(&crate::session::SyncMsg::ProcessExited {
        plugin_id: context.plugin_id,
        pid: context.pid,
        exit_code,
    });
    if let Some(finished) = stop_waiter {
        let _ = finished.send(());
    }
}

#[allow(clippy::unused_async)]
pub async fn plugin_process_start(
    Path(id): Path<String>,
    State((pm, manager)): State<(PluginManagerState, Arc<SessionManager>)>,
    Json(body): Json<ProcessStartRequest>,
) -> Response {
    if !pm.registry.contains_key(&id) {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    }
    let operation_lock = pm.operation_lock(&id);
    let _operation = operation_lock.read_owned().await;
    let Some(info) = pm.registry.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found");
    };
    if info.state != PluginStateValue::Active {
        return plugin_err(
            StatusCode::CONFLICT,
            info.error.as_deref().unwrap_or("plugin is not active"),
        );
    }
    let bin = match &info.manifest.bin {
        Some(b) if b.mode == "cli" => b.clone(),
        _ => return plugin_err(StatusCode::BAD_REQUEST, "plugin has no CLI bin"),
    };

    let bin_path = match pm.resolve_plugin_binary(&id, &info.manifest) {
        Ok(path) => path,
        Err(e) => return plugin_err(StatusCode::BAD_REQUEST, &e),
    };
    let mut cmd = Command::new(&bin_path);
    cmd.no_window();
    cmd.args(&body.args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let lifecycle = bin.lifecycle.unwrap_or_default();
    if lifecycle.stdin_lease {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.kill_on_drop(true);
    if let Err(e) = configure_plugin_command(&mut cmd, &pm, &id, body.env.as_ref()) {
        return plugin_err(StatusCode::BAD_REQUEST, &e);
    }
    if let Some(ref cwd) = body.cwd {
        cmd.current_dir(cwd);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let Some(pid) = child.id() else {
        return plugin_err(StatusCode::INTERNAL_SERVER_ERROR, "failed to get process id");
    };
    let proc_id = pid.to_string();
    let stdout = Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new()));
    let stderr = Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new()));
    if let Some(reader) = child.stdout.take() {
        tokio::spawn(drain_process_output(reader, Arc::clone(&stdout)));
    }
    if let Some(reader) = child.stderr.take() {
        tokio::spawn(drain_process_output(reader, Arc::clone(&stderr)));
    }
    let (control, control_rx) = tokio::sync::mpsc::channel(4);

    let managed_proc = ManagedProcess {
        info: ProcessInfo {
            pid,
            command: bin_path.to_string_lossy().into_owned(),
            args: body.args.clone(),
            state: ProcessState::Running,
            exit_code: None,
        },
        scope: lifecycle.scope,
        control,
        stop_timeout: managed_process_stop_timeout(&lifecycle),
        stdout,
        stderr,
    };

    pm.processes
        .entry(id.clone())
        .or_insert_with(DashMap::new)
        .insert(proc_id.clone(), managed_proc);

    let pm_clone = Arc::clone(&pm);
    let manager_clone = Arc::clone(&manager);
    let plugin_id = id.clone();
    tokio::spawn(supervise_managed_process(
        child,
        control_rx,
        lifecycle,
        ManagedProcessContext {
            pm: pm_clone,
            manager: manager_clone,
            plugin_id,
            process_id: proc_id,
            pid,
        },
    ));

    Json(serde_json::json!({
        "pid": pid,
        "command": bin_path.to_string_lossy(),
        "args": body.args,
        "state": "running"
    }))
    .into_response()
}

#[allow(clippy::unused_async)]
pub async fn plugin_process_list(
    Path(id): Path<String>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return Json(serde_json::json!([])).into_response();
    };
    let list: Vec<ProcessInfo> = proc_map.iter().map(|e| e.value().info.clone()).collect();
    Json(list).into_response()
}

pub async fn plugin_process_stop(
    Path((id, pid_str)): Path<(String, String)>,
    State(pm): State<PluginManagerState>,
) -> Response {
    let Some(proc_map) = pm.processes.get(&id) else {
        return plugin_err(StatusCode::NOT_FOUND, "no processes for plugin");
    };
    let Some(entry) = proc_map.get(&pid_str) else {
        return plugin_err(StatusCode::NOT_FOUND, "process not found");
    };
    let control = entry.control.clone();
    let stop_timeout = entry.stop_timeout;
    drop(entry);
    let (finished, wait) = tokio::sync::oneshot::channel();
    match control.try_send(ProcessControl::Stop { finished }) {
        Ok(()) => {}
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
            proc_map.remove(&pid_str);
            return plugin_err(StatusCode::CONFLICT, "process already exited");
        }
        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
            return plugin_err(StatusCode::CONFLICT, "process stop already requested");
        }
    }
    drop(proc_map);
    match tokio::time::timeout(stop_timeout, wait).await {
        Ok(Ok(())) => {
            if let Some(proc_map) = pm.processes.get(&id) {
                proc_map.remove(&pid_str);
            }
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(Err(_)) => {
            let already_stopped = pm.processes.get(&id).is_none_or(|proc_map| {
                proc_map
                    .get(&pid_str)
                    .is_none_or(|entry| matches!(&entry.info.state, ProcessState::Exited))
            });
            if already_stopped {
                if let Some(proc_map) = pm.processes.get(&id) {
                    proc_map.remove(&pid_str);
                }
                StatusCode::NO_CONTENT.into_response()
            } else {
                plugin_err(StatusCode::CONFLICT, "process stop acknowledgement was dropped")
            }
        }
        Err(_) => plugin_err(StatusCode::GATEWAY_TIMEOUT, "timed out while stopping process"),
    }
}

pub async fn plugin_process_stop_all(
    Path(id): Path<String>,
    Query(query): Query<ProcessStopAllQuery>,
    State(pm): State<PluginManagerState>,
) -> Response {
    match pm.kill_plugin_processes_with_scope(&id, query.scope).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => plugin_err(StatusCode::GATEWAY_TIMEOUT, &e),
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_managed_child;
    use crate::platform::process::CommandNoWindowExt;
    use crate::plugin::types::{ProcessControl, ProcessLifecycleConfig, ProcessLifecycleScope};
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    #[tokio::test]
    async fn managed_process_wait_keeps_stdin_lease_open_until_stop() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.no_window();
            command.args([
                "/Q",
                "/D",
                "/C",
                "echo READY& set /p line=& if errorlevel 1 (echo EOF& exit /b 42) else (echo STOP& exit /b 0)",
            ]);
            command
        };
        #[cfg(unix)]
        let mut command = {
            let mut command = Command::new("sh");
            command.no_window();
            command.args([
                "-c",
                "printf 'READY\\n'; if IFS= read -r line; then printf 'STOP\\n'; exit 0; else printf 'EOF\\n'; exit 42; fi",
            ]);
            command
        };
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut output = BufReader::new(stdout).lines();
        let lifecycle = ProcessLifecycleConfig {
            scope: ProcessLifecycleScope::Host,
            stdin_lease: true,
            shutdown_deadline_ms: 1_000,
            force_kill_after_ms: 2_000,
        };
        let (control, control_rx) = tokio::sync::mpsc::channel(1);
        let supervisor = tokio::spawn(async move {
            wait_for_managed_child(child, control_rx, &lifecycle, "test-plugin", pid).await
        });

        let ready = tokio::time::timeout(Duration::from_secs(5), output.next_line())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ready.as_deref(), Some("READY"));
        assert!(
            tokio::time::timeout(Duration::from_millis(250), output.next_line()).await.is_err(),
            "stdin lease closed while waiting for the child"
        );

        let (finished, stopped) = tokio::sync::oneshot::channel();
        control.send(ProcessControl::Stop { finished }).await.unwrap();
        let stopped_output = tokio::time::timeout(Duration::from_secs(5), output.next_line())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stopped_output.as_deref(), Some("STOP"));
        let (exit_code, stop_waiter) = supervisor.await.unwrap();
        assert_eq!(exit_code, Some(0));
        stop_waiter.unwrap().send(()).unwrap();
        stopped.await.unwrap();
    }
}

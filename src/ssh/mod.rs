pub mod host_key;
pub mod sftp;

use crate::event_bus::BusEvent;
use crate::session::{
    CwdState, PendingSshAuth, Session, SessionBackend, SessionManager, SessionStatus,
    SshAuthPrompt, SshCmd, SshSessionParams, SyncMsg,
};
use crate::settings::SshAuthMethod;
use crate::vt_screen::VirtualScreen;
use russh::client;
use russh::keys::{decode_secret_key, load_secret_key, PrivateKeyWithHashAlg, PublicKey};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tracing::{debug, error, info, warn};

/// SSH 连接超时配置
pub struct SshTimeouts {
    pub tcp_connect: Duration,
    pub auth: Duration,
    pub channel_open: Duration,
    pub command_exec: Duration,
}

impl Default for SshTimeouts {
    fn default() -> Self {
        Self {
            tcp_connect: Duration::from_secs(10),
            auth: Duration::from_secs(15),
            channel_open: Duration::from_secs(5),
            command_exec: Duration::from_secs(5),
        }
    }
}

/// SSH 客户端 Handler
pub(crate) struct SshClientHandler {
    verifier: host_key::HostKeyVerifier,
    host: String,
    port: u16,
}

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_bytes = server_public_key
            .to_bytes()
            .map_err(|e| russh::Error::from(std::io::Error::other(e.to_string())))?
            .clone();
        let key_type = format!("{:?}", server_public_key.algorithm());

        match self.verifier.verify(&self.host, self.port, &key_bytes, &key_type) {
            Ok(()) => Ok(true),
            Err(host_key::HostKeyError::UnknownHost { .. }) => {
                // 首次连接：自动接受并保存（类似 StrictHostKeyChecking=accept-new）
                info!("Accepting new host key for {}:{}", self.host, self.port);
                let _ = self.verifier.accept_and_save(&self.host, self.port, &key_bytes, &key_type);
                Ok(true)
            }
            Err(host_key::HostKeyError::KeyMismatch {
                host,
                stored_fingerprint,
                received_fingerprint,
            }) => {
                error!(
                    "Host key MISMATCH for {}! stored={} received={}",
                    host, stored_fingerprint, received_fingerprint
                );
                Err(russh::Error::from(std::io::Error::other(format!(
                    "Host key mismatch for {host}. Potential MITM attack. \
                         Remove the old key from known_hosts to reconnect."
                ))))
            }
        }
    }
}

/// 校验 SSH key 文件路径
///
/// - 必须是绝对路径
/// - 解析符号链接，防止路径穿越
/// - Unix 必须在 ~/.ssh/ 或 /etc/ssh/ 下，Windows 必须在 %USERPROFILE%\.ssh 下
/// - 文件权限不能过于宽松（Unix: 0600/0400）
fn validate_key_path(key_path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(key_path);

    if !p.is_absolute() {
        return Err("Key path must be absolute".into());
    }

    let canonical = p.canonicalize().map_err(|e| format!("Cannot resolve key path: {e}"))?;

    let home_ssh = ssh_home_dir()
        .map(|h| h.join(".ssh"))
        .ok_or("Cannot determine home directory")?
        .canonicalize()
        .map_err(|e| format!("Cannot resolve ~/.ssh: {e}"))?;

    if !is_allowed_key_path(&canonical, &home_ssh) {
        return Err(allowed_key_path_error());
    }

    crate::platform::fs::validate_private_key_permissions(&canonical)?;

    Ok(canonical)
}

fn ssh_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
    }
    #[cfg(not(windows))]
    {
        dirs::home_dir()
    }
}

fn is_allowed_key_path(canonical: &Path, home_ssh: &Path) -> bool {
    if path_within_or_equal(canonical, home_ssh) {
        return true;
    }

    #[cfg(unix)]
    {
        path_within_or_equal(canonical, Path::new("/etc/ssh"))
    }

    #[cfg(not(unix))]
    {
        false
    }
}

fn allowed_key_path_error() -> String {
    #[cfg(windows)]
    {
        "Key file must be in %USERPROFILE%\\.ssh\\".into()
    }
    #[cfg(unix)]
    {
        "Key file must be in ~/.ssh/ or /etc/ssh/".into()
    }
    #[cfg(not(any(unix, windows)))]
    {
        "Key file must be in the user's .ssh directory".into()
    }
}

fn path_within_or_equal(path: &Path, dir: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = normalize_windows_path_for_compare(path);
        let dir = normalize_windows_path_for_compare(dir);
        let dir_with_sep = format!("{dir}\\");
        path == dir || path.starts_with(&dir_with_sep)
    }

    #[cfg(not(windows))]
    {
        path == dir || path.starts_with(dir)
    }
}

#[cfg(windows)]
fn normalize_windows_path_for_compare(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('/', "\\");
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    stripped.trim_end_matches('\\').to_ascii_lowercase()
}

#[cfg(test)]
mod key_path_tests {
    use super::{is_allowed_key_path, validate_key_path};
    use std::path::Path;

    #[cfg(windows)]
    fn with_temp_home<T>(f: impl FnOnce(&Path) -> T) -> T {
        let _env = crate::test_support::EnvGuard::new(&["HOME", "USERPROFILE"]);
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
        f(&home)
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_allows_windows_home_ssh_key() {
        with_temp_home(|home| {
            let key = home.join(".ssh").join("id_ed25519");
            std::fs::write(&key, "key").unwrap();

            let resolved = validate_key_path(&key.to_string_lossy()).unwrap();

            assert_eq!(resolved, key.canonicalize().unwrap());
        });
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_allows_windows_long_path_prefix() {
        with_temp_home(|home| {
            let key = home.join(".ssh").join("id_ed25519");
            std::fs::write(&key, "key").unwrap();
            let long_path = format!(r"\\?\{}", key.display());

            let resolved = validate_key_path(&long_path).unwrap();

            assert_eq!(resolved, key.canonicalize().unwrap());
        });
    }

    #[cfg(windows)]
    #[test]
    fn allowed_key_path_accepts_windows_long_path_prefix() {
        assert!(is_allowed_key_path(
            Path::new(r"\\?\C:\Users\me\.ssh\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    // 验证 .ssh_evil 这类前缀相似目录不能绕过 .ssh 边界。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_rejects_windows_ssh_prefix_sibling() {
        assert!(!is_allowed_key_path(
            Path::new(r"C:\Users\me\.ssh_evil\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    // 验证 Windows 路径比较兼容大小写差异和 /、\ 混用。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_accepts_windows_case_and_separator_variants() {
        assert!(is_allowed_key_path(
            Path::new(r"C:/USERS/me/.SSH/id_ed25519"),
            Path::new(r"c:\users\ME\.ssh"),
        ));
    }

    // 验证带 \\?\ 前缀的相似目录仍不能绕过 .ssh 边界。
    #[cfg(windows)]
    #[test]
    fn allowed_key_path_rejects_windows_long_path_prefix_sibling() {
        assert!(!is_allowed_key_path(
            Path::new(r"\\?\C:\Users\me\.ssh_evil\id_ed25519"),
            Path::new(r"C:\Users\me\.ssh"),
        ));
    }

    #[cfg(windows)]
    #[test]
    fn validate_key_path_rejects_key_outside_home_ssh() {
        with_temp_home(|home| {
            let outside = home.parent().unwrap().join("outside_id_ed25519");
            std::fs::write(&outside, "key").unwrap();

            let err = validate_key_path(&outside.to_string_lossy()).unwrap_err();

            assert!(err.contains("%USERPROFILE%"));
        });
    }

    // 验证 Windows 下 USERPROFILE 优先于 HOME，HOME\.ssh 中的 key 不应放行。
    #[cfg(windows)]
    #[test]
    fn validate_key_path_prefers_userprofile_over_home() {
        let _env = crate::test_support::EnvGuard::new(&["HOME", "USERPROFILE"]);
        let tmp = tempfile::tempdir().unwrap();
        let userprofile = tmp.path().join("userprofile");
        let home = tmp.path().join("home");
        std::fs::create_dir_all(userprofile.join(".ssh")).unwrap();
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::env::set_var("USERPROFILE", &userprofile);
        std::env::set_var("HOME", &home);
        let home_key = home.join(".ssh").join("id_ed25519");
        std::fs::write(&home_key, "key").unwrap();

        let err = validate_key_path(&home_key.to_string_lossy()).unwrap_err();

        assert!(err.contains("%USERPROFILE%"), "unexpected error: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn allowed_key_path_allows_etc_ssh_on_unix() {
        assert!(is_allowed_key_path(
            Path::new("/etc/ssh/ssh_host_ed25519_key"),
            Path::new("/home/me/.ssh"),
        ));
    }
}

/// 创建 SSH 会话
///
/// # Errors
/// 返回连接失败的错误信息
#[allow(clippy::too_many_lines)]
pub async fn create_ssh_session(
    manager: &Arc<SessionManager>,
    pane_id: &str,
    params: SshSessionParams,
    tauri_on_exit: Option<Arc<dyn Fn(String) + Send + Sync>>,
) -> Result<(Arc<Session>, String), String> {
    let timeouts = SshTimeouts::default();

    // 1. 建立 SSH 连接
    let config = russh::client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    };
    let config = Arc::new(config);

    let addr = format!("{}:{}", params.host, params.port);
    let socket = tokio::time::timeout(timeouts.tcp_connect, tokio::net::TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("Connection timed out: {addr}"))?
        .map_err(|e| format!("TCP connect failed: {e}"))?;

    // 2. SSH 握手
    let handler = SshClientHandler {
        verifier: host_key::HostKeyVerifier::new(),
        host: params.host.clone(),
        port: params.port,
    };
    let mut session = client::connect_stream(config, socket, handler)
        .await
        .map_err(|e| format!("SSH handshake failed: {e}"))?;

    // 3. 认证
    let auth_result = match &params.auth_method {
        SshAuthMethod::Password { password } => tokio::time::timeout(
            timeouts.auth,
            session.authenticate_password(&params.username, password.expose()),
        )
        .await
        .map_err(|_| "Authentication timed out".to_string())?
        .map_err(|e| format!("Auth failed: {e}"))?,
        SshAuthMethod::KeyFile { key_path, passphrase } => {
            let key_path = validate_key_path(key_path)?;
            let key_pair = load_secret_key(
                &key_path,
                passphrase.as_ref().map(super::settings::SensitiveString::expose),
            )
            .map_err(|e| format!("Failed to load key: {e}"))?;
            let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            tokio::time::timeout(
                timeouts.auth,
                session.authenticate_publickey(&params.username, key_with_alg),
            )
            .await
            .map_err(|_| "Authentication timed out".to_string())?
            .map_err(|e| format!("Auth failed: {e}"))?
        }
        SshAuthMethod::KeyInline { private_key, passphrase } => {
            let key_str = private_key.expose();
            let key_pair = decode_secret_key(
                key_str,
                passphrase.as_ref().map(super::settings::SensitiveString::expose),
            )
            .map_err(|e| format!("Failed to parse key: {e}"))?;
            let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            tokio::time::timeout(
                timeouts.auth,
                session.authenticate_publickey(&params.username, key_with_alg),
            )
            .await
            .map_err(|_| "Authentication timed out".to_string())?
            .map_err(|e| format!("Auth failed: {e}"))?
        }
    };

    // 3b. 如果密码认证失败，尝试 keyboard-interactive（2FA 场景）
    let auth_result = if auth_result.success() {
        auth_result
    } else {
        info!(
            "Password auth failed for {}@{}, trying keyboard-interactive",
            params.username, params.host
        );
        match try_keyboard_interactive_auth(
            &mut session,
            &params.username,
            manager,
            pane_id,
            &timeouts,
        )
        .await
        {
            Ok(result) => result,
            Err(e) => {
                warn!("Keyboard-interactive auth also failed: {}", e);
                return Err("Authentication failed".to_string());
            }
        }
    };

    if !auth_result.success() {
        return Err("Authentication failed".to_string());
    }
    info!("SSH authenticated as {}@{}", params.username, params.host);

    // 4. 打开 channel
    let channel = tokio::time::timeout(timeouts.channel_open, session.channel_open_session())
        .await
        .map_err(|_| "Channel open timed out".to_string())?
        .map_err(|e| format!("Channel open failed: {e}"))?;

    // 5. 请求 PTY
    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {e}"))?;

    // 6. 请求 shell 或自定义命令
    if let Some(ref cmd) = params.default_command {
        tokio::time::timeout(timeouts.command_exec, channel.exec(true, cmd.as_bytes()))
            .await
            .map_err(|_| "Command exec timed out".to_string())?
            .map_err(|e| format!("Exec failed: {e}"))?;
    } else {
        let initial_cwd = params.initial_cwd.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());
        if let Some(cwd) = initial_cwd {
            let escaped = cwd.replace('\'', "'\\''");
            // Inject PROMPT_COMMAND so bash reports its CWD via OSC 0 title
            // sequences (`\033]0;user@host:path\007`). The backend's
            // `sniff_cwd_from_title_osc` parses this to track cwd changes,
            // which the file browser and workspace matcher rely on. This
            // mirrors the local PTY shell integration in `pty.rs`.
            // We send `${PWD}` (absolute) rather than `${PWD/#$HOME/~}` because
            // the backend's `parse_title_cwd` resolves `~` against the *local*
            // home, which is wrong for SSH sessions.
            // Note: only bash honors PROMPT_COMMAND; zsh falls back to no
            // tracking (initial cd still works via `exec $SHELL -l`).
            let prompt_command = r#"history -a; history -r; printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD}"; printf "\033]133;A\033\\"; printf "\033]133;D;%d\033\\" $?"#;
            let cmd = format!(
                "cd '{escaped}' && export PROMPT_COMMAND='{prompt_command}' && exec \"${{SHELL:-/bin/bash}}\" -l"
            );
            info!("SSH exec command for {}: {}", pane_id, cmd);
            tokio::time::timeout(timeouts.command_exec, channel.exec(true, cmd.as_bytes()))
                .await
                .map_err(|_| "Command exec timed out".to_string())?
                .map_err(|e| format!("Exec failed: {e}"))?;
        } else {
            channel.request_shell(true).await.map_err(|e| format!("Shell request failed: {e}"))?;
        }
    }

    info!("SSH channel opened for {}", pane_id);

    // 7. 查询远程 home 目录
    let remote_home = {
        let mut ch = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open exec channel for home query: {e}"))?;
        ch.exec(true, b"echo $HOME")
            .await
            .map_err(|e| format!("Failed to exec echo $HOME: {e}"))?;
        let mut home_out = Vec::new();
        let deadline = tokio::time::Instant::now() + timeouts.command_exec;
        loop {
            match tokio::time::timeout_at(deadline, ch.wait()).await {
                Ok(Some(russh::ChannelMsg::Data { data })) => home_out.extend_from_slice(&data),
                Ok(
                    Some(
                        russh::ChannelMsg::ExitStatus { .. }
                        | russh::ChannelMsg::Eof
                        | russh::ChannelMsg::Close,
                    )
                    | None,
                )
                | Err(_) => break,
                _ => {}
            }
        }
        let home_str = String::from_utf8_lossy(&home_out).trim().to_string();
        if home_str.is_empty() || !home_str.starts_with('/') {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
        } else {
            PathBuf::from(home_str)
        }
    };
    info!("Remote home for {}: {}", pane_id, remote_home.display());

    // Initial cwd: prefer the workspace-specified path, fall back to remote $HOME.
    let initial_cwd_path =
        params.initial_cwd.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(PathBuf::from);
    let effective_cwd = initial_cwd_path.unwrap_or_else(|| remote_home.clone());

    // 8. 构造 Session
    let (resize_tx, resize_rx) = watch::channel(None);
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let (ssh_cmd_tx, ssh_cmd_rx) = mpsc::unbounded_channel();

    let session_arc = Arc::new(Session {
        backend: tokio::sync::Mutex::new(SessionBackend::Ssh),
        ssh_params: Some(params.clone()),
        screen: std::sync::Mutex::new(VirtualScreen::new(80, 24)),
        clients: std::sync::Mutex::new(Vec::new()),
        next_client_id: std::sync::atomic::AtomicU64::new(1),
        tauri_client_id: std::sync::Mutex::new(None),
        input_tx: std::sync::Mutex::new(None),
        status: std::sync::Mutex::new(SessionStatus::Connected),
        size: std::sync::Mutex::new((80, 24)),
        exited: std::sync::Mutex::new(false),
        shell_type: "ssh".to_string(),
        tauri_on_exit: std::sync::Mutex::new(tauri_on_exit),
        cwd_state: std::sync::Mutex::new(CwdState { cwd: effective_cwd, sniff_buf: Vec::new() }),
        sync: std::sync::Mutex::new(crate::session::SyncState::default()),
        #[cfg(test)]
        sync_disable_hook: std::sync::Mutex::new(None),
        resize_tx,
        ssh_cmd_tx: std::sync::Mutex::new(Some(ssh_cmd_tx)),
        ssh_handle: tokio::sync::Mutex::new(None),
        sftp_session: std::sync::Mutex::new(None),
        remote_home: std::sync::Mutex::new(Some(remote_home.clone())),
        remote_user: std::sync::Mutex::new(None),
        output_tx,
        output_rx: std::sync::Mutex::new(Some(output_rx)),
        pending_results: std::sync::Mutex::new(Vec::new()),
    });

    // 9. 存储 SSH client handle（用于后续打开 SFTP/exec channel）
    *session_arc.ssh_handle.lock().await = Some(Box::new(session));

    // 10. 插入 SessionManager
    manager.sessions.insert(pane_id.to_string(), Arc::clone(&session_arc));

    // 11. 启动 SSH reader/writer task（拥有 channel，通过 select! 处理读写）
    let read_session = Arc::clone(&session_arc);
    let read_pane_id = pane_id.to_string();
    let read_manager = Arc::clone(manager);
    tokio::spawn(async move {
        ssh_reader_task(read_session, channel, ssh_cmd_rx, read_pane_id, read_manager).await;
    });

    // 12. 启动 broadcast task
    let broadcast_session = Arc::clone(&session_arc);
    let broadcast_manager = Arc::clone(manager);
    let broadcast_pane_id = pane_id.to_string();
    tokio::spawn(async move {
        crate::pty::broadcast_task(broadcast_session, broadcast_pane_id, broadcast_manager).await;
    });

    // 13. 启动 resize debounce task
    let resize_session = Arc::clone(&session_arc);
    let resize_pane_id = pane_id.to_string();
    tokio::spawn(async move {
        resize_debounce_task(resize_session, resize_rx, resize_pane_id).await;
    });

    // 14. 发布事件
    manager.event_bus.publish(BusEvent::SessionCreated {
        pane_id: pane_id.to_string(),
        shell_type: "ssh".to_string(),
    });

    info!("SSH session created for {}", pane_id);
    Ok((session_arc, "ssh".to_string()))
}

/// 尝试 keyboard-interactive 认证（2FA 场景）
///
/// 通过 `SessionManager` 的 `pending_ssh_auth` 通道与前端交互：
/// 1. 发送 prompts 到前端
/// 2. 等待前端返回 responses
/// 3. 循环直到认证成功或失败
async fn try_keyboard_interactive_auth(
    session: &mut client::Handle<SshClientHandler>,
    username: &str,
    manager: &Arc<SessionManager>,
    pane_id: &str,
    _timeouts: &SshTimeouts,
) -> Result<client::AuthResult, String> {
    use russh::client::KeyboardInteractiveAuthResponse;

    // 创建通道
    let (prompts_tx, prompts_rx) = mpsc::unbounded_channel::<Vec<SshAuthPrompt>>();
    let (responses_tx, responses_rx) = mpsc::unbounded_channel::<Vec<String>>();

    // 注册到 SessionManager
    manager.pending_ssh_auth.insert(
        pane_id.to_string(),
        PendingSshAuth {
            prompts_tx: prompts_tx.clone(),
            prompts_rx: tokio::sync::Mutex::new(prompts_rx),
            responses_tx: responses_tx.clone(),
            responses_rx: tokio::sync::Mutex::new(responses_rx),
        },
    );

    // 启动 keyboard-interactive 认证
    let result = session
        .authenticate_keyboard_interactive_start(username, None)
        .await
        .map_err(|e| format!("Keyboard-interactive start failed: {e}"))?;

    let mut current_result = result;

    loop {
        match current_result {
            KeyboardInteractiveAuthResponse::Success => {
                manager.pending_ssh_auth.remove(pane_id);
                return Ok(client::AuthResult::Success);
            }
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                manager.pending_ssh_auth.remove(pane_id);
                return Err("Keyboard-interactive auth failed".to_string());
            }
            KeyboardInteractiveAuthResponse::InfoRequest { name: _, instructions: _, prompts } => {
                // 转换 prompts 为前端格式
                let ssh_prompts: Vec<SshAuthPrompt> = prompts
                    .iter()
                    .map(|p| SshAuthPrompt { prompt: p.prompt.clone(), echo: p.echo })
                    .collect();

                // 通过通道发送 prompts（需要重新获取 prompts_tx）
                // 由于我们已经注册了 PendingSshAuth，直接通过它发送
                if let Some(auth) = manager.pending_ssh_auth.get(pane_id) {
                    let _ = auth.prompts_tx.send(ssh_prompts);
                }

                // 等待前端返回 responses（带超时）
                let response = {
                    let auth =
                        manager.pending_ssh_auth.get(pane_id).ok_or("Auth channel not found")?;
                    let mut rx = auth.responses_rx.lock().await;
                    tokio::time::timeout(Duration::from_mins(2), rx.recv())
                        .await
                        .map_err(|_| "Keyboard-interactive response timed out".to_string())?
                        .ok_or("Auth channel closed".to_string())?
                };

                // 发送 responses
                current_result = session
                    .authenticate_keyboard_interactive_respond(response)
                    .await
                    .map_err(|e| format!("Keyboard-interactive respond failed: {e}"))?;
            }
        }
    }
}

/// SSH reader task: 从 SSH channel 读取数据并广播
async fn ssh_reader_task(
    session: Arc<Session>,
    mut channel: russh::Channel<russh::client::Msg>,
    mut ssh_cmd_rx: mpsc::UnboundedReceiver<SshCmd>,
    pane_id: String,
    manager: Arc<SessionManager>,
) {
    loop {
        tokio::select! {
            // 从 SSH channel 读取服务端数据
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        let bytes = data.to_vec();
                        // CWD sniffing (same as local PTY in pty.rs)
                        session.on_pty_output(&bytes);
                        {
                            let mut screen =
                                session.screen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                            screen.feed(&bytes);
                        }
                        let _ = session.output_tx.send(bytes);
                    }
                    Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        let bytes = data.to_vec();
                        let _ = session.output_tx.send(bytes);
                    }
                    Some(russh::ChannelMsg::Eof | russh::ChannelMsg::Close) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            // 处理来自 Session 方法的命令（输入、resize、关闭）
            cmd = ssh_cmd_rx.recv() => {
                match cmd {
                    Some(SshCmd::Input(data)) => {
                        let cursor = std::io::Cursor::new(data);
                        if let Err(e) = channel.data(cursor).await {
                            error!("SSH write failed: {e}, pane={}", pane_id);
                            break;
                        }
                    }
                    Some(SshCmd::Resize(cols, rows)) => {
                        debug!("SSH window_change: {cols}x{rows}, pane={pane_id}");
                        if let Err(e) = channel.window_change(u32::from(cols), u32::from(rows), 0, 0).await {
                            error!("SSH resize failed: {e}, pane={}", pane_id);
                        }
                    }
                    Some(SshCmd::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
        }
    }

    // 清理：清除 ssh_cmd_tx 以防止后续发送
    *session.ssh_cmd_tx.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;

    if session.notify_exit_and_mark_exited(&pane_id) {
        manager.sessions.remove(&pane_id);
        manager.pane_closed_notify(&pane_id);
        manager
            .event_bus
            .publish(BusEvent::SessionClosed { pane_id: pane_id.clone(), exit_code: None });
        if let Some(tab_pane_id) = manager.on_pty_exited(&pane_id) {
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_pane_id });
        }
    }
    if let Some(cb) =
        session.tauri_on_exit.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
    {
        cb(pane_id.clone());
    }

    info!("SSH reader task exited, pane={}", pane_id);
}

/// Resize debounce task — coalesces rapid resize events before sending
/// SSH `window-change`, similar to how the local kernel coalesces SIGWINCH.
///
/// Pattern: `borrow()` + conditional apply after 300ms sleep.
/// During a divider drag the frontend sends a resize every ~25ms.
/// The300ms window lets intermediate values collapse: if the value
/// changes during sleep, we skip and re-enter the loop. Only when
/// the drag stops (no new values for 300ms) do we apply the final size.
async fn resize_debounce_task(
    session: Arc<Session>,
    mut resize_rx: watch::Receiver<Option<(u64, u16, u16)>>,
    pane_id: String,
) {
    loop {
        if resize_rx.changed().await.is_err() {
            break;
        }
        let size = *resize_rx.borrow();
        if let Some((origin, cols, rows)) = size {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let latest = *resize_rx.borrow();
            if latest == Some((origin, cols, rows)) {
                debug!("SSH resize debounce: applying {cols}x{rows}, pane={pane_id}");
                let session = Arc::clone(&session);
                let _ = tokio::task::spawn_blocking(move || {
                    session.apply_and_broadcast_resize(origin, cols, rows);
                })
                .await;
            }
        }
    }
}

/// SSH 连接参数（用于 API 请求）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshConnectRequest {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default = "default_ssh_username")]
    pub username: String,
    pub auth: SshAuthMethod,
    #[serde(default)]
    pub default_command: Option<String>,
    /// Optional profile ID — set when connecting from a saved profile
    /// so the session can be linked back to the profile for workspace matching.
    #[serde(default)]
    pub profile_id: Option<String>,
    /// Optional initial remote directory. When set, the shell runs `cd` to this
    /// path after startup. Ignored if `default_command` is set.
    #[serde(default)]
    pub initial_cwd: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

fn default_ssh_username() -> String {
    "root".into()
}

impl SshConnectRequest {
    #[must_use]
    pub fn to_params(&self) -> SshSessionParams {
        SshSessionParams {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            auth_method: self.auth.clone(),
            default_command: self.default_command.clone(),
            profile_id: self.profile_id.clone(),
            initial_cwd: self.initial_cwd.clone(),
        }
    }
}

/// 从 Profile ID 创建 SSH 会话的请求
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SshProfileConnectRequest {
    pub profile_id: String,
    /// Optional initial remote directory. When set, the shell runs `cd` to this
    /// path after startup. Ignored if the profile has a `default_command`.
    #[serde(default)]
    pub initial_cwd: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Test: `borrow()` + conditional apply with 300ms debounce.
    /// Simulates rapid frontend resize messages during a divider drag,
    /// then verifies only one resize is applied after the drag stops.
    #[tokio::test]
    async fn test_resize_debounce_conditional_300ms() {
        let (tx, mut rx) = watch::channel(None::<(u16, u16)>);
        let apply_count = Arc::new(AtomicUsize::new(0));
        let last_applied = Arc::new(std::sync::Mutex::new(None::<(u16, u16)>));

        let ac = Arc::clone(&apply_count);
        let la = Arc::clone(&last_applied);

        // Same pattern as resize_debounce_task: borrow_and_update() + conditional apply
        tokio::spawn(async move {
            loop {
                if rx.changed().await.is_err() {
                    break;
                }
                let size = *rx.borrow_and_update();
                if let Some((cols, rows)) = size {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    let latest = *rx.borrow();
                    if latest == Some((cols, rows)) {
                        ac.fetch_add(1, Ordering::SeqCst);
                        *la.lock().unwrap() = Some((cols, rows));
                    }
                }
            }
        });

        // Phase 1: Simulate drag — rapid resizes every 25ms for 500ms
        for i in 0..20 {
            let cols = 100 + i;
            let _ = tx.send(Some((cols, 24)));
            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        // Phase 2: Drag stopped — wait for debounce to settle (300ms + buffer)
        tokio::time::sleep(Duration::from_millis(500)).await;

        let count = apply_count.load(Ordering::SeqCst);
        let final_size = *last_applied.lock().unwrap();

        println!("Conditional 300ms - apply count: {count}, final size: {final_size:?}");

        // Should apply exactly once — the final size after drag stops
        assert_eq!(count, 1, "Expected exactly 1 apply, got {count}");
        assert_eq!(final_size, Some((119, 24)));
    }

    /// Test: simulate a realistic 3-second divider drag with resize every 25ms.
    /// Verifies that only a handful of resizes are applied (not one per message).
    #[tokio::test]
    async fn test_resize_debounce_realistic_drag() {
        let (tx, mut rx) = watch::channel(None::<(u16, u16)>);
        let apply_count = Arc::new(AtomicUsize::new(0));
        let applied_sizes = Arc::new(std::sync::Mutex::new(Vec::<(u16, u16)>::new()));

        let ac = Arc::clone(&apply_count);
        let sizes = Arc::clone(&applied_sizes);

        tokio::spawn(async move {
            loop {
                if rx.changed().await.is_err() {
                    break;
                }
                let size = *rx.borrow_and_update();
                if let Some((cols, rows)) = size {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    let latest = *rx.borrow();
                    if latest == Some((cols, rows)) {
                        ac.fetch_add(1, Ordering::SeqCst);
                        sizes.lock().unwrap().push((cols, rows));
                    }
                }
            }
        });

        // Simulate a 3-second drag: resize every 25ms, cols from 80 to 200.
        let total_steps: u16 = 3000 / 25;
        for i in 0..total_steps {
            let cols = 80 + i;
            let _ = tx.send(Some((cols, 24)));
            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        // Wait for debounce to settle (300ms task sleep + buffer)
        tokio::time::sleep(Duration::from_millis(800)).await;

        let count = apply_count.load(Ordering::SeqCst);
        let applied = applied_sizes.lock().unwrap().clone();

        println!("Realistic drag - total messages: {total_steps}, applies: {count}");
        println!("Applied sizes: {applied:?}");

        // Should apply only once — the final size (80+119=199, 24)
        assert_eq!(count, 1, "Expected exactly 1 apply during drag, got {count}");
        assert_eq!(applied[0], (199, 24));
    }

    /// Test: drag and return to original size (edge case).
    /// Verifies that even if the final size equals the initial size,
    /// the resize is still applied.
    #[tokio::test]
    async fn test_resize_debounce_return_to_original() {
        let (tx, mut rx) = watch::channel(None::<(u16, u16)>);
        let apply_count = Arc::new(AtomicUsize::new(0));
        let last_applied = Arc::new(std::sync::Mutex::new(None::<(u16, u16)>));

        let ac = Arc::clone(&apply_count);
        let la = Arc::clone(&last_applied);

        tokio::spawn(async move {
            loop {
                if rx.changed().await.is_err() {
                    break;
                }
                let size = *rx.borrow_and_update();
                if let Some((cols, rows)) = size {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    let latest = *rx.borrow();
                    if latest == Some((cols, rows)) {
                        ac.fetch_add(1, Ordering::SeqCst);
                        *la.lock().unwrap() = Some((cols, rows));
                    }
                }
            }
        });

        // Drag right, then back to original
        let _ = tx.send(Some((100, 24)));
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = tx.send(Some((110, 24)));
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = tx.send(Some((100, 24))); // back to original
        tokio::time::sleep(Duration::from_millis(500)).await;

        let count = apply_count.load(Ordering::SeqCst);
        let final_size = *last_applied.lock().unwrap();

        println!("Return to original - apply count: {count}, final size: {final_size:?}");

        // tmux also applies twice for the "return to original" edge case
        assert!((1..=2).contains(&count), "Expected 1-2 applies, got {count}");
        assert_eq!(final_size, Some((100, 24)));
    }
}

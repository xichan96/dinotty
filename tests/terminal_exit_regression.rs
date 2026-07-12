use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::error::Error;
use std::fs;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header::COOKIE, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

#[cfg(any(unix, windows))]
type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

#[cfg(any(unix, windows))]
struct ChildGuard(Child);

#[cfg(any(unix, windows))]
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(any(unix, windows))]
fn test_error(message: impl Into<String>) -> Box<dyn Error + Send + Sync> {
    io::Error::other(message.into()).into()
}

#[cfg(any(unix, windows))]
fn free_loopback_port() -> TestResult<u16> {
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
    Ok(listener.local_addr()?.port())
}

#[cfg(any(unix, windows))]
fn create_dir(path: &Path) -> TestResult {
    fs::create_dir_all(path).map_err(|err| test_error(format!("create {}: {err}", path.display())))
}

#[cfg(any(unix, windows))]
fn test_shell() -> TestResult<PathBuf> {
    #[cfg(windows)]
    {
        resolve_command("pwsh.exe")
            .or_else(|| resolve_command("powershell.exe"))
            .or_else(|| resolve_command("cmd.exe"))
            .ok_or_else(|| test_error("no Windows shell found in PATH"))
    }

    #[cfg(unix)]
    {
        for candidate in ["/bin/sh", "/usr/bin/sh", "/bin/bash", "/usr/bin/bash"] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Ok(path);
            }
        }
        Err(test_error("no POSIX shell found"))
    }
}

#[cfg(windows)]
fn resolve_command(program: &str) -> Option<PathBuf> {
    let path = PathBuf::from(program);
    if path.is_absolute() {
        return path.is_file().then_some(path);
    }

    let candidates = command_candidates(program);
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| candidates.iter().map(move |candidate| dir.join(candidate)))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(windows)]
fn command_candidates(program: &str) -> Vec<String> {
    if Path::new(program).extension().is_some() {
        return vec![program.to_string()];
    }

    let mut candidates = vec![program.to_string()];
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    candidates.extend(
        pathext.split(';').filter(|ext| !ext.is_empty()).map(|ext| format!("{program}{ext}")),
    );
    candidates
}

#[cfg(any(unix, windows))]
#[allow(clippy::too_many_arguments)]
fn spawn_server(
    server: &str,
    port: u16,
    cwd: &Path,
    tmp: &TempDir,
    appdata: &Path,
    localappdata: &Path,
    userprofile: &Path,
    shell: &Path,
) -> TestResult<ChildGuard> {
    let stdout = fs::File::create(tmp.path().join("server.out.log"))?;
    let stderr = fs::File::create(tmp.path().join("server.err.log"))?;

    let mut cmd = Command::new(server);
    cmd.args(["--port", &port.to_string()])
        .current_dir(cwd)
        .env("APPDATA", appdata)
        .env("LOCALAPPDATA", localappdata)
        .env("USERPROFILE", userprofile)
        .env("HOME", userprofile)
        .env("XDG_CONFIG_HOME", tmp.path().join("xdg-config"))
        .env("XDG_DATA_HOME", tmp.path().join("xdg-data"))
        .env("DINOTTY_SHELL", shell)
        .env("DINOTTY_TOKEN", "regression-token")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0008); // CREATE_NO_WINDOW | DETACHED_PROCESS
    }

    Ok(ChildGuard(cmd.spawn()?))
}

#[cfg(any(unix, windows))]
async fn wait_until_ready(
    client: &reqwest::Client,
    base: &str,
    port: u16,
    child: &mut ChildGuard,
    log_dir: &Path,
) -> TestResult {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut last_error = String::new();

    while Instant::now() < deadline {
        if let Some(status) = child.0.try_wait()? {
            return Err(test_error(format!(
                "server exited early with {status}; stderr:\n{}",
                read_log(log_dir, "server.err.log")
            )));
        }

        match client.get(format!("{base}/api/info")).bearer_auth("regression-token").send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(resp) => match resp.json::<Value>().await {
                    Ok(info) => {
                        let actual = info.get("port").and_then(Value::as_u64);
                        if actual == Some(u64::from(port)) {
                            return Ok(());
                        }
                        return Err(test_error(format!("unexpected /api/info port: {actual:?}")));
                    }
                    Err(err) => last_error = err.to_string(),
                },
                Err(err) => last_error = err.to_string(),
            },
            Err(err) => last_error = err.to_string(),
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err(test_error(format!(
        "server did not become ready: {last_error}; stderr:\n{}",
        read_log(log_dir, "server.err.log")
    )))
}

#[cfg(any(unix, windows))]
async fn login_cookie(client: &reqwest::Client, base: &str) -> TestResult<String> {
    let resp = client
        .post(format!("{base}/api/auth"))
        .json(&serde_json::json!({ "token": "regression-token" }))
        .send()
        .await?
        .error_for_status()?;
    let set_cookie = resp
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .ok_or_else(|| test_error("login response missing Set-Cookie"))?
        .to_str()?;
    Ok(set_cookie.split(';').next().unwrap_or(set_cookie).to_string())
}

#[cfg(any(unix, windows))]
async fn wait_for_shell_prompt(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> TestResult {
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut saw_output = false;
    let mut collected = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let wait = if saw_output { Duration::from_millis(750) } else { remaining };
        match tokio::time::timeout(wait.min(remaining), ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                    if msg.get("type").and_then(Value::as_str) == Some("output") {
                        saw_output = true;
                        if let Some(data) = msg.get("data").and_then(Value::as_str) {
                            collected.push_str(data);
                            if looks_like_prompt(&collected) {
                                return Ok(());
                            }
                        }
                    }
                }
            }
            Ok(Some(Ok(Message::Close(_)))) => {
                return Err(test_error("websocket closed before prompt"))
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(err))) => return Err(err.into()),
            Ok(None) => return Err(test_error("websocket stream ended before prompt")),
            Err(_) if saw_output => return Ok(()),
            Err(_) => break,
        }
    }

    Err(test_error(format!("shell prompt was not observed; output so far: {collected:?}")))
}

#[cfg(any(unix, windows))]
fn looks_like_prompt(output: &str) -> bool {
    output.contains("\u{1b}]133;A")
        || output.contains("> ")
        || output.ends_with("$ ")
        || output.ends_with("# ")
}

#[cfg(any(unix, windows))]
async fn wait_for_session_exit(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> TestResult {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut messages = Vec::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                    if msg.get("type").and_then(Value::as_str) == Some("session_exit") {
                        return Ok(());
                    }
                }
                messages.push(text);
            }
            Ok(Some(Ok(Message::Close(_))) | None) | Err(_) => break,
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(err))) => return Err(err.into()),
        }
    }

    Err(test_error(format!("session_exit was not received; messages: {messages:?}")))
}

#[cfg(any(unix, windows))]
async fn wait_until_tab_removed(client: &reqwest::Client, base: &str, tab_id: &str) -> TestResult {
    let deadline = Instant::now() + Duration::from_secs(5);

    while Instant::now() < deadline {
        let tabs: Value = client
            .get(format!("{base}/api/tabs"))
            .bearer_auth("regression-token")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let still_present = tabs.get("tabs").and_then(Value::as_array).is_some_and(|tabs| {
            tabs.iter().any(|tab| tab.get("tab_id").and_then(Value::as_str) == Some(tab_id))
        });
        if !still_present {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err(test_error(format!("tab {tab_id} was not removed after shell exit")))
}

#[cfg(any(unix, windows))]
fn read_log(dir: &Path, name: &str) -> String {
    fs::read_to_string(dir.join(name)).unwrap_or_else(|_| "<missing log>".to_string())
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn shell_exit_notifies_ws_and_removes_tab() -> TestResult {
    let server = env!("CARGO_BIN_EXE_dinotty-server");
    let port = free_loopback_port()?;
    let tmp = tempfile::Builder::new().prefix("dinotty-exit-regression-").tempdir()?;

    let appdata = tmp.path().join("AppData").join("Roaming");
    let localappdata = tmp.path().join("AppData").join("Local");
    let userprofile = tmp.path().join("User");
    create_dir(&appdata)?;
    create_dir(&localappdata)?;
    create_dir(&userprofile)?;

    let shell = test_shell()?;
    let mut child = spawn_server(
        server,
        port,
        &userprofile,
        &tmp,
        &appdata,
        &localappdata,
        &userprofile,
        &shell,
    )?;

    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build()?;
    let base = format!("http://127.0.0.1:{port}");
    wait_until_ready(&client, &base, port, &mut child, tmp.path()).await?;

    let created: Value = client
        .post(format!("{base}/api/tabs"))
        .bearer_auth("regression-token")
        .json(&serde_json::json!({ "cwd": null }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let tab_id = created
        .get("tab_id")
        .and_then(Value::as_str)
        .ok_or_else(|| test_error("create tab response missing tab_id"))?
        .to_string();
    let pane_id = created
        .get("pane_id")
        .and_then(Value::as_str)
        .ok_or_else(|| test_error("create tab response missing pane_id"))?;

    let cookie = login_cookie(&client, &base).await?;
    let ws_url = format!("ws://127.0.0.1:{port}/ws?paneId={pane_id}");
    let mut request = ws_url.into_client_request()?;
    request.headers_mut().insert(COOKIE, HeaderValue::from_str(&cookie)?);
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await?;
    wait_for_shell_prompt(&mut ws).await?;

    ws.send(Message::Text(serde_json::json!({ "type": "input", "data": "exit\r" }).to_string()))
        .await?;

    wait_for_session_exit(&mut ws).await?;
    wait_until_tab_removed(&client, &base, &tab_id).await?;

    Ok(())
}

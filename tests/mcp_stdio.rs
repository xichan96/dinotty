//! Integration tests for MCP stdio mode.
//!
//! Spawns the server binary on a random loopback port with a throwaway
//! `DINOTTY_CONFIG_SUFFIX`, toggles the `mcp.http_enabled` / `mcp.stdio_enabled`
//! switches via the settings API, then exercises the `--mcp-stdio` proxy
//! (which forwards JSON-RPC to the running main service) and the endpoint
//! gating (404 when both switches are off).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

struct ServerGuard {
    child: std::process::Child,
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static SUFFIX_COUNTER: AtomicUsize = AtomicUsize::new(0);

fn unique_suffix() -> String {
    let pid = std::process::id();
    let n = SUFFIX_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("-mcp-stdio-test-{pid}-{n}")
}

fn free_loopback_port() -> TestResult<u16> {
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
    Ok(listener.local_addr()?.port())
}

fn spawn_server(token: &str, suffix: &str) -> TestResult<(ServerGuard, String)> {
    let port = free_loopback_port()?;
    let server = env!("CARGO_BIN_EXE_dinotty-server");

    let mut cmd = Command::new(server);
    cmd.args(["--port", &port.to_string()])
        .env("DINOTTY_TOKEN", token)
        .env("DINOTTY_CONFIG_SUFFIX", suffix)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0008);
    }

    let child = cmd.spawn()?;
    let base = format!("http://127.0.0.1:{port}");
    Ok((ServerGuard { child }, base))
}

async fn wait_until_ready(client: &reqwest::Client, base: &str) -> TestResult {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Ok(resp) = client.get(format!("{base}/api/token-configured")).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("server did not become ready".into())
}

async fn set_mcp(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    http_enabled: bool,
    stdio_enabled: bool,
) -> TestResult {
    let resp = client.get(format!("{base}/api/settings")).bearer_auth(token).send().await?;
    assert!(resp.status().is_success(), "GET /api/settings failed");
    let mut settings: Value = resp.json().await?;
    settings["mcp"]["http_enabled"] = json!(http_enabled);
    settings["mcp"]["stdio_enabled"] = json!(stdio_enabled);
    let resp = client
        .put(format!("{base}/api/settings"))
        .bearer_auth(token)
        .json(&settings)
        .send()
        .await?;
    assert!(resp.status().is_success(), "PUT /api/settings failed");
    Ok(())
}

/// Run `dinotty-server --mcp-stdio` with the given JSON-RPC lines on stdin and
/// return (exit code, non-empty stdout lines, stderr).
fn run_stdio_proxy(
    port: u16,
    token: &str,
    suffix: &str,
    input_lines: &[&str],
) -> TestResult<(i32, Vec<String>, String)> {
    let server = env!("CARGO_BIN_EXE_dinotty-server");

    let mut cmd = Command::new(server);
    cmd.args(["--mcp-stdio", "--port", &port.to_string()])
        .env("DINOTTY_TOKEN", token)
        .env("DINOTTY_CONFIG_SUFFIX", suffix)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0008);
    }

    let mut child = cmd.spawn()?;
    {
        let mut stdin = child.stdin.take().expect("proxy stdin");
        for line in input_lines {
            stdin.write_all(line.as_bytes())?;
            stdin.write_all(b"\n")?;
        }
        // Dropping stdin (EOF) makes the proxy exit after flushing responses.
    }
    let output = child.wait_with_output()?;

    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(String::from)
        .collect();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

#[tokio::test]
async fn stdio_proxy_lists_tools_from_main_server() -> TestResult {
    let suffix = unique_suffix();
    let token = "mcp-stdio-e2e-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
    wait_until_ready(&client, &base).await?;
    set_mcp(&client, &base, token, true, true).await?;

    let port = base.rsplit(':').next().unwrap().parse::<u16>()?;
    let (code, lines, stderr) = run_stdio_proxy(
        port,
        token,
        &suffix,
        &[r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#],
    )?;
    assert_eq!(code, 0, "stdio proxy should exit 0; stderr: {stderr}");
    let response = lines.join("\n");
    assert!(response.contains(r#""tools""#), "response should list tools: {response}");
    assert!(
        response.contains("terminal_execute"),
        "response should contain terminal_execute: {response}"
    );
    assert!(response.contains(r#""id":1"#), "response should echo id 1: {response}");
    Ok(())
}

#[tokio::test]
async fn mcp_endpoints_gate_when_disabled() -> TestResult {
    let suffix = unique_suffix();
    let token = "mcp-stdio-e2e-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
    wait_until_ready(&client, &base).await?;

    // Default state (http_enabled=true, stdio_enabled=false): /mcp/message works.
    let resp = client
        .post(format!("{base}/mcp/message"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
        .send()
        .await?;
    assert_eq!(resp.status(), reqwest::StatusCode::OK, "default state should serve /mcp/message");

    // Turn both off: endpoints return 404.
    set_mcp(&client, &base, token, false, false).await?;

    let resp = client.get(format!("{base}/mcp/sse")).bearer_auth(token).send().await?;
    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND, "GET /mcp/sse should 404");

    let resp = client
        .post(format!("{base}/mcp/message"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
        .send()
        .await?;
    assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND, "POST /mcp/message should 404");

    // stdio proxy refuses to start when stdio_enabled=false.
    let port = base.rsplit(':').next().unwrap().parse::<u16>()?;
    let (code, _lines, stderr) = run_stdio_proxy(
        port,
        token,
        &suffix,
        &[r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#],
    )?;
    assert_ne!(code, 0, "proxy should exit non-zero when stdio disabled");
    assert!(
        stderr.contains("MCP stdio disabled in settings"),
        "expected disabled message, got: {stderr}"
    );
    Ok(())
}

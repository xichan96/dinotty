//! Integration tests for agent token scope enforcement.
//!
//! Spawns the server binary on a random loopback port, creates two terminal
//! panes, then mints a token scoped to one pane and verifies that the Agent
//! API (send/read/run) denies out-of-scope panes with SCOPE_DENIED while
//! allowing the scoped pane. Uses a throwaway `DINOTTY_CONFIG_SUFFIX` so the
//! server never touches the user's real `~/.dinotty` data.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use reqwest::StatusCode;
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
    format!("-scope-test-{pid}-{n}")
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

async fn enable_open_api(client: &reqwest::Client, base: &str, token: &str) -> TestResult {
    let resp = client.get(format!("{base}/api/settings")).bearer_auth(token).send().await?;
    assert!(resp.status().is_success(), "GET /api/settings failed");
    let mut settings: Value = resp.json().await?;
    settings["open_api"]["enabled"] = json!(true);
    let resp = client
        .put(format!("{base}/api/settings"))
        .bearer_auth(token)
        .json(&settings)
        .send()
        .await?;
    assert!(resp.status().is_success(), "PUT /api/settings failed");
    Ok(())
}

async fn create_tab(client: &reqwest::Client, base: &str, token: &str) -> TestResult<String> {
    let resp = client
        .post(format!("{base}/api/tabs"))
        .bearer_auth(token)
        .json(&json!({}))
        .send()
        .await?;
    assert!(resp.status().is_success(), "POST /api/tabs failed");
    let body: Value = resp.json().await?;
    body.get("pane_id")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| "missing pane_id".into())
}

#[tokio::test]
async fn scoped_token_denies_out_of_scope_pane() -> TestResult {
    let suffix = unique_suffix();
    let admin_token = "scope-e2e-token";
    let (_guard, base) = spawn_server(admin_token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
    wait_until_ready(&client, &base).await?;
    enable_open_api(&client, &base, admin_token).await?;

    let pane1 = create_tab(&client, &base, admin_token).await?;
    let pane2 = create_tab(&client, &base, admin_token).await?;
    assert_ne!(pane1, pane2);

    // Mint a token scoped to pane1 only.
    let resp = client
        .post(format!("{base}/api/tokens"))
        .bearer_auth(admin_token)
        .json(&json!({
            "name": "scoped",
            "description": "e2e scope test",
            "capabilities": ["terminal:read", "terminal:write"],
            "scopes": {
                "terminal:read": [pane1],
                "terminal:write": [pane1]
            }
        }))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::CREATED, "create token failed");
    let body: Value = resp.json().await?;
    let agent_token = body.get("token").and_then(Value::as_str).ok_or("missing token")?.to_string();

    // send to out-of-scope pane -> 403 SCOPE_DENIED
    let resp = client
        .post(format!("{base}/api/sessions/{pane2}/send"))
        .bearer_auth(&agent_token)
        .json(&json!({"command": "echo hi", "pane_id": pane2}))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = resp.json().await?;
    assert_eq!(body["error"]["code"].as_str(), Some("SCOPE_DENIED"));

    // read of out-of-scope pane -> 403 SCOPE_DENIED
    let resp = client
        .get(format!("{base}/api/sessions/{pane2}/read?pane_id={pane2}"))
        .bearer_auth(&agent_token)
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = resp.json().await?;
    assert_eq!(body["error"]["code"].as_str(), Some("SCOPE_DENIED"));

    // run on out-of-scope pane -> 403 SCOPE_DENIED
    let resp = client
        .post(format!("{base}/api/sessions/{pane2}/run"))
        .bearer_auth(&agent_token)
        .json(&json!({"command": "true", "pane_id": pane2, "timeout": 2000}))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = resp.json().await?;
    assert_eq!(body["error"]["code"].as_str(), Some("SCOPE_DENIED"));

    // Scoped pane still works: send -> 200 ok, read -> 200
    let resp = client
        .post(format!("{base}/api/sessions/{pane1}/send"))
        .bearer_auth(&agent_token)
        .json(&json!({"command": "true", "pane_id": pane1}))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::OK, "in-scope send should succeed");

    let resp = client
        .get(format!("{base}/api/sessions/{pane1}/read?pane_id={pane1}"))
        .bearer_auth(&agent_token)
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::OK, "in-scope read should succeed");

    Ok(())
}

#[tokio::test]
async fn unscoped_token_still_allowed_on_any_pane() -> TestResult {
    let suffix = unique_suffix();
    let admin_token = "scope-e2e-token";
    let (_guard, base) = spawn_server(admin_token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;
    wait_until_ready(&client, &base).await?;
    enable_open_api(&client, &base, admin_token).await?;

    let pane = create_tab(&client, &base, admin_token).await?;

    // No scopes restriction: token works on any pane (backwards compatible).
    let resp = client
        .post(format!("{base}/api/tokens"))
        .bearer_auth(admin_token)
        .json(&json!({
            "name": "unscoped",
            "description": "",
            "capabilities": ["terminal:write"]
        }))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body: Value = resp.json().await?;
    let agent_token = body.get("token").and_then(Value::as_str).ok_or("missing token")?.to_string();

    let resp = client
        .post(format!("{base}/api/sessions/{pane}/send"))
        .bearer_auth(&agent_token)
        .json(&json!({"command": "true", "pane_id": pane}))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::OK, "unscoped send should succeed");

    Ok(())
}

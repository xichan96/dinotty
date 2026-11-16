//! Integration tests for verification code login.
//!
//! Spawns the server binary on a random loopback port with `DINOTTY_TOKEN`
//! preset, then exercises the auth mutual-exclusion behavior via plain HTTP.
//! Each test uses a unique `DINOTTY_CONFIG_SUFFIX` so the server reads/writes
//! its settings to a throwaway config directory, never touching the user's
//! real `~/.dinotty` data.
//!
//! WebSocket-based event capture is intentionally avoided here - the unit
//! tests in `src/auth/verification_code.rs` cover the code generation and
//! verification logic; this file focuses on the HTTP-level dispatch.

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

/// Unique across runs, not merely within one. `process::id()` alone repeats on
/// long-lived hosts (the self-hosted Windows runner), and a repeated suffix
/// makes the server read the `settings.json` a previous run left behind.
fn unique_suffix() -> String {
    let pid = std::process::id();
    let n = SUFFIX_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    format!("-vc-test-{pid}-{n}-{nonce}")
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

async fn set_login_method(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    method: &str,
) -> TestResult {
    let get_resp = client.get(format!("{base}/api/settings")).bearer_auth(token).send().await?;
    assert!(get_resp.status().is_success(), "GET /api/settings failed");
    let mut settings: Value = get_resp.json().await?;
    settings["auth"]["login_method"] = json!(method);
    let put_resp = client
        .put(format!("{base}/api/settings"))
        .bearer_auth(token)
        .json(&settings)
        .send()
        .await?;
    assert!(put_resp.status().is_success(), "PUT /api/settings failed");
    Ok(())
}

async fn request_code(client: &reqwest::Client, base: &str) -> TestResult<String> {
    let resp = client.post(format!("{base}/api/auth/request-code")).send().await?;
    assert_eq!(resp.status(), StatusCode::OK, "request-code failed");
    let body: Value = resp.json().await?;
    Ok(body.get("request_id").and_then(Value::as_str).ok_or("missing request_id")?.to_string())
}

#[tokio::test]
async fn token_configured_reports_default_login_method() -> TestResult {
    let suffix = unique_suffix();
    let token = "vc-test-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    wait_until_ready(&client, &base).await?;

    let resp = client.get(format!("{base}/api/token-configured")).send().await?;
    assert!(resp.status().is_success());
    // The login page reads this before a session exists; a cache must not keep
    // serving the previous login method after the user switches modes.
    assert_eq!(resp.headers().get(reqwest::header::CACHE_CONTROL).unwrap(), "no-store");
    let body: Value = resp.json().await?;
    assert_eq!(body.get("login_method").and_then(Value::as_str), Some("token"));
    Ok(())
}

#[tokio::test]
async fn token_mode_rejects_verification_code_body() -> TestResult {
    let suffix = unique_suffix();
    let token = "vc-test-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    wait_until_ready(&client, &base).await?;

    // request_code succeeds (returns a request_id) but login with
    // {request_id, code} must be rejected because login_method=token.
    let request_id = request_code(&client, &base).await?;

    let resp = client
        .post(format!("{base}/api/auth"))
        .json(&json!({ "request_id": request_id, "code": "123456" }))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body: Value = resp.json().await?;
    assert_eq!(body.get("error").and_then(Value::as_str), Some("login method mismatch"));
    Ok(())
}

#[tokio::test]
async fn verification_code_mode_rejects_token_body() -> TestResult {
    let suffix = unique_suffix();
    let token = "vc-test-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    wait_until_ready(&client, &base).await?;

    // Switch to verification_code first.
    set_login_method(&client, &base, token, "verification_code").await?;

    // Sanity: login_method is verification_code.
    let cfg: Value =
        client.get(format!("{base}/api/token-configured")).send().await?.json().await?;
    assert_eq!(cfg.get("login_method").and_then(Value::as_str), Some("verification_code"));

    // Token login is rejected.
    let resp =
        client.post(format!("{base}/api/auth")).json(&json!({ "token": token })).send().await?;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body: Value = resp.json().await?;
    assert_eq!(body.get("error").and_then(Value::as_str), Some("login method mismatch"));
    Ok(())
}

#[tokio::test]
async fn code_too_many_attempts_after_five_mismatches() -> TestResult {
    let suffix = unique_suffix();
    let token = "vc-test-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    wait_until_ready(&client, &base).await?;

    set_login_method(&client, &base, token, "verification_code").await?;

    let request_id = request_code(&client, &base).await?;

    // Submit 5 wrong codes: first 4 must return "code mismatch"; the 5th
    // pushes the entry past MAX_ATTEMPTS and removes it, returning
    // "too many attempts".
    let mut last_error = String::new();
    for i in 0..5 {
        let resp = client
            .post(format!("{base}/api/auth"))
            .json(&json!({ "request_id": &request_id, "code": "000000" }))
            .send()
            .await?;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "attempt {i}");
        let body: Value = resp.json().await?;
        last_error = body.get("error").and_then(Value::as_str).unwrap_or("").to_string();
    }
    assert_eq!(last_error, "too many attempts", "5th mismatch should be too_many_attempts");

    // Entry is gone after removal.
    let resp = client
        .post(format!("{base}/api/auth"))
        .json(&json!({ "request_id": &request_id, "code": "000000" }))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body: Value = resp.json().await?;
    assert_eq!(body.get("error").and_then(Value::as_str), Some("code not found"));
    Ok(())
}

#[tokio::test]
async fn switching_login_method_via_settings_takes_effect() -> TestResult {
    let suffix = unique_suffix();
    let token = "vc-test-token";
    let (_guard, base) = spawn_server(token, &suffix)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;
    wait_until_ready(&client, &base).await?;

    // Confirm default mode rejects verification code login.
    let request_id = request_code(&client, &base).await?;
    let resp = client
        .post(format!("{base}/api/auth"))
        .json(&json!({ "request_id": &request_id, "code": "123456" }))
        .send()
        .await?;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Switch to verification_code.
    set_login_method(&client, &base, token, "verification_code").await?;

    // Token login should now be rejected.
    let resp =
        client.post(format!("{base}/api/auth")).json(&json!({ "token": token })).send().await?;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body: Value = resp.json().await?;
    assert_eq!(body.get("error").and_then(Value::as_str), Some("login method mismatch"));
    Ok(())
}

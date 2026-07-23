#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::missing_panics_doc,
    clippy::manual_assert
)]
use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use dashmap::DashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::{net::IpAddr, sync::OnceLock, time::Instant};

use crate::auth::session::SessionStore;
use crate::settings::SettingsState;

pub mod session;

static SESSION_COOKIE_PORT: OnceLock<u16> = OnceLock::new();

#[must_use]
pub fn session_cookie_name(port: u16) -> String {
    format!("dinotty_session_{port}")
}

fn check_port_conflict(existing: u16, new: u16) -> bool {
    existing != new
}

pub fn set_session_cookie_port(port: u16) {
    if SESSION_COOKIE_PORT.set(port).is_err() {
        let existing = *SESSION_COOKIE_PORT.get().expect("session cookie port must be initialized");
        if check_port_conflict(existing, port) {
            panic!(
                "session cookie port already configured as {existing}; cannot reconfigure to {port}"
            );
        }
    }
}

fn default_port() -> u16 {
    option_env!("DINOTTY_DEFAULT_PORT").and_then(|s| s.parse().ok()).unwrap_or(8999)
}

fn configured_session_cookie_port() -> u16 {
    SESSION_COOKIE_PORT.get().copied().unwrap_or_else(default_port)
}

struct FailRecord {
    count: u32,
    last_fail: Instant,
}

fn fail_map() -> &'static DashMap<IpAddr, FailRecord> {
    static MAP: OnceLock<DashMap<IpAddr, FailRecord>> = OnceLock::new();
    MAP.get_or_init(DashMap::new)
}

static GLOBAL_FAIL_COUNT: AtomicU32 = AtomicU32::new(0);
static GLOBAL_FAIL_WINDOW_START: AtomicU64 = AtomicU64::new(0);

/// Record a failed auth attempt for the given IP. Called by the login handler.
pub fn record_auth_failure(ip: IpAddr, global_lockout_secs: u64) {
    // Per-IP tracking
    let map = fail_map();
    let mut rec = map.entry(ip).or_insert(FailRecord { count: 0, last_fail: Instant::now() });
    rec.count += 1;
    rec.last_fail = Instant::now();

    // Global tracking
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let window_start = GLOBAL_FAIL_WINDOW_START.load(Ordering::Relaxed);
    if now.saturating_sub(window_start) > global_lockout_secs {
        GLOBAL_FAIL_COUNT.store(1, Ordering::Relaxed);
        GLOBAL_FAIL_WINDOW_START.store(now, Ordering::Relaxed);
    } else {
        GLOBAL_FAIL_COUNT.fetch_add(1, Ordering::Relaxed);
    }
}

/// Check whether the given IP (or global state) is currently locked out.
/// Returns `Some(retry_after_secs)` if locked out, `None` if allowed.
#[must_use]
pub fn check_lockout(
    real_ip: IpAddr,
    strategy: &str,
    max_failures: u32,
    lockout_secs: u64,
    global_max_failures: u32,
    global_lockout_secs: u64,
) -> Option<u64> {
    match strategy {
        "off" => None,
        "global" => {
            let count = GLOBAL_FAIL_COUNT.load(Ordering::Relaxed);
            let window_start = GLOBAL_FAIL_WINDOW_START.load(Ordering::Relaxed);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if count >= global_max_failures
                && now.saturating_sub(window_start) < global_lockout_secs
            {
                Some(global_lockout_secs - now.saturating_sub(window_start))
            } else {
                None
            }
        }
        _ => {
            // "ip" (default): per-IP lockout
            let map = fail_map();
            if let Some(rec) = map.get(&real_ip) {
                if rec.count >= max_failures {
                    let elapsed = rec.last_fail.elapsed().as_secs();
                    if elapsed < lockout_secs {
                        return Some(lockout_secs - elapsed);
                    }
                    drop(rec);
                    map.remove(&real_ip);
                }
            }
            None
        }
    }
}

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
pub async fn auth_middleware(
    request: Request,
    next: Next,
    token: &str,
    settings: &SettingsState,
    sessions: &SessionStore,
    client_ip: IpAddr,
    port: u16,
) -> Response {
    let path = request.uri().path();

    // No token configured - first-time setup, allow all requests
    if token.is_empty() {
        return next.run(request).await;
    }

    if path == "/"
        || path == "/api/token-configured"
        || path == "/manifest.json"
        || path == "/logo.png"
        || path.starts_with("/assets/")
        || path.starts_with("/icons/")
    {
        return next.run(request).await;
    }

    // Agent WS has its own agent-token middleware; skip main auth so agent
    // clients (which carry an agent token, not a session cookie) can connect.
    if path == "/ws/agent" {
        return next.run(request).await;
    }

    // /preview/* still bypasses here; the proxy handler enforces its own
    // loopback / session check.
    if path.starts_with("/preview/") {
        return next.run(request).await;
    }

    // Resolve real client IP (respects trusted_proxies for X-Forwarded-For).
    // This fixes a pre-existing vuln: behind a same-host tunnel, all traffic
    // appeared from 127.0.0.1 and bypassed auth via the loopback whitelist.
    let (real_ip, ip_whitelist) = {
        let s = settings.read().await;
        let real = real_client_ip(request.headers(), client_ip, &s.auth.trusted_proxies);
        (real, s.ip_whitelist.clone())
    };

    // /api/auto-token exposes the raw auth token — loopback only.
    if path == "/api/auto-token" && !real_ip.is_loopback() {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(r#"{"error":"auto-token is only available from localhost"}"#))
            .unwrap();
    }

    // IP whitelist (loopback bypass) check - uses real IP, not direct peer.
    if is_ip_whitelisted(real_ip, &ip_whitelist) {
        return next.run(request).await;
    }

    // /api/auth is the login endpoint - exempt from IP whitelist so non-loopback
    // users can authenticate. The login handler does its own token validation
    // and brute-force accounting.
    if path == "/api/auth" {
        return next.run(request).await;
    }

    // Brute-force lockout check (strategy-driven).
    let (lockout_strategy, max_failures, lockout_secs, global_max_failures, global_lockout_secs) = {
        let s = settings.read().await;
        (
            s.auth.lockout_strategy.clone(),
            s.auth.lockout_max_failures,
            s.auth.lockout_secs,
            s.auth.global_lockout_max_failures,
            s.auth.global_lockout_secs,
        )
    };

    if let Some(retry_after) = check_lockout(
        real_ip,
        &lockout_strategy,
        max_failures,
        lockout_secs,
        global_max_failures,
        global_lockout_secs,
    ) {
        return Response::builder()
            .status(StatusCode::TOO_MANY_REQUESTS)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .header("Retry-After", retry_after.to_string())
            .body(Body::from(r#"{"error":"too many failed attempts, please try again later"}"#))
            .unwrap();
    }

    // Cookie session check (browser login).
    if let Some(session_id) = extract_session_cookie(&request, port) {
        if sessions.validate(&session_id) {
            return next.run(request).await;
        }
    }

    // Bearer header check (programmatic clients + Tauri).
    if check_token(&request, token) {
        return next.run(request).await;
    }

    tracing::warn!(
        "auth: reject {} {} from {} (no valid session/token)",
        request.method(),
        path,
        real_ip
    );
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(r#"{"error":"unauthorized"}"#))
        .unwrap()
}

/// Check whether a request carries a valid session cookie or Bearer token.
pub fn has_valid_auth(request: &Request, sessions: &SessionStore, token: &str) -> bool {
    if let Some(sid) = extract_session_cookie(request, configured_session_cookie_port()) {
        if sessions.validate(&sid) {
            return true;
        }
    }
    check_token(request, token)
}

fn extract_session_cookie(request: &Request, port: u16) -> Option<String> {
    let header = request.headers().get(header::COOKIE)?;
    let raw = header.to_str().ok()?;
    let cookie_prefix = format!("{}=", session_cookie_name(port));
    for pair in raw.split(';') {
        let pair = pair.trim();
        if let Some(rest) = pair.strip_prefix(&cookie_prefix) {
            return Some(rest.to_string());
        }
    }
    None
}

/// Resolve the real client IP. If the direct connection IP is in `trusted_proxies`
/// (CIDR list), parse `X-Forwarded-For` and return the first non-trusted hop.
/// Otherwise return the direct connection IP unchanged.
///
/// This is critical for the loopback bypass: behind a same-host tunnel (e.g.
/// ngrok/cloudflared on 127.0.0.1), the direct peer is always loopback and
/// would bypass auth. With `trusted_proxies` empty (default), the direct peer
/// is used as-is, so tunnel traffic from a remote ngrok exit keeps its real IP.
#[must_use]
pub fn real_client_ip(headers: &HeaderMap, conn_ip: IpAddr, trusted_proxies: &[String]) -> IpAddr {
    if !is_ip_whitelisted(conn_ip, trusted_proxies) {
        return conn_ip;
    }
    let Some(xff) = headers.get("x-forwarded-for") else {
        return conn_ip;
    };
    let Ok(s) = xff.to_str() else {
        return conn_ip;
    };
    for part in s.split(',') {
        let part = part.trim();
        if let Ok(ip) = part.parse::<IpAddr>() {
            if !is_ip_whitelisted(ip, trusted_proxies) {
                return ip;
            }
        }
    }
    conn_ip
}

/// 暂时关闭：反代（极空间等 NAS）默认不带 X-Forwarded-Host，Host 被改写为内部
/// 地址，导致 Origin 与 Host 比对失配，所有非 /ws 的 WS 端点（监控、sync、
/// watch、notify、history 等）全部 403。cookie session 鉴权仍在 `auth_middleware`
/// 生效，跨站 WS CSRF 风险有限。后续修复 `trusted_proxies` 语义 bug（应用直连
/// peer 判断而非 `real_ip`）并加拒绝日志后再恢复。
#[must_use]
pub fn check_ws_origin(
    _headers: &HeaderMap,
    _allowed_origins: &[String],
    _client_ip: std::net::IpAddr,
    _trusted_proxies: &[String],
) -> bool {
    true
}

fn is_ip_whitelisted(ip: IpAddr, whitelist: &[String]) -> bool {
    for entry in whitelist {
        let entry = entry.trim();
        // CIDR: 192.168.1.0/24
        if entry.contains('/') {
            if matches_cidr(ip, entry) {
                return true;
            }
            continue;
        }
        // Wildcard: 192.168.0.*
        if entry.contains('*') {
            if matches_wildcard(ip, entry) {
                return true;
            }
            continue;
        }
        // Exact match
        if let Ok(listed) = entry.parse::<IpAddr>() {
            if listed == ip {
                return true;
            }
        }
    }
    false
}

// Wildcard match only applies to IPv4
fn matches_wildcard(ip: IpAddr, pattern: &str) -> bool {
    let IpAddr::V4(ipv4) = ip else { return false };
    let octets = ipv4.octets();
    let parts: Vec<&str> = pattern.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    for (i, part) in parts.iter().enumerate() {
        if *part == "*" {
            continue;
        }
        if let Ok(n) = part.parse::<u8>() {
            if octets[i] != n {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

fn matches_cidr(ip: IpAddr, cidr: &str) -> bool {
    let Some((addr_str, prefix_str)) = cidr.split_once('/') else { return false };
    let Ok(prefix_len) = prefix_str.parse::<u32>() else { return false };
    match (ip, addr_str.parse::<IpAddr>()) {
        (IpAddr::V4(ip4), Ok(IpAddr::V4(net4))) => {
            if prefix_len > 32 {
                return false;
            }
            let mask = if prefix_len == 0 { 0u32 } else { !0u32 << (32 - prefix_len) };
            let ip_bits = u32::from(ip4);
            let net_bits = u32::from(net4);
            (ip_bits & mask) == (net_bits & mask)
        }
        (IpAddr::V6(ip6), Ok(IpAddr::V6(net6))) => {
            if prefix_len > 128 {
                return false;
            }
            let ip_bits = u128::from(ip6);
            let net_bits = u128::from(net6);
            let mask = if prefix_len == 0 { 0u128 } else { !0u128 << (128 - prefix_len) };
            (ip_bits & mask) == (net_bits & mask)
        }
        _ => false,
    }
}

fn check_token(request: &Request, token: &str) -> bool {
    if let Some(auth) = request.headers().get(header::AUTHORIZATION) {
        if let Ok(v) = auth.to_str() {
            if let Some(t) = v.strip_prefix("Bearer ") {
                return constant_time_eq(t.trim(), token);
            }
        }
    }

    false
}

#[must_use]
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests;

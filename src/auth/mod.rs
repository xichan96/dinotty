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

pub mod handlers;
pub mod session;
pub mod verification_code;

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
/// Returns the updated per-IP attempt count.
pub fn record_auth_failure(ip: IpAddr, global_lockout_secs: u64) -> u32 {
    // Per-IP tracking
    let map = fail_map();
    let mut rec = map.entry(ip).or_insert(FailRecord { count: 0, last_fail: Instant::now() });
    rec.count += 1;
    rec.last_fail = Instant::now();
    let count = rec.count;

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
    count
}

/// Read the current per-IP failure count without mutating it.
#[must_use]
pub fn get_fail_count(ip: IpAddr) -> u32 {
    fail_map().get(&ip).map_or(0, |r| r.count)
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
#[allow(clippy::too_many_lines)]
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
        || path == "/sw.js"
        || path == "/logo.png"
        || path.starts_with("/assets/")
        || path.starts_with("/icons/")
    {
        return next.run(request).await;
    }

    // Event stream WS has its own sessions-token middleware; skip main auth so
    // agent clients (which carry an agent token, not a session cookie) can connect.
    if path == "/ws/events" {
        return next.run(request).await;
    }

    // /preview/* still bypasses here; the proxy handler enforces its own
    // loopback / session check.
    if path.starts_with("/preview/") {
        return next.run(request).await;
    }

    // /preview-ws/<token>/* is the workspace HTML preview's own asset reader.
    // The frame is sandboxed without `allow-same-origin`, so it cannot send the
    // session cookie; the minted path token is the credential, and the handler
    // confines it to one directory (see `workspace::preview_ws`).
    if path.starts_with("/preview-ws/") {
        return next.run(request).await;
    }

    // /__srv/* is the hub relay, which carries *another* server's credentials
    // and therefore enforces a stricter gate of its own (loopback-or-valid-auth
    // AND not cross-site AND target in the roster AND the X-Dinotty-Relay
    // header on writes). Checking it here as well would only produce a 403 that
    // hides which of those failed, and would break the browser mode where the
    // session cookie belongs to the hub, not the upstream.
    if path.starts_with("/__srv/") {
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

    // /api/auto-token exposes the raw auth token - local requests only.
    // The gate is `is_local_request`, not the peer address: a same-host tunnel
    // (cloudflared, ngrok, `tailscale serve`) also connects from 127.0.0.1.
    if path == "/api/auto-token" {
        let cross_site = is_cross_site_browser_request(request.headers());
        if !is_local_request(request.headers(), real_ip) || cross_site {
            tracing::warn!(
                "auth: reject {path} from {real_ip} (loopback-only, cross_site_browser={cross_site})"
            );
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::CACHE_CONTROL, "no-store")
                .body(Body::from(r#"{"error":"auto-token is only available from localhost"}"#))
                .unwrap();
        }
    }

    // IP whitelist check - uses real IP, not the direct peer.
    //
    // A loopback match is honoured only for a request that is genuinely local.
    // Every same-host forwarder (cloudflared, ngrok, `tailscale serve`, nginx,
    // `ssh -L`) dials this server from 127.0.0.1, so the peer address alone
    // cannot tell the user's own browser apart from the internet arriving
    // through a tunnel; `is_local_request` adds the two properties the forwarder
    // cannot hide. Non-loopback entries (a LAN CIDR the user added on purpose)
    // keep their previous unconditional meaning.
    //
    // Cross-site browser requests are rejected even from whitelisted peers
    // (see is_cross_site_browser_request).
    if is_ip_whitelisted(real_ip, &ip_whitelist) {
        if real_ip.is_loopback() && !is_local_request(request.headers(), real_ip) {
            tracing::warn!(
                "auth: refusing loopback whitelist bypass for forwarded request {} {} (host {:?}, x-forwarded-for {:?}); falling back to credentials",
                request.method(),
                path,
                request.headers().get(header::HOST).and_then(|v| v.to_str().ok()),
                request.headers().get("x-forwarded-for").and_then(|v| v.to_str().ok())
            );
        } else {
            if is_cross_site_browser_request(request.headers()) {
                tracing::warn!(
                    "auth: reject cross-site browser request to {path} via whitelisted {real_ip} (origin {:?})",
                    request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok())
                );
                return Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"error":"cross-site requests are not allowed"}"#))
                    .unwrap();
            }
            return next.run(request).await;
        }
    }

    // /api/auth is the login endpoint - exempt from IP whitelist so non-loopback
    // users can authenticate. The login handler does its own token validation
    // and brute-force accounting. /api/auth/request-code is the verification
    // code request endpoint - same exemption rationale.
    if path == "/api/auth" || path == "/api/auth/request-code" {
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

    // Routes that carry their own `sessions_token_middleware`: it validates
    // session cookies, the global token AND scoped agent tokens, while this
    // middleware only knows cookie + global token and would reject agent
    // tokens before they ever reach the capability checks.
    if is_agent_managed_path(path) {
        return next.run(request).await;
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

/// Check whether a request carries a valid session cookie (no token involved).
/// Used by `sessions_token_middleware`, whose routes are exempt from
/// `auth_middleware` and therefore cannot delegate the cookie check.
pub fn has_valid_session_cookie(request: &Request, sessions: &SessionStore) -> bool {
    extract_session_cookie(request, configured_session_cookie_port())
        .is_some_and(|sid| sessions.validate(&sid))
}

/// Paths authenticated by `sessions_token_middleware` instead of
/// `auth_middleware` (it accepts agent tokens in addition to cookies and the
/// global token). Must stay in sync with the routes mounted under that
/// middleware in `main.rs`.
fn is_agent_managed_path(path: &str) -> bool {
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match segments.as_slice() {
        ["api", "sessions", _, action] => matches!(*action, "run" | "send" | "read" | "viewer"),
        ["api", "tokens", ..] => true,
        ["mcp", action] => matches!(*action, "sse" | "message"),
        _ => false,
    }
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
/// This matters for the loopback bypass: behind a same-host tunnel (e.g.
/// cloudflared/ngrok/`tailscale serve` on 127.0.0.1) the direct peer is always
/// loopback. With `trusted_proxies` empty (the default) this function therefore
/// returns `127.0.0.1` for tunnel traffic - it does **not** recover the remote
/// client's IP, because the header is only parsed for configured proxies.
/// Distinguishing a tunnel from the local user is [`is_local_request`]'s job,
/// not this function's; treating the peer as authoritative is exactly why the
/// whitelist bypass needs that extra check.
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

/// Headers that only a forwarding proxy adds. The proxy appends them after it
/// receives the request, so a remote client cannot strip them back out.
const FORWARDING_HEADERS: &[&str] = &[
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "cf-connecting-ip",
    "true-client-ip",
];

fn has_forwarding_headers(headers: &HeaderMap) -> bool {
    FORWARDING_HEADERS.iter().any(|name| headers.contains_key(*name))
}

/// Whether `Host` names a loopback authority (`localhost`, `*.localhost`,
/// `127.0.0.0/8`, `[::1]`), ignoring any port.
fn host_header_is_loopback(headers: &HeaderMap) -> bool {
    let Some(raw) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let authority = raw.trim();
    if authority.is_empty() {
        return false;
    }
    // Bracketed IPv6 literal, with or without a port: `[::1]`, `[::1]:8999`.
    if let Some(rest) = authority.strip_prefix('[') {
        let Some((addr, _)) = rest.split_once(']') else { return false };
        return addr.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    }
    let host = authority.rsplit_once(':').map_or(authority, |(host, _port)| host);
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost") {
        return true;
    }
    host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Whether a request may be treated as a genuine on-host request - which is what
/// the loopback entries of `ip_whitelist` mean by "local".
///
/// The peer address alone cannot answer that: every same-host forwarder
/// (cloudflared, ngrok, `tailscale serve`, nginx, `ssh -L`) dials the server from
/// 127.0.0.1, so a request arriving through a tunnel looks identical to the local
/// user's browser. Two properties the forwarder cannot hide are checked instead:
///
/// * `Host` must name a loopback authority. Tunnels rewrite `Host` to the public
///   hostname (measured against `tailscale serve`: it forwards
///   `host: <node>.ts.net` plus `x-forwarded-*`; cloudflared and ngrok behave the
///   same way), so a public-URL request fails even though its peer is loopback.
/// * No forwarding header may be present, because the proxy adds those itself.
///
/// Residual, accepted: `ssh -L` forwards the far-end browser's own
/// `Host: localhost` and adds no headers, so it still looks local. Whoever can
/// open that tunnel already has shell access to this host, and dropping the
/// bypass outright would break the desktop app's zero-config local access.
#[must_use]
pub fn is_local_request(headers: &HeaderMap, peer: IpAddr) -> bool {
    peer.is_loopback() && !has_forwarding_headers(headers) && host_header_is_loopback(headers)
}

/// Split `scheme://authority...` into its scheme and authority.
fn split_scheme_authority(url: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if scheme.is_empty() || authority.is_empty() {
        return None;
    }
    Some((scheme, authority))
}

/// Split `host[:port]`, respecting `[::1]:8999` literals.
fn split_host_port(authority: &str) -> (&str, Option<&str>) {
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host_end = end + 2; // bracketed host, inclusive
            let host = authority.get(..host_end).unwrap_or(authority);
            let port = authority
                .get(host_end..)
                .and_then(|tail| tail.strip_prefix(':'))
                .map(str::trim)
                .filter(|port| !port.is_empty());
            return (host, port);
        }
        return (authority, None);
    }
    match authority.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && !port.is_empty() => (host, Some(port)),
        _ => (authority, None),
    }
}

fn is_loopback_hostname(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if bare.to_ascii_lowercase().ends_with(".localhost") {
        return true;
    }
    bare.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// The desktop shell's own origin. Browsers set `Origin` themselves and only the
/// app shell uses these schemes, so a website cannot forge one. The shell still
/// authenticates normally; this is only the cross-site gate.
fn is_app_shell_origin(origin: &str) -> bool {
    let Some((scheme, authority)) = split_scheme_authority(origin) else { return false };
    let (host, _port) = split_host_port(authority);
    match scheme.to_ascii_lowercase().as_str() {
        "tauri" | "asset" => is_loopback_hostname(host),
        "http" | "https" => host.eq_ignore_ascii_case("tauri.localhost"),
        _ => false,
    }
}

fn authority_matches(origin_authority: &str, host: &str) -> bool {
    if origin_authority.eq_ignore_ascii_case(host) {
        return true;
    }
    let (origin_host, origin_port) = split_host_port(origin_authority);
    let (host_host, host_port) = split_host_port(host);
    if !origin_host.eq_ignore_ascii_case(host_host) {
        return false;
    }
    // Same hostname but the ports disagree or are absent. The only benign
    // explanation is a proxy that dropped the port from `Host`; a loopback URL
    // always carries its port, so a missing one there is indistinguishable from
    // another local app on a different port - which is the case to reject.
    host_port.is_none() && origin_port.is_some() && !is_loopback_hostname(host_host)
}

/// Whether a WebSocket request's `Origin` may be trusted.
///
/// Rejecting a cross-origin browser handshake is the WebSocket equivalent of
/// CSRF protection: `/ws` and `/ws/sync` accept terminal input, so a page on
/// another origin must not be able to open one. Rules, in order:
///
/// 1. No `Origin` header: not a browser-driven request (agents, curl,
///    `tauri_fetch`). Nothing to judge, and authentication already ran.
/// 2. The desktop shell's own scheme (`tauri://`, `asset://`,
///    `http(s)://tauri.localhost`). Only the app shell uses these.
/// 3. An exact entry in `auth.allowed_origins` - the escape hatch for reverse
///    proxies that rewrite `Host` and `Origin` in ways this cannot reconcile.
/// 4. `Origin`'s authority must equal `Host`, or `X-Forwarded-Host` when the
///    caller is in `trusted_proxies` (first value wins; chained proxies append).
///
/// A plain `localhost` origin gets no special treatment. A page served by any
/// other app on this machine is exactly what this check exists to stop: it is
/// same-host, so the loopback whitelist already lets it past authentication.
#[must_use]
pub fn check_ws_origin(
    headers: &HeaderMap,
    allowed_origins: &[String],
    client_ip: IpAddr,
    trusted_proxies: &[String],
) -> bool {
    let Some(raw_origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = raw_origin.to_str() else {
        return false;
    };
    let origin = origin.trim();
    if origin.is_empty() {
        return true;
    }
    if is_app_shell_origin(origin) {
        return true;
    }
    if allowed_origins.iter().any(|allowed| allowed.trim() == origin) {
        return true;
    }
    let Some((_scheme, origin_authority)) = split_scheme_authority(origin) else {
        // `Origin: null` (sandboxed iframe) and anything unparseable.
        return false;
    };
    let forwarded_host = if is_ip_whitelisted(client_ip, trusted_proxies) {
        headers
            .get("x-forwarded-host")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
    } else {
        None
    };
    let host = forwarded_host
        .or_else(|| headers.get(header::HOST).and_then(|value| value.to_str().ok()).map(str::trim))
        .filter(|value| !value.is_empty());
    let Some(host) = host else {
        return false;
    };
    authority_matches(origin_authority, host)
}

/// True when the request looks like a script-readable cross-site browser call.
///
/// Loopback/whitelisted peers are trusted without a session, but that trust
/// must not extend to requests scripted by a random website in the local
/// user's browser - the browser connects from 127.0.0.1 yet is controlled by
/// the site that opened the connection. Cross-origin fetch/XHR, WS handshakes
/// and cross-site form POSTs always carry `Origin`, so only requests WITH an
/// `Origin` header are examined here.
///
/// Requests WITHOUT `Origin` are never blocked: they are either native
/// clients (curl, the Tauri shell) or no-cors subresource loads (`<img>`,
/// `<script>`, `<link>`), whose response body the initiating page cannot
/// read. Blocking those broke every `<img>` from the Tauri webview
/// (`tauri://localhost` page -> `http://127.0.0.1:port` server), whose loads
/// send `Sec-Fetch-Site: cross-site` but no `Origin`.
///
/// Decision order: local origins (localhost / 127.0.0.1 / tauri.localhost,
/// e.g. the Tauri webview and localhost dev servers) are exempt first because
/// their calls to the embedded server are legitimately cross-origin and are
/// labeled `Sec-Fetch-Site: cross-site`; `Sec-Fetch-Site` then decides when
/// present (browser-set, stays `same-origin` behind Host-rewriting reverse
/// proxies); the Origin-vs-Host comparison is only the legacy fallback.
#[must_use]
pub fn is_cross_site_browser_request(headers: &HeaderMap) -> bool {
    let origin_authority = headers.get("origin").and_then(|v| v.to_str().ok()).map(|o| {
        o.strip_prefix("https://")
            .or_else(|| o.strip_prefix("http://"))
            .or_else(|| o.strip_prefix("tauri://"))
            .or_else(|| o.strip_prefix("asset://"))
            .unwrap_or(o)
    });

    // No Origin means not script-readable: cross-origin fetch/XHR/WS and
    // cross-site form POSTs always send it. Everything else (native clients,
    // no-cors subresource loads) cannot have its response read by a page.
    let Some(authority) = &origin_authority else {
        return false;
    };

    // 1. Local-origin exemption, checked FIRST. The Tauri webview
    // (tauri://localhost, http://tauri.localhost) and localhost dev servers
    // call the embedded server cross-origin by design, so they legitimately
    // pair a local Origin with `Sec-Fetch-Site: cross-site`. A remote page
    // cannot forge any of these origins.
    let origin_host = authority.rsplit(':').next_back().unwrap_or(authority);
    if origin_host.eq_ignore_ascii_case("localhost")
        || origin_host.eq_ignore_ascii_case("127.0.0.1")
        || origin_host.eq_ignore_ascii_case("tauri.localhost")
    {
        return false;
    }

    // 2. Sec-Fetch-Site is browser-set and labels scripted requests honestly:
    // a website scripting the local browser says `cross-site`, while a
    // same-origin call through a Host-rewriting reverse proxy still says
    // `same-origin` and must pass.
    if let Some(s) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        return s.eq_ignore_ascii_case("cross-site");
    }

    // 3. Legacy fallback without fetch metadata: an Origin authority that
    // disagrees with Host means cross-site.
    if let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) {
        return !authority.eq_ignore_ascii_case(host);
    }
    false
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

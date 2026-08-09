#![allow(clippy::unwrap_used, clippy::expect_used)]
mod external;
mod inject;
mod response;
mod rewrite;
mod websocket;

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use reqwest::Client;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use crate::auth::session::SessionStore;
use crate::settings::SettingsState;

pub use external::external_proxy_handler;

use inject::INJECT_SCRIPT_INTERNAL;
use response::build_proxied_response;
use rewrite::RewriteMode;
use websocket::proxy_websocket;

static BASE_TAG_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)<base\s[^>]*>").unwrap());

static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .gzip(true)
        .brotli(true)
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(10)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap()
});

static HTTP_CLIENT_STREAMING: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(5)
        .connect_timeout(Duration::from_secs(5))
        .build()
        .unwrap()
});

pub static HTTP_CLIENT_FOLLOW_REDIRECTS: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(10)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .gzip(true)
        .brotli(true)
        .build()
        .unwrap()
});

fn make_base_tag(host: &str, port: u16) -> String {
    if host == "127.0.0.1" {
        format!("<base href=\"/preview/{port}/\">")
    } else {
        format!("<base href=\"/preview/{host}/{port}/\">")
    }
}

fn is_valid_proxy_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    !host.contains('/')
        && !host.contains('@')
        && !host.contains(' ')
        && !host.contains('\\')
        && !host.contains(':')
}

/// Auth check for `/preview/*` requests.
/// - Loopback IPs are always trusted (matches the main auth middleware's IP
///   whitelist behavior: localhost users who bypass login still get preview
///   access).
/// - Non-loopback IPs:
///   - `allow_external = false`: forbidden.
///   - `allow_external = true`: must have a valid session cookie or Bearer token.
///
/// Returns `Some(Response)` if the request should be rejected, `None` to proceed.
fn check_preview_auth(
    req: &Request,
    real_ip: std::net::IpAddr,
    allow_external: bool,
    sessions: &SessionStore,
    token: &str,
) -> Option<Response> {
    if real_ip.is_loopback() {
        return None;
    }
    if !allow_external {
        return Some(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Preview proxy is only available from localhost"))
                .unwrap(),
        );
    }
    if !crate::auth::has_valid_auth(req, sessions, token) {
        return Some(
            Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"error":"unauthorized"}"#))
                .unwrap(),
        );
    }
    None
}

pub async fn proxy_handler_root(
    Path(port): Path<u16>,
    State(settings): State<SettingsState>,
    State(sessions): State<Arc<SessionStore>>,
    State(auth_token): State<Arc<tokio::sync::RwLock<String>>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
) -> impl IntoResponse {
    let (allow_external, allowed_origins, trusted_proxies, real_ip) = {
        let s = settings.read().await;
        let ip = crate::auth::real_client_ip(req.headers(), addr.ip(), &s.auth.trusted_proxies);
        (
            s.preview.allow_external,
            s.auth.allowed_origins.clone(),
            s.auth.trusted_proxies.clone(),
            ip,
        )
    };
    let token = auth_token.read().await.clone();
    if let Some(resp) = check_preview_auth(&req, real_ip, allow_external, &sessions, &token) {
        return resp;
    }
    proxy_internal("127.0.0.1", port, String::new(), req, &allowed_origins, &trusted_proxies).await
}

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
pub async fn proxy_handler_wildcard(
    State(settings): State<SettingsState>,
    State(sessions): State<Arc<SessionStore>>,
    State(auth_token): State<Arc<tokio::sync::RwLock<String>>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
) -> impl IntoResponse {
    let (allow_external, allowed_origins, trusted_proxies, real_ip) = {
        let s = settings.read().await;
        let ip = crate::auth::real_client_ip(req.headers(), addr.ip(), &s.auth.trusted_proxies);
        (
            s.preview.allow_external,
            s.auth.allowed_origins.clone(),
            s.auth.trusted_proxies.clone(),
            ip,
        )
    };
    let token = auth_token.read().await.clone();
    if let Some(resp) = check_preview_auth(&req, real_ip, allow_external, &sessions, &token) {
        return resp;
    }

    let uri_path = req.uri().path().to_string();
    let after = uri_path.strip_prefix("/preview/").unwrap_or("");

    let Some((host, port, path)) = parse_preview_path(after) else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid preview path"))
            .unwrap();
    };
    proxy_internal(&host, port, path, req, &allowed_origins, &trusted_proxies).await
}

fn parse_preview_path(after: &str) -> Option<(String, u16, String)> {
    let segments: Vec<&str> = after.splitn(3, '/').collect();
    match segments.len() {
        0 => None,
        1 => {
            let port: u16 = segments[0].parse().ok()?;
            Some(("127.0.0.1".to_string(), port, String::new()))
        }
        2 => {
            if let Ok(port) = segments[0].parse::<u16>() {
                Some(("127.0.0.1".to_string(), port, format!("/{}", segments[1])))
            } else {
                let port: u16 = segments[1].parse().ok()?;
                Some((segments[0].to_string(), port, String::new()))
            }
        }
        _ => {
            if let Ok(port) = segments[0].parse::<u16>() {
                let rest = &after[segments[0].len()..];
                Some(("127.0.0.1".to_string(), port, rest.to_string()))
            } else {
                let port: u16 = segments[1].parse().ok()?;
                let prefix_len = segments[0].len() + 1 + segments[1].len();
                let rest = &after[prefix_len..];
                Some((segments[0].to_string(), port, rest.to_string()))
            }
        }
    }
}

async fn proxy_internal(
    host: &str,
    port: u16,
    path: String,
    req: Request,
    allowed_origins: &[String],
    trusted_proxies: &[String],
) -> Response {
    if port < 1024 {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid port (must be 1024-65535)"))
            .unwrap();
    }

    if !is_valid_proxy_host(host) {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid host"))
            .unwrap();
    }

    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let path_part = if path.is_empty() || path == "/" {
        String::from("/")
    } else if path.starts_with('/') {
        path.clone()
    } else {
        format!("/{path}")
    };

    let is_websocket = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));

    if is_websocket {
        let ws_url = format!("ws://{host}:{port}{path_part}{query}");
        return proxy_websocket(req, ws_url, allowed_origins, trusted_proxies).await;
    }

    let target_url = format!("http://{host}:{port}{path_part}{query}");
    let original_url = target_url.clone();

    let (method, headers, body_bytes) = match extract_request(req).await {
        Ok(v) => v,
        Err(r) => return r,
    };

    let is_event_stream = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));

    let client = if is_event_stream { &*HTTP_CLIENT_STREAMING } else { &*HTTP_CLIENT };
    let mut proxy_req = client
        .request(reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(), &target_url);

    for (name, value) in &headers {
        let n = name.as_str();
        if n == "host" || n == "connection" || n == "upgrade" || n == "accept-encoding" {
            continue;
        }
        if let Ok(v) = value.to_str() {
            proxy_req = proxy_req.header(n, v);
        }
    }

    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes);
    }

    let upstream_resp = match proxy_req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_connect() {
                format!("Cannot connect to {host}:{port} — is the server running?")
            } else {
                format!("Proxy error: {e}")
            };
            let error_html = format!(
                r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview Error</title>
<style>body{{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#ccc}}
.box{{text-align:center;max-width:420px}}h2{{color:#f87171;margin-bottom:8px}}
p{{color:#888;font-size:14px}}a{{color:#89b4fa;text-decoration:none}}a:hover{{text-decoration:underline}}</style></head>
<body><div class="box"><h2>Cannot connect</h2><p>{msg}</p>
<p><a href="{original_url}" target="_blank">Open in new tab ↗</a></p></div></body></html>"#
            );
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Body::from(error_html))
                .unwrap();
        }
    };

    let inject_base = make_base_tag(host, port);
    let inject_script = INJECT_SCRIPT_INTERNAL
        .replace("document.currentScript.getAttribute('data-port')", &format!("'{port}'"))
        .replace("document.currentScript.getAttribute('data-host')", &format!("'{host}'"));
    build_proxied_response(
        upstream_resp,
        &inject_base,
        &inject_script,
        Some(RewriteMode::Internal { host: host.to_string(), port }),
    )
    .await
}

async fn extract_request(
    req: Request,
) -> Result<(axum::http::Method, axum::http::HeaderMap, Bytes), Response> {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let body_bytes =
        axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await.map_err(|_| {
            Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Request body too large"))
                .unwrap()
        })?;
    Ok((method, headers, body_bytes))
}

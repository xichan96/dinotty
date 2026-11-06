#![allow(clippy::unwrap_used, clippy::expect_used)]
mod external;
mod inject;
mod relay;
mod response;
mod rewrite;
mod websocket;

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use base64::Engine;
use bytes::Bytes;
use reqwest::Client;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use crate::auth::session::SessionStore;
use crate::settings::SettingsState;

pub use external::external_proxy_handler;
// The private-address guard, reused by any route that fetches a URL the client
// named (currently the language-pack registry). Re-exported rather than copied
// so there is exactly one definition of "this address is not ours to dial".
pub(crate) use external::{pinned_client, resolve_target};
pub use relay::{
    relay_dispatch_handler, relay_http_handler, relay_ws_handler, RELAY_CSRF_HEADER, RELAY_PREFIX,
};

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
        .user_agent(PROXY_USER_AGENT)
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(10)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .gzip(true)
        .brotli(true)
        .build()
        .unwrap()
});

pub(crate) const PROXY_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Opaque `/preview` target segment for an origin.
///
/// The origin is base64url'd instead of being split into three path segments.
/// A segment cannot contain `/`, `?` or `#`, so a host that does not look like
/// an address (IPv6 literals, punycode, a port that would otherwise be mistaken
/// for a path segment) cannot change how the rest of the URL is parsed. The
/// frontend encodes the same way.
pub(crate) fn encode_preview_target(scheme: &str, host: &str, port: u16) -> String {
    let origin = format!("{scheme}://{host}:{port}");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(origin.as_bytes())
}

fn decode_preview_target(segment: &str) -> Option<(String, String, u16)> {
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(segment).ok()?;
    let origin = std::str::from_utf8(&raw).ok()?;
    let url = reqwest::Url::parse(origin).ok()?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    // A target segment is an origin, never a whole URL: the path is carried by
    // the remaining segments so the previewed app sees its own routes.
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    let host = url.host_str()?.to_string();
    if host.is_empty() {
        return None;
    }
    Some((scheme.to_string(), host, url.port_or_known_default()?))
}

/// `<base href>` for a proxied document.
///
/// Relative URLs in the document resolve against its directory, not the
/// target root: `/preview/<seg>/slaves/abc/workflow-manage` must resolve
/// `logo.png` to `/preview/<seg>/slaves/abc/logo.png`.
fn make_base_tag(prefix: &str, path: &str) -> String {
    let dir = path.rfind('/').map_or("/", |i| &path[..=i]);
    format!("<base href=\"{prefix}{dir}\">")
}

/// Hub relay prefix attached to a proxied response's URLs, e.g. `/__srv/abc`.
///
/// The relay carries the remote server's `/preview` response verbatim, so a
/// previewed page served through the hub would otherwise keep requesting
/// `/preview/...` from the hub's local server instead of the remote one.
/// Only the hub sets this header; the shape is validated so a hand-written
/// value cannot smuggle markup into the base tag or injected script.
fn relay_prefix(headers: &HeaderMap) -> String {
    let Some(value) = headers.get("x-dinotty-relay-prefix").and_then(|v| v.to_str().ok()) else {
        return String::new();
    };
    let Some(id) = value.trim_end_matches('/').strip_prefix("/__srv/") else {
        return String::new();
    };
    let valid = !id.is_empty()
        && !id.contains('/')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        format!("/__srv/{id}")
    } else {
        String::new()
    }
}

fn is_valid_proxy_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    // `Url::host_str()` keeps the brackets on IPv6 literals; accept exactly a
    // bracketed address so a `host:port` string still cannot slip through.
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<std::net::Ipv6Addr>().is_ok();
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
        // Loopback is trusted without a session, but not when the call was
        // scripted cross-site by a website in the local user's browser.
        if crate::auth::is_cross_site_browser_request(req.headers()) {
            tracing::warn!(
                "preview: reject cross-site browser request to {} (origin {:?})",
                req.uri().path(),
                req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok())
            );
            return Some(
                Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .body(Body::from("Cross-site requests are not allowed"))
                    .unwrap(),
            );
        }
        return None;
    }
    if !allow_external {
        return Some(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from(
                    "Preview proxy is only available from localhost. Enable \"Allow External \
                     Preview Access\" in Settings to preview from other devices.",
                ))
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

    let Some(target) = parse_preview_path(after) else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid preview path"))
            .unwrap();
    };
    let relay = relay_prefix(req.headers());
    proxy_internal(&target, &relay, req, &allowed_origins, &trusted_proxies).await
}

/// One `/preview/...` target.
struct PreviewTarget {
    scheme: String,
    host: String,
    port: u16,
    /// Browser-visible prefix without the hub relay prefix, e.g.
    /// `/preview/aHR0cDovLzEwLjAuMC41OjgwODk` or the legacy
    /// `/preview/http/10.0.0.5/8089`.
    prefix: String,
    /// Upstream path. Always starts with `/`.
    path: String,
}

/// Parse `/preview/...`.
///
/// Canonical form is `/preview/{base64url(origin)}/{path}`. The older
/// readable forms (`/preview/{port}/...`, `/preview/{host}/{port}/...` and
/// `/preview/{scheme}/{host}/{port}/...`) are still accepted so existing links
/// keep working; they always default to plain HTTP unless the scheme segment
/// says otherwise.
fn parse_preview_path(after: &str) -> Option<PreviewTarget> {
    let (first, rest) = match after.split_once('/') {
        Some((first, rest)) => (first, Some(rest)),
        None => (after, None),
    };

    if first == "http" || first == "https" {
        let (host, port, path) = parse_preview_target(rest?)?;
        let prefix = format!("/preview/{first}/{host}/{port}");
        return Some(PreviewTarget { scheme: first.to_string(), host, port, prefix, path });
    }

    if let Some((scheme, host, port)) = decode_preview_target(first) {
        let prefix = format!("/preview/{first}");
        let path = match rest {
            None | Some("") => "/".to_string(),
            Some(rest) => format!("/{rest}"),
        };
        return Some(PreviewTarget { scheme, host, port, prefix, path });
    }

    let (host, port, path) = parse_preview_target(after)?;
    let prefix = if first.parse::<u16>().is_ok() {
        format!("/preview/{port}")
    } else {
        format!("/preview/{host}/{port}")
    };
    Some(PreviewTarget { scheme: "http".to_string(), host, port, prefix, path })
}

fn parse_preview_target(after: &str) -> Option<(String, u16, String)> {
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

/// Whether a browser request header should be passed through to the upstream.
///
/// Two groups are dropped. Hop-by-hop headers (`host`, `connection`, `upgrade`)
/// describe this TCP connection, and `accept-encoding` is dropped so the
/// upstream sends plaintext that [`build_proxied_response`] can rewrite.
///
/// The rest — `origin` and `sec-fetch-*` — describe the browser's relationship
/// to *dinotty*, not to the upstream, and forwarding them verbatim is what
/// breaks same-origin fences. Since `host` is dropped, reqwest sets it to the
/// upstream authority; an untouched `Origin` then still names dinotty. A fence
/// of the shape `Origin.host === Host.host` rejects exactly that pair, and no
/// upstream allowlist can help, because the two headers are compared against
/// *each other* rather than against a configured list. `Sec-Fetch-Site` is a
/// second, independent fence: an upstream refusing `cross-site` sees a false
/// positive, since that label describes browser→dinotty. Both are re-added by
/// [`same_origin_headers`].
fn should_forward_header(name: &str) -> bool {
    !matches!(
        name,
        "host" | "connection" | "upgrade" | "accept-encoding" | "origin" | "x-dinotty-relay-prefix"
    ) && !name.starts_with("sec-fetch-")
}

/// Headers presenting the proxy as a same-origin caller of `host:port`.
///
/// `Origin` is built from the same authority reqwest will put in `Host`, so the
/// pair always agrees. `Sec-Fetch-Site` describes this proxy→upstream hop.
///
/// This makes dinotty vouch for the browser, which weakens the upstream's own
/// CSRF protection — sound only because dinotty is the trust boundary:
/// non-loopback callers already cleared session/token auth in
/// [`check_preview_auth`] before reaching here.
fn same_origin_headers(scheme: &str, host: &str, port: u16) -> [(&'static str, String); 2] {
    [("origin", format!("{scheme}://{host}:{port}")), ("sec-fetch-site", "same-origin".to_string())]
}

async fn proxy_internal(
    target: &PreviewTarget,
    relay: &str,
    req: Request,
    allowed_origins: &[String],
    trusted_proxies: &[String],
) -> Response {
    let PreviewTarget { scheme, host, port, prefix: canonical_prefix, path } = target;
    let scheme = scheme.as_str();
    let host = host.as_str();
    let port = *port;
    let external_prefix = format!("{relay}{canonical_prefix}");

    if scheme != "http" && scheme != "https" {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid scheme"))
            .unwrap();
    }

    // Intranet pages frequently live on privileged ports (80/443), so the
    // preview proxy deliberately accepts every non-zero port. The route is
    // already gated by `check_preview_auth`: loopback is trusted, and remote
    // callers need a session or token when `allow_external` is on.
    if port == 0 {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid port"))
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
        let ws_scheme = if scheme == "https" { "wss" } else { "ws" };
        let ws_url = format!("{ws_scheme}://{host}:{port}{path_part}{query}");
        // `/preview/` forwards on the caller's behalf; there is no roster
        // credential to inject here.
        return proxy_websocket(req, ws_url, allowed_origins, trusted_proxies, &[]).await;
    }

    let target_url = format!("{scheme}://{host}:{port}{path_part}{query}");

    let (method, headers, body_bytes) = match extract_request(req).await {
        Ok(v) => v,
        Err(r) => return *r,
    };

    let upstream_resp = match send_upstream(target, &target_url, method, &headers, body_bytes).await
    {
        Ok(r) => r,
        Err(resp) => return *resp,
    };

    let inject_base = make_base_tag(&external_prefix, &path_part);
    let inject_script = INJECT_SCRIPT_INTERNAL
        .replace("__DN_PORT__", &js_literal(&port.to_string()))
        .replace("__DN_HOST__", &js_literal(host))
        .replace("__DN_SCHEME__", &js_literal(scheme))
        .replace("__DN_PREFIX__", &js_literal(&external_prefix))
        .replace("__DN_PATH__", &js_literal(&path_part));
    build_proxied_response(
        upstream_resp,
        &inject_base,
        &inject_script,
        Some(RewriteMode::Internal(rewrite::InternalTarget {
            scheme: scheme.to_string(),
            host: host.to_string(),
            port,
            prefix: external_prefix,
            relay_prefix: relay.to_string(),
        })),
        &target_url,
    )
    .await
}

/// A JSON-escaped JS string literal that is also safe inside an inline
/// `<script>` element. `serde_json` covers quotes and backslashes; `<` and `>`
/// are escaped too so a path containing `</script>` cannot end the block.
fn js_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// Forward one already-extracted request to the upstream.
///
/// Kept apart from [`proxy_internal`] so the shape of the outgoing request is
/// readable in one place: hop-by-hop headers and the browser's relationship to
/// Dinotty are dropped, and the proxy presents itself as a same-origin caller.
async fn send_upstream(
    target: &PreviewTarget,
    target_url: &str,
    method: axum::http::Method,
    headers: &axum::http::HeaderMap,
    body_bytes: Bytes,
) -> Result<reqwest::Response, Box<Response>> {
    let is_event_stream = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));

    let client = if is_event_stream { &*HTTP_CLIENT_STREAMING } else { &*HTTP_CLIENT };
    let mut proxy_req = client
        .request(reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(), target_url);

    for (name, value) in headers {
        if !should_forward_header(name.as_str()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            proxy_req = proxy_req.header(name.as_str(), v);
        }
    }
    for (name, value) in same_origin_headers(&target.scheme, &target.host, target.port) {
        proxy_req = proxy_req.header(name, value);
    }

    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes);
    }

    proxy_req.send().await.map_err(|e| Box::new(connect_error_response(target, target_url, &e)))
}

fn connect_error_response(
    target: &PreviewTarget,
    target_url: &str,
    e: &reqwest::Error,
) -> Response {
    let msg = if e.is_connect() {
        format!("Cannot connect to {}:{} — is the server running?", target.host, target.port)
    } else {
        format!("Proxy error: {e}")
    };
    let error_html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview Error</title>
<style>body{{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#ccc}}
.box{{text-align:center;max-width:420px}}h2{{color:#f87171;margin-bottom:8px}}
p{{color:#888;font-size:14px}}a{{color:#89b4fa;text-decoration:none}}a:hover{{text-decoration:underline}}</style></head>
<body><div class="box"><h2>Cannot connect</h2><p>{msg}</p>
<p><a href="{target_url}" target="_blank">Open in new tab ↗</a></p></div></body></html>"#
    );
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(error_html))
        .unwrap()
}

async fn extract_request(
    req: Request,
) -> Result<(axum::http::Method, axum::http::HeaderMap, Bytes), Box<Response>> {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let body_bytes =
        axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await.map_err(|_| {
            Box::new(
                Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .body(Body::from("Request body too large"))
                    .unwrap(),
            )
        })?;
    Ok((method, headers, body_bytes))
}

#[cfg(test)]
mod tests {
    use super::{
        encode_preview_target, is_valid_proxy_host, parse_preview_path, relay_prefix,
        same_origin_headers, should_forward_header,
    };

    /// The regression this file exists for. A dev server that guards its API
    /// with `Origin.host === Host.host` 403s every proxied request if the
    /// browser's `Origin` survives, because dropping `host` makes reqwest set
    /// `Host` to the upstream authority. The failure is silent from dinotty's
    /// side — it just relays the upstream's 403 — so nothing else would catch a
    /// refactor that put `origin` back in the pass-through set.
    #[test]
    fn browser_origin_is_never_forwarded() {
        assert!(!should_forward_header("origin"));
    }

    /// `Sec-Fetch-Site: cross-site` is an *independent* rejection path: an
    /// upstream can refuse on it with no `Origin` present at all. A browser
    /// reaching dinotty over a tunnel labels the preview iframe's requests
    /// `cross-site`, which describes browser→dinotty and is a false positive
    /// for the proxy→upstream hop.
    #[test]
    fn fetch_metadata_describes_the_browser_hop_and_is_dropped() {
        for h in ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"] {
            assert!(!should_forward_header(h), "{h} must not leak to the upstream");
        }
    }

    #[test]
    fn hop_by_hop_headers_are_dropped() {
        for h in ["host", "connection", "upgrade", "accept-encoding"] {
            assert!(!should_forward_header(h), "{h} describes this connection, not the upstream");
        }
    }

    /// The rewrite must stay surgical. If credentials or `Sec-WebSocket-*`
    /// stopped flowing, previews of authenticated dev servers would break in a
    /// way that looks unrelated to this code.
    #[test]
    fn credentials_and_content_headers_still_reach_upstream() {
        for h in [
            "cookie",
            "authorization",
            "content-type",
            "content-length",
            "accept",
            "user-agent",
            "referer",
            "sec-websocket-key",
            "sec-websocket-protocol",
            "x-requested-with",
        ] {
            assert!(should_forward_header(h), "{h} must be forwarded");
        }
    }

    /// The two headers are only useful if they agree; a fence compares them to
    /// each other. `Host` is whatever reqwest derives from the target URL's
    /// authority, so `Origin` must be built from that same authority.
    #[test]
    fn injected_origin_matches_the_upstream_authority() {
        // 203.0.113.0/24 is RFC 5737 documentation space.
        let headers = same_origin_headers("http", "203.0.113.7", 5173);
        assert_eq!(headers[0], ("origin", "http://203.0.113.7:5173".to_string()));
        assert_eq!(headers[1], ("sec-fetch-site", "same-origin".to_string()));
    }

    /// The port is always explicit, including for 80/443. Omitting it would
    /// make `Origin` and `Host` disagree as strings even when they name the
    /// same authority, and the fence is a string comparison.
    #[test]
    fn injected_origin_keeps_the_port_explicit() {
        assert_eq!(same_origin_headers("http", "127.0.0.1", 8080)[0].1, "http://127.0.0.1:8080");
        assert!(same_origin_headers("http", "localhost", 3000)[0].1.ends_with(":3000"));
        assert_eq!(same_origin_headers("https", "10.1.2.3", 443)[0].1, "https://10.1.2.3:443");
    }

    /// Header names arrive lowercased from `HeaderMap`, but a match arm is an
    /// exact comparison — pin that assumption so a future caller passing raw
    /// bytes cannot silently bypass the filter.
    #[test]
    fn unrelated_headers_are_unaffected() {
        assert!(should_forward_header("x-sec-fetch-site"), "only a prefix match should apply");
        assert!(should_forward_header("origination-id"), "substring of `origin` is not `origin`");
    }

    fn parts(after: &str) -> Option<(String, String, u16, String, String)> {
        parse_preview_path(after).map(|t| (t.scheme, t.host, t.port, t.prefix, t.path))
    }

    /// The canonical form keeps the whole origin in one opaque segment and
    /// leaves the upstream path alone, so a multi-segment app route cannot be
    /// mistaken for host/port segments.
    #[test]
    fn canonical_preview_paths_use_the_encoded_origin() {
        let seg = encode_preview_target("http", "10.70.11.20", 8089);
        let after = format!("{seg}/slaves/04403aa6fc000a00/workflow-manage");
        assert_eq!(
            parts(&after),
            Some((
                "http".into(),
                "10.70.11.20".into(),
                8089,
                format!("/preview/{seg}"),
                "/slaves/04403aa6fc000a00/workflow-manage".into()
            ))
        );
    }

    #[test]
    fn decoded_origin_keeps_tls_and_root_paths() {
        let seg = encode_preview_target("https", "intranet.example.test", 8443);
        assert_eq!(
            parts(&format!("{seg}/")),
            Some((
                "https".into(),
                "intranet.example.test".into(),
                8443,
                format!("/preview/{seg}"),
                "/".into()
            ))
        );
        let root = encode_preview_target("https", "intranet.example.test", 443);
        assert_eq!(parts(&root).map(|p| (p.0, p.4)), Some(("https".into(), "/".into())));
    }

    /// The readable legacy forms stay accepted so saved links keep working.
    #[test]
    fn legacy_preview_paths_still_parse() {
        assert_eq!(
            parts("http/172.25.26.252/80/index.html"),
            Some((
                "http".into(),
                "172.25.26.252".into(),
                80,
                "/preview/http/172.25.26.252/80".into(),
                "/index.html".into()
            ))
        );
        assert_eq!(
            parts("http/8080/x"),
            Some((
                "http".into(),
                "127.0.0.1".into(),
                8080,
                "/preview/http/127.0.0.1/8080".into(),
                "/x".into()
            ))
        );
        assert_eq!(
            parts("172.25.26.252/80/app"),
            Some((
                "http".into(),
                "172.25.26.252".into(),
                80,
                "/preview/172.25.26.252/80".into(),
                "/app".into()
            ))
        );
        assert_eq!(
            parts("5173/"),
            Some(("http".into(), "127.0.0.1".into(), 5173, "/preview/5173".into(), "/".into()))
        );
    }

    /// A segment that merely happens to be valid base64 must fall through to
    /// the legacy parser instead of being decoded into a bogus origin.
    #[test]
    fn non_origin_base64_falls_back_to_legacy() {
        assert_eq!(
            parts("aGVsbG8/80/x").map(|p| (p.1, p.2, p.4)),
            Some(("aGVsbG8".into(), 80, "/x".into()))
        );
    }

    /// The relay prefix is appended in front of the canonical prefix and is
    /// rejected unless it is exactly one safe id segment.
    #[test]
    fn relay_prefix_is_validated() {
        use axum::http::HeaderMap;
        let mut headers = HeaderMap::new();
        assert_eq!(relay_prefix(&headers), "");
        headers.insert("x-dinotty-relay-prefix", "/__srv/abc-1".parse().unwrap());
        assert_eq!(relay_prefix(&headers), "/__srv/abc-1");
        headers.insert("x-dinotty-relay-prefix", "/__srv/a/b".parse().unwrap());
        assert_eq!(relay_prefix(&headers), "");
        headers.insert("x-dinotty-relay-prefix", "/evil".parse().unwrap());
        assert_eq!(relay_prefix(&headers), "");
    }

    /// An IPv6 literal arrives bracketed from `Url::host_str()`. It is a valid
    /// target, while a `host:port` string must still be rejected.
    #[test]
    fn ipv6_literals_are_valid_hosts_but_ports_are_not() {
        assert!(is_valid_proxy_host("[::1]"));
        assert!(is_valid_proxy_host("[2001:db8::1]"));
        assert!(!is_valid_proxy_host("[::1]:8080"));
        assert!(!is_valid_proxy_host("10.0.0.5:8080"));
    }

    /// `</script>` in a path must not be able to close the injected block.
    #[test]
    fn js_literal_escapes_html_sensitive_characters() {
        assert_eq!(super::js_literal("</script>"), "\"\\u003c/script\\u003e\"");
        assert_eq!(super::js_literal("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
}

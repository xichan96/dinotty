#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Hub relay: re-serve a *remote* dinotty server's HTTP and WebSocket traffic
//! under this hub's own origin, at `/__srv/<server id>/…`.
//!
//! The frontend never talks to a remote server's origin directly. It keeps
//! talking to the origin that served the page (the hub) and the hub forwards,
//! injecting the upstream `Authorization` header from its own roster. That is
//! what makes the switch purely a transport concern: no CORS allowlisting on
//! either side, no remote-side auth change, and the upstream token never
//! reaches JavaScript.
//!
//! The relay is transparent: the same application protocol runs on both ends,
//! so - unlike `/preview/` - it rewrites no URLs, injects no script and touches
//! no policy headers. The only things it changes are the hop-by-hop headers,
//! the credentials it substitutes, and the paths it refuses to carry at all.

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use crate::auth::session::SessionStore;
use crate::settings::{RemoteServer, SensitiveString, SettingsState};

/// Reserved path prefix for relayed requests: `/__srv/<server id>/<rest>`.
///
/// Must stay in sync with the `/__srv/` early return in
/// `crate::auth::auth_middleware` - the relay owns its own gate, so the global
/// middleware has to let these paths through untouched. (Both hosts share that
/// one middleware: the Tauri router calls into the same core function.)
pub const RELAY_PREFIX: &str = "/__srv";

/// Anti-CSRF header required on every mutating relayed request.
///
/// The relay holds *another server's credentials*, so it must not be drivable
/// by a page the user merely happens to have open. A cross-origin `no-cors`
/// request cannot set a custom header (doing so would make it preflighted, and
/// `allowed_origins` blocks the preflight), while a same-origin request can.
/// This is strictly stronger than the `/preview/` rules, which tolerate
/// header-less requests for `<img>`-style subresources.
pub const RELAY_CSRF_HEADER: &str = "x-dinotty-relay";

/// Split `/__srv/<id>/<rest>` into its server id and the remainder.
///
/// Returns `None` when the path is not under [`RELAY_PREFIX`] or carries an
/// empty id. `rest` is returned without a leading slash and is `""` for a
/// request to the server root.
#[must_use]
pub fn parse_relay_path(path: &str) -> Option<(&str, &str)> {
    let after = path.strip_prefix(RELAY_PREFIX)?.strip_prefix('/')?;
    if after.is_empty() {
        return None;
    }
    match after.split_once('/') {
        Some((id, rest)) if !id.is_empty() => Some((id, rest)),
        Some(_) => None,
        None => Some((after, "")),
    }
}

/// Headers that describe *this* connection rather than the request's
/// destination. RFC 7230 §6.1 requires a proxy to strip them in both
/// directions; `proxy-` covers `Proxy-Authenticate`/`Proxy-Authorization`.
fn is_hop_by_hop(name: &str) -> bool {
    matches!(name, "connection" | "keep-alive" | "te" | "trailer" | "transfer-encoding" | "upgrade")
        || name.starts_with("proxy-")
}

/// Whether a client header survives the hop to the upstream.
///
/// [`super::should_forward_header`] already drops `host` (the upstream URL
/// decides it), `accept-encoding` (so the relay's own HTTP client, not the
/// caller, controls compression) and the browser↔dinotty pair `origin` /
/// `sec-fetch-*` - those describe the caller's relationship to *the hub*, and
/// forwarding them would make a dinotty upstream judge a request that never
/// came from a browser. On top of those the relay drops:
///
/// - `authorization`: the caller's credential is the hub's own; the upstream
///   gets the roster token instead (see [`forward_http`]);
/// - `cookie`: the relay crosses a trust boundary. The caller's cookies were
///   issued by *this* hub for *this* hub's origin, and the upstream is a
///   different machine - so forwarding them leaks the hub's session credential
///   to a host that has no business seeing it. The upstream gains nothing
///   either: the relay authenticates with the roster token. This is the one
///   place the relay is deliberately *less* transparent than `/preview/`, which
///   forwards cookies because it drives a dev server the user is logged into;
/// - `content-length`: the body is streamed with an unknown size and reqwest
///   frames it itself. A length header next to a stream is how a body gets
///   truncated;
/// - [`RELAY_CSRF_HEADER`]: hub-internal signalling, not the upstream's
///   business.
fn should_forward_header(name: &str) -> bool {
    !is_hop_by_hop(name)
        && name != RELAY_CSRF_HEADER
        && !matches!(name, "authorization" | "cookie" | "content-length")
        && super::should_forward_header(name)
}

/// Methods that must carry [`RELAY_CSRF_HEADER`].
///
/// The exempt set is the read-only one the frontend issues without any custom
/// header; every other method can have a side effect on the upstream, so the
/// caller has to prove it is not a cross-site `no-cors` request.
fn needs_csrf_header(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn has_csrf_header(headers: &HeaderMap) -> bool {
    headers
        .get(RELAY_CSRF_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| !v.trim().is_empty())
}

/// Paths that must always resolve against the *hub*, never be relayed.
///
/// In browser mode `apiUrl('/api/auth')` becomes `/__srv/<id>/api/auth`, and
/// relaying it would send the credentials to the upstream, which would set its
/// session cookie for the *upstream's* origin while the page stays on the
/// hub's - a login that looks like it worked and leaves the next request
/// unauthenticated anyway. There is nothing to log into remotely regardless:
/// the hub holds the upstream's token, so authentication always lands here.
///
/// `/api/auto-token` (loopback-only) and `/api/token-configured` (public) are
/// hub endpoints by `auth_middleware`'s own lists, and `/api/token*` /
/// `/api/tokens*` hand out the hub's credentials.
///
/// `rest` must already be the *resolved* path - see [`normalized_relay_path`].
/// Handing this the raw remainder is what let `api/plugins/../../../api/token`
/// through: no prefix here matches that string, but the upstream receives
/// `/api/token`.
fn is_hub_only_path(rest: &str) -> bool {
    // A trailing slash must not turn an excluded path into a relayable one.
    let path = rest.trim_end_matches('/');
    path == "api/auth"
        || path.starts_with("api/auth/")
        || path == "api/token"
        || path.starts_with("api/token/")
        || path == "api/auto-token"
        || path == "api/token-configured"
        // `/api/tokens` and `/api/tokens/:id`. The bare `starts_with` also
        // covers any future `api/tokens…` sibling, which is the safe side to
        // err on.
        || path.starts_with("api/tokens")
}

/// The path a relayed request will *actually* resolve to on the upstream.
///
/// The gate has to run on this rather than on the raw remainder, because
/// `Url::parse` - the very call [`forward_http`] builds the upstream URL with -
/// normalizes the path on the way: `.` and `..` segments, including their
/// `%2e` spellings, are collapsed before the request leaves the hub. So
/// `api/plugins/../../../api/token` arrives upstream as `/api/token`, while a
/// check against the raw string sees no `api/token` prefix anywhere and waves
/// it through - handing the caller the upstream's own credential.
///
/// Resolving here with that same parser is the point: the verdict and the
/// request cannot disagree about where the request goes. The origin is
/// irrelevant (only the path is normalized) and `.invalid` is reserved by
/// RFC 2606, so this never names a host that could be reached.
fn normalized_relay_path(rest: &str) -> Option<String> {
    let url = reqwest::Url::parse(&format!("http://relay.invalid/{rest}")).ok()?;
    Some(url.path().trim_start_matches('/').to_string())
}

fn forbidden(msg: &str) -> Response {
    (StatusCode::FORBIDDEN, msg.to_string()).into_response()
}

/// The relay's gate, in one place.
///
/// Order matters only for what the caller learns: the roster is consulted
/// last, so an unauthenticated caller cannot probe which ids exist, and a
/// *missing* id answers exactly like an id the roster no longer has.
///
/// The loopback test uses [`crate::auth::real_client_ip`]'s verdict rather
/// than the raw peer address: behind a same-host tunnel every caller looks
/// loopback, which is the vulnerability `real_client_ip` exists to close.
///
/// The rejection is boxed to keep the happy path small - `Response` is much
/// wider than the `RemoteServer` it competes with - matching how
/// [`super::extract_request`] reports its own failures.
fn authorized_target(
    req: &Request,
    real_ip: IpAddr,
    sessions: &SessionStore,
    token: &str,
    servers: &[RemoteServer],
    id: &str,
    rest: &str,
) -> Result<RemoteServer, Box<Response>> {
    if !real_ip.is_loopback() && !crate::auth::has_valid_auth(req, sessions, token) {
        tracing::warn!(
            "relay: reject {} {} from {real_ip} (no valid session or token)",
            req.method(),
            req.uri().path()
        );
        return Err(Box::new((StatusCode::UNAUTHORIZED, "relay: unauthorized").into_response()));
    }

    // Loopback is trusted, but not when the connection was scripted by a
    // website in the local user's browser - the same rule `/preview/` applies.
    if crate::auth::is_cross_site_browser_request(req.headers()) {
        tracing::warn!(
            "relay: reject cross-site browser request to {} (origin {:?})",
            req.uri().path(),
            req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok())
        );
        return Err(Box::new(forbidden("Cross-site requests are not allowed")));
    }

    // Resolve before judging: `is_hub_only_path` must see the path the upstream
    // will see, not the one the caller spelled.
    let Some(resolved) = normalized_relay_path(rest) else {
        return Err(Box::new((StatusCode::BAD_REQUEST, "malformed relay path").into_response()));
    };
    if is_hub_only_path(&resolved) {
        tracing::warn!(
            "relay: refuse hub-only path {} (resolves to {resolved}, id {id})",
            req.uri().path()
        );
        return Err(Box::new(forbidden("This endpoint is not relayed; use it on the hub")));
    }

    if needs_csrf_header(req.method()) && !has_csrf_header(req.headers()) {
        tracing::warn!(
            "relay: reject {} {} without the {RELAY_CSRF_HEADER} header",
            req.method(),
            req.uri().path()
        );
        return Err(Box::new(forbidden("Missing X-Dinotty-Relay header")));
    }

    servers.iter().find(|s| s.id == id).cloned().ok_or_else(|| {
        // Deliberately terse and identical to a malformed id: the roster is
        // not the caller's to enumerate.
        Box::new((StatusCode::NOT_FOUND, "Unknown server").into_response())
    })
}

/// A roster `url` reduced to a scheme+authority origin.
///
/// The roster is documented as storing a normalized origin, but the relay does
/// not take that on faith: it parses and rebuilds, so a hand-edited
/// `settings.json` can neither smuggle a path into the target nor make the
/// relay carry a `user:pass@` credential the roster never validated.
fn upstream_origin(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if matches!(url.host_str(), None | Some("")) {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

/// The WebSocket URL for the same origin and remainder.
///
/// `origin` comes from [`upstream_origin`], so the scheme is always http(s)
/// and the mapping to ws(s) is total.
fn upstream_ws_url(origin: &str, rest: &str, query: Option<&str>) -> Option<String> {
    let base = match origin.split_once("://") {
        Some(("http", host)) => format!("ws://{host}"),
        Some(("https", host)) => format!("wss://{host}"),
        _ => return None,
    };
    let query = query.map_or(String::new(), |q| format!("?{q}"));
    Some(format!("{base}/{rest}{query}"))
}

fn bad_gateway(msg: String) -> Response {
    tracing::error!("relay: {msg}");
    (StatusCode::BAD_GATEWAY, msg).into_response()
}

/// Forward a non-WebSocket relayed request to the roster server named in the
/// path.
///
/// The gate is [`authorized_target`]; everything below it is transport.
pub async fn relay_http_handler(
    Path(id): Path<String>,
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(sessions): State<Arc<SessionStore>>,
    State(auth_token): State<Arc<tokio::sync::RwLock<String>>>,
    req: Request,
) -> Response {
    // The dispatcher already parsed this out of the same path; re-reading it
    // here is what keeps one gate for all three `/__srv` route shapes.
    let path = req.uri().path().to_string();
    let Some((_, rest)) = parse_relay_path(&path) else {
        return (StatusCode::BAD_REQUEST, "Malformed relay path").into_response();
    };

    let hub_token = auth_token.read().await.clone();
    let (servers, real_ip) = {
        let s = settings.read().await;
        let ip = crate::auth::real_client_ip(req.headers(), addr.ip(), &s.auth.trusted_proxies);
        (s.remote_servers.clone(), ip)
    };

    let target = match authorized_target(&req, real_ip, &sessions, &hub_token, &servers, &id, rest)
    {
        Ok(t) => t,
        Err(denied) => return *denied,
    };
    let Some(origin) = upstream_origin(&target.url) else {
        return bad_gateway(format!("server '{id}' has no usable http(s) url"));
    };
    // Empty upstream token means the upstream runs unauthenticated; injecting
    // `Bearer ` there would only add a header that authenticates nothing.
    let upstream_token = target.token.as_ref().map_or("", SensitiveString::expose);

    forward_http(req, &origin, rest, upstream_token).await
}

/// Copy `req` to `origin/rest` and stream the answer back.
///
/// The body is streamed in both directions rather than buffered: the relayed
/// traffic includes workspace uploads, and the buffered `/preview/` path's
/// 10 MB ceiling does not exist on the hub's own upload route, so imposing it
/// here would break exactly the calls the relay exists to carry.
async fn forward_http(req: Request, origin: &str, rest: &str, upstream_token: &str) -> Response {
    let query = req.uri().query().map_or(String::new(), |q| format!("?{q}"));
    let Ok(target_url) = reqwest::Url::parse(&format!("{origin}/{rest}{query}")) else {
        return (StatusCode::BAD_REQUEST, "Cannot build the upstream url").into_response();
    };

    let method = req.method().clone();
    let is_event_stream = req
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));
    let (parts, body) = req.into_parts();
    let headers = parts.headers;
    // `content-length: 0` is the only positive proof that there is nothing to
    // forward. The inverse rule ("no length, no body") would silently drop the
    // body of an HTTP/2 request, which may carry one with neither
    // `content-length` nor `transfer-encoding`; the cost of erring the other
    // way is one empty `chunked` frame on a bodyless request.
    let has_body = headers.get(header::CONTENT_LENGTH).is_none_or(|v| v.as_bytes() != b"0");

    // Both clients pin `redirect::Policy::none()`: following a redirect would
    // let an upstream steer the hub at a host the roster never named. The
    // streaming one is used for `text/event-stream`, which the 30s timeout on
    // the regular client would cut off mid-stream.
    let client =
        if is_event_stream { &*super::HTTP_CLIENT_STREAMING } else { &*super::HTTP_CLIENT };
    let mut proxy_req = client
        .request(reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(), target_url);
    for (name, value) in &headers {
        if !should_forward_header(name.as_str()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            proxy_req = proxy_req.header(name.as_str(), v);
        }
    }
    if !upstream_token.is_empty() {
        proxy_req = proxy_req.header(header::AUTHORIZATION, format!("Bearer {upstream_token}"));
    }
    if has_body {
        proxy_req = proxy_req.body(reqwest::Body::wrap_stream(body.into_data_stream()));
    }

    let upstream = match proxy_req.send().await {
        Ok(r) => r,
        Err(e) => {
            return bad_gateway(format!("cannot reach {origin}: {e}"));
        }
    };
    relay_response(upstream)
}

/// Hand the upstream's answer back, minus the hop-by-hop headers.
///
/// Straight copy otherwise: a dinotty upstream's `set-cookie`, `location` and
/// `content-length` describe the same resources the caller asked for, and
/// rewriting them would break the very identity the relay is preserving.
fn relay_response(upstream: reqwest::Response) -> Response {
    let mut builder = Response::builder().status(upstream.status().as_u16());
    for (name, value) in upstream.headers() {
        if is_hop_by_hop(name.as_str()) {
            continue;
        }
        builder = builder.header(name, value);
    }
    let stream = upstream.bytes_stream().map(|r| r.map_err(std::io::Error::other));
    builder.body(Body::from_stream(stream)).unwrap()
}

/// Forward a relayed WebSocket upgrade.
///
/// Same gate as the HTTP path, run before anything is handed to
/// [`super::proxy_websocket`]: that function's own `check_ws_origin` is
/// currently stubbed to always allow (`crate::auth::check_ws_origin`), so it
/// must not carry any of the relay's security weight.
pub async fn relay_ws_handler(
    Path(id): Path<String>,
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(sessions): State<Arc<SessionStore>>,
    State(auth_token): State<Arc<tokio::sync::RwLock<String>>>,
    req: Request,
) -> Response {
    let path = req.uri().path().to_string();
    let Some((_, rest)) = parse_relay_path(&path) else {
        return (StatusCode::BAD_REQUEST, "Malformed relay path").into_response();
    };

    let hub_token = auth_token.read().await.clone();
    let (servers, allowed_origins, trusted_proxies, real_ip) = {
        let s = settings.read().await;
        let ip = crate::auth::real_client_ip(req.headers(), addr.ip(), &s.auth.trusted_proxies);
        (
            s.remote_servers.clone(),
            s.auth.allowed_origins.clone(),
            s.auth.trusted_proxies.clone(),
            ip,
        )
    };

    let target = match authorized_target(&req, real_ip, &sessions, &hub_token, &servers, &id, rest)
    {
        Ok(t) => t,
        Err(denied) => return *denied,
    };
    let Some(origin) = upstream_origin(&target.url) else {
        return bad_gateway(format!("server '{id}' has no usable http(s) url"));
    };
    let Some(ws_url) = upstream_ws_url(&origin, rest, req.uri().query()) else {
        return bad_gateway(format!("cannot build a websocket url for '{id}'"));
    };
    // Injected last by `proxy_websocket`, so a `sec-websocket-*` header the
    // caller happened to send cannot shadow the credential.
    let inject_headers: Vec<(String, String)> =
        match target.token.as_ref().map_or("", SensitiveString::expose) {
            "" => Vec::new(),
            t => vec![(header::AUTHORIZATION.to_string(), format!("Bearer {t}"))],
        };

    // `proxy_websocket` forwards `cookie` on purpose - `/preview/` shares it,
    // and there the cookie belongs to the server being previewed. Here it does
    // not: the cookie was issued by this hub for this hub's origin, and the
    // upstream is a different machine. Strip it from the request *before*
    // handing it over, rather than adding a relay/preview switch to a function
    // that would then need a flag to keep its existing callers correct.
    let mut req = req;
    req.headers_mut().remove(header::COOKIE);

    super::proxy_websocket(req, ws_url, &allowed_origins, &trusted_proxies, &inject_headers).await
}

/// Single entry point for all three `/__srv` route shapes
/// (`/:id`, `/:id/`, `/:id/*rest`).
///
/// axum dispatches on a route pattern, but the same relay has to serve the
/// server root and every path below it, and only one of those can extract the
/// id positionally. Parsing the path here keeps one implementation for all
/// three and mirrors how [`crate::proxy::proxy_handler_wildcard`] already
/// handles its own wildcard.
///
/// The WebSocket/HTTP split is a header check, so one handler covers both.
pub async fn relay_dispatch_handler(
    State(settings): State<SettingsState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(sessions): State<Arc<SessionStore>>,
    State(auth_token): State<Arc<tokio::sync::RwLock<String>>>,
    req: Request,
) -> Response {
    let Some((id, _rest)) = parse_relay_path(req.uri().path()) else {
        return (StatusCode::BAD_REQUEST, "malformed relay path").into_response();
    };
    let is_websocket = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));

    let path = Path(id.to_string());
    if is_websocket {
        relay_ws_handler(
            path,
            State(settings),
            ConnectInfo(addr),
            State(sessions),
            State(auth_token),
            req,
        )
        .await
    } else {
        relay_http_handler(
            path,
            State(settings),
            ConnectInfo(addr),
            State(sessions),
            State(auth_token),
            req,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;
    use axum::extract::FromRef;
    use axum::routing::any;
    use axum::Router;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tower::ServiceExt;

    #[test]
    fn parses_id_and_remainder() {
        assert_eq!(parse_relay_path("/__srv/abc"), Some(("abc", "")));
        assert_eq!(parse_relay_path("/__srv/abc/"), Some(("abc", "")));
        assert_eq!(parse_relay_path("/__srv/abc/api/info"), Some(("abc", "api/info")));
        assert_eq!(parse_relay_path("/__srv/abc/ws/sync"), Some(("abc", "ws/sync")));
    }

    #[test]
    fn rejects_paths_outside_the_prefix_or_without_an_id() {
        assert_eq!(parse_relay_path("/__srv"), None);
        assert_eq!(parse_relay_path("/__srv/"), None);
        assert_eq!(parse_relay_path("/preview/8999/api/info"), None);
        assert_eq!(parse_relay_path("/api/settings"), None);
        // A sibling that merely shares the prefix must not be relayed.
        assert_eq!(parse_relay_path("/__srvx/abc"), None);
    }

    // ── the gate ────────────────────────────────────────────────────────────

    const HUB_TOKEN: &str = "hub-token";

    fn roster() -> Vec<RemoteServer> {
        vec![RemoteServer {
            id: "abc".into(),
            name: "A".into(),
            url: "http://192.0.2.10:58901".into(),
            token: Some(SensitiveString::new("upstream-token".into())),
            ..RemoteServer::default()
        }]
    }

    fn request(method: &str, path: &str) -> Request {
        Request::builder().method(method).uri(path).body(Body::empty()).unwrap()
    }

    fn loopback() -> IpAddr {
        "127.0.0.1".parse().unwrap()
    }

    /// Run the gate as the handlers do, with a fixed roster and token.
    fn gate(req: &Request, ip: IpAddr, rest: &str) -> Result<RemoteServer, Box<Response>> {
        let sessions = SessionStore::new(1);
        authorized_target(req, ip, &sessions, HUB_TOKEN, &roster(), "abc", rest)
    }

    #[test]
    fn a_loopback_read_only_request_is_allowed() {
        let target = gate(&request("GET", "/__srv/abc/api/info"), loopback(), "api/info");
        assert_eq!(target.unwrap().url, "http://192.0.2.10:58901");
    }

    #[test]
    fn an_id_outside_the_roster_is_a_404() {
        let sessions = SessionStore::new(1);
        let resp = authorized_target(
            &request("GET", "/__srv/nope/api/info"),
            loopback(),
            &sessions,
            HUB_TOKEN,
            &roster(),
            "nope",
            "api/info",
        )
        .unwrap_err();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    /// The roster must not be enumerable by a caller that has not
    /// authenticated: a known and an unknown id have to be indistinguishable,
    /// so the auth failure must land before the lookup.
    #[test]
    fn an_unauthenticated_remote_caller_cannot_probe_the_roster() {
        let remote: IpAddr = "192.0.2.7".parse().unwrap();
        let sessions = SessionStore::new(1);
        let mut statuses = Vec::new();
        for id in ["abc", "nope"] {
            let req = request("GET", &format!("/__srv/{id}/api/info"));
            let resp =
                authorized_target(&req, remote, &sessions, HUB_TOKEN, &roster(), id, "api/info")
                    .unwrap_err();
            statuses.push(resp.status());
        }
        assert_eq!(statuses, vec![StatusCode::UNAUTHORIZED, StatusCode::UNAUTHORIZED]);
    }

    #[test]
    fn a_valid_bearer_token_authenticates_a_remote_caller() {
        let remote: IpAddr = "192.0.2.7".parse().unwrap();
        let req = Request::builder()
            .method("GET")
            .uri("/__srv/abc/api/info")
            .header(header::AUTHORIZATION, format!("Bearer {HUB_TOKEN}"))
            .body(Body::empty())
            .unwrap();
        assert!(gate(&req, remote, "api/info").is_ok());
    }

    #[test]
    fn a_wrong_bearer_token_does_not_authenticate_a_remote_caller() {
        let remote: IpAddr = "192.0.2.7".parse().unwrap();
        let req = Request::builder()
            .method("GET")
            .uri("/__srv/abc/api/info")
            .header(header::AUTHORIZATION, "Bearer not-the-hub-token")
            .body(Body::empty())
            .unwrap();
        assert_eq!(gate(&req, remote, "api/info").unwrap_err().status(), StatusCode::UNAUTHORIZED);
    }

    /// A page the user merely has open must not be able to drive the relay,
    /// loopback or not - the request is scriptable and the response readable.
    #[test]
    fn a_cross_site_browser_request_is_rejected() {
        let req = Request::builder()
            .method("GET")
            .uri("/__srv/abc/api/info")
            .header(header::ORIGIN, "https://evil.example")
            .header("sec-fetch-site", "cross-site")
            .body(Body::empty())
            .unwrap();
        assert_eq!(gate(&req, loopback(), "api/info").unwrap_err().status(), StatusCode::FORBIDDEN);
    }

    /// The Tauri webview and localhost dev servers are cross-origin to the
    /// embedded server by design, and `is_cross_site_browser_request` exempts
    /// them by origin. If that exemption ever went away the desktop app would
    /// lose the relay entirely, so pin it here.
    #[test]
    fn local_origins_are_not_cross_site() {
        for origin in ["tauri://localhost", "http://tauri.localhost", "http://localhost:5173"] {
            let req = Request::builder()
                .method("GET")
                .uri("/__srv/abc/api/info")
                .header(header::ORIGIN, origin)
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap();
            assert!(gate(&req, loopback(), "api/info").is_ok(), "{origin} must be exempt");
        }
    }

    #[test]
    fn a_mutating_request_needs_the_csrf_header() {
        let bare = request("POST", "/__srv/abc/api/tabs");
        assert_eq!(
            gate(&bare, loopback(), "api/tabs").unwrap_err().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            gate(&request("DELETE", "/__srv/abc/api/tabs/1"), loopback(), "api/tabs/1")
                .unwrap_err()
                .status(),
            StatusCode::FORBIDDEN
        );

        let signed = Request::builder()
            .method("POST")
            .uri("/__srv/abc/api/tabs")
            .header(RELAY_CSRF_HEADER, "1")
            .body(Body::empty())
            .unwrap();
        assert!(gate(&signed, loopback(), "api/tabs").is_ok(), "a signed write must proceed");
    }

    #[test]
    fn read_only_methods_need_no_csrf_header() {
        for method in ["GET", "HEAD", "OPTIONS"] {
            assert!(!needs_csrf_header(&Method::from_bytes(method.as_bytes()).unwrap()));
        }
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            assert!(needs_csrf_header(&Method::from_bytes(method.as_bytes()).unwrap()));
        }
    }

    #[test]
    fn an_empty_csrf_header_does_not_count() {
        let req = Request::builder()
            .method("POST")
            .uri("/__srv/abc/api/tabs")
            .header(RELAY_CSRF_HEADER, "")
            .body(Body::empty())
            .unwrap();
        assert_eq!(gate(&req, loopback(), "api/tabs").unwrap_err().status(), StatusCode::FORBIDDEN);
    }

    /// Relaying a login would set the upstream's cookie on the upstream's
    /// origin while the page stays on the hub's: it looks like it worked and
    /// leaves the user unauthenticated.
    #[test]
    fn hub_only_paths_are_never_relayed() {
        for rest in [
            "api/auth",
            "api/auth/",
            "api/auth/request-code",
            "api/auth/sessions",
            "api/token",
            "api/token/",
            "api/token/abc",
            "api/tokens",
            "api/tokens/abc",
            "api/auto-token",
            "api/token-configured",
        ] {
            let resp = gate(&request("GET", "/__srv/abc/x"), loopback(), rest).unwrap_err();
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{rest} must not be relayed");
        }
        // …and the check must not swallow unrelated paths that share a prefix.
        for rest in ["api/info", "api/authentication", "api/tokenizer"] {
            assert!(!is_hub_only_path(rest), "{rest} is a normal relayed path");
        }
    }

    /// `Url::parse` collapses dot segments when it builds the upstream URL, so
    /// judging the *raw* remainder let a caller spell its way around the
    /// hub-only list and read the upstream's stored credential back out of
    /// `/api/token`.
    #[test]
    fn a_dot_segment_cannot_smuggle_a_hub_only_path() {
        for rest in [
            "api/plugins/../../../api/token",
            "api/plugins/../../../api/tokens",
            "api/plugins/../../../api/auth",
            "api/plugins/%2e%2e/%2e%2e/%2e%2e/api/token",
            "api/../../api/token",
            "./api/token",
        ] {
            let resp = gate(&request("GET", "/__srv/abc/x"), loopback(), rest).unwrap_err();
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "{rest} must not be relayed");
        }
    }

    /// The gate resolves exactly as the request builder does, so a path that
    /// normalizes back to something harmless stays relayable.
    #[test]
    fn resolving_does_not_reject_ordinary_paths() {
        assert_eq!(normalized_relay_path("api/info").unwrap(), "api/info");
        assert_eq!(normalized_relay_path("api/plugins/x/y").unwrap(), "api/plugins/x/y");
        assert_eq!(normalized_relay_path("api/plugins/../info").unwrap(), "api/info");
        assert_eq!(
            normalized_relay_path("api/plugins/%2e%2e/info").unwrap(),
            "api/info",
            "the encoded spelling of `..` is a `..` to the parser"
        );
    }

    // ── header handling ─────────────────────────────────────────────────────

    #[test]
    fn credentials_are_replaced_and_hop_by_hop_headers_dropped() {
        assert!(
            !should_forward_header("authorization"),
            "the caller's token is not the upstream's"
        );
        assert!(!should_forward_header("content-length"), "the body is streamed, not measured");
        assert!(!should_forward_header(RELAY_CSRF_HEADER), "hub-internal signalling");
        // The hub's session cookie is scoped to the hub's origin. The upstream
        // is a different machine, so carrying it there would hand a credential
        // to a host that has no business seeing it - and the relay authenticates
        // with the roster token, so the upstream has no use for it anyway.
        assert!(!should_forward_header("cookie"), "the hub's session cookie must not leak");
        for h in [
            "host",
            "connection",
            "keep-alive",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "proxy-authenticate",
            "proxy-authorization",
            "origin",
            "sec-fetch-site",
        ] {
            assert!(!should_forward_header(h), "{h} must not reach the upstream");
        }
    }

    /// The strip has to stay surgical: the relay is otherwise transparent, and
    /// an upstream that stopped receiving these would break in ways that look
    /// unrelated to credential handling.
    #[test]
    fn ordinary_request_headers_still_reach_the_upstream() {
        for h in ["content-type", "accept", "user-agent", "x-requested-with"] {
            assert!(should_forward_header(h), "{h} must be forwarded");
        }
    }

    #[test]
    fn the_upstream_origin_is_rebuilt_rather_than_trusted() {
        assert_eq!(
            upstream_origin("http://192.168.1.5:8999"),
            Some("http://192.168.1.5:8999".into())
        );
        // A stray path or trailing slash must not leak into the target.
        assert_eq!(upstream_origin("http://h:1/"), Some("http://h:1".into()));
        assert_eq!(upstream_origin("  http://h:1/base/  "), Some("http://h:1".into()));
        // Credentials in the url are dropped, not carried.
        assert_eq!(upstream_origin("http://user:pass@h:1"), Some("http://h:1".into()));
        for bad in ["ws://h:1", "file:///etc/passwd", "h:1", ""] {
            assert_eq!(upstream_origin(bad), None, "{bad} is not a usable origin");
        }
    }

    #[test]
    fn websocket_urls_mirror_the_upstream_scheme() {
        assert_eq!(
            upstream_ws_url("http://h:8999", "ws/sync", None),
            Some("ws://h:8999/ws/sync".into())
        );
        assert_eq!(
            upstream_ws_url("https://h", "ws/sync", Some("a=1")),
            Some("wss://h/ws/sync?a=1".into())
        );
    }

    // ── through the router ──────────────────────────────────────────────────

    /// A stand-in for the hosts' `AppState`: the dispatcher only needs these
    /// three pieces, and building a whole `AppState` in a unit test would tie
    /// this file to every subsystem it carries.
    #[derive(Clone)]
    struct TestState {
        settings: SettingsState,
        sessions: Arc<SessionStore>,
        token: Arc<tokio::sync::RwLock<String>>,
    }

    impl FromRef<TestState> for SettingsState {
        fn from_ref(state: &TestState) -> Self {
            state.settings.clone()
        }
    }

    impl FromRef<TestState> for Arc<SessionStore> {
        fn from_ref(state: &TestState) -> Self {
            state.sessions.clone()
        }
    }

    impl FromRef<TestState> for Arc<tokio::sync::RwLock<String>> {
        fn from_ref(state: &TestState) -> Self {
            state.token.clone()
        }
    }

    fn app(servers: Vec<RemoteServer>) -> Router {
        let settings = Settings { remote_servers: servers, ..Settings::default() };
        let state = TestState {
            settings: Arc::new(tokio::sync::RwLock::new(settings)),
            sessions: Arc::new(SessionStore::new(1)),
            token: Arc::new(tokio::sync::RwLock::new(HUB_TOKEN.to_string())),
        };
        Router::new()
            .route("/__srv/:id", any(relay_dispatch_handler))
            .route("/__srv/:id/", any(relay_dispatch_handler))
            .route("/__srv/:id/*rest", any(relay_dispatch_handler))
            .with_state(state)
    }

    /// `ConnectInfo` is normally inserted by `into_make_service_with_connect_info`;
    /// without it the extractor rejects and every test would see a 500.
    fn from_loopback(method: &str, path: &str) -> Request {
        let mut req = request(method, path);
        req.extensions_mut().insert(ConnectInfo("127.0.0.1:5000".parse::<SocketAddr>().unwrap()));
        req
    }

    async fn status_of(app: &Router, req: Request) -> StatusCode {
        app.clone().oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    async fn every_relay_route_shape_reaches_the_gate() {
        for path in ["/__srv/abc", "/__srv/abc/", "/__srv/abc/api/info", "/__srv/abc/ws/sync"] {
            // The roster is empty, so an id can only fail the lookup - which
            // is exactly the proof that the request was dispatched, parsed
            // and gated rather than 404ed by axum's router.
            assert_eq!(
                status_of(&app(Vec::new()), from_loopback("GET", path)).await,
                StatusCode::NOT_FOUND,
                "{path} did not reach the relay dispatcher"
            );
        }
    }

    #[tokio::test]
    async fn the_websocket_branch_runs_the_same_gate() {
        // The gate must reject before the upgrade is handed to
        // `proxy_websocket`, whose origin check is currently a stub.
        let cross_site = Request::builder()
            .method("GET")
            .uri("/__srv/abc/ws/sync")
            .header(header::UPGRADE, "websocket")
            .header("connection", "Upgrade")
            .header(header::ORIGIN, "https://evil.example")
            .header("sec-fetch-site", "cross-site")
            .body(Body::empty())
            .unwrap();
        let mut cross_site = cross_site;
        cross_site
            .extensions_mut()
            .insert(ConnectInfo("127.0.0.1:5000".parse::<SocketAddr>().unwrap()));
        assert_eq!(status_of(&app(roster()), cross_site).await, StatusCode::FORBIDDEN);

        let unknown = from_loopback("GET", "/__srv/nope/ws/sync");
        let mut unknown = unknown;
        unknown.headers_mut().insert(header::UPGRADE, "websocket".parse().unwrap());
        assert_eq!(status_of(&app(roster()), unknown).await, StatusCode::NOT_FOUND);
    }

    /// The end-to-end case: `rest` becomes the upstream's path, the body
    /// round-trips, and the upstream sees the roster's credential - not the
    /// one the caller sent.
    #[tokio::test]
    async fn relays_to_the_roster_url_with_the_roster_token() {
        // Reports what actually arrived, so the assertions below are on the
        // upstream's view of the request rather than on the relay's intent.
        async fn echo(uri: axum::http::Uri, headers: HeaderMap) -> String {
            let auth = headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("<none>");
            let csrf = headers.contains_key(RELAY_CSRF_HEADER);
            let cookie =
                headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("<none>");
            format!("{}|{auth}|csrf={csrf}|cookie={cookie}", uri)
        }

        // An ephemeral port, so this never collides with the user's running
        // server (8999) or with a sibling test agent.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let upstream = Router::new().route("/*rest", any(echo));
        tokio::spawn(async move {
            let _ = axum::serve(listener, upstream).await;
        });

        let servers = vec![RemoteServer {
            id: "abc".into(),
            name: "A".into(),
            url: format!("http://{addr}"),
            token: Some(SensitiveString::new("upstream-token".into())),
            ..RemoteServer::default()
        }];

        let req = Request::builder()
            .method("GET")
            .uri("/__srv/abc/api/echo?x=1")
            .header(header::AUTHORIZATION, "Bearer hub-session-token")
            // The hub's own session cookie, which the upstream must never see.
            .header(header::COOKIE, "dinotty_sid=hub-session-secret")
            .body(Body::empty())
            .unwrap();
        let mut req = req;
        req.extensions_mut().insert(ConnectInfo("127.0.0.1:5000".parse::<SocketAddr>().unwrap()));

        let resp = app(servers.clone()).oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            String::from_utf8_lossy(&body),
            "/api/echo?x=1|Bearer upstream-token|csrf=false|cookie=<none>",
            "the upstream must see the roster credential and the relayed path, but not the cookie"
        );

        // An unauthenticated upstream gets no Authorization header at all.
        let anonymous = vec![RemoteServer { token: None, ..servers[0].clone() }];
        let req = from_loopback("GET", "/__srv/abc/api/echo");
        let resp = app(anonymous).oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(String::from_utf8_lossy(&body), "/api/echo|<none>|csrf=false|cookie=<none>");
    }

    /// The WebSocket branch strips the cookie itself, before handing the
    /// request to `proxy_websocket` - that function forwards `cookie` on
    /// purpose for `/preview/`, so it cannot be the one to decide.
    ///
    /// Driven over a real socket rather than through `oneshot`: `proxy_websocket`
    /// only reaches its header handling from inside `on_upgrade`, and a bare
    /// `oneshot` never performs the upgrade, so it would pass whether the cookie
    /// was stripped or not. The upstream is a real handshake for the same
    /// reason - this asserts on what the upstream *received*.
    // `accept_hdr_async`'s callback returns the whole handshake `Response` in
    // its `Err` arm, which is far wider than this test has any use for.
    #[allow(clippy::result_large_err)]
    #[tokio::test]
    async fn the_websocket_branch_does_not_forward_the_hub_cookie() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let recorded = Arc::clone(&seen);

        let upstream_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream_listener.local_addr().unwrap();
        tokio::spawn(async move {
            let Ok((stream, _)) = upstream_listener.accept().await else { return };
            let accepted = tokio_tungstenite::accept_hdr_async(stream, {
                let recorded = Arc::clone(&recorded);
                move |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    let cookie = req
                        .headers()
                        .get(header::COOKIE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("<none>")
                        .to_string();
                    recorded.lock().unwrap().push(cookie);
                    Ok(resp)
                }
            })
            .await;
            if let Ok(mut ws) = accepted {
                // Hold the upgrade open briefly; the assertion is on the handshake.
                let _ = ws.close(None).await;
            }
        });

        // The relay itself, on a real listener so the upgrade can complete.
        let relay_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let relay_addr = relay_listener.local_addr().unwrap();
        let servers = vec![RemoteServer {
            id: "abc".into(),
            name: "A".into(),
            url: format!("http://{upstream_addr}"),
            token: Some(SensitiveString::new("upstream-token".into())),
            ..RemoteServer::default()
        }];
        tokio::spawn(async move {
            let _ = axum::serve(
                relay_listener,
                app(servers).into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });

        let mut req = format!("ws://{relay_addr}/__srv/abc/ws/sync").into_client_request().unwrap();
        req.headers_mut().insert(header::COOKIE, "dinotty_sid=hub-session-secret".parse().unwrap());

        // The handshake completing at all proves the relay connected upstream;
        // if the upstream refused, this errors or times out.
        let handshake = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            tokio_tungstenite::connect_async(req),
        )
        .await;

        for _ in 0..100 {
            if !seen.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let cookies = seen.lock().unwrap().clone();
        assert_eq!(
            cookies,
            vec!["<none>".to_string()],
            "the hub cookie reached the upstream (handshake: {handshake:?})"
        );
    }
}

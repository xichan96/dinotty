use super::*;

// ── constant_time_eq ────────────────────────────────────────────

#[test]
fn constant_time_eq_equal_strings() {
    assert!(constant_time_eq("hello", "hello"));
}

#[test]
fn constant_time_eq_different_strings() {
    assert!(!constant_time_eq("hello", "world"));
}

#[test]
fn constant_time_eq_different_lengths() {
    assert!(!constant_time_eq("short", "longer string"));
}

#[test]
fn constant_time_eq_empty_strings() {
    assert!(constant_time_eq("", ""));
}

#[test]
fn constant_time_eq_single_char_diff() {
    assert!(!constant_time_eq("abc", "abd"));
}

// ── session cookie port scoping ────────────────────────────────

#[test]
fn session_cookie_names_are_port_scoped() {
    let port_8998 = session_cookie_name(8998);
    let port_8999 = session_cookie_name(8999);

    assert_eq!(port_8998, "dinotty_session_8998");
    assert_ne!(port_8998, port_8999);
    assert_ne!("dinotty_session", port_8998);
    assert_ne!("dinotty_session", port_8999);
}

#[test]
fn session_cookie_port_conflict_check_allows_same_port_only() {
    assert!(!check_port_conflict(8998, 8998));
    assert!(check_port_conflict(8998, 8999));
}

#[test]
fn setting_same_session_cookie_port_twice_is_idempotent() {
    set_session_cookie_port(8998);
    set_session_cookie_port(8998);

    assert_eq!(configured_session_cookie_port(), 8998);
}

#[test]
fn extract_session_cookie_rejects_legacy_and_wrong_port_names() {
    let req = Request::builder()
        .header(
            header::COOKIE,
            "dinotty_session=legacy-session; dinotty_session_8999=wrong-port-session",
        )
        .body(Body::empty())
        .unwrap();

    assert_eq!(extract_session_cookie(&req, 8998), None);
}

#[test]
fn extract_session_cookie_honors_only_the_correct_port_name() {
    let req = Request::builder()
        .header(
            header::COOKIE,
            "dinotty_session=legacy-session; dinotty_session_8999=wrong-port-session; \
             dinotty_session_8998=correct-session",
        )
        .body(Body::empty())
        .unwrap();

    assert_eq!(extract_session_cookie(&req, 8998).as_deref(), Some("correct-session"));
}

// ── matches_wildcard ────────────────────────────────────────────

#[test]
fn wildcard_exact_match() {
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(matches_wildcard(ip, "192.168.1.100"));
}

#[test]
fn wildcard_star_matches_any_octet() {
    let ip: IpAddr = "192.168.1.42".parse().unwrap();
    assert!(matches_wildcard(ip, "192.168.*.*"));
}

#[test]
fn wildcard_star_last_octet() {
    let ip: IpAddr = "10.0.0.255".parse().unwrap();
    assert!(matches_wildcard(ip, "10.0.0.*"));
}

#[test]
fn wildcard_mismatch() {
    let ip: IpAddr = "192.168.2.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.1.*"));
}

#[test]
fn wildcard_ipv6_returns_false() {
    let ip: IpAddr = "::1".parse().unwrap();
    assert!(!matches_wildcard(ip, "*.*.*.*"));
}

#[test]
fn wildcard_invalid_pattern() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.*")); // only 3 parts
}

#[test]
fn wildcard_non_numeric_non_star() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_wildcard(ip, "192.168.1.abc"));
}

// ── matches_cidr ────────────────────────────────────────────────

#[test]
fn cidr_matches_in_range() {
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(matches_cidr(ip, "192.168.1.0/24"));
}

#[test]
fn cidr_rejects_out_of_range() {
    let ip: IpAddr = "192.168.2.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0/24"));
}

#[test]
fn cidr_prefix_32_exact() {
    let ip: IpAddr = "10.0.0.1".parse().unwrap();
    assert!(matches_cidr(ip, "10.0.0.1/32"));
    assert!(!matches_cidr("10.0.0.2".parse().unwrap(), "10.0.0.1/32"));
}

#[test]
fn cidr_prefix_0_matches_all() {
    let ip: IpAddr = "255.255.255.255".parse().unwrap();
    assert!(matches_cidr(ip, "0.0.0.0/0"));
}

#[test]
fn cidr_ipv6() {
    let ip: IpAddr = "fe80::1".parse().unwrap();
    assert!(matches_cidr(ip, "fe80::/10"));
}

#[test]
fn cidr_ipv6_out_of_range() {
    let ip: IpAddr = "2001:db8::1".parse().unwrap();
    assert!(!matches_cidr(ip, "fe80::/10"));
}

#[test]
fn cidr_invalid_prefix_len() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0/33")); // > 32
}

#[test]
fn cidr_mixed_v4_v6() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "::1/128")); // mismatched families
}

#[test]
fn cidr_no_slash() {
    let ip: IpAddr = "192.168.1.1".parse().unwrap();
    assert!(!matches_cidr(ip, "192.168.1.0"));
}

// ── is_ip_whitelisted ───────────────────────────────────────────

#[test]
fn whitelist_exact_match() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_cidr_match() {
    let ip: IpAddr = "192.168.1.50".parse().unwrap();
    let whitelist = vec!["192.168.1.0/24".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_wildcard_match() {
    let ip: IpAddr = "10.0.0.99".parse().unwrap();
    let whitelist = vec!["10.0.0.*".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_no_match() {
    let ip: IpAddr = "172.16.0.1".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into(), "::1".into()];
    assert!(!is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_empty_list() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    assert!(!is_ip_whitelisted(ip, &[]));
}

#[test]
fn whitelist_multiple_entries() {
    let ip: IpAddr = "192.168.1.5".parse().unwrap();
    let whitelist = vec!["127.0.0.1".into(), "::1".into(), "192.168.0.0/16".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

#[test]
fn whitelist_whitespace_trimmed() {
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    let whitelist = vec!["  127.0.0.1  ".into()];
    assert!(is_ip_whitelisted(ip, &whitelist));
}

// ── check_token ─────────────────────────────────────────────────

#[test]
fn check_token_bearer_header() {
    let req = Request::builder()
        .header(header::AUTHORIZATION, "Bearer my-secret-token")
        .body(Body::empty())
        .unwrap();
    assert!(check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_bearer_wrong_token() {
    let req = Request::builder()
        .header(header::AUTHORIZATION, "Bearer wrong-token")
        .body(Body::empty())
        .unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_no_auth_returns_false() {
    let req = Request::builder().uri("/api/something").body(Body::empty()).unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

#[test]
fn check_token_query_param_ignored() {
    // ?token= is no longer accepted; only Bearer header works.
    let req =
        Request::builder().uri("/api/something?token=my-secret-token").body(Body::empty()).unwrap();
    assert!(!check_token(&req, "my-secret-token"));
}

// ── check_ws_origin ────────────────────────────────────────────
// 暂时全部 ignore：check_ws_origin 已关闭，函数恒返回 true。
// 修复反代场景下的 Origin/Host 比对问题后恢复。

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_loopback_always_allowed() {
    let headers = HeaderMap::new();
    let loopback: IpAddr = "127.0.0.1".parse().unwrap();
    assert!(check_ws_origin(&headers, &[], loopback, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_no_origin_header_allowed() {
    let headers = HeaderMap::new();
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(check_ws_origin(&headers, &[], ip, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_same_origin_matches() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com".parse().unwrap());
    headers.insert(header::HOST, "nas.example.com".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(check_ws_origin(&headers, &[], ip, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_mismatch_behind_proxy_fails_without_trusted() {
    // Proxy rewrites Host to internal address; Origin stays external.
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(!check_ws_origin(&headers, &[], ip, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_x_forwarded_host_with_trusted_proxy() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    headers.insert("x-forwarded-host", "nas.example.com".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    let trusted = vec!["192.168.1.0/24".to_string()];
    assert!(check_ws_origin(&headers, &[], ip, &trusted));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_x_forwarded_host_not_used_for_untrusted() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    headers.insert("x-forwarded-host", "nas.example.com".parse().unwrap());
    let ip: IpAddr = "10.0.0.1".parse().unwrap();
    let trusted = vec!["192.168.1.0/24".to_string()];
    assert!(!check_ws_origin(&headers, &[], ip, &trusted));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_hostname_only_fallback() {
    // Proxy strips port from Host header.
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com:8443".parse().unwrap());
    headers.insert(header::HOST, "nas.example.com".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    assert!(check_ws_origin(&headers, &[], ip, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_allowed_origins_fallback() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://custom.domain.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    let allowed = vec!["https://custom.domain.com".to_string()];
    assert!(check_ws_origin(&headers, &allowed, ip, &[]));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_x_forwarded_host_with_port() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com:8443".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    headers.insert("x-forwarded-host", "nas.example.com:8443".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    let trusted = vec!["192.168.1.0/24".to_string()];
    assert!(check_ws_origin(&headers, &[], ip, &trusted));
}

#[test]
#[ignore = "check_ws_origin disabled - see auth/mod.rs"]
fn ws_origin_x_forwarded_host_comma_separated() {
    let mut headers = HeaderMap::new();
    headers.insert(header::ORIGIN, "https://nas.example.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.100:8999".parse().unwrap());
    headers.insert("x-forwarded-host", "nas.example.com, proxy.internal".parse().unwrap());
    let ip: IpAddr = "192.168.1.100".parse().unwrap();
    let trusted = vec!["192.168.1.0/24".to_string()];
    assert!(check_ws_origin(&headers, &[], ip, &trusted));
}

#[test]
fn cross_site_browser_request_detection() {
    let mk = |pairs: &[(&str, &str)]| {
        use axum::http::{HeaderName, HeaderValue};
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    };

    // Non-browser clients: no Origin, no Sec-Fetch-Site.
    assert!(!is_cross_site_browser_request(&mk(&[])));
    assert!(!is_cross_site_browser_request(&mk(&[("user-agent", "curl/8.7.1")])));

    // Same-origin browser fetch: Origin authority matches Host.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "http://127.0.0.1:58999"),
        ("host", "127.0.0.1:58999"),
    ])));

    // Cross-site fetch from evil.com via the local browser.
    assert!(is_cross_site_browser_request(&mk(&[
        ("origin", "http://evil.com"),
        ("host", "127.0.0.1:58999"),
    ])));
    // Origin "null" (sandboxed iframe) is treated as cross-site.
    assert!(is_cross_site_browser_request(&mk(
        &[("origin", "null"), ("host", "127.0.0.1:58999"),]
    )));

    // No-cors subresource loads (`<img>`, `<script>`, `<link>`) send
    // Sec-Fetch-Site but no Origin; their response body is unreadable by the
    // initiating page, so they must pass. This is exactly how the Tauri
    // webview loads preview images from the embedded server.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("sec-fetch-site", "cross-site"),
        ("host", "127.0.0.1:58999"),
    ])));
    // Address-bar navigation sends sec-fetch-site: none and no Origin.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("sec-fetch-site", "none"),
        ("host", "127.0.0.1:58999"),
    ])));

    // Tauri webview origins talk to the embedded server cross-origin by design.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "tauri://localhost"),
        ("host", "127.0.0.1:48999"),
    ])));
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "http://tauri.localhost"),
        ("host", "127.0.0.1:48999"),
    ])));
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "http://localhost:5173"),
        ("host", "127.0.0.1:48999"),
    ])));

    // The desktop-app regression: WKWebView sends BOTH `Origin:
    // tauri://localhost` and `Sec-Fetch-Site: cross-site` on its cross-origin
    // calls to the embedded server. The local-origin exemption must win over
    // the fetch-metadata label.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "tauri://localhost"),
        ("sec-fetch-site", "cross-site"),
        ("host", "127.0.0.1:48999"),
    ])));
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "http://localhost:5173"),
        ("sec-fetch-site", "cross-site"),
        ("host", "127.0.0.1:8999"),
    ])));

    // A same-origin call through a Host-rewriting reverse proxy: the browser
    // honestly labels it `same-origin`, which must override the Origin/Host
    // mismatch dinotty sees.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("origin", "https://nas.example.com"),
        ("sec-fetch-site", "same-origin"),
        ("host", "192.168.1.100:8999"),
    ])));

    // Remote sites stay blocked with either signal.
    assert!(is_cross_site_browser_request(&mk(&[
        ("origin", "http://evil.com"),
        ("sec-fetch-site", "cross-site"),
        ("host", "127.0.0.1:58999"),
    ])));

    // The desktop-app `<img>` regression: WKWebView loads subresources from
    // the embedded server with `Sec-Fetch-Site: cross-site` and NO Origin
    // header. These are no-cors loads and must not be rejected.
    assert!(!is_cross_site_browser_request(&mk(&[
        ("sec-fetch-site", "cross-site"),
        ("accept", "image/avif,image/webp,image/png,image/svg+xml,*/*"),
        ("host", "127.0.0.1:8999"),
    ])));
}

// ── relay path early return ─────────────────────────────────────

/// The hub relay owns its own gate (roster membership, the `X-Dinotty-Relay`
/// CSRF header, upstream token injection), so `auth_middleware` must pass
/// `/__srv/*` through untouched. If this early return is ever dropped, every
/// relayed request from a non-whitelisted peer becomes a 403 *before* the
/// relay can apply its stricter-but-different rules, and browser mode breaks
/// outright because the session cookie belongs to the hub, not the upstream.
///
/// The `/preview/` precedent has the same shape, so both are asserted here.
#[tokio::test]
async fn relay_and_preview_paths_bypass_the_global_auth_gate() {
    use axum::{body::Body, middleware, routing::any, Router};
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn assert_reaches_inner(path: &str) {
        let settings: crate::settings::SettingsState =
            Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
        let sessions = SessionStore::new(30);
        // A non-empty token is what arms the gate; an empty one makes the whole
        // middleware a no-op and would make this test pass vacuously.
        let token = "configured-token";
        let settings_for_layer = settings.clone();
        let app = Router::new()
            .route("/__srv/:id/*rest", any(|| async { "reached the relay" }))
            .route("/preview/:port/*path", any(|| async { "reached the proxy" }))
            .layer(middleware::from_fn(move |req, next| {
                let settings = settings_for_layer.clone();
                let sessions = sessions.clone();
                async move {
                    auth_middleware(
                        req,
                        next,
                        token,
                        &settings,
                        &sessions,
                        "203.0.113.9".parse().unwrap(),
                        8999,
                    )
                    .await
                }
            }));

        let resp = app
            .oneshot(axum::http::Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "{path} was stopped by the global auth gate instead of reaching its handler"
        );
    }

    assert_reaches_inner("/__srv/abc/api/info").await;
    assert_reaches_inner("/__srv/abc/ws/sync").await;
    assert_reaches_inner("/preview/8999/api/info").await;
}

/// Guard the guard: an unrelated `/api/` path from the same non-whitelisted
/// peer must still be rejected, so the test above cannot pass because the
/// middleware turned into a no-op.
#[tokio::test]
async fn a_plain_api_path_is_still_gated_from_a_non_whitelisted_peer() {
    use axum::{body::Body, middleware, routing::any, Router};
    use std::sync::Arc;
    use tower::ServiceExt;

    let settings: crate::settings::SettingsState =
        Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default()));
    let sessions = SessionStore::new(30);
    let settings_for_layer = settings.clone();
    let app = Router::new().route("/api/settings", any(|| async { "reached settings" })).layer(
        middleware::from_fn(move |req, next| {
            let settings = settings_for_layer.clone();
            let sessions = sessions.clone();
            async move {
                auth_middleware(
                    req,
                    next,
                    "configured-token",
                    &settings,
                    &sessions,
                    "203.0.113.9".parse().unwrap(),
                    8999,
                )
                .await
            }
        }),
    );

    let resp = app
        .oneshot(axum::http::Request::builder().uri("/api/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    // 401 (`UNAUTHORIZED`, no session and no Bearer), not 403 - 403 is the
    // separate cross-site-from-a-whitelisted-peer branch.
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

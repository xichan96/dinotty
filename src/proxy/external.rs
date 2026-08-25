#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::Query,
    http::{header, StatusCode},
    response::Response,
};
use serde::Deserialize;
use std::net::IpAddr;

use super::extract_request;
use super::inject::INJECT_SCRIPT_EXTERNAL;
use super::response::build_proxied_response;
use super::rewrite::{rewrite_form_urlencoded_body, RewriteMode};

#[derive(Deserialize)]
pub struct ExternalProxyParams {
    pub url: String,
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 100 && v4.octets()[1] >= 64 && v4.octets()[1] <= 127
                || v4.octets() == [169, 254, 169, 254]
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped (::ffff:a.b.c.d) is routable to the IPv4 network on
            // major stacks - run it through the V4 checks, not the V6 ones.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

/// Validated upstream target: DNS was resolved once, every address passed the
/// private-IP check, and `domain` is set when the connection must be pinned to
/// `addrs` (DNS-rebinding defense: the HTTP client re-resolves otherwise, and
/// a re-resolve between check and connect can return a private address).
struct ResolvedTarget {
    domain: Option<String>,
    addrs: Vec<std::net::SocketAddr>,
}

fn forbidden(msg: &str) -> Response {
    Response::builder().status(StatusCode::FORBIDDEN).body(Body::from(msg.to_string())).unwrap()
}

async fn resolve_target(parsed: &reqwest::Url, msg: &str) -> Result<ResolvedTarget, Box<Response>> {
    let port = parsed.port_or_known_default().unwrap_or(80);
    let Some(host) = parsed.host_str() else {
        return Ok(ResolvedTarget { domain: None, addrs: vec![] });
    };
    // IPv6 literals keep their brackets in host_str(); strip before parsing.
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(Box::new(forbidden(msg)));
        }
        return Ok(ResolvedTarget {
            domain: None,
            addrs: vec![std::net::SocketAddr::new(ip, port)],
        });
    }
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| {
            Box::new(
                Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from("DNS resolution failed"))
                    .unwrap(),
            )
        })?
        .collect();
    tracing::debug!("external proxy: resolved {host} -> {addrs:?}");
    for addr in &addrs {
        if is_private_ip(addr.ip()) {
            return Err(Box::new(forbidden(msg)));
        }
    }
    Ok(ResolvedTarget { domain: Some(host.to_string()), addrs })
}

/// Per-hop client with DNS pinned to the validated addresses. Built per hop
/// because reqwest has no per-request resolver override; redirects are handled
/// manually so every hop is resolved + validated before connecting.
fn pinned_client(target: &ResolvedTarget) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent(super::PROXY_USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .gzip(true)
        .brotli(true);
    if let (Some(domain), addrs) = (&target.domain, target.addrs.as_slice()) {
        if !addrs.is_empty() {
            builder = builder.resolve_to_addrs(domain, addrs);
        }
    }
    builder.build().unwrap()
}

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
#[allow(clippy::too_many_lines)]
pub async fn external_proxy_handler(
    Query(params): Query<ExternalProxyParams>,
    req: axum::extract::Request,
) -> Response {
    let target_url = params.url;

    if target_url.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Missing url parameter"))
            .unwrap();
    }

    let Ok(parsed) = reqwest::Url::parse(&target_url) else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Invalid URL"))
            .unwrap();
    };

    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Only http/https URLs are supported"))
            .unwrap();
    }

    if let Err(r) =
        resolve_target(&parsed, "Access to private/internal addresses is not allowed").await
    {
        return *r;
    }

    let (method, headers, body_bytes) = match extract_request(req).await {
        Ok(v) => v,
        Err(r) => return *r,
    };

    let mut current_url = parsed;
    let mut current_method = reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap();
    let mut current_body = body_bytes;
    let mut upstream_resp = None;
    for _hop in 0..10 {
        // Resolve + validate BEFORE connecting; the pinned client then connects
        // to exactly these addresses, closing the DNS-rebinding TOCTOU window.
        let target = match resolve_target(
            &current_url,
            "Access to private/internal addresses is not allowed",
        )
        .await
        {
            Ok(t) => t,
            Err(r) => return *r,
        };

        let mut proxy_req =
            pinned_client(&target).request(current_method.clone(), current_url.clone());

        for (name, value) in &headers {
            let n = name.as_str();
            if n == "host"
                || n == "connection"
                || n == "upgrade"
                || n == "origin"
                || n == "referer"
                || n == "accept-encoding"
                || n == "content-length"
            {
                continue;
            }
            if let Ok(v) = value.to_str() {
                proxy_req = proxy_req.header(n, v);
            }
        }

        if !current_body.is_empty() {
            let content_type_val =
                headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
            if content_type_val.contains("application/x-www-form-urlencoded") {
                let mode = RewriteMode::External(current_url.to_string());
                if let Some(rewritten) =
                    rewrite_form_urlencoded_body(&current_body, current_url.as_str(), &mode)
                {
                    proxy_req = proxy_req.body(rewritten);
                } else {
                    proxy_req = proxy_req.body(current_body.clone());
                }
            } else {
                proxy_req = proxy_req.body(current_body.clone());
            }
        }

        let resp = match proxy_req.send().await {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("Proxy error: {e}");
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(Body::from(msg))
                    .unwrap();
            }
        };

        let status = resp.status();
        if status.is_redirection() {
            let Some(loc) = resp.headers().get(header::LOCATION).and_then(|v| v.to_str().ok())
            else {
                upstream_resp = Some(resp);
                break;
            };
            let Ok(next) = current_url.join(loc) else {
                upstream_resp = Some(resp);
                break;
            };
            if next.scheme() != "http" && next.scheme() != "https" {
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .body(Body::from("Only http/https redirects are supported"))
                    .unwrap();
            }
            // Browser-like redirect semantics: 303 always rewrites to GET;
            // 301/302 rewrite POST/PUT/DELETE to GET; 307/308 preserve.
            if status.as_u16() == 303
                || ((status.as_u16() == 301 || status.as_u16() == 302)
                    && current_method != reqwest::Method::GET
                    && current_method != reqwest::Method::HEAD)
            {
                current_method = reqwest::Method::GET;
                current_body = Vec::new().into();
            }
            current_url = next;
            continue;
        }
        upstream_resp = Some(resp);
        break;
    }

    let Some(upstream_resp) = upstream_resp else {
        return Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .body(Body::from("Too many redirects"))
            .unwrap();
    };

    let final_url_str = current_url.to_string();

    let inject_base = "";
    let escaped_url = final_url_str
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let inject_script = INJECT_SCRIPT_EXTERNAL.replacen(
        "<script>",
        &format!("<script data-base-url=\"{escaped_url}\">"),
        1,
    );
    build_proxied_response(
        upstream_resp,
        inject_base,
        &inject_script,
        Some(RewriteMode::External(final_url_str)),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::is_private_ip;

    #[test]
    fn ipv6_private_ranges_are_blocked() {
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(is_private_ip("fe80::1".parse().unwrap()));
        assert!(is_private_ip("fc00::1".parse().unwrap()));
        assert!(is_private_ip("fd12::1".parse().unwrap()));
    }

    #[test]
    fn ipv4_mapped_ipv6_hits_v4_checks() {
        assert!(is_private_ip("::ffff:127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("::ffff:169.254.169.254".parse().unwrap()));
        assert!(is_private_ip("::ffff:10.0.0.5".parse().unwrap()));
    }

    #[test]
    fn public_ips_are_allowed() {
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("2001:4860:4860::8888".parse().unwrap()));
    }
}

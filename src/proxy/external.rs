#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::Query,
    http::{header, StatusCode},
    response::Response,
};
use serde::Deserialize;
use std::net::IpAddr;

use super::inject::INJECT_SCRIPT_EXTERNAL;
use super::response::build_proxied_response;
use super::rewrite::{rewrite_form_urlencoded_body, RewriteMode};
use super::{extract_request, HTTP_CLIENT_FOLLOW_REDIRECTS};

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
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

async fn check_host_not_private(parsed: &reqwest::Url, msg: &str) -> Result<(), Box<Response>> {
    let Some(host) = parsed.host_str() else {
        return Ok(());
    };
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(Box::new(
                Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .body(Body::from(msg.to_string()))
                    .unwrap(),
            ));
        }
    } else {
        let port = parsed.port_or_known_default().unwrap_or(80);
        let addrs = tokio::net::lookup_host((host, port)).await.map_err(|_| {
            Box::new(
                Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from("DNS resolution failed"))
                    .unwrap(),
            )
        })?;
        for addr in addrs {
            if is_private_ip(addr.ip()) {
                return Err(Box::new(
                    Response::builder()
                        .status(StatusCode::FORBIDDEN)
                        .body(Body::from(msg.to_string()))
                        .unwrap(),
                ));
            }
        }
    }
    Ok(())
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
        check_host_not_private(&parsed, "Access to private/internal addresses is not allowed").await
    {
        return *r;
    }

    let (method, headers, body_bytes) = match extract_request(req).await {
        Ok(v) => v,
        Err(r) => return *r,
    };

    let mut proxy_req = HTTP_CLIENT_FOLLOW_REDIRECTS.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(),
        target_url.clone(),
    );

    for (name, value) in &headers {
        let n = name.as_str();
        if n == "host"
            || n == "connection"
            || n == "upgrade"
            || n == "origin"
            || n == "referer"
            || n == "accept-encoding"
        {
            continue;
        }
        if let Ok(v) = value.to_str() {
            proxy_req = proxy_req.header(n, v);
        }
    }

    if !body_bytes.is_empty() {
        let content_type_val =
            headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
        if content_type_val.contains("application/x-www-form-urlencoded") {
            let mode = RewriteMode::External(target_url.clone());
            if let Some(rewritten) = rewrite_form_urlencoded_body(&body_bytes, &target_url, &mode) {
                proxy_req = proxy_req.body(rewritten);
            } else {
                proxy_req = proxy_req.body(body_bytes);
            }
        } else {
            proxy_req = proxy_req.body(body_bytes);
        }
    }

    let upstream_resp = match proxy_req.send().await {
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

    let final_url = upstream_resp.url().clone();
    let final_url_str = final_url.to_string();
    if let Err(r) =
        check_host_not_private(&final_url, "Redirect to private/internal address is not allowed")
            .await
    {
        return *r;
    }

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

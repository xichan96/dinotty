#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{body::Body, http::header, response::Response};
use futures_util::StreamExt;

use super::rewrite::{
    rewrite_css_urls, rewrite_html_urls, rewrite_js_imports, rewrite_set_cookie, rewrite_url,
    RewriteMode,
};
use super::BASE_TAG_RE;

/// Build the response Dinotty sends for a proxied document.
///
/// `base_url` is the *upstream request URL*, not just its origin: relative
/// references resolve against the document's own path, so an app served from
/// `/slaves/abc/` keeps its sub-path when its assets are rewritten.
pub async fn build_proxied_response(
    upstream_resp: reqwest::Response,
    inject_base: &str,
    inject_script: &str,
    rewrite_mode: Option<RewriteMode>,
    base_url: &str,
) -> Response {
    let status = upstream_resp.status();
    let resp_headers = upstream_resp.headers().clone();
    let content_type = resp_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_html = content_type.contains("text/html");
    let is_css = content_type.contains("text/css");
    let is_js = content_type.contains("javascript") || content_type.contains("ecmascript");
    let may_rewrite = is_html
        || is_css
        || is_js
        || (matches!(&rewrite_mode, Some(RewriteMode::Internal { .. }))
            && (content_type.is_empty() || content_type.starts_with("text/")));

    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in &resp_headers {
        let n = name.as_str();
        if n == "transfer-encoding"
            || n == "connection"
            || n == "x-frame-options"
            || n == "content-security-policy"
            || n == "content-security-policy-report-only"
            || n == "content-encoding"
        {
            continue;
        }
        if may_rewrite && n == "content-length" {
            continue;
        }
        if n == "location" {
            if let (Ok(loc), Some(mode)) = (value.to_str(), &rewrite_mode) {
                if let Some(rewritten) = rewrite_url(loc, base_url, mode) {
                    builder = builder.header(n, rewritten);
                    continue;
                }
            }
        }
        if n == "set-cookie" {
            if let Ok(cookie_str) = value.to_str() {
                let rewritten = rewrite_set_cookie(cookie_str, rewrite_mode.as_ref());
                builder = builder.header(n, rewritten);
                continue;
            }
        }
        builder = builder.header(n, value);
    }

    if is_html {
        let inject = format!("{inject_base}{inject_script}");
        let full_body = upstream_resp.bytes().await.unwrap_or_default();
        let html_raw = String::from_utf8_lossy(&full_body);
        let html = BASE_TAG_RE.replace_all(&html_raw, "");
        let html = if let Some(mode) = &rewrite_mode {
            std::borrow::Cow::Owned(rewrite_html_urls(&html, base_url, mode))
        } else {
            html
        };
        let mut buf = String::with_capacity(html.len() + inject.len());
        if let Some(pos) = html.find("<head>") {
            buf.push_str(&html[..pos + 6]);
            buf.push_str(&inject);
            buf.push_str(&html[pos + 6..]);
        } else if let Some(pos) = html.find("</head>") {
            buf.push_str(&html[..pos]);
            buf.push_str(&inject);
            buf.push_str(&html[pos..]);
        } else {
            buf.push_str(&inject);
            buf.push_str(&html);
        }
        builder.header(header::CONTENT_LENGTH, buf.len()).body(Body::from(buf)).unwrap()
    } else if is_css {
        if let Some(mode) = &rewrite_mode {
            let full_body = upstream_resp.bytes().await.unwrap_or_default();
            let css_raw = String::from_utf8_lossy(&full_body);
            let rewritten = rewrite_css_urls(&css_raw, base_url, mode);
            builder
                .header(header::CONTENT_LENGTH, rewritten.len())
                .body(Body::from(rewritten))
                .unwrap()
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else if is_js {
        if let Some(mode) = &rewrite_mode {
            let full_body = upstream_resp.bytes().await.unwrap_or_default();
            let js_raw = String::from_utf8_lossy(&full_body);
            let rewritten = rewrite_js_imports(&js_raw, mode);
            builder
                .header(header::CONTENT_LENGTH, rewritten.len())
                .body(Body::from(rewritten))
                .unwrap()
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else if let Some(mode @ RewriteMode::Internal { .. }) = &rewrite_mode {
        if content_type.is_empty()
            || (content_type.starts_with("text/")
                && !content_type.contains("text/css")
                && !content_type.contains("text/html"))
        {
            let full_body = upstream_resp.bytes().await.unwrap_or_default();
            let text = String::from_utf8_lossy(&full_body);
            let trimmed = text.trim_start();
            if trimmed.starts_with("import ")
                || trimmed.starts_with("import{")
                || trimmed.starts_with("import(")
                || trimmed.starts_with("export ")
                || trimmed.starts_with("export{")
                || trimmed.starts_with("from ")
                || trimmed.starts_with("const ")
                || trimmed.starts_with("var ")
                || trimmed.starts_with("let ")
            {
                let rewritten = rewrite_js_imports(&text, mode);
                builder
                    .header(header::CONTENT_LENGTH, rewritten.len())
                    .body(Body::from(rewritten))
                    .unwrap()
            } else {
                builder
                    .header(header::CONTENT_LENGTH, full_body.len())
                    .body(Body::from(full_body))
                    .unwrap()
            }
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else {
        let stream =
            upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
        builder.body(Body::from_stream(stream)).unwrap()
    }
}

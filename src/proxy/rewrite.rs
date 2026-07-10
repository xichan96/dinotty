#![allow(clippy::unwrap_used, clippy::expect_used)]
use bytes::Bytes;
use lol_html::{element, HtmlRewriter, Settings};
use std::sync::LazyLock;

static CSS_URL_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"(?i)url\(\s*(['"]?)([^)'"]+)['"]?\s*\)"#).unwrap());

static JS_IMPORT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"((?:from|import)\s*\(?)(["'])/([^/"'])"#).unwrap());

#[derive(Clone)]
pub enum RewriteMode {
    External(String),
    Internal { host: String, port: u16 },
}

pub fn rewrite_url(raw: &str, base_url: &str, mode: &RewriteMode) -> Option<String> {
    let u = raw.trim();
    if u.is_empty()
        || u.starts_with('#')
        || u.starts_with("data:")
        || u.starts_with("blob:")
        || u.starts_with("javascript:")
        || u.starts_with("mailto:")
        || u.contains("/api/proxy")
        || u.contains("/preview/")
    {
        return None;
    }
    let abs = if u.starts_with("http://")
        || u.starts_with("https://")
        || u.starts_with("HTTP://")
        || u.starts_with("HTTPS://")
    {
        u.to_string()
    } else if u.starts_with("//") {
        format!("https:{u}")
    } else if let Ok(base) = reqwest::Url::parse(base_url) {
        base.join(u).ok()?.to_string()
    } else {
        return None;
    };
    match mode {
        RewriteMode::External(_) => Some(format!("/api/proxy?url={}", urlencoding::encode(&abs))),
        RewriteMode::Internal { host, port } => {
            if let Ok(parsed) = reqwest::Url::parse(&abs) {
                let h = parsed.host_str().unwrap_or("");
                if h == "127.0.0.1" || h == "localhost" || h == "0.0.0.0" || h == host {
                    let p = parsed.port().unwrap_or(*port);
                    let target_host = if h == host { host.as_str() } else { "127.0.0.1" };
                    let prefix = if target_host == "127.0.0.1" {
                        format!("/preview/{p}")
                    } else {
                        format!("/preview/{target_host}/{p}")
                    };
                    Some(format!(
                        "{}{}{}",
                        prefix,
                        parsed.path(),
                        parsed.query().map(|q| format!("?{q}")).unwrap_or_default()
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        }
    }
}

pub fn rewrite_css_urls(css: &str, base_url: &str, mode: &RewriteMode) -> String {
    CSS_URL_RE
        .replace_all(css, |caps: &regex::Captures| {
            let quote = &caps[1];
            let url = &caps[2];
            match rewrite_url(url, base_url, mode) {
                Some(rewritten) => format!("url({quote}{rewritten}{quote})"),
                None => caps[0].to_string(),
            }
        })
        .into_owned()
}

pub fn rewrite_js_imports(js: &str, mode: &RewriteMode) -> String {
    let prefix = match mode {
        RewriteMode::Internal { host, port } => {
            if host == "127.0.0.1" {
                format!("/preview/{port}")
            } else {
                format!("/preview/{host}/{port}")
            }
        }
        RewriteMode::External(_) => return js.to_string(),
    };
    JS_IMPORT_RE
        .replace_all(js, |caps: &regex::Captures| {
            format!("{}{}{}/{}", &caps[1], &caps[2], prefix, &caps[3])
        })
        .into_owned()
}

pub fn rewrite_html_urls(html: &str, base_url: &str, mode: &RewriteMode) -> String {
    let base_url = base_url.to_string();
    let mode_clone = mode.clone();
    let mut output = Vec::with_capacity(html.len());

    let attr_handler = |el: &mut lol_html::html_content::Element| {
        for attr_name in &["href", "src", "action", "poster", "data"] {
            if let Some(val) = el.get_attribute(attr_name) {
                if let Some(rewritten) = rewrite_url(&val, &base_url, &mode_clone) {
                    el.set_attribute(attr_name, &rewritten).ok();
                }
            }
        }
        if let Some(srcset) = el.get_attribute("srcset") {
            let rewritten_entries: Vec<String> = srcset
                .split(',')
                .map(|entry| {
                    let parts: Vec<&str> = entry.trim().splitn(2, char::is_whitespace).collect();
                    if parts.is_empty() {
                        return entry.to_string();
                    }
                    let url = parts[0];
                    let descriptor = if parts.len() > 1 { parts[1] } else { "" };
                    match rewrite_url(url, &base_url, &mode_clone) {
                        Some(rewritten) if descriptor.is_empty() => rewritten,
                        Some(rewritten) => format!("{rewritten} {descriptor}"),
                        None => entry.trim().to_string(),
                    }
                })
                .collect();
            el.set_attribute("srcset", &rewritten_entries.join(", ")).ok();
        }
        Ok(())
    };

    let base_url2 = base_url.clone();
    let mode_clone2 = mode.clone();
    let style_handler = move |el: &mut lol_html::html_content::Element| {
        if let Some(style_val) = el.get_attribute("style") {
            let rewritten = rewrite_css_urls(&style_val, &base_url2, &mode_clone2);
            if rewritten != style_val {
                el.set_attribute("style", &rewritten).ok();
            }
        }
        Ok(())
    };

    let base_url3 = base_url.clone();
    let mode_clone3 = mode.clone();
    let meta_handler = move |el: &mut lol_html::html_content::Element| {
        let http_equiv = el.get_attribute("http-equiv").unwrap_or_default();
        if http_equiv.eq_ignore_ascii_case("refresh") {
            if let Some(content) = el.get_attribute("content") {
                static META_URL_RE: LazyLock<regex::Regex> =
                    LazyLock::new(|| regex::Regex::new(r"(?i)(.*?url\s*=\s*)(.+)").unwrap());
                if let Some(caps) = META_URL_RE.captures(&content) {
                    let prefix = &caps[1];
                    let url = &caps[2];
                    if let Some(rewritten) = rewrite_url(url.trim(), &base_url3, &mode_clone3) {
                        el.set_attribute("content", &format!("{prefix}{rewritten}")).ok();
                    }
                }
            }
        }
        Ok(())
    };

    {
        let base_url_s = base_url.clone();
        let mode_s = mode.clone();
        let mut rewriter = HtmlRewriter::new(
            Settings {
                element_content_handlers: vec![
                    element!("a, link, area, form, img, script, source, video, audio, embed, object, iframe, input, track", attr_handler),
                    element!("*[style]", style_handler),
                    element!("meta[http-equiv]", meta_handler),
                    element!("base", |el| {
                        el.remove();
                        Ok(())
                    }),
                ],
                ..Settings::new()
            },
            |c: &[u8]| output.extend_from_slice(c),
        );
        rewriter.write(html.as_bytes()).unwrap_or(());
        rewriter.end().unwrap_or(());

        let result = String::from_utf8(output).unwrap_or_else(|_| html.to_string());
        rewrite_style_blocks(&result, &base_url_s, &mode_s)
    }
}

fn rewrite_style_blocks(html: &str, base_url: &str, mode: &RewriteMode) -> String {
    static STYLE_BLOCK_RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?is)<style[^>]*>(.*?)</style>").unwrap());
    STYLE_BLOCK_RE
        .replace_all(html, |caps: &regex::Captures| {
            let full = &caps[0];
            let inner = &caps[1];
            let rewritten = rewrite_css_urls(inner, base_url, mode);
            full.replace(inner, &rewritten)
        })
        .into_owned()
}

pub fn rewrite_form_urlencoded_body(
    body: &[u8],
    base_url: &str,
    mode: &RewriteMode,
) -> Option<Bytes> {
    let text = std::str::from_utf8(body).ok()?;
    let mut changed = false;
    let pairs: Vec<String> = text
        .split('&')
        .map(|pair| {
            if let Some((key, val)) = pair.split_once('=') {
                let decoded = urlencoding::decode(val).unwrap_or(std::borrow::Cow::Borrowed(val));
                if decoded.starts_with("http://") || decoded.starts_with("https://") {
                    if let Some(rewritten) = rewrite_url(&decoded, base_url, mode) {
                        changed = true;
                        return format!("{}={}", key, urlencoding::encode(&rewritten));
                    }
                }
            }
            pair.to_string()
        })
        .collect();
    if changed {
        Some(Bytes::from(pairs.join("&")))
    } else {
        None
    }
}

pub fn rewrite_set_cookie(cookie: &str, mode: Option<&RewriteMode>) -> String {
    static DOMAIN_RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i);\s*domain=[^;]*").unwrap());
    static PATH_RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i);\s*path=([^;]*)").unwrap());
    static SECURE_RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i);\s*secure").unwrap());
    static SAMESITE_RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i);\s*samesite=[^;]*").unwrap());

    let mut result = DOMAIN_RE.replace_all(cookie, "").into_owned();
    result = SECURE_RE.replace_all(&result, "").into_owned();
    result = SAMESITE_RE.replace_all(&result, "").into_owned();

    let path_prefix = match mode {
        Some(RewriteMode::Internal { host, port }) => {
            if host == "127.0.0.1" {
                format!("/preview/{port}")
            } else {
                format!("/preview/{host}/{port}")
            }
        }
        Some(RewriteMode::External(_)) => "/api/proxy".to_string(),
        None => return result,
    };

    if let Some(caps) = PATH_RE.captures(&result) {
        let orig_path = caps.get(1).map_or("/", |m| m.as_str());
        let new_path = format!("{path_prefix}{orig_path}");
        result = PATH_RE.replace(&result, format!("; Path={new_path}")).into_owned();
    } else {
        result = format!("{result}; Path={path_prefix}/");
    }

    result
}

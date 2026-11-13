#![allow(clippy::unwrap_used, clippy::expect_used)]
use bytes::Bytes;
use lol_html::{element, HtmlRewriter, Settings};
use std::sync::LazyLock;

static CSS_URL_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"(?i)url\(\s*(['"]?)([^)'"]+)['"]?\s*\)"#).unwrap());

static JS_IMPORT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"((?:from|import)\s*\(?)(["'])/([^/"'])"#).unwrap());

// Vite's production preload helper builds chunk URLs as `"/" + dep`, where
// `dep` is a bare `assets/...` entry from `__vite__mapDeps`. The browser
// resolves those against the origin, so lazy chunks 404 unless the map itself
// carries the preview prefix.
static VITE_DEP_DOUBLE_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#""assets/([^"{}\s]+)""#).unwrap());
static VITE_DEP_SINGLE_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"'assets/([^'"{}\s]+)'"#).unwrap());

// Inline module scripts are part of the HTML document, so the response-level
// JS rewriter never sees them. Vite's dev React refresh preamble, for example,
// is an inline module with a root-absolute `import "/@react-refresh"`; without
// the preview prefix that request hits Dinotty's origin and the preamble dies.
static INLINE_SCRIPT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?is)<script([^>]*)>(.*?)</script>").unwrap());
static SCRIPT_TYPE_MODULE_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"(?i)\btype\s*=\s*["']?module["']?(?:\s|$)"#).unwrap());
static SCRIPT_SRC_ATTR_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)(?:^|\s)src\s*=").unwrap());

/// The upstream a proxied page came from.
#[derive(Clone)]
pub struct InternalTarget {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    /// Browser-visible prefix already including any hub relay prefix, e.g.
    /// `/__srv/abc/preview/aHR0cDovLzEwLjAuMC41OjgwODk`.
    pub prefix: String,
    /// Hub relay prefix (`/__srv/<id>`) or empty when served directly.
    pub relay_prefix: String,
}

#[derive(Clone)]
pub enum RewriteMode {
    External,
    Internal(InternalTarget),
}

/// Proxy prefix for one upstream origin.
///
/// The page's own origin keeps its prefix verbatim; a resource on a different
/// scheme or port builds a new opaque target segment, carrying the relay
/// prefix over so relayed previews stay reachable through the hub.
fn target_prefix(target: &InternalTarget, scheme: &str, host: &str, port: u16) -> String {
    if scheme == target.scheme && host == target.host && port == target.port {
        target.prefix.clone()
    } else {
        let segment = super::encode_preview_target(scheme, host, port);
        format!("{}/preview/{segment}", target.relay_prefix)
    }
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
        RewriteMode::External => Some(format!("/api/proxy?url={}", urlencoding::encode(&abs))),
        RewriteMode::Internal(target) => {
            let Ok(parsed) = reqwest::Url::parse(&abs) else { return None };
            let h = parsed.host_str().unwrap_or("");
            let ours = h == "127.0.0.1" || h == "localhost" || h == "0.0.0.0" || h == target.host;
            if !ours {
                return None;
            }
            let port = parsed.port_or_known_default().unwrap_or(target.port);
            // Keep the resource's own scheme: an HTTPS page that pulls a
            // resource over HTTP must still be dialed as HTTP.
            let scheme = if parsed.scheme() == "https" { "https" } else { "http" };
            let prefix = target_prefix(target, scheme, h, port);
            Some(format!(
                "{}{}{}",
                prefix,
                parsed.path(),
                parsed.query().map(|q| format!("?{q}")).unwrap_or_default()
            ))
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
        RewriteMode::Internal(target) => target.prefix.clone(),
        RewriteMode::External => return js.to_string(),
    };
    let mut out = JS_IMPORT_RE
        .replace_all(js, |caps: &regex::Captures| {
            format!("{}{}{}/{}", &caps[1], &caps[2], prefix, &caps[3])
        })
        .into_owned();

    // No `__vite__mapDeps` means the bundle does not use Vite's `"/" + dep`
    // preload scheme, and rewriting every "assets/..." string would be too
    // broad. When it is present, the map is exactly where those strings live.
    if out.contains("__vite__mapDeps") {
        let dep_prefix = prefix.trim_start_matches('/');
        out = VITE_DEP_DOUBLE_RE
            .replace_all(&out, |caps: &regex::Captures| {
                format!("\"{dep_prefix}/assets/{}\"", &caps[1])
            })
            .into_owned();
        out = VITE_DEP_SINGLE_RE
            .replace_all(&out, |caps: &regex::Captures| {
                format!("'{dep_prefix}/assets/{}'", &caps[1])
            })
            .into_owned();
    }
    out
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
        let result = rewrite_style_blocks(&result, &base_url_s, &mode_s);
        rewrite_inline_module_scripts(&result, &mode_s)
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

/// Rewrite root-absolute imports inside inline `<script type="module">` blocks.
///
/// Only module scripts without a `src` are touched: classic inline scripts
/// cannot import statically, and rewriting arbitrary script text would risk
/// corrupting strings or JSON payloads. `</script>` cannot appear inside a
/// script body, so the non-greedy match cannot overrun the block.
fn rewrite_inline_module_scripts(html: &str, mode: &RewriteMode) -> String {
    if matches!(mode, RewriteMode::External) {
        return html.to_string();
    }
    INLINE_SCRIPT_RE
        .replace_all(html, |caps: &regex::Captures| {
            let attrs = &caps[1];
            let body = &caps[2];
            if SCRIPT_SRC_ATTR_RE.is_match(attrs) || !SCRIPT_TYPE_MODULE_RE.is_match(attrs) {
                return caps[0].to_string();
            }
            let rewritten = rewrite_js_imports(body, mode);
            if rewritten == body {
                caps[0].to_string()
            } else {
                format!("<script{attrs}>{rewritten}</script>")
            }
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
        Some(RewriteMode::Internal(target)) => target.prefix.clone(),
        Some(RewriteMode::External) => "/api/proxy".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn target(relay_prefix: &str) -> InternalTarget {
        let segment = crate::proxy::encode_preview_target("https", "10.0.0.5", 443);
        InternalTarget {
            scheme: "https".into(),
            host: "10.0.0.5".into(),
            port: 443,
            prefix: format!("{relay_prefix}/preview/{segment}"),
            relay_prefix: relay_prefix.into(),
        }
    }

    fn https_mode() -> RewriteMode {
        RewriteMode::Internal(target(""))
    }

    fn prefix(mode: &RewriteMode) -> String {
        match mode {
            RewriteMode::Internal(t) => t.prefix.clone(),
            RewriteMode::External => unreachable!(),
        }
    }

    /// Vite lazy chunks are addressed by `"/" + dep` at runtime. The dep map
    /// must already carry the preview prefix, or every dynamic import 404s at
    /// the Dinotty origin and the SPA never mounts.
    #[test]
    fn vite_dep_map_gets_the_preview_prefix() {
        let js = r#"const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/a.js",'assets/b.css'])))=>i.map(i=>d[i]);"#;
        let mode = https_mode();
        let out = rewrite_js_imports(js, &mode);
        let dep = prefix(&mode).trim_start_matches('/').to_string();
        assert!(out.contains(&format!("\"{dep}/assets/a.js\"")), "{out}");
        assert!(out.contains(&format!("'{dep}/assets/b.css'")), "{out}");
    }

    /// Without the Vite map marker the rewrite would be too broad; ordinary
    /// "assets/..." strings must survive untouched.
    #[test]
    fn bare_assets_strings_are_left_alone_without_vite_map() {
        let js = r#"const x = "assets/keep.js";"#;
        assert_eq!(rewrite_js_imports(js, &https_mode()), js);
    }

    #[test]
    fn absolute_js_imports_carry_the_prefix() {
        let js = r#"import x from "/assets/a.js";"#;
        let mode = https_mode();
        let out = rewrite_js_imports(js, &mode);
        assert!(out.contains(&format!("from \"{}/assets/a.js\"", prefix(&mode))), "{out}");
    }

    #[test]
    fn internal_rewrites_keep_the_resource_scheme() {
        let out = rewrite_url("http://10.0.0.5/plain.js", "https://10.0.0.5:443/", &https_mode())
            .unwrap();
        let http_segment = crate::proxy::encode_preview_target("http", "10.0.0.5", 80);
        assert_eq!(out, format!("/preview/{http_segment}/plain.js"));
    }

    /// The upstream's path is part of the base, not the target root: an app
    /// mounted at `/slaves/x/` that says `logo.png` means `/slaves/x/logo.png`.
    #[test]
    fn relative_urls_resolve_against_the_document_path() {
        let out = rewrite_url(
            "logo.png",
            "http://10.70.11.20:8089/slaves/abc/workflow-manage",
            &RewriteMode::Internal(InternalTarget {
                scheme: "http".into(),
                host: "10.70.11.20".into(),
                port: 8089,
                prefix: "/preview/seg".into(),
                relay_prefix: String::new(),
            }),
        )
        .unwrap();
        assert_eq!(out, "/preview/seg/slaves/abc/logo.png");
    }

    /// Through the hub relay every rewritten URL must stay under `/__srv/<id>`,
    /// including the prefixes built for a different scheme or port.
    #[test]
    fn relayed_rewrites_keep_the_relay_prefix() {
        let mode = RewriteMode::Internal(target("/__srv/abc"));
        let out = rewrite_url("http://10.0.0.5/plain.js", "https://10.0.0.5:443/", &mode).unwrap();
        let http_segment = crate::proxy::encode_preview_target("http", "10.0.0.5", 80);
        assert_eq!(out, format!("/__srv/abc/preview/{http_segment}/plain.js"));
    }

    /// Vite injects its dev React refresh preamble as an inline module script.
    /// The response-level JS rewriter never sees inline document scripts, so
    /// its root-absolute import must be prefixed here. Otherwise the preamble
    /// 401s at the Dinotty origin and every JSX module throws "can't detect
    /// preamble".
    #[test]
    fn inline_module_imports_carry_the_prefix() {
        let html = r#"<html><head><script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};</script></head><body></body></html>"#;
        let mode = https_mode();
        let out = rewrite_html_urls(html, "http://127.0.0.1:5173/", &mode);
        assert!(out.contains(&format!("from \"{}/@react-refresh\"", prefix(&mode))), "{out}");
    }

    /// Classic inline scripts cannot import statically and JSON payloads must
    /// not be touched; external module scripts are already covered by the
    /// attribute rewriter and must not be processed twice.
    #[test]
    fn only_inline_module_scripts_are_rewritten() {
        let mode = https_mode();
        let html = concat!(
            r#"<script>var s = 'import("/keep.js")';</script>"#,
            r#"<script type="application/json">{"url":"/keep.json"}</script>"#,
            r#"<script type="module" src="/main.tsx"></script>"#,
            r#"<script type="module">import "/go.js";</script>"#,
            r#"<script type=module>import "/unquoted.js";</script>"#,
        );
        let out = rewrite_html_urls(html, "https://10.0.0.5:443/", &mode);
        let p = prefix(&mode);
        assert!(out.contains(r#"import("/keep.js")"#), "{out}");
        assert!(out.contains(r#""/keep.json""#), "{out}");
        assert!(out.contains(&format!(r#"src="{p}/main.tsx""#)), "{out}");
        assert!(out.contains(&format!(r#"import "{p}/go.js""#)), "{out}");
        assert!(out.contains(&format!(r#"import "{p}/unquoted.js""#)), "{out}");
    }
}

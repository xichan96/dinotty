//! Token-scoped static reader for the workspace HTML preview.
//!
//! The preview renders the editor buffer through an `<iframe srcdoc>` so that
//! unsaved edits show up. That frame is sandboxed without `allow-same-origin`,
//! which means it has an opaque origin: it cannot present the session cookie,
//! and every request it makes to the authenticated API comes back 401. Relative
//! assets therefore never load — including the ones a *script* builds at
//! runtime (`<img src>` set from a data table), which no amount of rewriting
//! the HTML string could reach.
//!
//! Widening the sandbox would hand workspace HTML the app's origin and with it
//! the user's authenticated API access, which is exactly what the sandbox is
//! there to prevent. Instead the host page — which *is* authenticated — mints a
//! short-lived token scoped to the HTML file's directory, and injects a
//! `<base href="/preview-ws/<token>/">` into the framed document. Every relative
//! URL inside the frame then resolves here, where the token in the path
//! authenticates the request and the path is confined to the minted directory.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::Path as UrlPath,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

/// How long a minted token stays usable. Long enough to leave a preview open,
/// short enough that a token copied out of the DOM does not stay live forever.
pub const PREVIEW_TOKEN_TTL: Duration = Duration::from_secs(7200);

struct Scope {
    /// Canonical directory the token may read, and nothing outside it.
    root: PathBuf,
    expires: Instant,
}

static SCOPES: LazyLock<Mutex<HashMap<String, Scope>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn scopes() -> MutexGuard<'static, HashMap<String, Scope>> {
    // A poisoned lock only means some other request panicked mid-lookup; the map
    // is still structurally sound, so recover instead of failing every preview.
    SCOPES.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Mint a token that lets a sandboxed preview frame read `dir` and below.
///
/// `dir` must already be canonical and confined to the workspace by the caller.
#[must_use]
pub fn mint(dir: &Path) -> String {
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let now = Instant::now();
    let mut scopes = scopes();
    scopes.retain(|_, scope| scope.expires > now);
    scopes
        .insert(token.clone(), Scope { root: dir.to_path_buf(), expires: now + PREVIEW_TOKEN_TTL });
    token
}

fn root_for(token: &str) -> Option<PathBuf> {
    let now = Instant::now();
    let mut scopes = scopes();
    scopes.retain(|_, scope| scope.expires > now);
    scopes.get(token).map(|scope| scope.root.clone())
}

/// Map a request path onto a file inside `root`, rejecting anything that
/// canonicalizes outside it (symlinks and `..` both land here).
pub(crate) fn resolve_target(root: &Path, rest: &str) -> Option<PathBuf> {
    let root_canon = root.canonicalize().ok()?;
    let joined = super::util::normalize_join(&root_canon, rest).ok()?;
    let canon = joined.canonicalize().ok()?;
    if !canon.starts_with(&root_canon) || !canon.is_file() {
        return None;
    }
    Some(canon)
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, [(header::CACHE_CONTROL, "no-store")], "not found").into_response()
}

/// `GET /preview-ws/:token/*path` — serve one file inside the minted directory.
///
/// Mounted outside `auth_middleware`: the path token *is* the credential.
/// Responses are `no-cache` (the editor buffer can change the same URL) and
/// explicitly `Access-Control-Allow-Origin: *` so an `<iframe>` page that uses
/// `fetch()` on its own assets is not blocked by CORS; there are no credentials
/// involved, and the scope is one directory of read-only files.
#[allow(clippy::unused_async)]
pub async fn serve_preview_asset(UrlPath((token, rest)): UrlPath<(String, String)>) -> Response {
    let Some(root) = root_for(&token) else {
        return not_found();
    };
    // axum hands over the wildcard as matched; a file whose name contains a
    // percent escape can arrive either decoded or raw depending on the version,
    // so try the literal path first and the decoded form only if that misses.
    let target = match resolve_target(&root, &rest) {
        Some(target) => target,
        None if rest.contains('%') => {
            match percent_decode(&rest).and_then(|decoded| resolve_target(&root, &decoded)) {
                Some(target) => target,
                None => return not_found(),
            }
        }
        None => return not_found(),
    };

    let Ok(bytes) = tokio::fs::read(&target).await else {
        return not_found();
    };
    let mime = mime_guess::from_path(&target).first_or_octet_stream().to_string();
    let mut response = (StatusCode::OK, Body::from(bytes)).into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&mime) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=0"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response
}

/// Minimal `%xx` decoder; invalid escapes are left untouched.
fn percent_decode(value: &str) -> Option<String> {
    if !value.contains('%') {
        return Some(value.to_string());
    }
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let mut changed = false;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                changed = true;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    if !changed {
        return Some(value.to_string());
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir_with(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, body) in files {
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, body).unwrap();
        }
        dir
    }

    #[test]
    fn resolve_target_reads_inside_the_scope() {
        let dir = temp_dir_with(&[("css/base.css", "body{}"), ("img/pic.png", "x")]);
        let root = dir.path().canonicalize().unwrap();
        let target = resolve_target(&root, "css/base.css").expect("inside the scope");
        assert!(target.ends_with("base.css"));
        assert!(resolve_target(&root, "img/pic.png").is_some());
    }

    #[test]
    fn resolve_target_rejects_escapes_and_directories() {
        let parent = temp_dir_with(&[("secret.txt", "no"), ("site/index.html", "<html>")]);
        let root = parent.path().join("site").canonicalize().unwrap();
        assert!(resolve_target(&root, "../secret.txt").is_none());
        assert!(resolve_target(&root, "..\\secret.txt").is_none());
        // A directory is not a preview asset.
        assert!(resolve_target(&root, "").is_none());
        assert!(resolve_target(&root, ".").is_none());
    }

    #[test]
    fn tokens_are_scoped_and_expire() {
        let dir = temp_dir_with(&[("a.css", "x")]);
        let root = dir.path().canonicalize().unwrap();
        let token = mint(&root);
        assert_eq!(root_for(&token), Some(root));
        assert_eq!(root_for("not-a-token"), None);
        {
            let mut scopes = scopes();
            if let Some(scope) = scopes.get_mut(&token) {
                scope.expires = Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
            }
        }
        assert_eq!(root_for(&token), None, "expired tokens stop resolving");
    }

    #[test]
    fn percent_decode_handles_escapes() {
        assert_eq!(percent_decode("a%20b.css").as_deref(), Some("a b.css"));
        assert_eq!(percent_decode("plain.css").as_deref(), Some("plain.css"));
        assert_eq!(percent_decode("%zz").as_deref(), Some("%zz"));
    }
}

#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Discovery, installation and removal of user-installed language packs.
//!
//! Packs live in `config_dir()/locales/*.json` and are read as *data*: the
//! frontend only ever `JSON.parse`s them. They must never be `import()`ed as
//! modules, because that would execute a dropped file as code.
//!
//! A pack can be installed two ways: by putting a file in the directory (the
//! desktop path), or through `POST /api/locales` (the only path available on a
//! phone, where `config_dir()` is not reachable). The upload route **revalidates
//! and rewrites** the pack rather than storing what it was sent — see
//! [`sanitize_pack`] for why the frontend's validation is not a security
//! boundary here.
//!
//! These handlers take no state, which is load-bearing rather than stylistic:
//! the two binaries (`src/main.rs` and `src-tauri`) each have their own
//! `AppState`, so any extractor would have to be added to *both* `FromRef` impls.

use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::settings::config_dir;

/// Query for [`post_locale`]. See there for why the name is not required.
#[derive(Deserialize)]
pub struct InstallQuery {
    /// Filename the upload came from. Public so the endpoint tests can build one.
    pub file: Option<String>,
}

/// Directory the packs are read from, next to `settings.json`.
#[must_use]
pub fn locales_dir() -> std::path::PathBuf {
    config_dir().join("locales")
}

/// Refuse an implausible pack before reading it into memory.
///
/// Matches `MAX_PACK_BYTES` in the frontend validator; the browser enforces its
/// own cap, but a client can request the directory listing without parsing.
const MAX_PACK_BYTES: u64 = 512 * 1024;

/// Above this a single "translation" is a payload, not a sentence.
const MAX_VALUE_LEN: usize = 4000;

/// A pack translating more keys than the app has is padding, not translation.
const MAX_MESSAGES: usize = 20_000;

/// Keys whose presence would rewrite the prototype of whatever object the
/// frontend copies them onto.
const FORBIDDEN_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// What the frontend is told when an upload is rejected, so it can show why.
fn bad_request(message: impl Into<String>) -> Response {
    (StatusCode::BAD_REQUEST, axum::Json(json!({ "error": message.into() }))).into_response()
}

/// A tag is used as a filename, so it must not be able to escape the directory.
///
/// Character-by-character for the same reason the frontend does it that way:
/// this input decides a path, and rejection has to be obvious rather than
/// dependent on a regex being read correctly.
#[must_use]
pub fn is_valid_tag(tag: &str) -> bool {
    let bytes = tag.as_bytes();
    if bytes.len() < 2 || bytes.len() > 35 {
        return false;
    }
    if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
        return false;
    }
    let mut last_dash = false;
    for &b in bytes {
        if b == b'-' {
            if last_dash {
                return false;
            }
            last_dash = true;
            continue;
        }
        last_dash = false;
        if !b.is_ascii_alphanumeric() {
            return false;
        }
    }
    true
}

// `Deserialize` is here so the endpoint tests can read the response back
// through the same shape the frontend sees.
#[derive(Serialize, serde::Deserialize)]
pub struct LocaleFile {
    /// Filename stem. The frontend prefers the manifest's own `tag` when
    /// present; this is only a fallback and a stable identifier for reporting.
    pub file: String,
    /// Raw file contents. The frontend validates and sanitises it — keeping
    /// validation in one place rather than duplicating the rules in Rust.
    pub body: String,
}

/// `GET /api/locales` — every readable, plausibly-named pack in the directory.
///
/// A missing directory is not an error: it means no packs are installed.
/// Unreadable or oversized entries are skipped rather than failing the request,
/// so one bad file cannot hide the language packs that are fine.
pub async fn get_locales() -> Response {
    let dir = locales_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return axum::Json(Vec::<LocaleFile>::new()).into_response();
    };

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // The filename is what makes the tag a path component, so validate it
        // before anything else touches the path.
        if !is_valid_tag(stem) {
            tracing::warn!(file = %path.display(), "skipping locale pack with invalid tag");
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_PACK_BYTES {
            tracing::warn!(file = %path.display(), "skipping oversized locale pack");
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(body) => files.push(LocaleFile { file: stem.to_string(), body }),
            Err(e) => tracing::warn!(file = %path.display(), %e, "skipping unreadable locale pack"),
        }
    }

    // Deterministic order so the settings list does not reshuffle per request.
    files.sort_by(|a, b| a.file.cmp(&b.file));

    // `Json` sets the content type; the explicit no-cache is because the
    // settings list must reflect a pack the user just installed.
    ([(header::CACHE_CONTROL, "no-cache")], axum::Json(files)).into_response()
}

/// A validated pack, normalised to the one shape we are willing to store.
#[derive(Serialize)]
pub struct SanitizedPack {
    tag: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_app_version: Option<String>,
    extends: String,
    messages: serde_json::Map<String, Value>,
}

/// Re-validate an uploaded pack and reduce it to a normalised, safe form.
///
/// This is the security boundary for the write path, and it does not trust the
/// frontend's validation — that one exists to give the user a good error
/// message, and a client can post here without ever running it. Anything
/// written to disk has been rebuilt from parsed, filtered values.
///
/// It **rewrites rather than stores**: a pack carrying `__proto__` is saved
/// without that key, so a poisoned file cannot sit in the directory for the
/// next reader (or a future client with a weaker parser) to trip over.
fn sanitize_pack(text: &str, fallback_tag: &str) -> Result<SanitizedPack, String> {
    if text.len() as u64 > MAX_PACK_BYTES {
        return Err(format!("pack is larger than {}KB", MAX_PACK_BYTES / 1024));
    }
    let raw: Value = serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let Value::Object(manifest) = raw else {
        return Err("pack must be a JSON object".to_string());
    };

    let tag = manifest
        .get("tag")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_tag);
    if !is_valid_tag(tag) {
        return Err(format!(
            "invalid locale tag `{tag}` (letters, digits and single dashes, 2-35 chars)"
        ));
    }

    let Some(Value::Object(messages)) = manifest.get("messages") else {
        return Err("`messages` must be an object".to_string());
    };
    if messages.len() > MAX_MESSAGES {
        return Err(format!("too many messages (max {MAX_MESSAGES})"));
    }

    let mut clean = serde_json::Map::new();
    for (key, value) in messages {
        // `constructor` and `prototype` are legal object keys in JSON and are
        // only dangerous once copied onto a plain object, which is exactly what
        // the frontend does with them.
        if FORBIDDEN_KEYS.contains(&key.as_str()) {
            continue;
        }
        let Some(value) = value.as_str() else { continue };
        if value.len() > MAX_VALUE_LEN {
            continue;
        }
        clean.insert(key.clone(), Value::String(value.to_string()));
    }
    if clean.is_empty() {
        return Err("no usable messages".to_string());
    }

    let extends = manifest
        .get("extends")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("en")
        .to_string();
    if extends != tag && !is_valid_tag(&extends) {
        return Err(format!("invalid `extends` tag `{extends}`"));
    }

    Ok(SanitizedPack {
        tag: tag.to_string(),
        name: manifest
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(tag)
            .to_string(),
        version: manifest.get("version").and_then(Value::as_str).map(str::to_string),
        min_app_version: manifest.get("minAppVersion").and_then(Value::as_str).map(str::to_string),
        extends,
        messages: clean,
    })
}

/// `POST /api/locales?file=<name>` — install or replace one language pack.
///
/// The body is the pack itself, so a browser can post a picked `File` straight
/// through (`fetch(url, { method: 'POST', body: file })`) and a script can post
/// a JSON string. Multipart would buy nothing here — there is exactly one part —
/// and would make every caller build a `FormData`.
///
/// `file` is only a fallback for a manifest that omits `tag`; the manifest wins
/// when it has one, so a pack may be renamed freely.
pub async fn post_locale(Query(params): Query<InstallQuery>, body: Bytes) -> Response {
    let Ok(text) = std::str::from_utf8(&body) else {
        return bad_request("pack must be UTF-8");
    };
    // Strip any directory component a client may have sent. `is_valid_tag`
    // rejects separators anyway, but taking the basename first gives a clearer
    // error message than "invalid tag `../ja`".
    let fallback = params
        .file
        .as_deref()
        .and_then(|f| f.rsplit(['/', '\\']).next())
        .and_then(|f| f.strip_suffix(".json"))
        .unwrap_or("");

    let pack = match sanitize_pack(text, fallback) {
        Ok(pack) => pack,
        Err(e) => return bad_request(e),
    };

    let dir = locales_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": format!("could not create {}: {e}", dir.display()) })),
        )
            .into_response();
    }

    let encoded = match serde_json::to_vec_pretty(&pack) {
        Ok(encoded) => encoded,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(json!({ "error": format!("could not encode pack: {e}") })),
            )
                .into_response()
        }
    };

    // Write-then-rename in the same directory. `rename` is atomic within a
    // filesystem, so a reader never sees a half-written pack and an interrupted
    // upload leaves the previous pack in place rather than a truncated one.
    let final_path = dir.join(format!("{}.json", pack.tag));
    let tmp_path = dir.join(format!(".{}.json.tmp", pack.tag));
    if let Err(e) = std::fs::write(&tmp_path, &encoded) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": format!("could not write pack: {e}") })),
        )
            .into_response();
    }
    if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": format!("could not install pack: {e}") })),
        )
            .into_response();
    }

    tracing::info!(tag = %pack.tag, path = %final_path.display(), "installed locale pack");
    axum::Json(json!({
        "tag": pack.tag,
        "name": pack.name,
        "count": pack.messages.len(),
    }))
    .into_response()
}

/// `DELETE /api/locales/:tag` — remove an installed pack.
///
/// Removing a pack that is not installed is a success, not a 404: the caller's
/// intent ("this pack should not be here") is satisfied either way, and a
/// retried request must not fail.
pub async fn delete_locale(Path(tag): Path<String>) -> Response {
    // The tag arrives from the path, so it is the one place a traversal could
    // be attempted. Reject before touching the filesystem.
    if !is_valid_tag(&tag) {
        return bad_request("invalid locale tag");
    }
    let path = locales_dir().join(format!("{tag}.json"));
    match std::fs::remove_file(&path) {
        Ok(()) => {
            tracing::info!(tag = %tag, "removed locale pack");
            axum::Json(json!({ "tag": tag })).into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            axum::Json(json!({ "tag": tag })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": format!("could not remove pack: {e}") })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_tags() {
        for tag in ["en", "zh", "ja", "zh-Hant-TW", "pt-BR", "es-419"] {
            assert!(is_valid_tag(tag), "{tag} should be valid");
        }
    }

    #[test]
    fn rejects_tags_that_could_escape_the_directory() {
        for tag in [
            "",
            "a",
            "en-",
            "-en",
            "en--US",
            "../etc/passwd",
            "en/US",
            "en\\US",
            "en_US",
            "../..",
            "..",
        ] {
            assert!(!is_valid_tag(tag), "{tag} should be rejected");
        }
        assert!(!is_valid_tag(&"x".repeat(36)));
    }
}

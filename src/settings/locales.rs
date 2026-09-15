#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Discovery, installation and removal of user-installed language packs.
//!
//! Packs live in `config_dir()/locales/*.json` and are read as *data*: the
//! frontend only ever `JSON.parse`s them. They must never be `import()`ed as
//! modules, because that would execute a dropped file as code.
//!
//! A pack can be installed three ways: by putting a file in the directory (the
//! desktop path), through `POST /api/locales` (the only path available on a
//! phone, where `config_dir()` is not reachable), or by name from a remote
//! registry through `POST /api/locales/fetch`. The last two **revalidate and
//! rewrite** the pack rather than storing what they were given — see
//! [`sanitize_pack`] for why the frontend's validation is not a security
//! boundary here.
//!
//! The registry is *operator* configuration, not a client argument:
//! `DINOTTY_LOCALES_REGISTRY_URL` names the index, `GET /api/locales/registry`
//! serves it, and the client hands one advert back to `POST /api/locales/fetch`.
//! There is no hosted index — see [`DEFAULT_REGISTRY_URL`].
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
use sha2::{Digest, Sha256};

use crate::proxy::{pinned_client, resolve_target};
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

/// Placeholder for [`registry_url`]. **There is no hosted language-pack
/// registry.** This is a reserved domain (RFC 2606) rather than a plausible
/// URL for a service that does not exist yet, so that shipping the default
/// cannot look like a promise that something answers there. Leaving it in
/// place means "no registry configured", and the routes say so.
const DEFAULT_REGISTRY_URL: &str = "https://example.com/dinotty-locales/registry.json";

/// Variable naming follows `DINOTTY_REGISTRY_URL` in `plugin::registry`.
/// `pub(crate)` so the endpoint tests can clear it rather than repeat the name.
pub(crate) const REGISTRY_URL_ENV: &str = "DINOTTY_LOCALES_REGISTRY_URL";

/// The only index schema this build understands. A higher number is a
/// *different* document, not a malformed one, and must not be guessed at.
const REGISTRY_SCHEMA: u32 = 1;

/// An index past this size is not an index. Packs get [`MAX_PACK_BYTES`];
/// the document listing them needs far less, and it is read into memory.
const MAX_REGISTRY_BYTES: u64 = 1024 * 1024;

/// The configured registry URL, or `None` when none is configured — which is
/// the default state and not an error, just an absent feature.
fn registry_url() -> Option<String> {
    let url = std::env::var(REGISTRY_URL_ENV).unwrap_or_default();
    let url = url.trim();
    if url.is_empty() || url == DEFAULT_REGISTRY_URL {
        return None;
    }
    Some(url.to_string())
}

/// Whether a string is a URL we are willing to *show*, not one we will dial.
///
/// The private-address check needs DNS and so cannot run for a whole listing;
/// it happens per pack in [`fetch_locale`]. This filter only drops entries that
/// could never be fetched at all.
fn is_http_url(url: &str) -> bool {
    matches!(
        reqwest::Url::parse(url),
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some()
    )
}

/// What the frontend is told when an upload is rejected, so it can show why.
fn bad_request(message: impl Into<String>) -> Response {
    refused(StatusCode::BAD_REQUEST, message)
}

/// A refusal in the `{"error": ...}` shape every route in this module uses.
fn refused(status: StatusCode, message: impl Into<String>) -> Response {
    (status, axum::Json(json!({ "error": message.into() }))).into_response()
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

/// One pack as a registry advertises it.
///
/// Also the body of [`fetch_locale`]: `GET /api/locales/registry` hands these
/// out and the client posts the one it picked straight back, so the two routes
/// cannot drift into different vocabularies.
// `Serialize` so the listing is this shape, `Deserialize` so the install route
// accepts it back.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegistryPack {
    /// Locale tag, and the fallback filename when the pack omits its own.
    pub tag: String,
    /// Endonym shown in the picker — never translated.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The app version the pack was written against, same key the manifest uses.
    #[serde(default, rename = "minAppVersion", skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    /// Where the pack file lives.
    pub url: String,
    /// sha256 of the pack file, lowercase hex. Optional but verified when
    /// present — see [`fetch_locale`] for what it is and is not good for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// The registry document, as the offsite side publishes it.
#[derive(Deserialize)]
struct RegistryDocument {
    schema: u32,
    /// The offsite registry publishes one document covering every content kind,
    /// partitioned by kind: `locales` for packs, `themes` for themes. A
    /// single-purpose document with a bare `packs` array is still accepted so a
    /// hand-written index keeps working, but `locales` is what offsite sends.
    ///
    /// `Vec<Value>` rather than `Vec<RegistryPack>` so one bad row is dropped
    /// instead of failing the deserialize for the whole document — see the
    /// per-row parse in [`get_locale_registry`].
    #[serde(default, alias = "packs")]
    locales: Vec<serde_json::Value>,
}

/// What `GET /api/locales/registry` returns: the same document, minus the
/// entries that could not have been installed anyway.
#[derive(Serialize)]
struct RegistryListing {
    schema: u32,
    packs: Vec<RegistryPack>,
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

    install_pack(text, fallback)
}

/// Validate, normalise and atomically install a pack.
///
/// The one write path. Both the upload route and the registry route end here,
/// so a pack that arrived over the network is rebuilt by exactly the code that
/// rebuilds a picked file and cannot skip [`sanitize_pack`] on the way in.
///
/// `fallback_tag` is what a manifest omitting its own `tag` is filed under.
fn install_pack(text: &str, fallback_tag: &str) -> Response {
    let pack = match sanitize_pack(text, fallback_tag) {
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

// ---------------------------------------------------------------------------
// Remote registry.
//
// Split across two routes on purpose. The index is *operator* configuration —
// the client cannot name it, only read it — while installing an entry means
// downloading a URL the client chose. Keeping the read on `GET` and the only
// write on `POST` is the same split `get_locales`/`post_locale` already uses,
// and it means the dangerous half (a client-influenced URL) is one function
// that can be read in full.
// ---------------------------------------------------------------------------

/// Why a remote read did not produce a body.
enum FetchError {
    /// Transport, DNS, or a non-2xx status. Carries a message for the client.
    Network(String),
    /// The body passed the caller's cap and the transfer was stopped.
    TooLarge,
}

/// Read a response body, refusing anything past `cap`.
///
/// Chunked rather than `bytes()` because the cap has to stop the *transfer*:
/// a body that is already too big must not be buffered first and measured
/// after, or the limit protects nothing.
async fn read_capped(mut resp: reqwest::Response, cap: u64) -> Result<Vec<u8>, FetchError> {
    let mut body = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() as u64 + chunk.len() as u64 > cap {
                    return Err(FetchError::TooLarge);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(body),
            Err(e) => return Err(FetchError::Network(e.to_string())),
        }
    }
}

/// Fetch a *configured* URL — the registry index, not a client-named pack.
///
/// Safe to use the plain redirect-following client here because the URL comes
/// from the environment, not from a request: an operator pointing this at their
/// own network is choosing to, which is the same trust `plugin::registry`
/// extends to `DINOTTY_REGISTRY_URL`. Client-named URLs go through
/// [`resolve_target`] instead — see [`fetch_locale`].
async fn fetch_configured(url: &str, cap: u64) -> Result<Vec<u8>, FetchError> {
    let resp = crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS
        .get(url)
        .send()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(FetchError::Network(format!("registry returned {}", resp.status())));
    }
    read_capped(resp, cap).await
}

/// Lowercase hex sha256, the form a registry publishes.
fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().fold(String::with_capacity(64), |mut acc, byte| {
        use std::fmt::Write as _;
        // Writing into a String cannot fail; the result is ignored rather than
        // unwrapped so this stays infallible.
        let _ = write!(acc, "{byte:02x}");
        acc
    })
}

/// `GET /api/locales/registry` — the packs the configured registry offers.
///
/// The registry URL is operator configuration (`DINOTTY_LOCALES_REGISTRY_URL`);
/// with none set this answers `503` naming the variable, because "no registry
/// is configured" and "the registry is broken" are different problems and the
/// user can only fix the first one.
///
/// Malformed entries are *dropped*, not fatal, mirroring what [`get_locales`]
/// does with malformed files: one bad row must not hide the good ones. What
/// survives is filtered only on shape — whether a pack URL points somewhere we
/// are willing to dial is decided at fetch time, where DNS can be consulted.
pub async fn get_locale_registry() -> Response {
    let Some(url) = registry_url() else {
        return refused(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("no language pack registry is configured; set {REGISTRY_URL_ENV}"),
        );
    };

    let body = match fetch_configured(&url, MAX_REGISTRY_BYTES).await {
        Ok(body) => body,
        Err(FetchError::TooLarge) => {
            return refused(
                StatusCode::BAD_GATEWAY,
                format!("registry index is larger than {}KB", MAX_REGISTRY_BYTES / 1024),
            )
        }
        Err(FetchError::Network(e)) => {
            return refused(StatusCode::BAD_GATEWAY, format!("could not read the registry: {e}"))
        }
    };

    // Rows are parsed one at a time so a single malformed entry is dropped
    // rather than failing the request: `tag` and `url` are required, and
    // without this one bad row would take down every good one with it — the
    // same rule `get_locales` applies to a malformed file on disk.
    let Ok(document) = serde_json::from_slice::<RegistryDocument>(&body) else {
        return refused(StatusCode::BAD_GATEWAY, "invalid registry JSON");
    };
    if document.schema != REGISTRY_SCHEMA {
        return refused(
            StatusCode::BAD_GATEWAY,
            format!(
                "registry schema {} is not supported (this build reads {REGISTRY_SCHEMA})",
                document.schema
            ),
        );
    }

    let mut packs: Vec<RegistryPack> = document
        .locales
        .into_iter()
        .filter_map(|row| serde_json::from_value::<RegistryPack>(row).ok())
        .filter(|pack| is_valid_tag(&pack.tag) && is_http_url(&pack.url))
        .collect();
    // Deterministic order, like `get_locales`, so the list does not reshuffle.
    packs.sort_by(|a, b| a.tag.cmp(&b.tag));

    // `no-cache` for the same reason `get_locales` sets it: a pack published
    // since the last look must show up.
    (
        [(header::CACHE_CONTROL, "no-cache")],
        axum::Json(RegistryListing { schema: REGISTRY_SCHEMA, packs }),
    )
        .into_response()
}

/// `POST /api/locales/fetch` — download one registry entry and install it.
///
/// The body is an entry exactly as [`get_locale_registry`] returned it, so the
/// frontend forwards a row it already has instead of assembling a request.
///
/// That shape makes `url` client-controlled, which is the whole reason this
/// route is more careful than the others here: it goes through the external
/// proxy's [`resolve_target`] guard, so a client cannot aim this server at its
/// own network (or at a cloud metadata endpoint) and read the reply out of the
/// resulting error message. DNS is resolved once and the connection pinned, so
/// a rebinding answer between check and connect does not slip through either.
///
/// `sha256`, when the registry supplies it, is checked here rather than in the
/// browser because the browser is not a boundary — the same argument
/// [`sanitize_pack`] makes about validation. It is an *integrity* check against
/// a truncated or swapped file, not an authenticity one: a registry that lies
/// about a pack can lie about its hash too. [`sanitize_pack`] remains the thing
/// standing between a hostile pack and the disk.
pub async fn fetch_locale(axum::Json(entry): axum::Json<RegistryPack>) -> Response {
    if !is_valid_tag(&entry.tag) {
        return bad_request("invalid locale tag");
    }
    let Ok(parsed) = reqwest::Url::parse(&entry.url) else {
        return bad_request("invalid pack url");
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return bad_request("pack url must be http or https");
    }

    // Resolve and validate before connecting, then pin the client to the
    // addresses that passed — closing the rebinding window rather than merely
    // making it unlikely.
    // The proxy's own refusal is discarded in favour of this module's
    // `{"error"}` shape, so the frontend has one response shape to read — but
    // its *distinction* is kept: `resolve_target` answers 403 for an address it
    // refuses and 502 for a name it cannot resolve. Reporting a typo in a
    // registry entry as "private or internal" would send the user looking for
    // a firewall.
    let target = match resolve_target(&parsed, "pack url is not allowed").await {
        Ok(target) => target,
        Err(resp) if resp.status() == StatusCode::FORBIDDEN => {
            return refused(
                StatusCode::FORBIDDEN,
                "the pack url points at a private or internal address",
            )
        }
        Err(_) => return refused(StatusCode::BAD_GATEWAY, "could not resolve the pack url host"),
    };

    let resp = match pinned_client(&target).get(parsed).send().await {
        Ok(resp) => resp,
        Err(e) => {
            return refused(StatusCode::BAD_GATEWAY, format!("could not download the pack: {e}"))
        }
    };
    if !resp.status().is_success() {
        return refused(
            StatusCode::BAD_GATEWAY,
            format!("the pack url returned {}", resp.status()),
        );
    }

    let bytes = match read_capped(resp, MAX_PACK_BYTES).await {
        Ok(bytes) => bytes,
        Err(FetchError::TooLarge) => {
            return refused(
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("pack is larger than {}KB", MAX_PACK_BYTES / 1024),
            )
        }
        Err(FetchError::Network(e)) => {
            return refused(StatusCode::BAD_GATEWAY, format!("could not download the pack: {e}"))
        }
    };

    finish_fetch(&bytes, &entry)
}

/// What happens to a pack once its bytes are in hand: the integrity check, the
/// UTF-8 decode, and the shared install.
///
/// Split out from [`fetch_locale`] so the decisions that make a *downloaded*
/// pack trustworthy are testable without a socket. They cannot be reached
/// through the handler in a test, because the handler refuses the loopback
/// address any local stand-in would be served from — which is the guard
/// working, not a gap.
fn finish_fetch(bytes: &[u8], entry: &RegistryPack) -> Response {
    if let Some(expected) = entry.sha256.as_deref() {
        let expected = expected.trim().to_ascii_lowercase();
        if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
            return bad_request("invalid sha256 (expected 64 hex characters)");
        }
        let actual = sha256_hex(bytes);
        if actual != expected {
            // The client asked correctly; the registry and the file disagree.
            return refused(
                StatusCode::BAD_GATEWAY,
                format!("sha256 mismatch: registry says {expected}, the file is {actual}"),
            );
        }
    }

    let Ok(text) = std::str::from_utf8(bytes) else {
        return bad_request("pack must be UTF-8");
    };
    install_pack(text, &entry.tag)
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

    /// Only a pack URL we would actually dial survives the listing filter. The
    /// private-address half needs DNS and is checked in `fetch_locale`.
    #[test]
    fn listing_keeps_only_http_urls_with_a_host() {
        for url in ["https://example.com/ja.json", "http://127.0.0.1:8080/ja.json"] {
            assert!(is_http_url(url), "{url} should survive the listing filter");
        }
        for url in ["", "ja.json", "file:///etc/passwd", "data:text/json,{}", "https://"] {
            assert!(!is_http_url(url), "{url} should not survive the listing filter");
        }
    }

    /// The endpoint tests live in `src/settings/tests/locales.rs`; these are
    /// here because they reach into private helpers, and because the two that
    /// need a socket need it *without* the private-address guard — the guard is
    /// what stops the handler itself from ever talking to a loopback stand-in.
    mod fetch {
        use super::*;

        fn entry(url: &str, sha256: Option<&str>) -> RegistryPack {
            RegistryPack {
                tag: "ja".to_string(),
                name: "日本語".to_string(),
                version: None,
                min_app_version: None,
                url: url.to_string(),
                sha256: sha256.map(str::to_string),
            }
        }

        async fn body_of(response: Response) -> (StatusCode, serde_json::Value) {
            let status = response.status();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
            (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
        }

        /// Serve one body, so `read_capped` is exercised against a real
        /// response rather than a struct we invented.
        async fn serve(body: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
            use axum::routing::get;
            let app = axum::Router::new().route(
                "/pack.json",
                get(move || {
                    let body = body.clone();
                    async move { body }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let task = tokio::spawn(async move {
                // A client that stops reading mid-body (which is the point of
                // the cap) turns into an error here; that is expected, so it is
                // discarded rather than unwrapped into a panic.
                let _ = axum::serve(listener, app).await;
            });
            (format!("http://{addr}/pack.json"), task)
        }

        #[tokio::test]
        async fn read_capped_stops_the_transfer_at_the_cap() {
            let (url, task) = serve(vec![b'x'; 4096]).await;
            let resp = reqwest::get(&url).await.unwrap();

            assert!(matches!(read_capped(resp, 1024).await, Err(FetchError::TooLarge)));

            task.abort();
        }

        #[tokio::test]
        async fn read_capped_returns_a_body_that_fits() {
            let (url, task) = serve(b"{\"tag\":\"ja\"}".to_vec()).await;
            let resp = reqwest::get(&url).await.unwrap();

            let body = read_capped(resp, 1024).await.ok().unwrap();
            assert_eq!(body, b"{\"tag\":\"ja\"}");

            task.abort();
        }

        #[tokio::test]
        async fn a_matching_hash_installs_the_pack() {
            let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
            std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-locales-fetch-unit-tests");
            let _ = std::fs::remove_dir_all(locales_dir());

            let bytes = r#"{"tag":"ja","messages":{"app.settings":"設定"}}"#.as_bytes().to_vec();
            let digest = sha256_hex(&bytes);

            let (status, body) =
                body_of(finish_fetch(&bytes, &entry("https://x/ja.json", Some(&digest)))).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["tag"], "ja");
            assert!(locales_dir().join("ja.json").exists());

            let _ = std::fs::remove_dir_all(locales_dir());
            drop(env);
        }

        /// The check that makes `sha256` worth publishing. Note the direction:
        /// the *file* is rejected, so nothing reached the directory.
        #[tokio::test]
        async fn a_mismatched_hash_is_refused_and_writes_nothing() {
            let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
            std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-locales-fetch-unit-tests");
            let _ = std::fs::remove_dir_all(locales_dir());

            let bytes = r#"{"tag":"ja","messages":{"app.settings":"設定"}}"#.as_bytes().to_vec();
            // The hash of some *other* file.
            let wrong = sha256_hex(b"a different pack");

            let (status, body) =
                body_of(finish_fetch(&bytes, &entry("https://x/ja.json", Some(&wrong)))).await;
            assert_eq!(status, StatusCode::BAD_GATEWAY);
            let error = body["error"].as_str().unwrap();
            assert!(error.contains("sha256 mismatch"), "unclear refusal: {error}");
            assert!(!locales_dir().join("ja.json").exists(), "a rejected pack was written");

            let _ = std::fs::remove_dir_all(locales_dir());
            drop(env);
        }

        #[tokio::test]
        async fn a_hash_that_is_not_a_hash_is_refused_before_the_comparison() {
            let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
            std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-locales-fetch-unit-tests");

            for bad in ["", "abc", &"z".repeat(64), &"a".repeat(63)] {
                let (status, body) =
                    body_of(finish_fetch(b"{}", &entry("https://x/ja.json", Some(bad)))).await;
                assert_eq!(status, StatusCode::BAD_REQUEST, "sha256 {bad:?} should be refused");
                assert!(body["error"].as_str().unwrap().contains("invalid sha256"));
            }

            drop(env);
        }

        /// An absent hash is not a failure: the field is optional in the format.
        #[tokio::test]
        async fn no_hash_means_no_check() {
            let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
            std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-locales-fetch-unit-tests");
            let _ = std::fs::remove_dir_all(locales_dir());

            let bytes = r#"{"tag":"ja","messages":{"app.settings":"設定"}}"#.as_bytes().to_vec();
            let (status, _) =
                body_of(finish_fetch(&bytes, &entry("https://x/ja.json", None))).await;
            assert_eq!(status, StatusCode::OK);

            let _ = std::fs::remove_dir_all(locales_dir());
            drop(env);
        }

        /// A fetched pack is not trusted more than an uploaded one.
        #[tokio::test]
        async fn a_fetched_pack_goes_through_the_same_sanitiser() {
            let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
            std::env::set_var("DINOTTY_CONFIG_SUFFIX", "-locales-fetch-unit-tests");
            let _ = std::fs::remove_dir_all(locales_dir());

            let bytes =
                r#"{"tag":"ja","messages":{"__proto__":"x","constructor":"y","app.settings":"設定"}}"#
                    .as_bytes()
                    .to_vec();
            let (status, _) =
                body_of(finish_fetch(&bytes, &entry("https://x/ja.json", None))).await;
            assert_eq!(status, StatusCode::OK);

            let on_disk = std::fs::read_to_string(locales_dir().join("ja.json")).unwrap();
            assert!(!on_disk.contains("__proto__"), "the fetched pack skipped the rewrite");
            assert!(!on_disk.contains("constructor"));
            assert!(on_disk.contains("app.settings"));

            let _ = std::fs::remove_dir_all(locales_dir());
            drop(env);
        }

        #[tokio::test]
        async fn a_pack_that_is_not_utf8_is_refused() {
            let (status, body) =
                body_of(finish_fetch(&[0xff, 0xfe, 0xfd], &entry("https://x/ja.json", None))).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(body["error"].as_str().unwrap().contains("UTF-8"));
        }

        /// The guard is the reason a client cannot aim this server at its own
        /// network, so it is asserted rather than assumed.
        #[tokio::test]
        async fn fetch_refuses_a_pack_url_on_a_private_address() {
            for url in ["http://127.0.0.1:9/ja.json", "http://192.168.1.1/ja.json"] {
                let (status, body) =
                    body_of(fetch_locale(axum::Json(entry(url, None))).await).await;
                assert_eq!(status, StatusCode::FORBIDDEN, "{url} should not be dialled");
                assert!(body["error"].as_str().unwrap().contains("private"));
            }
        }

        /// A host that does not resolve is a broken registry entry, not an
        /// attack. Collapsing the two into one message sends the reader looking
        /// for a firewall that is not involved.
        #[tokio::test]
        async fn fetch_reports_an_unresolvable_host_as_a_gateway_problem() {
            let (status, body) = body_of(
                fetch_locale(axum::Json(entry("https://no-such-host.invalid/ja.json", None))).await,
            )
            .await;

            assert_eq!(status, StatusCode::BAD_GATEWAY);
            let error = body["error"].as_str().unwrap();
            assert!(error.contains("resolve"), "unclear refusal: {error}");
            assert!(!error.contains("private"), "a DNS failure was reported as SSRF: {error}");
        }

        #[tokio::test]
        async fn fetch_refuses_a_url_that_is_not_http() {
            for (url, expected) in [
                ("file:///etc/passwd", "http"),
                ("not a url", "invalid pack url"),
                ("", "invalid pack url"),
            ] {
                let (status, body) =
                    body_of(fetch_locale(axum::Json(entry(url, None))).await).await;
                assert_eq!(status, StatusCode::BAD_REQUEST, "{url} should be refused");
                assert!(body["error"].as_str().unwrap().contains(expected), "{url} gave: {body}");
            }
        }

        #[tokio::test]
        async fn fetch_refuses_an_entry_whose_tag_could_escape_the_directory() {
            for tag in ["../evil", "a/b", "en_US", ""] {
                let mut pack = entry("https://example.com/ja.json", None);
                pack.tag = tag.to_string();
                let (status, _) = body_of(fetch_locale(axum::Json(pack)).await).await;
                assert_eq!(status, StatusCode::BAD_REQUEST, "tag {tag:?} should be refused");
            }
        }
    }

    #[test]
    fn sha256_hex_matches_the_known_digest_of_the_empty_string() {
        // A fixed vector, so this cannot drift with an implementation change.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(sha256_hex(b"").len(), 64);
    }

    /// Unconfigured is the shipping default, so it has to read as "absent"
    /// rather than as a hostname we then try to dial.
    #[test]
    fn an_unset_or_placeholder_registry_reads_as_unconfigured() {
        let env = crate::test_support::EnvGuard::new(&["DINOTTY_LOCALES_REGISTRY_URL"]);

        std::env::remove_var("DINOTTY_LOCALES_REGISTRY_URL");
        assert_eq!(registry_url(), None, "unset must mean unconfigured");

        std::env::set_var("DINOTTY_LOCALES_REGISTRY_URL", "");
        assert_eq!(registry_url(), None, "empty must mean unconfigured");

        std::env::set_var("DINOTTY_LOCALES_REGISTRY_URL", DEFAULT_REGISTRY_URL);
        assert_eq!(registry_url(), None, "the shipped placeholder must mean unconfigured");

        std::env::set_var("DINOTTY_LOCALES_REGISTRY_URL", "  https://packs.example/reg.json  ");
        assert_eq!(registry_url().as_deref(), Some("https://packs.example/reg.json"));

        drop(env);
    }
}

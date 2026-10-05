#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Discovery, installation and removal of user-installed theme files.
//!
//! Themes live in `config_dir()/themes/` and are read as *data*: the frontend
//! only ever `JSON.parse`s them. They must never be `import()`ed as modules,
//! because that would execute a dropped file as code.
//!
//! # Why this is not `custom_themes`
//!
//! `settings.json` already carries a `custom_themes` array, and a theme saved
//! there is a *setting*: it round-trips through `PUT /api/settings`, is capped
//! at [`super::normalize`]'s `THEME_CUSTOM_CAP`, and is the user's own work.
//! Installed themes are *content*: they arrive as files, may be shared, and
//! should not consume the 15-theme library budget or be truncated by a PUT that
//! happens to arrive with 16 of them. So this module is a second source, and
//! the frontend merges the two for display. `custom_themes` is untouched, which
//! also means every existing user's library keeps working unchanged.
//!
//! # Formats
//!
//! The write path accepts JSON only. It **revalidates and rewrites** what it is
//! sent (see [`sanitize_theme`]), and teaching the server a second, Rust-side
//! Ghostty parser would duplicate `frontend/src/utils/themeImport.ts` for no
//! gain. The *read* path additionally picks up `.conf`, because that is what
//! this app's own "Export theme" produces — a user who exports a theme and
//! drops it back into the directory should get it listed. Nothing is parsed
//! server-side on that path; the file is handed over verbatim for the frontend
//! to sniff, exactly as `locales.rs` does.
//!
//! These handlers take no state, which is load-bearing rather than stylistic:
//! the two binaries (`src/main.rs` and `src-tauri`) each have their own
//! `AppState`, so any extractor would have to be added to *both* `FromRef` impls.

use std::path::{Path, PathBuf};

use axum::{
    body::Bytes,
    extract::{Path as AxumPath, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::settings::config_dir;

/// Query for [`post_theme`]. See there for why the id is not required.
#[derive(Deserialize)]
pub struct InstallQuery {
    /// Filename the upload came from. Public so the endpoint tests can build one.
    pub file: Option<String>,
}

/// Directory the theme files are read from, next to `settings.json`.
///
/// Mirrors [`super::locales::locales_dir`]; `docs/en/guide/appearance.md` said
/// this directory existed long before it did.
#[must_use]
pub fn themes_dir() -> PathBuf {
    config_dir().join("themes")
}

/// Refuse an implausible file before reading it into memory.
///
/// A 19-colour theme is ~1.5KB of JSON; 64KB is generous for comments and
/// whitespace without giving a payload anywhere to hide.
const MAX_THEME_BYTES: u64 = 64 * 1024;

/// Longest display name stored. Cosmetic, but an unbounded one is padding.
const MAX_NAME_LEN: usize = 64;

/// Longest `version` string kept. Same reasoning as [`MAX_NAME_LEN`].
const MAX_VERSION_LEN: usize = 32;

/// A theme id is used as a filename, so it may not be able to escape the
/// directory. Same bound as a locale tag (`locales::is_valid_tag`).
const MAX_ID_LEN: usize = 64;

/// Extensions [`get_themes`] reads. `.json` is what the write path produces;
/// `.conf` is what this app's export produces (see the module note). Order is
/// the precedence when both exist for one id.
const THEME_EXTENSIONS: [&str; 2] = ["json", "conf"];

/// The 16 ANSI slots a theme must define, in palette order.
const PALETTE_SLOTS: usize = 16;

/// Registry documents are a list of ids and URLs; anything near this is not one.
const MAX_REGISTRY_BYTES: u64 = 1024 * 1024;

/// Only schema 1 exists. A registry announcing a different one is either newer
/// than this build (so its entries cannot be trusted to mean what they say) or
/// malformed; both are refused rather than guessed at.
const REGISTRY_SCHEMA: u32 = 1;

/// Where the registry is read from, overridable by environment.
///
/// Deliberately **empty**, i.e. "not configured", rather than a placeholder
/// host: a default URL that does not resolve would turn every look at the
/// theme store into a DNS timeout against a service that was never there. The
/// app therefore ships with the store switched off and a hint in the UI, and
/// an operator opts in by setting the variable — the same shape as
/// `DINOTTY_REGISTRY_URL` in `src/plugin/registry.rs`.
const DEFAULT_REGISTRY_URL: &str = "";

/// What the frontend is told when an upload is rejected, so it can show why.
fn bad_request(message: impl Into<String>) -> Response {
    (StatusCode::BAD_REQUEST, axum::Json(json!({ "error": message.into() }))).into_response()
}

/// A failure reaching or reading a remote document.
fn bad_gateway(message: impl Into<String>) -> Response {
    (StatusCode::BAD_GATEWAY, axum::Json(json!({ "error": message.into() }))).into_response()
}

/// A failure that is ours, not the caller's.
fn server_error(message: impl Into<String>) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(json!({ "error": message.into() })))
        .into_response()
}

/// A theme id is used as a filename, so it must not be able to escape the
/// directory.
///
/// Character-by-character for the same reason the frontend does it that way:
/// this input decides a path, and rejection has to be obvious rather than
/// dependent on a regex being read correctly. It intentionally mirrors
/// `locales::is_valid_tag` rather than calling it — the two are separate
/// security boundaries, and a future change to locale tags must not silently
/// loosen what a theme id may be.
#[must_use]
pub fn is_valid_theme_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 2 || bytes.len() > MAX_ID_LEN {
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

/// Reduce a hex colour to lowercase `#rrggbb`, or `None` if it is not one.
///
/// Accepts `#rgb` / `rrggbb` like the frontend's `normalizeColor`, and rejects
/// rather than repairs — an unreadable colour is a broken theme, and
/// [`super::normalize::normalize_hex_color`]'s replace-with-a-fallback
/// behaviour belongs to the settings path where silently keeping the theme is
/// the point.
///
/// Byte-wise rather than a regex: this is attacker-shaped input, and the
/// frontend carries a `ReDoS` test for exactly that reason.
fn normalize_hex(raw: &str) -> Option<String> {
    let digits = raw.trim();
    let digits = digits.strip_prefix('#').unwrap_or(digits);
    // Checked by byte, so a multi-byte character cannot pass on length alone.
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let lower = digits.to_ascii_lowercase();
    match lower.len() {
        6 => Some(format!("#{lower}")),
        3 => {
            let mut out = String::from("#");
            for ch in lower.chars() {
                out.push(ch);
                out.push(ch);
            }
            Some(out)
        }
        _ => None,
    }
}

/// Turn an uploaded filename into the id to fall back on.
///
/// The basename is taken first so a path (`C:\fakepath\a.json`, `/tmp/a.json`)
/// reduces to something the error message can talk about; `is_valid_theme_id`
/// would reject the separators anyway, but this gives a better message.
fn theme_id_from_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    // The suffixes are ASCII, so slicing at `len - suffix.len()` is always on a
    // character boundary — the comparison above proved those bytes exist.
    let lower = base.to_ascii_lowercase();
    for suffix in [".json", ".conf"] {
        if lower.ends_with(suffix) {
            return base[..base.len() - suffix.len()].to_string();
        }
    }
    base.to_string()
}

/// The on-disk shape of an installed theme.
///
/// Field-for-field compatible with `SavedTheme` minus the `uuid` (an installed
/// theme is identified by its file), which also means the frontend can read it
/// with the parser it already has: `parseThemeFile` looks for `name` on the
/// root and colours under `colors`.
#[derive(Serialize, Debug)]
struct SanitizedTheme {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    colors: WireColors,
}

#[derive(Serialize, Debug)]
struct WireColors {
    foreground: String,
    background: String,
    cursor: String,
    ansi: [String; 16],
}

/// Read one colour out of a theme object, or say which one is wrong.
fn want_color(source: &serde_json::Map<String, Value>, key: &str) -> Result<String, String> {
    let Some(value) = source.get(key) else {
        return Err(format!("missing `{key}`"));
    };
    let Some(text) = value.as_str() else {
        return Err(format!("`{key}` must be a string"));
    };
    normalize_hex(text).ok_or_else(|| format!("invalid `{key}`: {text}"))
}

/// Read all 16 palette slots, refusing a short array.
///
/// All-or-nothing on purpose: a theme missing slots 8-15 would render, but with
/// whatever the terminal's defaults happen to be, which is not the theme the
/// author shipped.
fn want_palette(source: &serde_json::Map<String, Value>) -> Result<[String; 16], String> {
    let Some(value) = source.get("ansi") else {
        return Err("missing `ansi` palette".to_string());
    };
    let Value::Array(entries) = value else {
        return Err(format!("`ansi` must be an array of {PALETTE_SLOTS} colours"));
    };
    if entries.len() != PALETTE_SLOTS {
        return Err(format!(
            "`ansi` must have exactly {PALETTE_SLOTS} colours (got {})",
            entries.len()
        ));
    }

    let mut palette: Vec<String> = Vec::with_capacity(PALETTE_SLOTS);
    for (index, entry) in entries.iter().enumerate() {
        let Some(text) = entry.as_str() else {
            return Err(format!("palette {index} must be a string"));
        };
        palette
            .push(normalize_hex(text).ok_or_else(|| format!("invalid palette {index}: {text}"))?);
    }
    let palette: [String; PALETTE_SLOTS] =
        palette.try_into().map_err(|_| "palette must have 16 colours".to_string())?;
    Ok(palette)
}

/// Re-validate an uploaded theme and reduce it to a normalised, safe form.
///
/// This is the security boundary for the write path, and it does not trust the
/// frontend's validation — that one exists to give the user a good error
/// message, and a client can post here without ever running it.
///
/// It **rewrites rather than stores**, and it does so by *rebuilding from known
/// fields* rather than by filtering a key list the way `locales::sanitize_pack`
/// does. That distinction is deliberate: a pack copies a whole message map onto
/// an object, so `__proto__` has somewhere to hide and needs naming. A theme is
/// read key by key into typed fields, so an unknown key — prototype-polluting
/// or otherwise — has no way to survive into the output at all. The tests below
/// pin that property down rather than the mechanism.
fn sanitize_theme(text: &str, fallback_id: &str) -> Result<SanitizedTheme, String> {
    if text.len() as u64 > MAX_THEME_BYTES {
        return Err(format!("theme file is larger than {}KB", MAX_THEME_BYTES / 1024));
    }
    let raw: Value = serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let Value::Object(root) = raw else {
        return Err("theme must be a JSON object".to_string());
    };

    // Colours may sit at the root or under `colors`, matching `parseJsonTheme`
    // so a file the frontend accepted cannot be refused here.
    let source = match root.get("colors") {
        Some(Value::Object(nested)) => nested,
        Some(_) => return Err("`colors` must be an object".to_string()),
        None => &root,
    };

    let id =
        root.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(fallback_id);
    if !is_valid_theme_id(id) {
        return Err(format!(
            "invalid theme id `{id}` (letters, digits and single dashes, 2-{MAX_ID_LEN} chars)"
        ));
    }

    let name = root
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(id);
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!("theme name is longer than {MAX_NAME_LEN} characters"));
    }

    let version =
        root.get("version").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    if version.is_some_and(|v| v.chars().count() > MAX_VERSION_LEN) {
        return Err(format!("`version` is longer than {MAX_VERSION_LEN} characters"));
    }

    Ok(SanitizedTheme {
        id: id.to_string(),
        name: name.to_string(),
        version: version.map(str::to_string),
        colors: WireColors {
            foreground: want_color(source, "foreground")?,
            background: want_color(source, "background")?,
            cursor: want_color(source, "cursor")?,
            ansi: want_palette(source)?,
        },
    })
}

/// Replace `<id>.json` with `encoded`, creating the directory if needed.
///
/// Write-then-rename in the same directory. `rename` is atomic within a
/// filesystem, so a reader never sees a half-written theme and an interrupted
/// install leaves the previous one in place rather than a truncated one.
fn write_theme(dir: &Path, id: &str, encoded: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let final_path = dir.join(format!("{id}.json"));
    let tmp_path = dir.join(format!(".{id}.json.tmp"));
    std::fs::write(&tmp_path, encoded).map_err(|e| format!("could not write theme: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("could not install theme: {e}"));
    }
    Ok(final_path)
}

/// Encode and store a sanitized theme.
///
/// Failures come back as a message rather than a `Response` so the error type
/// stays small; every one of them is a 500, which the caller applies.
fn store_theme(theme: &SanitizedTheme) -> Result<PathBuf, String> {
    let encoded =
        serde_json::to_vec_pretty(theme).map_err(|e| format!("could not encode theme: {e}"))?;
    let path = write_theme(&themes_dir(), &theme.id, &encoded)?;
    tracing::info!(id = %theme.id, path = %path.display(), "installed theme");
    Ok(path)
}

// `Deserialize` is here so the endpoint tests can read the response back
// through the same shape the frontend sees.
#[derive(Serialize, serde::Deserialize)]
pub struct ThemeFile {
    /// Filename stem, which is also the id used by the delete route and by an
    /// `installed` theme selection. Stable in a way the file's own contents are
    /// not: a hand-dropped file need not carry an `id` field at all.
    pub file: String,
    /// Raw file contents, `.json` or `.conf`. The frontend sniffs and validates
    /// it, keeping the format rules in one place rather than duplicating them
    /// in Rust.
    pub body: String,
}

/// `GET /api/themes` — every readable, plausibly-named theme file.
///
/// A missing directory is not an error: it means no themes are installed.
/// Unreadable or oversized entries are skipped rather than failing the request,
/// so one bad file cannot hide the themes that are fine.
pub async fn get_themes() -> Response {
    let dir = themes_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return axum::Json(Vec::<ThemeFile>::new()).into_response();
    };

    // (id, extension rank, body) — rank keeps the dedup below deterministic.
    let mut found: Vec<(String, usize, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let Some(rank) =
            THEME_EXTENSIONS.iter().position(|candidate| extension.eq_ignore_ascii_case(candidate))
        else {
            continue;
        };
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // The filename is what makes the id a path component, so validate it
        // before anything else touches the path.
        if !is_valid_theme_id(stem) {
            tracing::warn!(file = %path.display(), "skipping theme file with invalid id");
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_THEME_BYTES {
            tracing::warn!(file = %path.display(), "skipping oversized theme file");
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(body) => found.push((stem.to_string(), rank, body)),
            Err(e) => tracing::warn!(file = %path.display(), %e, "skipping unreadable theme file"),
        }
    }

    // One id, one theme: a `.json` installed through the route wins over a
    // hand-dropped `.conf` of the same name, and the order is stable so the
    // settings list does not reshuffle per request.
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    found.dedup_by(|a, b| a.0 == b.0);

    let files: Vec<ThemeFile> =
        found.into_iter().map(|(file, _, body)| ThemeFile { file, body }).collect();

    // `Json` sets the content type; the explicit no-cache is because the
    // settings list must reflect a theme the user just installed.
    ([(header::CACHE_CONTROL, "no-cache")], axum::Json(files)).into_response()
}

/// `POST /api/themes?file=<name>` — install or replace one theme file.
///
/// The body is the theme itself, so a browser can post a picked `File` straight
/// through (`fetch(url, { method: 'POST', body: text })`) and a script can post
/// a JSON string. Multipart would buy nothing here — there is exactly one part
/// — and would make every caller build a `FormData`.
///
/// `file` is only a fallback for a theme that omits `id`; the theme's own id
/// wins when it has one, so a file may be renamed freely.
pub async fn post_theme(Query(params): Query<InstallQuery>, body: Bytes) -> Response {
    let Ok(text) = std::str::from_utf8(&body) else {
        return bad_request("theme file must be UTF-8");
    };
    // Strip any directory component a client may have sent, and the extension
    // the user's picker reported. `is_valid_theme_id` rejects separators
    // anyway, but taking the basename first gives a clearer error than
    // "invalid theme id `../dracula`".
    let fallback = params.file.as_deref().map(theme_id_from_filename).unwrap_or_default();

    let theme = match sanitize_theme(text, &fallback) {
        Ok(theme) => theme,
        Err(e) => return bad_request(e),
    };

    match store_theme(&theme) {
        Ok(_) => axum::Json(json!({ "id": theme.id, "name": theme.name })).into_response(),
        Err(e) => server_error(e),
    }
}

/// `DELETE /api/themes/:id` — remove an installed theme.
///
/// Removing a theme that is not installed is a success, not a 404: the caller's
/// intent ("this theme should not be here") is satisfied either way, and a
/// retried request must not fail.
pub async fn delete_theme(AxumPath(id): AxumPath<String>) -> Response {
    // The id arrives from the path, so it is the one place a traversal could be
    // attempted. Reject before touching the filesystem.
    if !is_valid_theme_id(&id) {
        return bad_request("invalid theme id");
    }

    let dir = themes_dir();
    let mut removed = false;
    // Both extensions, since an id names a theme rather than a file — a
    // hand-dropped `.conf` and an installed `.json` are the same theme.
    for extension in THEME_EXTENSIONS {
        match std::fs::remove_file(dir.join(format!("{id}.{extension}"))) {
            Ok(()) => removed = true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return server_error(format!("could not remove theme: {e}")),
        }
    }

    if removed {
        tracing::info!(id = %id, "removed theme");
    }
    axum::Json(json!({ "id": id })).into_response()
}

/// The configured theme registry, if any. See [`DEFAULT_REGISTRY_URL`].
fn registry_url() -> Option<String> {
    std::env::var("DINOTTY_THEMES_REGISTRY_URL")
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .or_else(|| {
            let fallback = DEFAULT_REGISTRY_URL.trim();
            (!fallback.is_empty()).then(|| fallback.to_string())
        })
}

/// One entry in a registry document, on the wire and in our response.
///
/// `sha256` is read but never echoed: verifying it is the server's job, and
/// handing it to a client that cannot check it would only invite the client to
/// pretend it had.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegistryTheme {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    pub url: String,
    #[serde(default, skip_serializing)]
    pub sha256: Option<String>,
}

#[derive(Deserialize)]
struct RegistryIndex {
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    themes: Vec<RegistryTheme>,
}

/// Fetch a remote document, refusing to buffer more than `max` bytes.
///
/// Read as a chunk stream rather than `bytes()` so the cap holds while the body
/// is arriving; a `Content-Length` check alone is advisory, since a server may
/// omit it or lie about it.
async fn fetch_bytes(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;
    let mut resp =
        client.get(url).send().await.map_err(|e| format!("could not reach {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url} answered HTTP {}", resp.status()));
    }

    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("could not read {url}: {e}"))? {
        if body.len() as u64 + chunk.len() as u64 > max {
            return Err(format!("{url} is larger than {}KB", max / 1024));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Parse a registry document. Split from the fetch so the schema rules can be
/// tested without a server.
fn parse_registry(url: &str, text: &str) -> Result<Vec<RegistryTheme>, String> {
    let index: RegistryIndex =
        serde_json::from_str(text).map_err(|e| format!("{url} is not a registry document: {e}"))?;
    if index.schema != REGISTRY_SCHEMA {
        return Err(format!(
            "{url} announces schema {} (this build understands {REGISTRY_SCHEMA})",
            index.schema
        ));
    }
    Ok(index.themes)
}

/// Fetch and parse the configured registry.
async fn fetch_registry(url: &str) -> Result<Vec<RegistryTheme>, String> {
    let body = fetch_bytes(url, MAX_REGISTRY_BYTES).await?;
    let text = std::str::from_utf8(&body).map_err(|_| format!("{url} is not UTF-8"))?;
    parse_registry(url, text)
}

/// Whether an entry can be offered at all: a usable id and an http(s) URL.
fn is_offered(entry: &RegistryTheme) -> bool {
    is_valid_theme_id(&entry.id)
        && (entry.url.starts_with("https://") || entry.url.starts_with("http://"))
}

/// `GET /api/themes/registry` — the configured registry, or a "not configured"
/// answer.
///
/// Unset is a `200` with `configured: false`, not an error: shipping with the
/// store switched off is the normal state, and the UI renders a hint rather
/// than a failure. A registry that *is* configured but unreachable is a real
/// error and says so.
pub async fn get_theme_registry() -> Response {
    let Some(url) = registry_url() else {
        return axum::Json(json!({ "configured": false, "themes": [] })).into_response();
    };

    match fetch_registry(&url).await {
        Ok(themes) => {
            // An entry we would refuse to install is not worth showing; log the
            // drop rather than silently shrinking the list.
            let offered: Vec<RegistryTheme> = themes
                .into_iter()
                .filter(|entry| {
                    let usable = is_offered(entry);
                    if !usable {
                        tracing::warn!(id = %entry.id, "skipping unusable theme registry entry");
                    }
                    usable
                })
                .collect();
            axum::Json(json!({
                "configured": true,
                "url": url,
                "schema": REGISTRY_SCHEMA,
                "themes": offered,
            }))
            .into_response()
        }
        Err(e) => bad_gateway(e),
    }
}

/// `POST /api/themes/install/:id` — install a theme the registry lists.
///
/// The theme id is the only thing the client chooses; the URL comes from the
/// registry, which the operator configured. That is deliberate — taking a URL
/// from the request would turn this route into a request forwarder for anything
/// the server can reach.
///
/// `sha256` is checked when the entry carries one. It is the only integrity
/// guarantee between the registry and here, so a mismatch refuses the install
/// rather than warning: half a theme is worse than none.
pub async fn install_registry_theme(AxumPath(id): AxumPath<String>) -> Response {
    let Some(registry) = registry_url() else {
        return bad_request("no theme registry is configured");
    };
    if !is_valid_theme_id(&id) {
        return bad_request("invalid theme id");
    }

    let themes = match fetch_registry(&registry).await {
        Ok(themes) => themes,
        Err(e) => return bad_gateway(e),
    };
    let Some(entry) = themes.into_iter().find(|entry| entry.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(json!({ "error": format!("`{id}` is not in the registry") })),
        )
            .into_response();
    };
    if !is_offered(&entry) {
        return bad_request(format!("`{id}` is not installable from this registry"));
    }

    let bytes = match fetch_bytes(&entry.url, MAX_THEME_BYTES).await {
        Ok(bytes) => bytes,
        Err(e) => return bad_gateway(e),
    };
    if let Some(expected) = entry.sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let actual = sha256_hex(&bytes);
        if !actual.eq_ignore_ascii_case(expected) {
            return bad_request(format!(
                "sha256 mismatch for `{id}`: expected {expected}, got {actual}"
            ));
        }
    }

    let Ok(text) = std::str::from_utf8(&bytes) else {
        return bad_request("theme file must be UTF-8");
    };
    let mut theme = match sanitize_theme(text, &entry.id) {
        Ok(theme) => theme,
        Err(e) => return bad_request(e),
    };
    // The registry's id is what the client asked for and what the delete route
    // will be given, so it is authoritative over whatever the file calls itself.
    theme.id.clone_from(&entry.id);
    // A registry that names the theme gets to say what it is called; one that
    // leaves the name blank keeps the file's own.
    let registry_name = entry.name.trim();
    if !registry_name.is_empty() {
        theme.name = registry_name.to_string();
    }

    match store_theme(&theme) {
        Ok(_) => axum::Json(json!({ "id": theme.id, "name": theme.name })).into_response(),
        Err(e) => server_error(e),
    }
}

/// Lowercase hex SHA-256. The digest is not a secret, so a plain comparison is
/// enough — this is a corruption check, not a MAC.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;

    let mut out = String::with_capacity(64);
    for byte in Sha256::digest(bytes) {
        // Writing to a `String` cannot fail, so the result is deliberately
        // discarded rather than propagated.
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16-colour palette, distinct per slot so a shifted entry is visible.
    fn palette() -> Value {
        Value::Array(
            (0..16)
                .map(|i| Value::String(format!("#{:02x}{:02x}{:02x}", i * 17, i * 17, i * 17)))
                .collect(),
        )
    }

    /// A complete, valid theme document.
    ///
    /// `nested` puts the colours under `colors` (the `SavedTheme` shape, i.e.
    /// what this app's own export looks like) instead of at the root. `extra`
    /// is merged over the top, which is how the individual tests break exactly
    /// one thing at a time.
    fn theme(nested: bool, extra: Value) -> String {
        let colors = json!({
            "foreground": "#ffffff",
            "background": "#000000",
            "cursor": "#ffffff",
            "ansi": palette(),
        })
        .as_object()
        .unwrap()
        .clone();

        let mut root = serde_json::Map::new();
        if nested {
            root.insert("colors".to_string(), Value::Object(colors));
        } else {
            root.extend(colors);
        }
        root.extend(extra.as_object().unwrap().clone());
        serde_json::to_string(&Value::Object(root)).unwrap()
    }

    /// A theme with a field deleted, to prove the field is actually required.
    fn theme_without(field: &str) -> String {
        let mut value: Value =
            serde_json::from_str(&theme(false, json!({"id": "sample"}))).unwrap();
        value.as_object_mut().unwrap().remove(field);
        serde_json::to_string(&value).unwrap()
    }

    fn refuse(body: &str) -> String {
        sanitize_theme(body, "sample").unwrap_err()
    }

    #[test]
    fn accepts_ordinary_theme_ids() {
        for id in ["dracula-soft", "catppuccin-mocha", "nord", "tokyo-night-storm"] {
            assert!(is_valid_theme_id(id), "{id} should be valid");
        }
    }

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        for id in [
            "",
            "a",
            "en-",
            "-en",
            "a--b",
            "../etc/passwd",
            "a/b",
            "a\\b",
            "dracula.soft",
            "dracula_soft",
            "..",
            ".../x",
        ] {
            assert!(!is_valid_theme_id(id), "{id} should be rejected");
        }
        assert!(!is_valid_theme_id(&"x".repeat(MAX_ID_LEN + 1)));
    }

    /// The frontend's `normalizeColor` accepts a bare value, so this must too —
    /// otherwise a theme the UI accepted would be refused by the server.
    #[test]
    fn a_colour_is_normalised_the_way_the_frontend_normalises_it() {
        assert_eq!(normalize_hex("#ABCDEF"), Some("#abcdef".to_string()));
        assert_eq!(normalize_hex("abcdef"), Some("#abcdef".to_string()));
        assert_eq!(normalize_hex("  #abc  "), Some("#aabbcc".to_string()));
        assert_eq!(normalize_hex("#FFF"), Some("#ffffff".to_string()));
    }

    #[test]
    fn refuses_colours_that_are_not_hex() {
        for value in ["", "#", "zzzzzz", "#12345", "#1234567", "rgb(1,2,3)", "#12g456", "白色"] {
            assert_eq!(normalize_hex(value), None, "{value} should be rejected");
        }
    }

    #[test]
    fn a_filename_is_reduced_to_its_id() {
        assert_eq!(theme_id_from_filename("dracula-soft.json"), "dracula-soft");
        assert_eq!(theme_id_from_filename("Dracula-Soft.CONF"), "Dracula-Soft");
        assert_eq!(theme_id_from_filename("C:\\fakepath\\nord.json"), "nord");
        assert_eq!(theme_id_from_filename("/tmp/nord.conf"), "nord");
        assert_eq!(theme_id_from_filename("nord"), "nord");
    }

    /// The property that matters is what would land on disk, not how it got
    /// there: `sanitize_theme` rebuilds from known fields, so a prototype key
    /// has nowhere to survive. This is the regression guard for that — it would
    /// fail the day someone started forwarding unrecognised keys.
    #[test]
    fn a_theme_carrying_prototype_keys_is_rebuilt_without_them() {
        let poisoned = theme(
            true,
            json!({
                "__proto__": {"polluted": true},
                "constructor": "x",
                "name": "Poisoned",
            }),
        );
        // The nested object needs the poison too, which `extra` cannot reach.
        let mut value: Value = serde_json::from_str(&poisoned).unwrap();
        value["colors"]["__proto__"] = json!({"polluted": true});
        value["colors"]["prototype"] = json!("y");

        let theme = sanitize_theme(&serde_json::to_string(&value).unwrap(), "poisoned")
            .expect("should sanitize");
        let wire = serde_json::to_string(&theme).unwrap();

        assert!(!wire.contains("__proto__"), "still carries __proto__: {wire}");
        assert!(!wire.contains("prototype"));
        assert!(!wire.contains("polluted"));
        // The real content survived, so this is a rebuild and not a rejection.
        assert_eq!(theme.name, "Poisoned");
        assert_eq!(theme.colors.ansi[1], "#111111");
    }

    #[test]
    fn structural_failures_are_refused_with_a_reason() {
        for (body, expected) in [
            ("not json".to_string(), "invalid JSON"),
            ("[]".to_string(), "must be a JSON object"),
            ("{}".to_string(), "missing `foreground`"),
            (theme(false, json!({"colors": 5})), "`colors` must be an object"),
            (theme(false, json!({"ansi": "x"})), "`ansi` must be an array"),
            (theme(false, json!({"foreground": 5})), "`foreground` must be a string"),
        ] {
            let error = refuse(&body);
            assert!(error.contains(expected), "body {body}: expected {expected:?}, got {error:?}");
        }
    }

    #[test]
    fn a_missing_colour_is_refused_by_name() {
        for field in ["foreground", "background", "cursor", "ansi"] {
            let error = refuse(&theme_without(field));
            assert!(error.contains(field), "removing {field} gave {error:?}");
        }
    }

    /// Half a palette would render, but with the terminal's defaults in the
    /// other half — which is not the theme the author shipped.
    #[test]
    fn a_palette_that_is_not_sixteen_colours_is_refused() {
        let full = palette();
        let full = full.as_array().unwrap();
        for count in [0, 15, 17] {
            // Cycled rather than truncated, so 17 really is 17 entries.
            let slots: Vec<Value> = (0..count).map(|i| full[i % full.len()].clone()).collect();
            let body = theme(false, json!({ "ansi": Value::Array(slots) }));
            let error = refuse(&body);
            assert!(error.contains("exactly 16"), "{count} colours gave {error:?}");
        }
    }

    #[test]
    fn a_bad_colour_is_refused_rather_than_repaired() {
        assert!(refuse(&theme(false, json!({"foreground": "#zzzzzz"})))
            .contains("invalid `foreground`"));
        assert!(refuse(&theme(false, json!({"background": "rgb(0,0,0)"})))
            .contains("invalid `background`"));

        let mut slots = palette().as_array().unwrap().clone();
        slots[7] = json!("nope");
        let error = refuse(&theme(false, json!({ "ansi": Value::Array(slots) })));
        assert!(error.contains("invalid palette 7"), "got {error:?}");
    }

    #[test]
    fn colours_may_sit_at_the_root_or_under_colors() {
        let flat = theme(false, json!({"name": "Flat"}));
        let nested = theme(true, json!({"name": "Nested"}));

        assert_eq!(sanitize_theme(&flat, "sample").unwrap().name, "Flat");
        assert_eq!(sanitize_theme(&nested, "sample").unwrap().name, "Nested");
    }

    #[test]
    fn the_id_falls_back_to_the_filename_only_when_absent() {
        let body = theme(false, json!({"name": "No Id"}));

        assert_eq!(sanitize_theme(&body, "from-file").unwrap().id, "from-file");
        // An empty fallback is not a valid id, so the theme is refused rather
        // than written to a name-less file.
        assert!(sanitize_theme(&body, "").unwrap_err().contains("invalid theme id"));
    }

    #[test]
    fn a_name_that_is_absent_falls_back_to_the_id() {
        let theme = sanitize_theme(&theme(false, json!({"id": "named"})), "sample").unwrap();
        assert_eq!(theme.name, "named");
    }

    #[test]
    fn an_oversized_body_is_refused() {
        let huge =
            theme(false, json!({"name": "x".repeat(usize::try_from(MAX_THEME_BYTES).unwrap())}));
        assert!(refuse(&huge).contains("larger than"));
    }

    #[test]
    fn a_name_or_version_that_is_too_long_is_refused() {
        let long_name = theme(false, json!({"name": "n".repeat(MAX_NAME_LEN + 1)}));
        assert!(refuse(&long_name).contains("longer than"));

        let long_version = theme(false, json!({"version": "1".repeat(MAX_VERSION_LEN + 1)}));
        assert!(refuse(&long_version).contains("`version` is longer than"));
    }

    #[test]
    fn a_digest_is_the_lowercase_hex_sha256_of_the_bytes() {
        // The published SHA-256 of "abc".
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_registry_entry_needs_a_usable_id_and_an_http_url() {
        let entry = |id: &str, url: &str| RegistryTheme {
            id: id.to_string(),
            name: String::new(),
            version: None,
            min_app_version: None,
            url: url.to_string(),
            sha256: None,
        };

        assert!(is_offered(&entry("dracula-soft", "https://example.com/a.json")));
        assert!(is_offered(&entry("dracula-soft", "http://example.com/a.json")));
        assert!(!is_offered(&entry("../evil", "https://example.com/a.json")));
        assert!(!is_offered(&entry("dracula-soft", "file:///etc/passwd")));
        assert!(!is_offered(&entry("dracula-soft", "ftp://example.com/a.json")));
    }

    /// The registry wire format is camelCase and carries `sha256`, which must
    /// not be echoed to a client that cannot check it.
    #[test]
    fn registry_entries_parse_but_do_not_leak_the_digest() {
        let document = json!({
            "schema": 1,
            "themes": [{
                "id": "dracula-soft",
                "name": "Dracula Soft",
                "version": "1.0.0",
                "minAppVersion": "0.28.0",
                "url": "https://example.com/d.json",
                "sha256": "deadbeef",
            }],
        });

        let index: RegistryIndex = serde_json::from_value(document).unwrap();
        assert_eq!(index.schema, REGISTRY_SCHEMA);

        let entry = &index.themes[0];
        assert_eq!(entry.min_app_version.as_deref(), Some("0.28.0"));
        assert_eq!(entry.sha256.as_deref(), Some("deadbeef"));

        let echoed = serde_json::to_value(entry).unwrap();
        assert_eq!(echoed["minAppVersion"], "0.28.0");
        assert!(echoed.get("sha256").is_none(), "digest must not be echoed: {echoed}");
    }

    /// A registry announcing a schema this build does not know is refused
    /// rather than read hopefully — its entries might mean something else.
    #[test]
    fn a_registry_with_an_unknown_schema_is_refused() {
        let error = parse_registry("https://example.com/r.json", r#"{"schema":2,"themes":[]}"#)
            .unwrap_err();
        assert!(error.contains("schema 2"), "got {error:?}");

        // Absent is not a version we can trust either.
        assert!(parse_registry("https://example.com/r.json", r#"{"themes":[]}"#).is_err());
        assert!(parse_registry("https://example.com/r.json", "not json").is_err());
    }

    /// A registry that omits an entry's optional fields still parses; only the
    /// id and url are load-bearing.
    #[test]
    fn a_registry_entry_only_needs_an_id_and_a_url() {
        let document = json!({
            "schema": 1,
            "themes": [{"id": "nord", "url": "https://example.com/n.json"}],
        });

        let index: RegistryIndex = serde_json::from_value(document).unwrap();
        assert_eq!(index.themes.len(), 1);
        assert_eq!(index.themes[0].name, "");
        assert!(index.themes[0].version.is_none());
    }
}

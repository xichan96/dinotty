//! Endpoint-level tests for the theme-file routes.
//!
//! These write into a real `config_dir()/themes` directory, isolated from the
//! user's own config by `DINOTTY_CONFIG_SUFFIX`.

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;

use crate::settings::themes::InstallQuery;
use crate::settings::{
    delete_theme, get_theme_registry, get_themes, install_registry_theme, post_theme, themes_dir,
    ThemeFile,
};

/// Isolates these tests from the user's real config directory. Named after this
/// feature so a stray directory is obvious.
const TEST_SUFFIX: &str = "-themes-endpoints-tests";

/// Point `config_dir()` at a scratch directory, clear the registry setting, and
/// start from a clean slate.
fn scratch_dir() -> (crate::test_support::EnvGuard, std::path::PathBuf) {
    let env = crate::test_support::EnvGuard::new(&[
        "DINOTTY_CONFIG_SUFFIX",
        "DINOTTY_THEMES_REGISTRY_URL",
    ]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", TEST_SUFFIX);
    // A stray value from the developer's shell would turn the "unconfigured"
    // tests into network calls.
    std::env::remove_var("DINOTTY_THEMES_REGISTRY_URL");
    let dir = themes_dir();
    let _ = std::fs::remove_dir_all(&dir);
    (env, dir)
}

/// `count` distinct valid colours, as a JSON array.
fn palette_json_n(count: usize) -> String {
    let slots: Vec<String> =
        (0..count).map(|i| format!("\"#{:02x}{:02x}{:02x}\"", i * 17, i * 17, i * 17)).collect();
    format!("[{}]", slots.join(","))
}

fn palette_json() -> String {
    palette_json_n(16)
}

fn quoted(value: &str) -> String {
    format!("\"{value}\"")
}

/// A theme document built from exactly the fields given.
///
/// Composing rather than string-surgery (deleting a substring) is what lets a
/// test leave one field out *without* also leaving a trailing comma — which
/// would make the document fail as malformed JSON rather than as a missing
/// field, i.e. pass the test for the wrong reason.
fn body_with(fields: &[(&str, String)]) -> String {
    let pairs: Vec<String> =
        fields.iter().map(|(key, value)| format!("\"{key}\":{value}")).collect();
    format!("{{{}}}", pairs.join(","))
}

/// A complete, valid theme with the given name.
fn theme_body(name: &str) -> String {
    body_with(&[
        ("name", quoted(name)),
        ("foreground", quoted("#ffffff")),
        ("background", quoted("#000000")),
        ("cursor", quoted("#ffffff")),
        ("ansi", palette_json()),
    ])
}

/// The same theme in Ghostty's format, which is what "Export theme" writes.
fn conf_body(name: &str) -> String {
    let mut lines = vec![
        format!("# name = {name}"),
        "foreground = #ffffff".to_string(),
        "background = #000000".to_string(),
        "cursor-color = #ffffff".to_string(),
    ];
    for index in 0..16 {
        lines.push(format!(
            "palette = {index}=#{:02x}{:02x}{:02x}",
            index * 17,
            index * 17,
            index * 17
        ));
    }
    lines.join("\n")
}

fn write_theme_file(dir: &std::path::Path, name: &str, body: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join(name), body).unwrap();
}

async fn read_themes() -> (StatusCode, Vec<ThemeFile>) {
    let response = get_themes().await.into_response();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

/// Install a theme the way the frontend does, returning the status and the
/// decoded body (which is `{"error": ...}` on rejection).
async fn install(body: &str, file: Option<&str>) -> (StatusCode, serde_json::Value) {
    let query = Query(InstallQuery { file: file.map(str::to_string) });
    let response = post_theme(query, axum::body::Bytes::from(body.to_string())).await;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn uninstall(id: &str) -> StatusCode {
    delete_theme(Path(id.to_string())).await.into_response().status()
}

async fn install_from_registry(id: &str) -> StatusCode {
    install_registry_theme(Path(id.to_string())).await.into_response().status()
}

async fn read_registry() -> (StatusCode, serde_json::Value) {
    let response = get_theme_registry().await.into_response();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

/// The bytes actually on disk, which is what the read path will serve later.
fn stored(id: &str) -> String {
    std::fs::read_to_string(themes_dir().join(format!("{id}.json"))).unwrap()
}

/// A throwaway HTTP server, aborted when the test ends.
///
/// The registry is fetched by URL, so exercising it for real means a real
/// listener — the same shape `tests/remote_servers.rs` uses.
struct TestServer {
    task: tokio::task::JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TestServer {
    fn spawn(listener: tokio::net::TcpListener, app: axum::Router) -> Self {
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self { task }
    }

    /// Serve `document` at `/registry.json`. Returns the server (keep it alive
    /// for the test's duration) and the registry URL to point the setting at.
    async fn registry_index(document: String) -> (Self, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new().route(
            "/registry.json",
            get(move || {
                let body = document.clone();
                async move { body }
            }),
        );
        (Self::spawn(listener, app), format!("{origin}/registry.json"))
    }

    /// Serve an index listing one `nord` entry — with `entry_extra` appended,
    /// so a test can add a `sha256` — plus the theme file it points at.
    async fn registry_with(theme: String, entry_extra: &str) -> (Self, String) {
        // Bind first: the index has to name the theme's own address.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let index = format!(
            r#"{{"schema":1,"themes":[{{"id":"nord","name":"Registry Nord","url":"{origin}/nord.json"{entry_extra}}}]}}"#
        );

        let app = axum::Router::new()
            .route(
                "/registry.json",
                get(move || {
                    let body = index.clone();
                    async move { body }
                }),
            )
            .route(
                "/nord.json",
                get(move || {
                    let body = theme.clone();
                    async move { body }
                }),
            );
        (Self::spawn(listener, app), format!("{origin}/registry.json"))
    }
}

/// Computed here rather than borrowed from the module under test, so the check
/// is not self-confirming.
fn sha256_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;

    let mut out = String::with_capacity(64);
    for byte in Sha256::digest(bytes) {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

// ---------------------------------------------------------------------------
// GET /api/themes — the read path.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn missing_directory_is_an_empty_list_not_an_error() {
    let (_env, _dir) = scratch_dir();
    // No themes installed is the normal first-run state, not a failure.
    let (status, files) = read_themes().await;
    assert_eq!(status, StatusCode::OK);
    assert!(files.is_empty());
}

#[tokio::test]
async fn reads_every_theme_in_a_deterministic_order() {
    let (_env, dir) = scratch_dir();
    // Written out of order so the assertion below is about sorting, not luck.
    write_theme_file(&dir, "nord.json", &theme_body("Nord"));
    write_theme_file(&dir, "dracula-soft.json", &theme_body("Dracula Soft"));

    let (status, files) = read_themes().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["dracula-soft", "nord"]);
    assert!(files[0].body.contains("Dracula Soft"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// `.conf` is what this app's own "Export theme" writes, so a user who exports
/// a theme and drops it back into the directory must see it listed.
#[tokio::test]
async fn reads_ghostty_conf_files_too() {
    let (_env, dir) = scratch_dir();
    write_theme_file(&dir, "my-theme.conf", &conf_body("My Ghostty Theme"));

    let (status, files) = read_themes().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["my-theme"]);
    // Handed over verbatim: the frontend sniffs the format, the server does not.
    assert!(files[0].body.contains("# name = My Ghostty Theme"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// An id names a theme, not a file, so two files claiming one id must not
/// produce two entries — and the installed `.json` wins over a dropped `.conf`.
#[tokio::test]
async fn one_id_yields_one_theme_preferring_json() {
    let (_env, dir) = scratch_dir();
    write_theme_file(&dir, "nord.conf", &conf_body("From Conf"));
    write_theme_file(&dir, "nord.json", &theme_body("From Json"));

    let (_, files) = read_themes().await;
    assert_eq!(files.len(), 1, "both extensions must collapse to one theme");
    assert!(files[0].body.contains("From Json"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_names_that_are_not_valid_ids() {
    let (_env, dir) = scratch_dir();
    // The filename stem becomes a path component, so anything that is not a
    // plausible id is skipped before the path is touched.
    write_theme_file(&dir, "dracula_soft.json", &theme_body("Underscore"));
    write_theme_file(&dir, "bad name.json", &theme_body("Space"));
    write_theme_file(&dir, "nord.json", &theme_body("Nord"));

    let (_, files) = read_themes().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["nord"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_files_that_are_not_themes() {
    let (_env, dir) = scratch_dir();
    write_theme_file(&dir, "README.md", "not a theme");
    write_theme_file(&dir, "nord.txt", "not a theme");
    write_theme_file(&dir, "nord.json", &theme_body("Nord"));

    let (_, files) = read_themes().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["nord"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_directories_even_when_named_like_a_theme() {
    let (_env, dir) = scratch_dir();
    write_theme_file(&dir, "nord.json", &theme_body("Nord"));
    std::fs::create_dir_all(dir.join("dracula.json")).unwrap();

    let (_, files) = read_themes().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["nord"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_an_oversized_theme_without_failing_the_request() {
    let (_env, dir) = scratch_dir();
    // One bad file must not hide the themes that are fine.
    write_theme_file(&dir, "huge.json", &"x".repeat(80 * 1024));
    write_theme_file(&dir, "nord.json", &theme_body("Nord"));

    let (status, files) = read_themes().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["nord"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn returns_invalid_json_verbatim_for_the_frontend_to_reject() {
    let (_env, dir) = scratch_dir();
    // Validation lives in one place (the frontend). The route reads bytes, it
    // does not judge their contents — which is what lets a `.conf` through.
    write_theme_file(&dir, "nord.json", "{ this is not json");

    let (status, files) = read_themes().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].body, "{ this is not json");

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// POST /api/themes — the write path.
//
// This revalidates rather than trusting the client, so most of these tests are
// about what it refuses.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn installing_a_theme_makes_it_readable() {
    let (_env, dir) = scratch_dir();

    let (status, body) = install(&theme_body("Dracula Soft"), Some("dracula-soft.json")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], "dracula-soft");
    assert_eq!(body["name"], "Dracula Soft");

    let (_, files) = read_themes().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["dracula-soft"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn replacing_a_theme_overwrites_it() {
    let (_env, dir) = scratch_dir();
    install(&theme_body("First"), Some("nord.json")).await;
    install(&theme_body("Second"), Some("nord.json")).await;

    let (_, files) = read_themes().await;
    assert_eq!(files.len(), 1, "a re-install must replace, not duplicate");
    assert!(files[0].body.contains("Second"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// The theme's own id wins over the filename, so a file can be renamed freely.
#[tokio::test]
async fn the_theme_id_wins_over_the_filename() {
    let (_env, dir) = scratch_dir();
    let body = body_with(&[
        ("id", quoted("nord")),
        ("name", quoted("Nord")),
        ("foreground", quoted("#ffffff")),
        ("background", quoted("#000000")),
        ("cursor", quoted("#ffffff")),
        ("ansi", palette_json()),
    ]);
    install(&body, Some("something-else.json")).await;

    let (_, files) = read_themes().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["nord"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_filename_is_used_when_the_theme_has_no_id() {
    let (_env, dir) = scratch_dir();
    let (status, body) = install(&theme_body("Anonymous"), Some("nord.json")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], "nord");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A client that posts without running the frontend validator, or a malicious
/// one, must not be able to write something the read path will later hand to a
/// browser as-is. The theme is rebuilt, not forwarded.
#[tokio::test]
async fn a_poisoned_theme_is_stored_without_the_poison() {
    let (_env, dir) = scratch_dir();

    let body = body_with(&[
        ("__proto__", "{\"polluted\":true}".to_string()),
        ("constructor", quoted("x")),
        ("prototype", quoted("y")),
        ("name", quoted("Poisoned")),
        ("foreground", quoted("#ffffff")),
        ("background", quoted("#000000")),
        ("cursor", quoted("#ffffff")),
        ("ansi", palette_json()),
    ]);
    let (status, _) = install(&body, Some("poisoned.json")).await;
    assert_eq!(status, StatusCode::OK);

    // The real assertion: the bytes on disk are clean, so every future reader
    // is safe regardless of how it parses them.
    let on_disk = stored("poisoned");
    assert!(!on_disk.contains("__proto__"), "stored theme still carries __proto__: {on_disk}");
    assert!(!on_disk.contains("constructor"));
    assert!(!on_disk.contains("prototype"));
    assert!(!on_disk.contains("polluted"));
    assert!(on_disk.contains("Poisoned"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn malformed_requests_are_refused_with_a_reason() {
    let (_env, dir) = scratch_dir();

    let color = |key: &'static str, value: &str| (key, quoted(value));
    let no_foreground = body_with(&[
        color("name", "x"),
        color("background", "#000000"),
        color("cursor", "#ffffff"),
        ("ansi", palette_json()),
    ]);
    let no_background = body_with(&[
        color("name", "x"),
        color("foreground", "#ffffff"),
        color("cursor", "#ffffff"),
        ("ansi", palette_json()),
    ]);
    let no_cursor = body_with(&[
        color("name", "x"),
        color("foreground", "#ffffff"),
        color("background", "#000000"),
        ("ansi", palette_json()),
    ]);
    let no_palette = body_with(&[
        color("name", "x"),
        color("foreground", "#ffffff"),
        color("background", "#000000"),
        color("cursor", "#ffffff"),
    ]);
    let short_palette = body_with(&[
        color("name", "x"),
        color("foreground", "#ffffff"),
        color("background", "#000000"),
        color("cursor", "#ffffff"),
        ("ansi", palette_json_n(15)),
    ]);
    let bad_hex = body_with(&[
        color("name", "x"),
        color("foreground", "#zzzzzz"),
        color("background", "#000000"),
        color("cursor", "#ffffff"),
        ("ansi", palette_json()),
    ]);

    for (body, expected) in [
        ("not json".to_string(), "invalid JSON"),
        ("[]".to_string(), "must be a JSON object"),
        ("{}".to_string(), "missing `foreground`"),
        (no_foreground, "missing `foreground`"),
        (no_background, "missing `background`"),
        (no_cursor, "missing `cursor`"),
        (no_palette, "missing `ansi`"),
        (short_palette, "exactly 16"),
        (bad_hex, "invalid `foreground`"),
    ] {
        let (status, json) = install(&body, Some("sample.json")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "body {body} should be refused");
        let error = json["error"].as_str().unwrap_or_default();
        assert!(error.contains(expected), "body {body}: expected {expected:?}, got {error:?}");
    }

    // Nothing was created: every one of these was refused before the write.
    assert!(std::fs::read_dir(&dir).map_or(true, |d| d.count() == 0));

    let _ = std::fs::remove_dir_all(&dir);
}

/// The id decides a filename, so a traversal must be unrepresentable rather
/// than merely unlikely. Every one of these is an id the client controls.
#[tokio::test]
async fn an_id_that_could_escape_the_directory_is_refused() {
    let (_env, dir) = scratch_dir();

    for id in ["../evil", "a/b", "a\\b", "dracula_soft", "..", "a", "nord-", "nord--soft", ".../x"]
    {
        let body = body_with(&[
            ("id", quoted(id)),
            ("name", quoted("Traversal")),
            ("foreground", quoted("#ffffff")),
            ("background", quoted("#000000")),
            ("cursor", quoted("#ffffff")),
            ("ansi", palette_json()),
        ]);
        let (status, json) = install(&body, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "id {id:?} should be refused");
        assert!(
            json["error"].as_str().unwrap_or_default().contains("invalid theme id"),
            "id {id:?} gave an unclear error: {json}"
        );
    }

    // Nothing was created anywhere, inside or outside the directory.
    assert!(std::fs::read_dir(&dir).map_or(true, |d| d.count() == 0));

    let _ = std::fs::remove_dir_all(&dir);
}

/// A filename carrying a directory component is *basename'd*, not rejected.
///
/// This is deliberate and load-bearing: a browser `<input type="file">` posts
/// `nord.json` as the name, but some platforms post a fake path
/// (`C:\fakepath\nord.json`). Rejecting any separator would break the real UI
/// for no gain — the basename cannot escape the directory, which is the
/// property that actually matters.
#[tokio::test]
async fn a_filename_with_a_directory_component_is_reduced_to_its_basename() {
    let (_env, dir) = scratch_dir();

    for (name, expected_id) in [
        ("../../etc/passwd.json", "passwd"),
        ("C:\\fakepath\\nord.json", "nord"),
        ("/tmp/dracula-soft.conf", "dracula-soft"),
    ] {
        let (status, body) = install(&theme_body("From A Path"), Some(name)).await;
        assert_eq!(status, StatusCode::OK, "{name} should install under its basename");
        assert_eq!(body["id"], expected_id, "{name}");
        // And it landed *inside* the directory, never beside it.
        assert!(themes_dir().join(format!("{expected_id}.json")).exists());
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_oversized_body_is_refused() {
    let (_env, dir) = scratch_dir();
    let body = theme_body(&"x".repeat(80 * 1024));
    let (status, json) = install(&body, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(json["error"].as_str().unwrap().contains("larger than"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// A body that is not UTF-8 is refused rather than lossily converted.
#[tokio::test]
async fn a_non_utf8_body_is_refused() {
    let (_env, dir) = scratch_dir();
    let response = post_theme(
        Query(InstallQuery { file: None }),
        axum::body::Bytes::from(vec![0xff, 0xfe, 0x00]),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn removing_a_theme_deletes_it() {
    let (_env, dir) = scratch_dir();
    install(&theme_body("Nord"), Some("nord.json")).await;
    assert!(themes_dir().join("nord.json").exists());

    assert_eq!(uninstall("nord").await, StatusCode::OK);
    assert!(!themes_dir().join("nord.json").exists());

    let (_, files) = read_themes().await;
    assert!(files.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

/// An id names a theme, so removing it takes the hand-dropped `.conf` as well
/// as the installed `.json`.
#[tokio::test]
async fn removing_a_theme_takes_both_extensions() {
    let (_env, dir) = scratch_dir();
    write_theme_file(&dir, "nord.conf", &conf_body("Nord"));

    assert_eq!(uninstall("nord").await, StatusCode::OK);

    let (_, files) = read_themes().await;
    assert!(files.is_empty(), "the .conf should have gone with the id");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Deleting is idempotent: the caller's intent is "this theme should not be
/// here", which is satisfied either way, and a retry must not fail.
#[tokio::test]
async fn removing_a_theme_that_is_not_installed_succeeds() {
    let (_env, _dir) = scratch_dir();
    assert_eq!(uninstall("nord").await, StatusCode::OK);
}

#[tokio::test]
async fn removing_refuses_an_id_that_could_escape_the_directory() {
    for id in ["..", "a/b", "dracula_soft"] {
        assert_eq!(uninstall(id).await, StatusCode::BAD_REQUEST, "id {id:?}");
    }
}

/// A failed install must leave the previous theme intact — the write goes to a
/// temporary file and is renamed into place only on success.
#[tokio::test]
async fn a_failed_install_leaves_the_previous_theme_intact() {
    let (_env, dir) = scratch_dir();
    install(&theme_body("Good"), Some("nord.json")).await;

    let (status, _) = install("{ this is not json", Some("nord.json")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert!(stored("nord").contains("Good"), "the good theme was damaged by a failed install");

    let _ = std::fs::remove_dir_all(&dir);
}

/// No temporary files are left behind for the read path to trip over.
#[tokio::test]
async fn a_temp_file_is_not_left_behind() {
    let (_env, dir) = scratch_dir();
    install(&theme_body("Nord"), Some("nord.json")).await;

    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with('.'))
        .collect();
    assert!(leftovers.is_empty(), "temporary files left behind: {leftovers:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

/// Shipping with the store switched off is the normal state, and must read as
/// "nothing to show" rather than as a failure.
#[tokio::test]
async fn a_registry_that_is_not_configured_is_reported_not_an_error() {
    let (_env, _dir) = scratch_dir();

    let (status, body) = read_registry().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], false);
    assert_eq!(body["themes"].as_array().unwrap().len(), 0);

    // Installing from it says why, rather than pretending the id was missing.
    assert_eq!(install_from_registry("nord").await, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_blank_registry_setting_counts_as_unconfigured() {
    let (_env, _dir) = scratch_dir();
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", "   ");

    let (status, body) = read_registry().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], false);
}

/// An entry we would refuse to install is not offered — a button that cannot
/// work is worse than one that is not there.
#[tokio::test]
async fn a_configured_registry_lists_only_installable_entries() {
    let (_env, _dir) = scratch_dir();

    let index = r#"{"schema":1,"themes":[
        {"id":"nord","name":"Nord","version":"1.0.0","url":"https://example.com/nord.json"},
        {"id":"../evil","name":"Traversal","url":"https://example.com/evil.json"},
        {"id":"nord-2","name":"No URL","url":"file:///etc/passwd"}
    ]}"#
    .to_string();
    let (_server, url) = TestServer::registry_index(index).await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    let (status, body) = read_registry().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], true);
    assert_eq!(body["url"], std::env::var("DINOTTY_THEMES_REGISTRY_URL").unwrap());

    let themes = body["themes"].as_array().unwrap();
    assert_eq!(themes.len(), 1, "got {themes:?}");
    assert_eq!(themes[0]["id"], "nord");
    assert_eq!(themes[0]["name"], "Nord");
    // The digest is the server's to check, so it is not the client's to see.
    assert!(themes[0].get("sha256").is_none());
}

#[tokio::test]
async fn installing_from_the_registry_writes_the_theme() {
    let (_env, dir) = scratch_dir();
    let (_server, url) = TestServer::registry_with(theme_body("Registry Nord"), "").await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    assert_eq!(install_from_registry("nord").await, StatusCode::OK);
    assert!(stored("nord").contains("Registry Nord"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// The digest is the only integrity guarantee between the registry and us, so
/// a mismatch refuses the install rather than warning — half a theme is worse
/// than none.
#[tokio::test]
async fn the_registry_digest_is_checked_when_given() {
    let (_env, dir) = scratch_dir();
    // A background no palette slot uses, so the assertion below can only be
    // satisfied by the *fetched* bytes having been written.
    let theme = body_with(&[
        ("name", quoted("Digested")),
        ("foreground", quoted("#ffffff")),
        ("background", quoted("#123456")),
        ("cursor", quoted("#ffffff")),
        ("ansi", palette_json()),
    ]);
    let good = sha256_of(theme.as_bytes());

    // A wrong digest is refused, and writes nothing.
    let (_bad_server, bad_url) =
        TestServer::registry_with(theme.clone(), &format!(",\"sha256\":\"{}\"", "0".repeat(64)))
            .await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", bad_url);
    assert_eq!(install_from_registry("nord").await, StatusCode::BAD_REQUEST);
    assert!(!themes_dir().join("nord.json").exists(), "a mismatched install must write nothing");

    // The matching digest installs.
    let (_good_server, good_url) =
        TestServer::registry_with(theme, &format!(",\"sha256\":\"{good}\"")).await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", good_url);
    assert_eq!(install_from_registry("nord").await, StatusCode::OK);
    assert!(stored("nord").contains("#123456"), "the fetched bytes should be what was written");

    let _ = std::fs::remove_dir_all(&dir);
}

/// The registry's `name` wins over the theme file's own.
///
/// The user picked *that entry* from a list that showed that name, so the card
/// they get has to match the card they clicked — a file whose internal name
/// disagrees must not silently rename it out from under them. (`id` behaves the
/// same way, for the same reason plus one more: it is the key the delete route
/// will later be handed.)
#[tokio::test]
async fn the_registry_name_wins_over_the_files_own() {
    let (_env, dir) = scratch_dir();
    let (_server, url) = TestServer::registry_with(theme_body("A Name Nobody Saw"), "").await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    assert_eq!(install_from_registry("nord").await, StatusCode::OK);
    assert!(stored("nord").contains("Registry Nord"));
    assert!(!stored("nord").contains("A Name Nobody Saw"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// A registry announcing a schema this build does not know is refused rather
/// than read hopefully — its entries might mean something else.
#[tokio::test]
async fn a_registry_announcing_another_schema_is_refused_not_guessed_at() {
    let (_env, _dir) = scratch_dir();

    let (_server, url) =
        TestServer::registry_index(r#"{"schema":2,"themes":[]}"#.to_string()).await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    let (status, body) = read_registry().await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body["error"].as_str().unwrap().contains("schema 2"), "got {body}");
}

#[tokio::test]
async fn an_unreachable_registry_is_reported() {
    let (_env, _dir) = scratch_dir();
    // Port 1 on loopback: nothing listens there, so the connection fails fast.
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", "http://127.0.0.1:1/registry.json");

    let (status, body) = read_registry().await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn an_id_that_is_not_in_the_registry_is_a_404() {
    let (_env, _dir) = scratch_dir();
    let (_server, url) = TestServer::registry_with(theme_body("Nord"), "").await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    assert_eq!(install_from_registry("absent").await, StatusCode::NOT_FOUND);
}

/// A traversal must be refused before the registry is even consulted.
#[tokio::test]
async fn installing_refuses_an_id_that_could_escape_the_directory() {
    let (_env, _dir) = scratch_dir();
    let (_server, url) = TestServer::registry_with(theme_body("Nord"), "").await;
    std::env::set_var("DINOTTY_THEMES_REGISTRY_URL", url);

    assert_eq!(install_from_registry("..").await, StatusCode::BAD_REQUEST);
}

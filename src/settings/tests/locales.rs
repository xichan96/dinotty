//! Endpoint-level tests for the language-pack routes.
//!
//! These write into a real `config_dir()/locales` directory, isolated from the
//! user's own config by `DINOTTY_CONFIG_SUFFIX`.

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::settings::locales::InstallQuery;
use crate::settings::{delete_locale, get_locales, locales_dir, post_locale, LocaleFile};

/// Isolates these tests from the user's real config directory. Named after this
/// feature so a stray directory is obvious.
const TEST_SUFFIX: &str = "-locales-endpoints-tests";

/// Point `config_dir()` at a scratch directory and start from a clean slate.
fn scratch_dir() -> (crate::test_support::EnvGuard, std::path::PathBuf) {
    let env = crate::test_support::EnvGuard::new(&["DINOTTY_CONFIG_SUFFIX"]);
    std::env::set_var("DINOTTY_CONFIG_SUFFIX", TEST_SUFFIX);
    let dir = locales_dir();
    let _ = std::fs::remove_dir_all(&dir);
    (env, dir)
}

async fn read_locales() -> (StatusCode, Vec<LocaleFile>) {
    let response = get_locales().await.into_response();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn write_pack(dir: &std::path::Path, name: &str, body: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join(name), body).unwrap();
}

const JA: &str = r#"{"tag":"ja","messages":{"app.settings":"設定"}}"#;
const KO: &str = r#"{"tag":"ko","messages":{"app.settings":"설정"}}"#;

/// Install a pack the way the frontend does, returning the status and the
/// decoded body (which is `{"error": ...}` on rejection).
async fn install(body: &str, file: Option<&str>) -> (StatusCode, serde_json::Value) {
    let query = Query(InstallQuery { file: file.map(str::to_string) });
    let response = post_locale(query, axum::body::Bytes::from(body.to_string())).await;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

async fn uninstall(tag: &str) -> StatusCode {
    delete_locale(Path(tag.to_string())).await.into_response().status()
}

/// The bytes actually on disk, which is what the read path will serve later.
fn stored(tag: &str) -> String {
    std::fs::read_to_string(locales_dir().join(format!("{tag}.json"))).unwrap()
}

#[tokio::test]
async fn missing_directory_is_an_empty_list_not_an_error() {
    let (_env, _dir) = scratch_dir();
    // No packs installed is the normal first-run state, not a failure.
    let (status, files) = read_locales().await;
    assert_eq!(status, StatusCode::OK);
    assert!(files.is_empty());
}

#[tokio::test]
async fn reads_every_pack_in_a_deterministic_order() {
    let (_env, dir) = scratch_dir();
    // Written out of order so the assertion below is about sorting, not luck.
    write_pack(&dir, "ko.json", KO);
    write_pack(&dir, "ja.json", JA);

    let (status, files) = read_locales().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja", "ko"]);
    assert_eq!(files[0].body, JA);
    assert_eq!(files[1].body, KO);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_names_that_are_not_valid_tags() {
    let (_env, dir) = scratch_dir();
    // The filename stem becomes a path component, so anything that is not a
    // plausible tag is skipped before the path is touched.
    write_pack(&dir, "en_US.json", JA);
    write_pack(&dir, "bad tag.json", JA);
    write_pack(&dir, "ja.json", JA);

    let (_, files) = read_locales().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_files_that_are_not_json() {
    let (_env, dir) = scratch_dir();
    write_pack(&dir, "README.md", "not a pack");
    write_pack(&dir, "ja.json", JA);

    let (_, files) = read_locales().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_directories_even_when_named_like_a_pack() {
    let (_env, dir) = scratch_dir();
    write_pack(&dir, "ja.json", JA);
    std::fs::create_dir_all(dir.join("ko.json")).unwrap();

    let (_, files) = read_locales().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn skips_an_oversized_pack_without_failing_the_request() {
    let (_env, dir) = scratch_dir();
    // One bad file must not hide the packs that are fine.
    write_pack(&dir, "huge.json", &"x".repeat(600 * 1024));
    write_pack(&dir, "ja.json", JA);

    let (status, files) = read_locales().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn returns_invalid_json_verbatim_for_the_frontend_to_reject() {
    let (_env, dir) = scratch_dir();
    // Validation lives in one place (the frontend). The route reads bytes, it
    // does not judge their contents.
    write_pack(&dir, "ja.json", "{ this is not json");

    let (status, files) = read_locales().await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].body, "{ this is not json");

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// POST /api/locales — the write path.
//
// This is the project's first route that writes a language pack, and the only
// way to install one from a phone. It revalidates rather than trusting the
// client, so most of these tests are about what it refuses.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn installing_a_pack_makes_it_readable() {
    let (_env, dir) = scratch_dir();

    let (status, body) = install(JA, Some("ja.json")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["tag"], "ja");
    assert_eq!(body["count"], 1);

    let (_, files) = read_locales().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn replacing_a_pack_overwrites_it() {
    let (_env, dir) = scratch_dir();
    install(JA, None).await;
    install(r#"{"tag":"ja","messages":{"app.settings":"設定2"}}"#, None).await;

    let (_, files) = read_locales().await;
    assert_eq!(files.len(), 1, "a re-install must replace, not duplicate");
    assert!(files[0].body.contains("設定2"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// The manifest's own tag wins over the filename, so a pack can be renamed.
#[tokio::test]
async fn the_manifest_tag_wins_over_the_filename() {
    let (_env, dir) = scratch_dir();
    install(JA, Some("something-else.json")).await;

    let (_, files) = read_locales().await;
    assert_eq!(files.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), ["ja"]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_filename_is_used_when_the_manifest_has_no_tag() {
    let (_env, dir) = scratch_dir();
    let (status, body) = install(r#"{"messages":{"app.settings":"設定"}}"#, Some("ja.json")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["tag"], "ja");

    let _ = std::fs::remove_dir_all(&dir);
}

/// A client that posts without running the frontend validator, or a malicious
/// one, must not be able to write something the read path will later hand to a
/// browser as-is. The pack is rewritten, not forwarded.
#[tokio::test]
async fn a_poisoned_pack_is_stored_without_the_poison() {
    let (_env, dir) = scratch_dir();

    let (status, _) = install(
        r#"{"tag":"ja","messages":{"__proto__":"x","constructor":"y","prototype":"z","app.settings":"設定"}}"#,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // The real assertion: the bytes on disk are clean, so every future reader
    // is safe regardless of how it parses them.
    let on_disk = stored("ja");
    assert!(!on_disk.contains("__proto__"), "stored pack still carries __proto__: {on_disk}");
    assert!(!on_disk.contains("constructor"));
    assert!(!on_disk.contains("prototype"));
    assert!(on_disk.contains("app.settings"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn non_string_message_values_are_dropped() {
    let (_env, dir) = scratch_dir();
    install(
        r#"{"tag":"ja","messages":{"a.b":"ok","a.c":42,"a.d":null,"a.e":{"n":"o"},"a.f":["x"]}}"#,
        None,
    )
    .await;

    let on_disk = stored("ja");
    assert!(on_disk.contains("a.b"));
    for dropped in ["a.c", "a.d", "a.e", "a.f"] {
        assert!(!on_disk.contains(dropped), "{dropped} should have been dropped");
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_oversized_value_is_dropped() {
    let (_env, dir) = scratch_dir();
    let huge = "x".repeat(5000);
    install(&format!(r#"{{"tag":"ja","messages":{{"a.b":"{huge}"}}}}"#), None).await;

    // Only the oversized entry was dropped, so nothing usable is left and the
    // pack is refused outright.
    assert!(!locales_dir().join("ja.json").exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_pack_with_no_usable_messages_is_refused() {
    let (_env, dir) = scratch_dir();
    let (status, body) = install(r#"{"tag":"ja","messages":{}}"#, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("no usable messages"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn malformed_requests_are_refused_with_a_reason() {
    let (_env, dir) = scratch_dir();

    for (body, expected) in [
        ("not json", "invalid JSON"),
        ("[]", "must be a JSON object"),
        (r#"{"tag":"ja"}"#, "`messages` must be an object"),
        (r#"{"tag":"ja","messages":"nope"}"#, "`messages` must be an object"),
        (r#"{"messages":{"a.b":"x"}}"#, "invalid locale tag"),
        (r#"{"tag":"ja","extends":"../evil","messages":{"a.b":"x"}}"#, "invalid `extends`"),
    ] {
        let (status, json) = install(body, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "body {body} should be refused");
        let error = json["error"].as_str().unwrap_or_default();
        assert!(error.contains(expected), "body {body}: expected {expected:?}, got {error:?}");
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// The tag decides a filename, so a traversal must be unrepresentable rather
/// than merely unlikely. Every one of these is a tag the client controls.
#[tokio::test]
async fn a_tag_that_could_escape_the_directory_is_refused() {
    let (_env, dir) = scratch_dir();

    for tag in ["../evil", "a/b", "a\\b", "en_US", "..", "a", "en-", "en--US", ".../x"] {
        let body = format!(r#"{{"tag":"{}","messages":{{"a.b":"x"}}}}"#, tag.escape_default());
        let (status, json) = install(&body, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "tag {tag:?} should be refused");
        assert!(
            json["error"].as_str().unwrap_or_default().contains("invalid locale tag"),
            "tag {tag:?} gave an unclear error: {json}"
        );
    }

    // Nothing was created anywhere, inside or outside the directory.
    assert!(std::fs::read_dir(&dir).map_or(true, |d| d.count() == 0));

    let _ = std::fs::remove_dir_all(&dir);
}

/// A filename carrying a directory component is *basename'd*, not rejected.
///
/// This is deliberate and load-bearing: a browser `<input type="file">` posts
/// `ja.json` as the name, but some platforms post a fake path
/// (`C:\fakepath\ja.json`). Rejecting any separator would break the real UI for
/// no gain — the basename cannot escape the directory, which is the property
/// that actually matters.
#[tokio::test]
async fn a_filename_with_a_directory_component_is_reduced_to_its_basename() {
    let (_env, dir) = scratch_dir();

    for (name, expected_tag) in [
        ("../../etc/passwd.json", "passwd"),
        ("C:\\fakepath\\ja.json", "ja"),
        ("/tmp/ko.json", "ko"),
    ] {
        let (status, body) = install(r#"{"messages":{"a.b":"x"}}"#, Some(name)).await;
        assert_eq!(status, StatusCode::OK, "{name} should install under its basename");
        assert_eq!(body["tag"], expected_tag, "{name}");
        // And it landed *inside* the directory, never beside it.
        assert!(locales_dir().join(format!("{expected_tag}.json")).exists());
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_oversized_body_is_refused() {
    let (_env, dir) = scratch_dir();
    let body = format!(r#"{{"tag":"ja","messages":{{"a.b":"{}"}}}}"#, "x".repeat(600 * 1024));
    let (status, json) = install(&body, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(json["error"].as_str().unwrap().contains("larger than"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn removing_a_pack_deletes_it() {
    let (_env, dir) = scratch_dir();
    install(JA, None).await;
    assert!(locales_dir().join("ja.json").exists());

    assert_eq!(uninstall("ja").await, StatusCode::OK);
    assert!(!locales_dir().join("ja.json").exists());

    let (_, files) = read_locales().await;
    assert!(files.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

/// Deleting is idempotent: the caller's intent is "this pack should not be
/// here", which is satisfied either way, and a retry must not fail.
#[tokio::test]
async fn removing_a_pack_that_is_not_installed_succeeds() {
    let (_env, _dir) = scratch_dir();
    assert_eq!(uninstall("ja").await, StatusCode::OK);
}

#[tokio::test]
async fn removing_refuses_a_tag_that_could_escape_the_directory() {
    for tag in ["..", "a/b", "en_US"] {
        assert_eq!(uninstall(tag).await, StatusCode::BAD_REQUEST, "tag {tag:?}");
    }
}

/// A failed install must leave the previous pack intact — the write goes to a
/// temporary file and is renamed into place only on success.
#[tokio::test]
async fn a_failed_install_leaves_the_previous_pack_intact() {
    let (_env, dir) = scratch_dir();
    install(JA, None).await;

    let (status, _) = install(r#"{"tag":"ja","messages":{}}"#, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert!(stored("ja").contains("設定"), "the good pack was damaged by a failed install");

    let _ = std::fs::remove_dir_all(&dir);
}

/// No temporary files are left behind for the read path to trip over.
#[tokio::test]
async fn a_temp_file_is_not_left_behind() {
    let (_env, dir) = scratch_dir();
    install(JA, None).await;

    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with('.'))
        .collect();
    assert!(leftovers.is_empty(), "temporary files left behind: {leftovers:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

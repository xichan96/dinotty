//! Guards the single assumption that both `/assets/*` caching layers rest on.
//!
//! Two independent mechanisms cache `/assets/*` **permanently**:
//!   - the server sends `Cache-Control: public, max-age=31536000, immutable`
//!   - `frontend/public/sw.js` serves that prefix cache-first, never revalidating
//!
//! Both are safe only because Vite puts a content hash in every asset filename,
//! so a URL's bytes can never change - new content means a new filename. If a
//! future build ever emits an unhashed name under `assets/` (a `rollupOptions.
//! output.*FileNames` override, or a plugin copying files in), that file becomes
//! permanently un-updatable for everyone who has already loaded it: the browser
//! and the service worker both stop asking the server about it, and no server
//! deploy can dislodge it. Clearing the site cache would not help either,
//! because the service worker's cache is a separate store.
//!
//! There is no runtime check for this - the header is applied to the whole
//! prefix unconditionally - so this test is the only thing standing between a
//! build-config change and a permanently stale asset in the field.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

fn assets_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("frontend/dist/assets")
}

/// A content hash as Rollup emits it: `name-<hash>.ext`, where `<hash>` is
/// exactly 8 chars of its base64url alphabet (so it may itself contain `-`, e.g.
/// `csp-D-4FJmMZ.js`). Anchoring on the fixed length is what lets this tell a
/// hash apart from a name segment - both contain dashes, so splitting on `-`
/// cannot decide it. Deliberately strict: the point is to reject names that
/// merely *look* versioned (`chunk-v2.js`, `vendor.js`).
fn has_content_hash(filename: &str) -> bool {
    // `.worker.js`-style double extensions: only the final ext matters here.
    let Some((stem, _ext)) = filename.rsplit_once('.') else { return false };
    if stem.len() < 9 {
        return false; // needs at least `x-` plus 8 hash chars
    }
    let (name, hash) = stem.split_at(stem.len() - 8);
    name.ends_with('-')
        && name.len() > 1
        && hash.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[test]
fn every_built_asset_carries_a_content_hash() {
    let dir = assets_dir();
    if !dir.exists() {
        // Rust-only checkouts and CI jobs that skip `pnpm build` have no dist.
        // Skip rather than fail: this guards the frontend build, and a missing
        // build is a different problem that other tests surface.
        eprintln!("skipping: {} not built", dir.display());
        return;
    }

    let mut unhashed = Vec::new();
    let mut checked = 0usize;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let entry = entry.unwrap();
        if !entry.file_type().unwrap().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // .DS_Store and friends are not served
        }
        checked += 1;
        if !has_content_hash(&name) {
            unhashed.push(name);
        }
    }

    assert!(checked > 0, "no assets found in {} - build looks broken", dir.display());
    assert!(
        unhashed.is_empty(),
        "these files under /assets/ have no content hash, so serving them \
         `immutable` + SW cache-first would pin users to stale bytes forever: {unhashed:#?}"
    );
}

#[test]
fn hash_detector_rejects_names_that_only_look_versioned() {
    // Guards the guard: if this predicate were sloppy, the test above would
    // pass while real unhashed files slipped through.
    assert!(has_content_hash("index-rQPnrQ9w.js"));
    assert!(has_content_hash("xterm-BCZmeEKv.js"));
    assert!(has_content_hash("codicon-DCmgc-FA.ttf"));
    // Hash containing `-`, and a name containing `-`: both real, from dist.
    assert!(has_content_hash("csp-D-4FJmMZ.js"));
    assert!(has_content_hash("objective-c-BDtDVThU.js"));
    assert!(has_content_hash("json.worker-usMZ-FED.js"));

    assert!(!has_content_hash("index.js"), "no hash segment at all");
    assert!(!has_content_hash("chunk-v2.js"), "short suffix is a version, not a hash");
    assert!(!has_content_hash("vendor-abc.css"), "3 chars is too short to be a content hash");
    assert!(!has_content_hash("logo.png"));
    assert!(!has_content_hash("sw.js"));
    assert!(!has_content_hash("-BDtDVThU.js"), "hash with no name is not a real emit");
}

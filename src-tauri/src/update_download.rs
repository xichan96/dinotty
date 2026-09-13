//! Desktop-side download of a release installer.
//!
//! The server crate already decides *which* asset this platform should get and
//! validates its URL (`dinotty_server::update_check::validate_release_asset_url`).
//! What it cannot do is put bytes on the user's disk: the frontend reaches the
//! backend through `tauri_fetch`, whose response body is a `String`, so a
//! ~100 MB installer cannot travel that path. Hence a dedicated command here.
//!
//! The URL still crosses the webview IPC boundary, so it is re-validated
//! against the same shared function rather than trusted.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration as StdDuration,
};

use dinotty_server::platform::process::CommandNoWindowExt;
use reqwest::{redirect::Policy, StatusCode};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{io::AsyncWriteExt, time::Instant};

pub const PROGRESS_EVENT: &str = "update-download-progress";

/// Progress is emitted on this cadence at most. `AppHandle::emit` can block when
/// the WKWebView IPC queue is full (see the note above `spawn_tauri_output_forwarder`
/// in `main.rs`), so the per-chunk volume must never reach the IPC queue raw.
const PROGRESS_INTERVAL: StdDuration = StdDuration::from_millis(250);

/// A download is bounded by this, not by the update checker's 8 second budget,
/// which would abort every real download.
const DOWNLOAD_TIMEOUT: StdDuration = StdDuration::from_mins(30);
const CONNECT_TIMEOUT: StdDuration = StdDuration::from_secs(10);

#[derive(Default)]
pub struct UpdateDownloadState {
    active: AtomicBool,
    cancel: AtomicBool,
}

impl UpdateDownloadState {
    /// Clears the cancellation flag. Call before starting a download, so a
    /// cancel from a previous run cannot abort this one.
    fn begin(&self) -> Result<DownloadGuard<'_>, String> {
        self.cancel.store(false, Ordering::SeqCst);
        self.active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "already_downloading".to_string())?;
        Ok(DownloadGuard { state: self })
    }
}

/// Releases the single-flight flag on every exit path, including early returns.
struct DownloadGuard<'a> {
    state: &'a UpdateDownloadState,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.state.active.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<u8>,
}

impl DownloadProgress {
    fn new(downloaded: u64, total: Option<u64>) -> Self {
        let percent = total.filter(|total| *total > 0).map(|total| {
            u8::try_from(downloaded.min(total).saturating_mul(100) / total).unwrap_or(100)
        });
        Self { downloaded, total, percent }
    }
}

#[derive(Serialize)]
pub struct DownloadResult {
    path: String,
}

#[tauri::command]
pub async fn download_update_asset(
    app: AppHandle,
    state: State<'_, UpdateDownloadState>,
    url: String,
    tag: String,
    filename: String,
) -> Result<DownloadResult, String> {
    // The webview is untrusted input even when it is our own page.
    let url = dinotty_server::update_check::validate_release_asset_url(&url, &tag, &filename)
        .map_err(|_| "invalid_asset_url".to_string())?;

    let _guard = state.begin()?;

    // Ask where to save before any network work, so cancelling costs the user
    // nothing and never leaves a half-written installer behind.
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Save Update")
        .set_file_name(&filename)
        .save_file()
        .await
        .ok_or_else(|| "cancelled".to_string())?;
    let target: PathBuf = handle.path().to_path_buf();

    let client = reqwest::Client::builder()
        // Release assets redirect to objects.githubusercontent.com.
        .redirect(Policy::limited(5))
        // Keep a redirect from downgrading the transfer to plaintext.
        .https_only(true)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| format!("client: {error}"))?;

    let mut response = client
        .get(url.as_str())
        .header(reqwest::header::USER_AGENT, format!("dinotty/{}", env!("CARGO_PKG_VERSION")))
        // A transparent proxy that compresses the body would make
        // `content_length()` a lie and push the progress bar past 100%.
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| format!("network: {error}"))?;

    if response.status() != StatusCode::OK {
        return Err(format!("http_status:{}", response.status().as_u16()));
    }

    // Write to a sibling and rename at the end: both are atomic on the same
    // filesystem, so a partial download is never mistaken for an installer.
    let mut part_os = target.clone().into_os_string();
    part_os.push(".part");
    let part = PathBuf::from(part_os);

    let mut file = tokio::fs::File::create(&part).await.map_err(|error| format!("io: {error}"))?;
    let total = response.content_length();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        let chunk = match response.chunk().await {
            Ok(chunk) => chunk,
            Err(error) => {
                drop(file);
                let _ = tokio::fs::remove_file(&part).await;
                return Err(format!("network: {error}"));
            }
        };
        let Some(chunk) = chunk else { break };

        if state.cancel.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err("cancelled".to_string());
        }

        if let Err(error) = file.write_all(&chunk).await {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(format!("io: {error}"));
        }
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            last_emit = Instant::now();
            let _ = app.emit(PROGRESS_EVENT, DownloadProgress::new(downloaded, total));
        }
    }

    if let Err(error) = file.flush().await {
        drop(file);
        let _ = tokio::fs::remove_file(&part).await;
        return Err(format!("io: {error}"));
    }
    drop(file);

    if let Some(total) = total.filter(|total| downloaded != *total) {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(format!("incomplete: {downloaded}/{total}"));
    }

    tokio::fs::rename(&part, &target).await.map_err(|error| format!("io: {error}"))?;
    let _ = app.emit(PROGRESS_EVENT, DownloadProgress::new(downloaded, total));

    Ok(DownloadResult { path: target.to_string_lossy().into_owned() })
}

/// Requests cancellation of the in-flight download, if any. Returns whether one
/// was running. The download command notices within one chunk, removes its
/// `.part` file, and reports `cancelled`.
#[tauri::command]
pub fn cancel_update_download(state: State<'_, UpdateDownloadState>) -> bool {
    state.cancel.swap(true, Ordering::SeqCst)
}

/// Reveals a downloaded installer in the OS file manager.
///
/// Deliberately the default affordance: opening a `.dmg` mounts it and opening
/// a `.exe` launches the installer, which must stay an explicit user action.
#[tauri::command]
pub fn reveal_downloaded_file(path: String) -> Result<(), String> {
    let path = existing_file(path)?;
    dinotty_server::workspace::reveal_in_file_manager(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_downloaded_file(path: String) -> Result<(), String> {
    let path = existing_file(path)?;
    open_path(&path).map_err(|error| error.to_string())
}

fn existing_file(path: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("not_a_file".to_string());
    }
    Ok(path)
}

#[cfg(target_os = "macos")]
fn open_path(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("open").no_window().arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_path(path: &std::path::Path) -> std::io::Result<()> {
    // `start` is a cmd builtin, and the empty first argument is the window
    // title — without it a quoted path would be parsed as the title.
    std::process::Command::new("cmd")
        .no_window()
        .args(["/C", "start", ""])
        .arg(path)
        .spawn()
        .map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").no_window().arg(path).spawn().map(|_| ())
}

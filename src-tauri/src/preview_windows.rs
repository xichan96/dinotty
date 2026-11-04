use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::window_host::{focus_window, run_on_main_thread_blocking};

pub const LABEL_PREFIX: &str = "preview-";
/// Main → preview window: focus already brought it forward, now show this
/// target. Mirrors `PREVIEW_WINDOW_NAVIGATE_EVENT` on the frontend.
pub const NAVIGATE_EVENT: &str = "preview-window-navigate";

const FILES_LABEL_PREFIX: &str = "preview-files-";
const FILE_LABEL_PREFIX: &str = "preview-file-";
const WEB_LABEL_PREFIX: &str = "preview-web-";
const DEFAULT_TITLE: &str = "Preview";
const WINDOW_WIDTH: f64 = 960.0;
const WINDOW_HEIGHT: f64 = 640.0;
const MIN_WINDOW_WIDTH: f64 = 480.0;
const MIN_WINDOW_HEIGHT: f64 = 320.0;
const CREATE_WAIT: Duration = Duration::from_secs(3);

/// Built-in previews that can live in their own native window.
///
/// Identity is no longer one-per-kind: a file browser window is bound to the
/// terminal session it browses (so different workspaces get their own window),
/// while every web preview open creates a fresh window.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum PreviewKind {
    Files,
    File,
    Web,
}

impl PreviewKind {
    fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "files" => Ok(Self::Files),
            "file" => Ok(Self::File),
            "web" => Ok(Self::Web),
            other => Err(format!("unsupported preview kind: {other:?}")),
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::Files => "files",
            Self::File => "file",
            Self::Web => "web",
        }
    }
}

/// Registry entry for one native preview window. The Tauri window remains the
/// source of truth for liveness; this map only remembers the label and title.
/// Identity (kind plus source session) is encoded in the label.
#[derive(Clone, Debug, Eq, PartialEq)]
struct PreviewWindowInfo {
    label: String,
    title: Option<String>,
}

#[derive(Default)]
struct Registry {
    /// Keyed by Tauri window label.
    windows: BTreeMap<String, PreviewWindowInfo>,
    /// Labels whose creation is still in flight.
    creating: BTreeSet<String>,
}

/// Tauri-managed registry of native preview windows.
///
/// All methods are pure Rust and take no `AppHandle`, so they can be unit
/// tested without a running application.
#[derive(Default)]
pub struct PreviewWindows {
    inner: Mutex<Registry>,
    /// Signalled whenever a creation reservation settles (window published or
    /// creation aborted), so a concurrent open can wait for the in-flight
    /// window instead of returning silently.
    settled: Condvar,
}

impl PreviewWindows {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// Reserve a creation slot. Returns false when the window already exists or
    /// another creation is in flight for the same label.
    fn begin_create(&self, label: &str) -> bool {
        let mut registry = self.lock();
        if registry.windows.contains_key(label) || registry.creating.contains(label) {
            return false;
        }
        registry.creating.insert(label.to_string());
        true
    }

    fn finish_create(&self, info: PreviewWindowInfo) {
        {
            let mut registry = self.lock();
            registry.creating.remove(&info.label);
            registry.windows.insert(info.label.clone(), info);
        }
        self.settled.notify_all();
    }

    fn abort_create(&self, label: &str) {
        {
            self.lock().creating.remove(label);
        }
        self.settled.notify_all();
    }

    /// Block until no creation is in flight for `label`, or `timeout` elapses.
    /// Returns true when creation settled before the deadline.
    fn wait_for_creation(&self, label: &str, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut registry = self.lock();
        while registry.creating.contains(label) {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (guard, _) = self
                .settled
                .wait_timeout(registry, deadline - now)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            registry = guard;
        }
        true
    }

    /// Record a window that already exists outside the registry (for example
    /// after the registry was lost) and refresh its title when one is given.
    fn remember_existing(&self, info: PreviewWindowInfo) {
        {
            let mut registry = self.lock();
            registry.creating.remove(&info.label);
            match registry.windows.get_mut(&info.label) {
                Some(existing) => {
                    if info.title.is_some() {
                        existing.title = info.title;
                    }
                }
                None => {
                    registry.windows.insert(info.label.clone(), info);
                }
            }
        }
        self.settled.notify_all();
    }

    /// Drop the window entry. Idempotent: returns the removed entry, if any.
    fn remove(&self, label: &str) -> Option<PreviewWindowInfo> {
        let removed = {
            let mut registry = self.lock();
            registry.creating.remove(label);
            registry.windows.remove(label)
        };
        self.settled.notify_all();
        removed
    }

    /// Drop only the window entry, keeping an in-flight creation reservation.
    /// Used when Tauri no longer knows about a label the registry still lists:
    /// clearing the reservation there would let a concurrent creator race.
    fn forget_window(&self, label: &str) -> Option<PreviewWindowInfo> {
        let removed = { self.lock().windows.remove(label) };
        self.settled.notify_all();
        removed
    }

    #[cfg(test)]
    fn list(&self) -> Vec<PreviewWindowInfo> {
        self.lock().windows.values().cloned().collect()
    }
}

/// Pane ids become part of a window label, so keep them to a conservative
/// character set. Generated ids (UUIDs) qualify.
#[must_use]
fn is_safe_source_pane_id(pane_id: &str) -> bool {
    !pane_id.is_empty()
        && pane_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A file browser window is identified by the terminal session it browses, so
/// reopening the same session focuses the existing window instead of creating
/// a duplicate. Different sessions (different workspaces) get their own.
fn files_label(source_pane_id: &str) -> Result<String, String> {
    if !is_safe_source_pane_id(source_pane_id) {
        return Err(format!("invalid source pane id: {source_pane_id:?}"));
    }
    Ok(format!("{FILES_LABEL_PREFIX}{source_pane_id}"))
}

/// The standalone file viewer is one window per terminal session: reopening
/// the same pane focuses it and navigates to the new file.
fn file_label(source_pane_id: &str) -> Result<String, String> {
    if !is_safe_source_pane_id(source_pane_id) {
        return Err(format!("invalid source pane id: {source_pane_id:?}"));
    }
    Ok(format!("{FILE_LABEL_PREFIX}{source_pane_id}"))
}

/// Web preview windows are independent browsers: every open gets a fresh
/// label (and therefore a fresh window).
fn web_label() -> String {
    format!("{WEB_LABEL_PREFIX}{}", uuid::Uuid::new_v4())
}

/// Whether `label` belongs to a native preview window. Used to reject attempts
/// to close any other window (the main window, detached terminals, …).
#[must_use]
pub fn is_preview_label(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX) && label.len() > LABEL_PREFIX.len()
}

/// Payload of `preview-window-navigate`. Serialized camelCase so it matches
/// the frontend's `PreviewWindowPayload`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigatePayload {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_pane_id: Option<String>,
}

/// Build the entry URL for `preview.html`, encoding every query value so paths
/// with spaces / `&` / non-ASCII survive the round-trip. `windowLabel` lets the
/// window close itself (`close_preview_window` targets a label now that several
/// windows of the same kind can coexist).
fn preview_url(
    kind: PreviewKind,
    path: Option<&str>,
    url: Option<&str>,
    source_pane_id: Option<&str>,
    window_label: &str,
) -> PathBuf {
    let mut addr = format!(
        "preview.html?kind={}&windowLabel={}",
        kind.slug(),
        urlencoding::encode(window_label)
    );
    let mut push = |key: &str, value: Option<&str>| {
        if let Some(value) = value {
            addr.push('&');
            addr.push_str(key);
            addr.push('=');
            addr.push_str(&urlencoding::encode(value));
        }
    };
    push("path", path);
    push("url", url);
    push("sourcePaneId", source_pane_id);
    PathBuf::from(addr)
}

/// Decide the outcome of losing the creation race for `label`.
///
/// A settled creation with no live window means the registry entry is stale;
/// reporting it as an error lets the caller retry instead of silently doing
/// nothing.
fn resolve_waited_creation<T>(
    label: &str,
    creation_settled: bool,
    window: Option<T>,
) -> Result<T, String> {
    if !creation_settled {
        return Err(format!("preview window {label} did not finish opening in time; try again"));
    }
    window.ok_or_else(|| {
        format!("preview window {label} is registered but no longer exists; try again")
    })
}

/// Show the window, retitle it, and send it the new target. Focus failures are
/// logged but never fail the open: the window exists and already navigated, so
/// the caller must not fall back to a second in-app preview.
fn adopt_and_focus(
    app: &AppHandle,
    state: &PreviewWindows,
    info: PreviewWindowInfo,
    title: Option<String>,
    window: &WebviewWindow,
    payload: &NavigatePayload,
) -> Result<(), String> {
    state.remember_existing(info);
    if let Some(title) = title {
        if let Err(error) = window.set_title(&title) {
            tracing::warn!(%error, label = window.label(), "failed to update preview window title");
        }
    }
    if let Err(error) = app.emit_to(window.label(), NAVIGATE_EVENT, payload) {
        tracing::warn!(%error, label = window.label(), "failed to send preview navigate event");
    }
    if let Err(error) = focus_window(window) {
        tracing::warn!(%error, label = window.label(), "failed to focus preview window");
    }
    Ok(())
}

/// Open a built-in preview in its own native window.
///
/// File previews are keyed by `source_pane_id`: reopening the same terminal
/// session focuses the existing window and sends it the new path. Every web
/// preview open creates a new, independent window. Returns the window label so
/// callers can focus or close that specific instance.
#[tauri::command]
pub fn open_preview_window(
    app: AppHandle,
    state: State<'_, PreviewWindows>,
    kind: String,
    path: Option<String>,
    url: Option<String>,
    source_pane_id: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    let kind = PreviewKind::parse(&kind)?;
    let label = match kind {
        PreviewKind::Files => {
            let source_pane_id = source_pane_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "file preview requires a source pane id".to_string())?;
            files_label(source_pane_id)?
        }
        PreviewKind::File => {
            let source_pane_id = source_pane_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "file viewer requires a source pane id".to_string())?;
            file_label(source_pane_id)?
        }
        PreviewKind::Web => web_label(),
    };
    let info = PreviewWindowInfo { label: label.clone(), title: title.clone() };
    let payload = NavigatePayload {
        kind: kind.slug(),
        path: path.clone(),
        url: url.clone(),
        source_pane_id: source_pane_id.clone(),
    };

    // Adopt a window that outlived the registry (reload, or an entry lost
    // while the webview stayed alive). A registry entry whose window Tauri no
    // longer knows about is dropped so the reservation below can succeed.
    if let Some(window) = app.get_webview_window(&label) {
        adopt_and_focus(&app, &state, info, title, &window, &payload)?;
        return Ok(label);
    }
    state.forget_window(&label);

    if !state.begin_create(&label) {
        // Another call owns creation; wait for it to publish the window so a
        // second open is not a silent no-op.
        let settled = state.wait_for_creation(&label, CREATE_WAIT);
        let window = if settled { app.get_webview_window(&label) } else { None };
        return match resolve_waited_creation(&label, settled, window) {
            Ok(window) => {
                adopt_and_focus(&app, &state, info, title, &window, &payload)?;
                Ok(label)
            }
            Err(error) => {
                if settled {
                    // The registry pointed at a window Tauri no longer knows
                    // about; drop it so a retry can create a fresh one.
                    state.remove(&label);
                }
                tracing::warn!(label, %error, "preview window open failed");
                Err(error)
            }
        };
    }

    let window_title = title.clone().unwrap_or_else(|| DEFAULT_TITLE.to_string());
    let entry =
        preview_url(kind, path.as_deref(), url.as_deref(), source_pane_id.as_deref(), &label);
    let app_for_create = app.clone();
    let label_for_create = label.clone();
    let label_for_log = label.clone();

    let created = run_on_main_thread_blocking(&app, move || {
        if let Some(window) = app_for_create.get_webview_window(&label_for_create) {
            return Ok(window);
        }
        WebviewWindowBuilder::new(&app_for_create, &label_for_create, WebviewUrl::App(entry))
            .title(window_title)
            .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .decorations(true)
            // Equivalent of `dragDropEnabled: false`: keep HTML5 drag and drop.
            .disable_drag_drop_handler()
            .build()
            .map_err(|error| format!("failed to create preview window: {error}"))
    });

    let window = match created {
        Ok(Ok(window)) => window,
        Ok(Err(error)) | Err(error) => {
            state.abort_create(&label);
            tracing::error!(label = %label_for_log, %error, "preview window creation failed");
            return Err(error);
        }
    };

    state.finish_create(info);
    tracing::info!(label = %label_for_log, "preview window opened");
    if let Err(error) = focus_window(&window) {
        tracing::warn!(%error, label = %label_for_log, "failed to focus preview window");
    }
    Ok(label)
}

/// Close one preview window by label (the in-window close affordance and the
/// dock-to-merge flow). Closing is idempotent: a label whose window is already
/// gone only drops the registry entry.
#[tauri::command]
pub fn close_preview_window(
    app: AppHandle,
    state: State<'_, PreviewWindows>,
    window_label: String,
) -> Result<(), String> {
    if !is_preview_label(&window_label) {
        return Err(format!("not a preview window label: {window_label:?}"));
    }
    let Some(window) = app.get_webview_window(&window_label) else {
        state.remove(&window_label);
        return Ok(());
    };
    window.close().map_err(|error| format!("failed to close preview window: {error}"))
}

/// Lifecycle hook for `preview-*` windows.
///
/// Preview windows own no server-side state, but the registry must drop an
/// entry when its window is destroyed. Cleanup runs only on `Destroyed`:
/// `CloseRequested` can be prevented or deferred, and removing the entry there
/// would forget a window that is still alive. Returning true keeps the main
/// window's quit-confirmation handler out of every preview close path.
pub fn handle_preview_window_event(window: &tauri::Window, event: &tauri::WindowEvent) -> bool {
    if !is_preview_label(window.label()) {
        return false;
    }
    if matches!(event, tauri::WindowEvent::Destroyed) {
        window.app_handle().state::<PreviewWindows>().remove(window.label());
    }
    true
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn info(label: &str) -> PreviewWindowInfo {
        PreviewWindowInfo { label: label.to_string(), title: None }
    }

    #[test]
    fn kind_parsing_maps_to_stable_slugs() {
        assert_eq!(PreviewKind::parse("files").unwrap().slug(), "files");
        assert_eq!(PreviewKind::parse("file").unwrap().slug(), "file");
        assert_eq!(PreviewKind::parse("web").unwrap().slug(), "web");
        assert!(PreviewKind::parse("plugin").is_err());
        assert!(PreviewKind::parse("").is_err());
    }

    #[test]
    fn file_labels_are_deterministic_per_source_and_distinct_from_files() {
        let label = file_label("pane-1").unwrap();
        assert_eq!(label, "preview-file-pane-1");
        assert_eq!(file_label("pane-1").unwrap(), label);
        assert_ne!(file_label("pane-2").unwrap(), label);
        assert_ne!(label, files_label("pane-1").unwrap());
        assert!(is_preview_label(&label));
    }

    #[test]
    fn file_labels_reject_unsafe_source_ids() {
        for id in ["", "has space", "a/b", "a.b", "a:b", "café", "a?b", "a#b"] {
            assert!(file_label(id).is_err(), "{id:?} should be rejected");
        }
        assert!(file_label("f47ac10b-58cc-4372-a567-0e02b2c3d479").is_ok());
    }

    #[test]
    fn file_url_carries_kind_file_and_encoded_path() {
        let url = preview_url(
            PreviewKind::File,
            Some("docs/a b.md"),
            None,
            Some("pane-1"),
            "preview-file-pane-1",
        );
        let url = url.to_string_lossy();
        assert!(url.starts_with("preview.html?kind=file&"));
        assert!(url.contains("windowLabel=preview-file-pane-1"));
        assert!(url.contains("sourcePaneId=pane-1"));
        assert!(url.contains("path=docs%2Fa%20b.md"));
    }

    #[test]
    fn files_labels_are_deterministic_per_source() {
        let a = files_label("pane-1").unwrap();
        assert_eq!(a, "preview-files-pane-1");
        assert_eq!(files_label("pane-1").unwrap(), a);
        assert_ne!(files_label("pane-2").unwrap(), a);
        assert!(is_preview_label(&a));
    }

    #[test]
    fn files_labels_reject_unsafe_source_ids() {
        for id in ["", "has space", "a/b", "a.b", "a:b", "café", "a?b", "a#b"] {
            assert!(!is_safe_source_pane_id(id), "{id:?} should be rejected");
            assert!(files_label(id).is_err(), "{id:?} should be rejected");
        }
        assert!(files_label("f47ac10b-58cc-4372-a567-0e02b2c3d479").is_ok());
    }

    #[test]
    fn web_labels_are_unique_and_prefixed() {
        let first = web_label();
        let second = web_label();
        assert_ne!(first, second);
        assert!(first.starts_with("preview-web-"));
        assert!(second.starts_with("preview-web-"));
        assert!(is_preview_label(&first));
        assert!(is_preview_label(&second));
    }

    #[test]
    fn preview_label_validation_rejects_other_windows() {
        assert!(!is_preview_label("preview-"));
        assert!(!is_preview_label("main"));
        assert!(!is_preview_label("tab-abc"));
        assert!(is_preview_label("preview-files-pane-1"));
        assert!(is_preview_label("preview-web-x"));
    }

    #[test]
    fn files_creation_guard_deduplicates_and_releases() {
        let registry = PreviewWindows::default();
        let label = files_label("one").unwrap();
        assert!(registry.begin_create(&label));
        assert!(!registry.begin_create(&label), "in-flight creation must be deduplicated");
        registry.finish_create(info(&label));
        assert!(!registry.begin_create(&label), "existing window must be deduplicated");
        assert_eq!(registry.list(), vec![info(&label)]);

        registry.remove(&label);
        assert!(registry.begin_create(&label), "closed window can be reopened");
        registry.abort_create(&label);
    }

    #[test]
    fn web_windows_coexist() {
        let registry = PreviewWindows::default();
        let first = web_label();
        let second = web_label();
        assert!(registry.begin_create(&first));
        assert!(registry.begin_create(&second));
        registry.finish_create(info(&first));
        registry.finish_create(info(&second));
        assert_eq!(registry.list().len(), 2);
    }

    #[test]
    fn removing_one_window_keeps_the_others() {
        let registry = PreviewWindows::default();
        let a = files_label("a").unwrap();
        let b = files_label("b").unwrap();
        registry.finish_create(info(&a));
        registry.finish_create(info(&b));

        assert_eq!(registry.remove(&a), Some(info(&a)));
        assert_eq!(registry.remove(&a), None, "close cleanup must be idempotent");
        assert_eq!(registry.list(), vec![info(&b)]);
    }

    #[test]
    fn forgetting_a_window_keeps_an_in_flight_creation() {
        let registry = PreviewWindows::default();
        let label = files_label("one").unwrap();
        assert!(registry.begin_create(&label));
        registry.forget_window(&label);
        assert!(
            !registry.begin_create(&label),
            "an in-flight creation must survive a stale-window cleanup"
        );
        registry.abort_create(&label);
    }

    #[test]
    fn waiting_for_an_in_flight_creation_unblocks_when_it_settles() {
        let registry = Arc::new(PreviewWindows::default());
        let label = web_label();
        assert!(registry.begin_create(&label));
        let waiter = Arc::clone(&registry);
        let waiting_label = label.clone();
        let handle = std::thread::spawn(move || {
            waiter.wait_for_creation(&waiting_label, Duration::from_secs(5))
        });

        // Give the waiter time to reach the condvar before publishing.
        std::thread::sleep(Duration::from_millis(20));
        registry.finish_create(info(&label));

        assert!(handle.join().unwrap());
        assert_eq!(registry.list(), vec![info(&label)]);
    }

    #[test]
    fn waiting_for_a_settled_label_returns_immediately() {
        let registry = PreviewWindows::default();
        assert!(registry.wait_for_creation("preview-web-none", Duration::from_millis(10)));
    }

    #[test]
    fn waiting_for_creation_times_out_while_still_in_flight() {
        let registry = PreviewWindows::default();
        let label = files_label("slow").unwrap();
        assert!(registry.begin_create(&label));
        assert!(!registry.wait_for_creation(&label, Duration::from_millis(10)));
        registry.abort_create(&label);
    }

    #[test]
    fn waited_creation_reports_timeout_and_stale_registry_instead_of_succeeding() {
        let timeout = resolve_waited_creation::<()>("preview-web-a", false, None).unwrap_err();
        assert!(timeout.contains("did not finish opening in time"), "{timeout}");

        let registry = PreviewWindows::default();
        let label = files_label("stale").unwrap();
        registry.finish_create(info(&label));
        assert!(!registry.begin_create(&label), "registry believes the window exists");
        assert!(registry.wait_for_creation(&label, Duration::from_millis(10)));
        let stale = resolve_waited_creation::<()>(&label, true, None).unwrap_err();
        assert!(stale.contains("registered but no longer exists"), "{stale}");

        assert_eq!(resolve_waited_creation("preview-web-a", true, Some(42)).unwrap(), 42);
    }

    #[test]
    fn aborting_a_create_allows_retry() {
        let registry = PreviewWindows::default();
        let label = web_label();
        assert!(registry.begin_create(&label));
        registry.abort_create(&label);
        assert!(registry.begin_create(&label));
    }

    #[test]
    fn remembering_an_existing_window_keeps_the_old_title_when_none_is_given() {
        let registry = PreviewWindows::default();
        let label = files_label("t").unwrap();
        let mut first = info(&label);
        first.title = Some("Terminal".into());
        registry.remember_existing(first.clone());
        registry.remember_existing(info(&label));
        assert_eq!(registry.list(), vec![first]);

        let mut renamed = info(&label);
        renamed.title = Some("Renamed".into());
        registry.remember_existing(renamed.clone());
        assert_eq!(registry.list(), vec![renamed]);
    }

    #[test]
    fn preview_url_encodes_every_query_value() {
        let url = preview_url(
            PreviewKind::Files,
            Some("/tmp/a b&c/文件.md"),
            None,
            Some("pane-1"),
            "preview-files-pane-1",
        );
        let url = url.to_string_lossy();
        assert!(url.starts_with("preview.html?kind=files"));
        assert!(url.contains("windowLabel=preview-files-pane-1"));
        assert!(url.contains("sourcePaneId=pane-1"));
        assert!(url.contains("%20"));
        assert!(url.contains("%26"));
        assert!(!url.contains("a b&c"));
    }

    #[test]
    fn web_url_is_part_of_the_entry_url() {
        let url = preview_url(
            PreviewKind::Web,
            None,
            Some("http://localhost:3000/x?y=1"),
            None,
            "preview-web-x",
        );
        let url = url.to_string_lossy();
        assert!(url.starts_with("preview.html?kind=web"));
        assert!(url.contains("windowLabel=preview-web-x"));
        assert!(url.contains("%3A%2F%2F"));
        assert!(url.contains("%3Fy%3D1"));
        assert!(!url.contains("path="));
    }
}

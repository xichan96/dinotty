use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::window_host::{focus_window, run_on_main_thread_blocking};

pub const LABEL_PREFIX: &str = "preview-";
/// Main → preview window: focus already brought it forward, now show this
/// target. Mirrors `PREVIEW_WINDOW_NAVIGATE_EVENT` on the frontend.
pub const NAVIGATE_EVENT: &str = "preview-window-navigate";

const DEFAULT_TITLE: &str = "Preview";
const WINDOW_WIDTH: f64 = 960.0;
const WINDOW_HEIGHT: f64 = 640.0;
const MIN_WINDOW_WIDTH: f64 = 480.0;
const MIN_WINDOW_HEIGHT: f64 = 320.0;
const CREATE_WAIT: Duration = Duration::from_secs(3);
const CREATE_POLL: Duration = Duration::from_millis(50);

/// Built-in previews that can live in their own native window. One window per
/// kind, matching the floating previews' identity.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum PreviewKind {
    Files,
    Web,
}

impl PreviewKind {
    fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "files" => Ok(Self::Files),
            "web" => Ok(Self::Web),
            other => Err(format!("unsupported preview kind: {other:?}")),
        }
    }

    fn slug(self) -> &'static str {
        match self {
            Self::Files => "files",
            Self::Web => "web",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Files => "preview-files",
            Self::Web => "preview-web",
        }
    }
}

/// Tracks in-flight window creation so two rapid opens of the same kind do not
/// race the builder (Tauri rejects a duplicate label).
#[derive(Default)]
pub struct PreviewWindows {
    creating: Mutex<HashSet<&'static str>>,
}

impl PreviewWindows {
    fn lock(&self) -> MutexGuard<'_, HashSet<&'static str>> {
        self.creating.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn begin_create(&self, label: &'static str) -> bool {
        self.lock().insert(label)
    }

    fn finish_create(&self, label: &'static str) {
        self.lock().remove(label);
    }

    fn is_creating(&self, label: &str) -> bool {
        self.lock().contains(label)
    }
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
/// with spaces / `&` / non-ASCII survive the round-trip.
fn preview_url(
    kind: PreviewKind,
    path: Option<&str>,
    url: Option<&str>,
    source_pane_id: Option<&str>,
) -> PathBuf {
    let mut addr = format!("preview.html?kind={}", kind.slug());
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

fn wait_for_window(
    app: &AppHandle,
    label: &'static str,
    state: &PreviewWindows,
) -> Option<WebviewWindow> {
    let deadline = Instant::now() + CREATE_WAIT;
    loop {
        if let Some(window) = app.get_webview_window(label) {
            return Some(window);
        }
        if !state.is_creating(label) || Instant::now() >= deadline {
            // Creation settled without a window (it failed), or we timed out.
            return app.get_webview_window(label);
        }
        std::thread::sleep(CREATE_POLL);
    }
}

fn adopt_and_focus(
    app: &AppHandle,
    label: &'static str,
    title: Option<String>,
    window: &WebviewWindow,
    payload: &NavigatePayload,
) -> Result<(), String> {
    if let Some(title) = title {
        if let Err(error) = window.set_title(&title) {
            tracing::warn!(%error, label, "failed to update preview window title");
        }
    }
    if let Err(error) = app.emit_to(label, NAVIGATE_EVENT, payload) {
        tracing::warn!(%error, label, "failed to send preview navigate event");
    }
    // The window exists and already received its target; a focus failure must
    // not surface as an open failure, or the caller would open a second
    // (in-app float) preview on top of this one.
    if let Err(error) = focus_window(window) {
        tracing::warn!(%error, label, "failed to focus preview window");
    }
    Ok(())
}

/// Open a built-in preview in its own native window. An existing window of the
/// same kind is focused and receives the new target through
/// [`NAVIGATE_EVENT`] instead of being recreated.
#[tauri::command]
pub fn open_preview_window(
    app: AppHandle,
    state: State<'_, PreviewWindows>,
    kind: String,
    path: Option<String>,
    url: Option<String>,
    source_pane_id: Option<String>,
    title: Option<String>,
) -> Result<(), String> {
    let kind = PreviewKind::parse(&kind)?;
    let label = kind.label();
    let payload = NavigatePayload {
        kind: kind.slug(),
        path: path.clone(),
        url: url.clone(),
        source_pane_id: source_pane_id.clone(),
    };

    if let Some(window) = app.get_webview_window(label) {
        return adopt_and_focus(&app, label, title, &window, &payload);
    }

    if !state.begin_create(label) {
        // Another call owns creation; wait for it to publish, then treat this
        // request like a reopen so the second click is not a silent no-op.
        return match wait_for_window(&app, label, &state) {
            Some(window) => adopt_and_focus(&app, label, title, &window, &payload),
            None => {
                Err(format!("preview window for {label} did not finish opening in time; try again"))
            }
        };
    }

    let app_for_create = app.clone();
    let entry = preview_url(kind, path.as_deref(), url.as_deref(), source_pane_id.as_deref());
    let window_title = title.unwrap_or_else(|| DEFAULT_TITLE.to_string());

    let created = run_on_main_thread_blocking(&app, move || {
        if let Some(window) = app_for_create.get_webview_window(label) {
            return Ok(window);
        }
        WebviewWindowBuilder::new(&app_for_create, label, WebviewUrl::App(entry))
            .title(window_title)
            .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .decorations(true)
            // Equivalent of `dragDropEnabled: false`: keep HTML5 drag and drop.
            .disable_drag_drop_handler()
            .build()
            .map_err(|error| format!("failed to create preview window: {error}"))
    });

    state.finish_create(label);

    match created {
        Ok(Ok(window)) => {
            tracing::info!(label, "preview window opened");
            if let Err(error) = focus_window(&window) {
                tracing::warn!(%error, label, "failed to focus preview window");
            }
            Ok(())
        }
        Ok(Err(error)) | Err(error) => {
            tracing::error!(label, %error, "preview window creation failed");
            Err(error)
        }
    }
}

/// Close the preview window of `kind` (the in-page close affordance, if any).
#[tauri::command]
pub fn close_preview_window(app: AppHandle, kind: String) -> Result<(), String> {
    let kind = PreviewKind::parse(&kind)?;
    let Some(window) = app.get_webview_window(kind.label()) else {
        return Ok(());
    };
    window.close().map_err(|error| format!("failed to close preview window: {error}"))
}

/// Lifecycle hook for `preview-*` windows.
///
/// Preview windows own no server-side state, so there is nothing to clean up.
/// Returning true keeps the main window's quit-confirmation handler out of
/// their close path — otherwise the window could never be closed.
pub fn handle_preview_window_event(window: &tauri::Window, _event: &tauri::WindowEvent) -> bool {
    window.label().starts_with(LABEL_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_parsing_maps_to_stable_labels() {
        assert_eq!(PreviewKind::parse("files").unwrap().label(), "preview-files");
        assert_eq!(PreviewKind::parse("web").unwrap().label(), "preview-web");
        assert!(PreviewKind::parse("plugin").is_err());
        assert!(PreviewKind::parse("").is_err());
    }

    #[test]
    fn preview_url_encodes_every_query_value() {
        let url = preview_url(PreviewKind::Files, Some("/tmp/a b&c/文件.md"), None, Some("pane-1"));
        let url = url.to_string_lossy();
        assert!(url.starts_with("preview.html?kind=files"));
        assert!(url.contains("sourcePaneId=pane-1"));
        assert!(url.contains("%20"));
        assert!(url.contains("%26"));
        assert!(!url.contains("a b&c"));
    }

    #[test]
    fn web_url_is_part_of_the_entry_url() {
        let url = preview_url(PreviewKind::Web, None, Some("http://localhost:3000/x?y=1"), None);
        let url = url.to_string_lossy();
        assert!(url.starts_with("preview.html?kind=web&url="));
        assert!(url.contains("%3A%2F%2F"));
        assert!(url.contains("%3Fy%3D1"));
        assert!(!url.contains("path="));
    }

    #[test]
    fn creation_guard_deduplicates_and_releases() {
        let state = PreviewWindows::default();
        assert!(state.begin_create("preview-files"));
        assert!(!state.begin_create("preview-files"));
        assert!(state.is_creating("preview-files"));
        state.finish_create("preview-files");
        assert!(!state.is_creating("preview-files"));
        assert!(state.begin_create("preview-files"));
    }
}

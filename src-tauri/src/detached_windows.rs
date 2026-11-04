use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::window_host::{focus_window, run_on_main_thread_blocking};

pub const LABEL_PREFIX: &str = "tab-";
pub const CLOSED_EVENT: &str = "tab-window-closed";

const DEFAULT_TITLE: &str = "Dinotty";
const WINDOW_WIDTH: f64 = 1000.0;
const WINDOW_HEIGHT: f64 = 700.0;
const MIN_WINDOW_WIDTH: f64 = 600.0;
const MIN_WINDOW_HEIGHT: f64 = 400.0;

/// Metadata about one detached tab window. Serialized as-is (snake_case), so
/// the `tab-window-closed` payload and list results stay consistent.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DetachedWindowInfo {
    pub tab_id: String,
    pub label: String,
    pub title: Option<String>,
}

/// Tab ids become part of a window label and a URL query, so keep them to a
/// conservative character set. Generated ids (UUIDs) qualify, and so do plugin
/// tabs (`plugin:<plugin_id>:<workspace_id>`), which use `:` as a separator.
#[must_use]
pub fn is_valid_tab_id(tab_id: &str) -> bool {
    !tab_id.is_empty()
        && tab_id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b':'))
}

pub fn label_for_tab(tab_id: &str) -> Result<String, String> {
    if !is_valid_tab_id(tab_id) {
        return Err(format!("invalid tab id: {tab_id:?}"));
    }
    Ok(format!("{LABEL_PREFIX}{tab_id}"))
}

#[must_use]
pub fn tab_id_from_label(label: &str) -> Option<String> {
    let tab_id = label.strip_prefix(LABEL_PREFIX)?;
    is_valid_tab_id(tab_id).then(|| tab_id.to_string())
}

#[derive(Default)]
struct Registry {
    /// Keyed by tab id; the label is derivable but stored for direct responses.
    windows: BTreeMap<String, DetachedWindowInfo>,
    /// Reservations for windows whose creation is still in flight.
    creating: BTreeSet<String>,
    /// Tab ids whose next window close means "return to the main window"
    /// rather than "close the terminal". Set by `close_tab_window` callers
    /// (Mission Control's recall action), consumed by the `Destroyed` hook.
    reattaching: BTreeSet<String>,
}

/// Tauri-managed registry of detached tab windows.
///
/// All methods are pure Rust and take no `AppHandle`, so they can be unit
/// tested without a running application.
#[derive(Default)]
pub struct DetachedTabWindows {
    inner: Mutex<Registry>,
    /// Signalled whenever a creation reservation settles (window published or
    /// creation aborted), so a concurrent `open_tab_window` can wait for the
    /// in-flight window instead of returning silently.
    settled: Condvar,
}

impl DetachedTabWindows {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// Reserve a creation slot. Returns false when the tab already has a
    /// window or another creation is in flight.
    fn begin_create(&self, tab_id: &str) -> bool {
        let mut registry = self.lock();
        if registry.windows.contains_key(tab_id) || registry.creating.contains(tab_id) {
            return false;
        }
        registry.creating.insert(tab_id.to_string());
        true
    }

    fn finish_create(&self, info: DetachedWindowInfo) {
        {
            let mut registry = self.lock();
            registry.creating.remove(&info.tab_id);
            registry.windows.insert(info.tab_id.clone(), info);
        }
        self.settled.notify_all();
    }

    fn abort_create(&self, tab_id: &str) {
        {
            self.lock().creating.remove(tab_id);
        }
        self.settled.notify_all();
    }

    /// Block until no creation is in flight for `tab_id`, or `timeout`
    /// elapses. Returns true when creation settled before the deadline.
    fn wait_for_creation(&self, tab_id: &str, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut registry = self.lock();
        while registry.creating.contains(tab_id) {
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
    fn remember_existing(&self, tab_id: &str, label: &str, title: Option<String>) {
        {
            let mut registry = self.lock();
            registry.creating.remove(tab_id);
            match registry.windows.get_mut(tab_id) {
                Some(info) => {
                    if title.is_some() {
                        info.title = title;
                    }
                }
                None => {
                    registry.windows.insert(
                        tab_id.to_string(),
                        DetachedWindowInfo {
                            tab_id: tab_id.to_string(),
                            label: label.to_string(),
                            title,
                        },
                    );
                }
            }
        }
        self.settled.notify_all();
    }

    /// Remove a tab's entry. Idempotent: returns the removed entry, if any.
    fn remove(&self, tab_id: &str) -> Option<DetachedWindowInfo> {
        let removed = {
            let mut registry = self.lock();
            registry.creating.remove(tab_id);
            registry.reattaching.remove(tab_id);
            registry.windows.remove(tab_id)
        };
        self.settled.notify_all();
        removed
    }

    /// Remember that closing `tab_id`'s window means "return to the main
    /// window". Any other close kills the terminal, so the default is false.
    fn mark_reattach(&self, tab_id: &str) {
        self.lock().reattaching.insert(tab_id.to_string());
    }

    fn clear_reattach(&self, tab_id: &str) {
        self.lock().reattaching.remove(tab_id);
    }

    /// Drop the window entry and take its reattach intent. Both are reported
    /// to the main window so a user close and a programmatic recall stay
    /// distinct.
    fn take_closed(&self, tab_id: &str) -> Option<(DetachedWindowInfo, bool)> {
        let taken = {
            let mut registry = self.lock();
            registry.creating.remove(tab_id);
            let info = registry.windows.remove(tab_id);
            let reattach = registry.reattaching.remove(tab_id);
            info.map(|info| (info, reattach))
        };
        self.settled.notify_all();
        taken
    }

    fn list(&self) -> Vec<DetachedWindowInfo> {
        self.lock().windows.values().cloned().collect()
    }
}

/// Adopt a window that already exists in Tauri (possibly outside the registry)
/// and bring it to the front.
fn adopt_and_focus(
    state: &DetachedTabWindows,
    tab_id: &str,
    label: &str,
    title: Option<String>,
    window: &WebviewWindow,
) -> Result<(), String> {
    state.remember_existing(tab_id, label, title.clone());
    if let Some(title) = title.as_deref() {
        if let Err(error) = window.set_title(title) {
            tracing::warn!(%error, tab_id, "failed to update detached window title");
        }
    }
    focus_window(window)
}

/// Decide the outcome of losing the creation race for `tab_id`.
///
/// Split out from [`open_tab_window`] so both failure branches are unit
/// testable without a running Tauri application. A settled creation with no
/// live window means the registry entry is stale; reporting it as an error lets
/// the frontend roll back its optimistic detach state instead of leaving a tab
/// hidden with no window to show it.
fn resolve_waited_creation<T>(
    tab_id: &str,
    creation_settled: bool,
    window: Option<T>,
) -> Result<T, String> {
    if !creation_settled {
        return Err(format!(
            "detached window for tab {tab_id} did not finish opening in time; try again"
        ));
    }
    window.ok_or_else(|| {
        format!("detached window for tab {tab_id} is registered but no longer exists; try again")
    })
}

/// Create the detached window for `tab_id`, or focus it when it already exists.
#[tauri::command]
pub fn open_tab_window(
    app: AppHandle,
    state: State<'_, DetachedTabWindows>,
    tab_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = label_for_tab(&tab_id)?;

    if let Some(window) = app.get_webview_window(&label) {
        return adopt_and_focus(&state, &tab_id, &label, title, &window);
    }

    if !state.begin_create(&tab_id) {
        // Another call owns creation (or the registry holds a stale entry).
        // Wait briefly for it to publish the window and focus it, so a second
        // open request is not a silent no-op.
        let settled = state.wait_for_creation(&tab_id, Duration::from_secs(3));
        let window = if settled { app.get_webview_window(&label) } else { None };
        return match resolve_waited_creation(&tab_id, settled, window) {
            Ok(window) => adopt_and_focus(&state, &tab_id, &label, title, &window),
            Err(error) => {
                if settled {
                    // The registry pointed at a window Tauri no longer knows
                    // about; drop it so a retry can create a fresh one.
                    state.remove(&tab_id);
                }
                tracing::warn!(tab_id, %error, "detached window open failed");
                Err(error)
            }
        };
    }

    let window_title = title.clone().unwrap_or_else(|| DEFAULT_TITLE.to_string());
    let url = PathBuf::from(format!("detached.html?tabId={}", urlencoding::encode(&tab_id)));
    let app_for_create = app.clone();
    let label_for_create = label.clone();
    let tab_id_for_log = tab_id.clone();

    let created = run_on_main_thread_blocking(&app, move || {
        if let Some(window) = app_for_create.get_webview_window(&label_for_create) {
            return Ok(window);
        }
        WebviewWindowBuilder::new(&app_for_create, &label_for_create, WebviewUrl::App(url))
            .title(window_title)
            .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .decorations(true)
            // Equivalent of `dragDropEnabled: false`: keep HTML5 drag and drop.
            .disable_drag_drop_handler()
            .build()
            .map_err(|error| format!("failed to create detached window: {error}"))
    });

    let window = match created {
        Ok(Ok(window)) => window,
        Ok(Err(error)) | Err(error) => {
            state.abort_create(&tab_id);
            tracing::error!(tab_id = %tab_id_for_log, %error, "detached window creation failed");
            return Err(error);
        }
    };

    state.finish_create(DetachedWindowInfo { tab_id, label, title });
    tracing::info!(tab_id = %tab_id_for_log, "detached window opened");
    focus_window(&window)
}

#[tauri::command]
pub fn focus_tab_window(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = label_for_tab(&tab_id)?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("detached window for tab {tab_id} not found"))?;
    focus_window(&window)
}

#[tauri::command]
pub fn list_detached_tab_windows(
    state: State<'_, DetachedTabWindows>,
) -> Result<Vec<DetachedWindowInfo>, String> {
    Ok(state.list())
}

/// Close a detached window. `reattach` selects what the close means: `true`
/// returns the tab to the main window (Mission Control's recall action);
/// `false`, the default, closes the terminal. Closing is idempotent: when the
/// window is already gone the registry entry is dropped and the main window is
/// notified with the same intent.
#[tauri::command]
pub fn close_tab_window(
    app: AppHandle,
    state: State<'_, DetachedTabWindows>,
    tab_id: String,
    reattach: Option<bool>,
) -> Result<(), String> {
    let reattach = reattach.unwrap_or(false);
    let label = label_for_tab(&tab_id)?;
    if reattach {
        state.mark_reattach(&tab_id);
    }
    if let Some(window) = app.get_webview_window(&label) {
        return window.close().map_err(|error| {
            if reattach {
                state.clear_reattach(&tab_id);
            }
            format!("failed to close detached window: {error}")
        });
    }
    match state.take_closed(&tab_id) {
        Some((_info, intent)) => notify_main_window_closed(&app, &tab_id, intent),
        // No registry entry: the intent (if any) has nothing to attach to.
        None => state.clear_reattach(&tab_id),
    }
    Ok(())
}

fn notify_main_window_closed(app: &AppHandle, tab_id: &str, reattach: bool) {
    if let Err(error) = app.emit_to(
        "main",
        CLOSED_EVENT,
        serde_json::json!({ "tab_id": tab_id, "reattach": reattach }),
    ) {
        tracing::warn!(%error, tab_id, "failed to notify main window of detached close");
    }
}

/// Lifecycle hook for `tab-*` windows.
///
/// Returns true when the event belonged to a detached window. Cleanup runs only
/// on `Destroyed`: `CloseRequested` can be prevented or deferred, and removing
/// the registry entry (plus telling the main window) there would drop a window
/// that is still alive. This hook never prevents the close, so every window
/// that closes reaches `Destroyed`. The cleanup is idempotent.
pub fn handle_detached_window_event(window: &tauri::Window, event: &tauri::WindowEvent) -> bool {
    let Some(tab_id) = tab_id_from_label(window.label()) else {
        return false;
    };
    if matches!(event, tauri::WindowEvent::Destroyed) {
        let app = window.app_handle();
        if let Some((_info, reattach)) = app.state::<DetachedTabWindows>().take_closed(&tab_id) {
            notify_main_window_closed(app, &tab_id, reattach);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn info(tab_id: &str, title: Option<&str>) -> DetachedWindowInfo {
        DetachedWindowInfo {
            tab_id: tab_id.to_string(),
            label: format!("tab-{tab_id}"),
            title: title.map(str::to_string),
        }
    }

    #[test]
    fn labels_round_trip_and_accept_uuid_shape() {
        let id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
        assert_eq!(label_for_tab(id).unwrap(), format!("tab-{id}"));
        assert_eq!(tab_id_from_label(&format!("tab-{id}")).as_deref(), Some(id));
        assert_eq!(label_for_tab("pane_1-A").unwrap(), "tab-pane_1-A");
        assert_eq!(tab_id_from_label("tab-pane_1-A").as_deref(), Some("pane_1-A"));
    }

    #[test]
    fn labels_round_trip_and_accept_plugin_tab_ids() {
        // Plugin tabs use `plugin:<plugin_id>:<workspace_id>` as the tab id.
        for id in ["plugin:session-browser:workspace-a", "plugin:json-formatter:"] {
            assert!(is_valid_tab_id(id), "{id:?} should be accepted");
            assert_eq!(label_for_tab(id).unwrap(), format!("tab-{id}"));
            assert_eq!(tab_id_from_label(&format!("tab-{id}")).as_deref(), Some(id));
        }
    }

    #[test]
    fn invalid_tab_ids_are_rejected() {
        for id in ["", "has space", "a/b", "a.b", "café", "a?b", "a#b"] {
            assert!(!is_valid_tab_id(id), "{id:?} should be rejected");
            assert!(label_for_tab(id).is_err(), "{id:?} should be rejected");
        }
        assert!(label_for_tab("").is_err());
    }

    #[test]
    fn non_detached_labels_are_ignored() {
        assert_eq!(tab_id_from_label("main"), None);
        assert_eq!(tab_id_from_label("tab-"), None);
        assert_eq!(tab_id_from_label("tab-a b"), None);
        assert_eq!(tab_id_from_label("other-abc"), None);
        assert_eq!(tab_id_from_label("tab/tab-id"), None);
    }

    #[test]
    fn duplicate_open_is_deduplicated_until_the_window_is_removed() {
        let registry = DetachedTabWindows::default();
        assert!(registry.begin_create("one"));
        assert!(!registry.begin_create("one"), "in-flight creation must be deduplicated");
        registry.finish_create(info("one", Some("One")));
        assert!(!registry.begin_create("one"), "existing window must be deduplicated");
        assert_eq!(registry.list(), vec![info("one", Some("One"))]);

        registry.remove("one");
        assert!(registry.begin_create("one"), "closed tab can be reopened");
        registry.abort_create("one");
    }

    #[test]
    fn waiting_for_an_in_flight_creation_unblocks_when_it_settles() {
        let registry = Arc::new(DetachedTabWindows::default());
        assert!(registry.begin_create("one"));
        let waiter = Arc::clone(&registry);
        let handle =
            std::thread::spawn(move || waiter.wait_for_creation("one", Duration::from_secs(5)));

        // Give the waiter time to reach the condvar before publishing.
        std::thread::sleep(Duration::from_millis(20));
        registry.finish_create(info("one", None));

        assert!(handle.join().unwrap());
        assert_eq!(registry.list(), vec![info("one", None)]);
    }

    #[test]
    fn waiting_for_a_settled_tab_returns_immediately() {
        let registry = DetachedTabWindows::default();
        assert!(registry.wait_for_creation("none", Duration::from_millis(10)));
    }

    #[test]
    fn waiting_for_creation_times_out_while_still_in_flight() {
        let registry = DetachedTabWindows::default();
        assert!(registry.begin_create("slow"));
        assert!(!registry.wait_for_creation("slow", Duration::from_millis(10)));
        registry.abort_create("slow");
    }

    #[test]
    fn waited_creation_reports_timeout_and_stale_registry_instead_of_succeeding() {
        // Creation never settled: the caller must retry rather than assume a
        // window exists.
        let timeout = resolve_waited_creation::<()>("t", false, None).unwrap_err();
        assert!(timeout.contains("did not finish opening in time"), "{timeout}");
        assert!(timeout.contains("tab t"), "{timeout}");

        // A stale registry entry: begin_create refuses, waiting settles, but
        // Tauri has no window for the label. That must be an error too.
        let registry = DetachedTabWindows::default();
        registry.finish_create(info("stale", None));
        assert!(!registry.begin_create("stale"), "registry believes the window exists");
        assert!(registry.wait_for_creation("stale", Duration::from_millis(10)));
        let stale = resolve_waited_creation::<()>("stale", true, None).unwrap_err();
        assert!(stale.contains("registered but no longer exists"), "{stale}");

        // A live window resolves normally.
        assert_eq!(resolve_waited_creation("t", true, Some(42)).unwrap(), 42);
    }

    #[test]
    fn aborting_a_create_allows_retry() {
        let registry = DetachedTabWindows::default();
        assert!(registry.begin_create("retry"));
        registry.abort_create("retry");
        assert!(registry.begin_create("retry"));
    }

    #[test]
    fn list_is_sorted_and_remove_is_idempotent() {
        let registry = DetachedTabWindows::default();
        registry.finish_create(info("b", None));
        registry.finish_create(info("a", Some("Alpha")));

        assert_eq!(registry.list(), vec![info("a", Some("Alpha")), info("b", None)]);
        assert_eq!(registry.remove("a"), Some(info("a", Some("Alpha"))));
        assert_eq!(registry.remove("a"), None, "close cleanup must be idempotent");
        assert_eq!(registry.list(), vec![info("b", None)]);
    }

    #[test]
    fn reattach_intent_rides_along_with_the_closed_entry_once() {
        let registry = DetachedTabWindows::default();
        registry.finish_create(info("a", None));
        registry.mark_reattach("a");

        let (_, reattach) = registry.take_closed("a").expect("closed entry");
        assert!(reattach, "recall intent must be reported");
        assert!(registry.take_closed("a").is_none(), "close cleanup must be idempotent");

        // A plain close carries no intent.
        registry.finish_create(info("b", None));
        let (_, reattach) = registry.take_closed("b").expect("closed entry");
        assert!(!reattach, "a user close closes the terminal");
    }

    #[test]
    fn removing_a_window_drops_any_stale_reattach_intent() {
        let registry = DetachedTabWindows::default();
        registry.finish_create(info("a", None));
        registry.mark_reattach("a");
        registry.remove("a");

        registry.finish_create(info("a", None));
        let (_, reattach) = registry.take_closed("a").expect("reopened entry");
        assert!(!reattach, "a fresh window must not inherit the old intent");
    }

    #[test]
    fn remembering_an_existing_window_keeps_the_old_title_when_none_is_given() {
        let registry = DetachedTabWindows::default();
        registry.remember_existing("t", "tab-t", Some("Terminal".into()));
        registry.remember_existing("t", "tab-t", None);
        assert_eq!(registry.list(), vec![info("t", Some("Terminal"))]);
        registry.remember_existing("t", "tab-t", Some("Renamed".into()));
        assert_eq!(registry.list(), vec![info("t", Some("Renamed"))]);
    }
}

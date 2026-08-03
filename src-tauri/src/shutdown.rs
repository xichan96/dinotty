use dinotty_server::session::{CloseReason, SessionManager};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use uuid::Uuid;

const FRONTEND_DEADLINE: Duration = Duration::from_millis(2500);

#[derive(Clone, Debug, Default, Eq, PartialEq)]
enum QuitPhase {
    #[default]
    Idle,
    AwaitingFrontend {
        request_id: String,
        source: String,
    },
    Finalizing {
        request_id: String,
        source: String,
    },
}

#[derive(Default)]
struct QuitModel {
    phase: QuitPhase,
}

impl QuitModel {
    fn request(&mut self, source: String, request_id: String) -> bool {
        if self.phase != QuitPhase::Idle {
            return false;
        }
        self.phase = QuitPhase::AwaitingFrontend { request_id, source };
        true
    }

    fn finalize(&mut self, request_id: &str) -> Option<(String, String)> {
        let QuitPhase::AwaitingFrontend { request_id: active, source } = &self.phase else {
            return None;
        };
        if active != request_id {
            return None;
        }
        let result = (active.clone(), source.clone());
        self.phase =
            QuitPhase::Finalizing { request_id: result.0.clone(), source: result.1.clone() };
        Some(result)
    }

    fn is_finalizing(&self) -> bool {
        matches!(self.phase, QuitPhase::Finalizing { .. })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitRequestPayload {
    request_id: String,
    source: String,
}

pub struct ShutdownCoordinator {
    model: Mutex<QuitModel>,
    cleanup_started: AtomicBool,
    manager: Arc<SessionManager>,
}

impl ShutdownCoordinator {
    pub fn new(manager: Arc<SessionManager>) -> Self {
        Self {
            model: Mutex::new(QuitModel::default()),
            cleanup_started: AtomicBool::new(false),
            manager,
        }
    }

    pub fn request_quit(&self, app: &AppHandle, source: impl Into<String>) {
        let source = source.into();
        let request_id = Uuid::new_v4().to_string();
        let started = self
            .model
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .request(source.clone(), request_id.clone());
        if !started {
            tracing::info!(source, "desktop.quit.duplicate_ignored");
            return;
        }

        tracing::info!(request_id, source, "desktop.quit.requested");
        let payload = QuitRequestPayload { request_id: request_id.clone(), source };
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = window.emit("desktop-quit-requested", payload) {
                tracing::warn!(request_id, %error, "desktop quit frontend emit failed");
            }
        } else {
            tracing::warn!(request_id, "desktop quit frontend unavailable");
        }

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FRONTEND_DEADLINE).await;
            let coordinator = app.state::<ShutdownCoordinator>();
            if coordinator.finalize_if_current(&app, &request_id, "timeout") {
                tracing::warn!(request_id, "desktop.quit.frontend_timeout");
            }
        });
    }

    fn finalize_if_current(&self, app: &AppHandle, request_id: &str, trigger: &str) -> bool {
        let Some((request_id, source)) =
            self.model.lock().unwrap_or_else(|error| error.into_inner()).finalize(request_id)
        else {
            return false;
        };
        tracing::info!(request_id, source, trigger, "desktop.quit.finalizing");
        self.cleanup_and_exit(app);
        true
    }

    fn cleanup_and_exit(&self, app: &AppHandle) {
        if self.cleanup_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let pane_ids: Vec<String> =
            self.manager.sessions.iter().map(|entry| entry.key().clone()).collect();
        tracing::info!(sessions = pane_ids.len(), "desktop quit terminating sessions");
        for pane_id in pane_ids {
            self.manager.close_session(&pane_id, CloseReason::Shutdown, true, None);
        }
        if let Err(error) = app.global_shortcut().unregister_all() {
            tracing::warn!(%error, "failed to unregister global shortcuts during shutdown");
        }
        app.exit(0);
    }

    pub fn is_finalizing(&self) -> bool {
        self.model.lock().unwrap_or_else(|error| error.into_inner()).is_finalizing()
    }

    pub fn force_cleanup(&self) {
        if self.cleanup_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let pane_ids: Vec<String> =
            self.manager.sessions.iter().map(|entry| entry.key().clone()).collect();
        for pane_id in pane_ids {
            self.manager.close_session(&pane_id, CloseReason::Shutdown, true, None);
        }
    }
}

#[tauri::command]
pub fn request_desktop_quit(source: String, app: AppHandle, state: State<'_, ShutdownCoordinator>) {
    state.request_quit(&app, source);
}

#[tauri::command]
pub fn desktop_quit_ack(
    request_id: String,
    persistence: String,
    app: AppHandle,
    state: State<'_, ShutdownCoordinator>,
) {
    if persistence == "failed" {
        tracing::warn!(request_id, "desktop.quit.frontend_persistence_failed");
    }
    if state.finalize_if_current(&app, &request_id, "frontend_ack") {
        tracing::info!(request_id, "desktop.quit.frontend_acknowledged");
    } else {
        tracing::info!(request_id, "desktop.quit.stale_ack_ignored");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_model_accepts_one_request_and_matching_ack() {
        let mut model = QuitModel::default();
        assert!(model.request("tray".into(), "one".into()));
        assert!(!model.request("window".into(), "two".into()));
        assert_eq!(model.finalize("old"), None);
        assert_eq!(model.finalize("one"), Some(("one".into(), "tray".into())));
        assert!(model.is_finalizing());
        assert_eq!(model.finalize("one"), None);
    }
}

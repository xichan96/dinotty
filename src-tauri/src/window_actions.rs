use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::tray::state::{TrayCapability, TrayCapabilityState, TrayMode};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilities {
    platform: &'static str,
    tray_mode: &'static str,
    can_hide_to_tray: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tray_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowActionError {
    code: &'static str,
    message: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum MainWindowPhase {
    #[default]
    Absent,
    Creating,
    Ready,
}

#[derive(Default)]
pub struct MainWindowState(Mutex<MainWindowPhase>);

impl MainWindowState {
    fn mark_ready(&self) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = MainWindowPhase::Ready;
    }

    fn begin_create(&self) -> bool {
        let mut phase = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if *phase == MainWindowPhase::Creating {
            return false;
        }
        *phase = MainWindowPhase::Creating;
        true
    }

    fn mark_absent(&self) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = MainWindowPhase::Absent;
    }
}

impl From<TrayCapability> for DesktopCapabilities {
    fn from(capability: TrayCapability) -> Self {
        let platform = std::env::consts::OS;
        match capability {
            TrayCapability::Installed { mode } => Self {
                platform,
                tray_mode: match mode {
                    TrayMode::Full => "full",
                    TrayMode::ShowOnly => "showOnly",
                },
                can_hide_to_tray: mode == TrayMode::Full,
                tray_error: None,
            },
            TrayCapability::Unavailable { reason } => Self {
                platform,
                tray_mode: "unavailable",
                can_hide_to_tray: false,
                tray_error: Some(reason),
            },
            TrayCapability::NotAttempted => Self {
                platform,
                tray_mode: "unavailable",
                can_hide_to_tray: false,
                tray_error: Some("tray installation has not completed".into()),
            },
        }
    }
}

#[tauri::command]
pub fn desktop_capabilities(state: State<'_, TrayCapabilityState>) -> DesktopCapabilities {
    state.get().into()
}

fn prepare_main_window(_window: &WebviewWindow) {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    if let Err(error) = _window.remove_menu() {
        tracing::warn!(%error, "failed to remove native main-window menu");
    }
}

fn show_main_window(window: &WebviewWindow) {
    let mut failures = Vec::new();
    if let Err(error) = window.show() {
        failures.push(format!("show: {error}"));
    }
    if let Err(error) = window.unminimize() {
        failures.push(format!("unminimize: {error}"));
    }
    if let Err(error) = window.set_focus() {
        failures.push(format!("focus: {error}"));
    }
    if failures.is_empty() {
        tracing::info!("window.reveal.succeeded");
    } else {
        tracing::warn!(reasons = %failures.join(", "), "window.reveal.failed");
    }
}

pub fn initialize_existing_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        prepare_main_window(&window);
        app.state::<MainWindowState>().mark_ready();
    }
}

/// Creates the configured main WebView only when the user explicitly asks for it.
pub fn request_main_window(app: &AppHandle, action: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        app.state::<MainWindowState>().mark_ready();
        show_main_window(&window);
        return;
    }

    let state = app.state::<MainWindowState>();
    if !state.begin_create() {
        tracing::info!(action, "window.create.already_in_progress");
        return;
    }

    let app_handle = app.clone();
    let schedule_result = app.run_on_main_thread(move || {
        let Some(mut config) =
            app_handle.config().app.windows.iter().find(|config| config.label == "main").cloned()
        else {
            tracing::error!("window.create.failed: main window config unavailable");
            app_handle.state::<MainWindowState>().mark_absent();
            return;
        };
        config.create = true;
        config.visible = false;

        match tauri::WebviewWindowBuilder::from_config(&app_handle, &config)
            .and_then(|builder| builder.build())
        {
            Ok(window) => {
                prepare_main_window(&window);
                #[cfg(target_os = "macos")]
                if let Err(error) =
                    app_handle.set_activation_policy(tauri::ActivationPolicy::Regular)
                {
                    tracing::warn!(%error, "failed to restore regular macOS activation policy");
                }
                app_handle.state::<MainWindowState>().mark_ready();
                show_main_window(&window);
                tracing::info!(action, "window.create.succeeded");
            }
            Err(error) => {
                app_handle.state::<MainWindowState>().mark_absent();
                tracing::error!(action, %error, "window.create.failed");
            }
        }
    });

    if let Err(error) = schedule_result {
        app.state::<MainWindowState>().mark_absent();
        tracing::error!(action, %error, "window.create.schedule_failed");
    }
}

pub fn reveal_main_window(app: &AppHandle) {
    request_main_window(app, "reveal");
}

fn can_hide(app: &AppHandle) -> Result<(), String> {
    let capability = app.state::<TrayCapabilityState>().get();
    if capability.can_hide() {
        Ok(())
    } else {
        tracing::warn!(?capability, "window.hide.rejected");
        Err("system tray is unavailable; the window was kept open".into())
    }
}

pub fn hide_main_window_checked(app: &AppHandle) -> Result<(), String> {
    can_hide(app)?;
    let window = app.get_webview_window("main").ok_or("main window unavailable")?;
    window.hide().map_err(|error| error.to_string())?;
    tracing::info!("window.hide.succeeded");
    Ok(())
}

pub fn toggle_main_window_checked(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        request_main_window(app, "toggle");
        return Ok(());
    };
    match window.is_visible() {
        Ok(true) => hide_main_window_checked(app),
        Ok(false) | Err(_) => {
            reveal_main_window(app);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), WindowActionError> {
    hide_main_window_checked(&app)
        .map_err(|message| WindowActionError { code: "tray_hide_unavailable", message })
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn open_system_tray_settings() -> Result<(), String> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target: Vec<u16> =
        std::ffi::OsStr::new("ms-settings:taskbar").encode_wide().chain(iter::once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!("failed to open Windows taskbar settings (code {})", result as isize))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn open_system_tray_settings() -> Result<(), String> {
    Err("system tray settings are only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_window_creation_is_deduplicated_and_can_retry() {
        let state = MainWindowState::default();
        assert!(state.begin_create());
        assert!(!state.begin_create());
        state.mark_absent();
        assert!(state.begin_create());
        state.mark_ready();
        assert!(state.begin_create());
    }
}

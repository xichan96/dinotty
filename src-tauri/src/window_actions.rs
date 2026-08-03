use serde::Serialize;
use tauri::{AppHandle, Manager, State};

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

pub fn reveal_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("window.reveal.failed: main window unavailable");
        return;
    };
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
        return Err("main window unavailable".into());
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

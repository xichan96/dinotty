pub mod menu;
pub mod platform;
pub mod state;

use std::panic::{catch_unwind, AssertUnwindSafe};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

use crate::shutdown::ShutdownCoordinator;
use crate::window_actions::{reveal_main_window, toggle_main_window_checked};
use state::{TrayCapabilityState, TrayMenuState};

pub const MAIN_TRAY_ID: &str = "dinotty-main-tray";
pub const TRAY_TOGGLE_MAIN_WINDOW: &str = "tray.toggle-main-window";
pub const TRAY_SHOW_MAIN_WINDOW: &str = "tray.show-main-window";
pub const TRAY_QUIT: &str = "tray.quit";

fn run_builder<T, F>(builder: F, catch_panics: bool) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    if catch_panics {
        match catch_unwind(AssertUnwindSafe(builder)) {
            Ok(result) => result,
            Err(_) => {
                tracing::warn!("tray.install.panic_caught");
                Err("tray backend panicked while loading the AppIndicator runtime".into())
            }
        }
    } else {
        builder()
    }
}

fn try_build(app: &App) -> Result<(), String> {
    if app.tray_by_id(MAIN_TRAY_ID).is_some() {
        tracing::info!("tray.install.duplicate_skipped");
        return Ok(());
    }
    let tray_menu = menu::build(app).map_err(|error| error.to_string())?;
    let icon = tauri::image::Image::from_bytes(platform::TRAY_ICON_BYTES)
        .map_err(|error| error.to_string())?;
    let builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .icon(icon)
        .icon_as_template(platform::use_template_icon())
        .show_menu_on_left_click(platform::show_menu_on_left_click())
        .tooltip("Dinotty")
        .menu(&tray_menu.menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_TOGGLE_MAIN_WINDOW => {
                if let Err(error) = toggle_main_window_checked(app) {
                    tracing::warn!(%error, "tray toggle failed");
                }
            }
            TRAY_SHOW_MAIN_WINDOW => reveal_main_window(app),
            TRAY_QUIT => app.state::<ShutdownCoordinator>().request_quit(app, "tray"),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "windows")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }
                )
            {
                reveal_main_window(tray.app_handle());
            }
        });
    let tray = run_builder(
        || builder.build(app).map_err(|error| error.to_string()),
        cfg!(target_os = "linux"),
    )?;
    tray.set_visible(true).map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    match tray.rect().map_err(|error| error.to_string())? {
        Some(rect) => tracing::info!(?rect, "tray.install.windows_shell_verified"),
        None => return Err("Windows Shell did not register the tray icon".into()),
    }

    if app.tray_by_id(MAIN_TRAY_ID).is_none() {
        return Err("tray was not present after successful build".into());
    }
    app.state::<TrayMenuState>().store(tray_menu.handles);
    Ok(())
}

pub fn install_tray(app: &App) -> state::TrayCapability {
    tracing::info!("tray.install.started");
    let result = try_build(app);
    match result {
        Ok(()) => {
            let mode = platform::platform_mode();
            app.state::<TrayCapabilityState>().set_installed(mode);
            tracing::info!(?mode, "tray.mode.configured");
            tracing::info!("tray.install.succeeded");
        }
        Err(error) => {
            app.state::<TrayCapabilityState>().set_unavailable(error.clone());
            tracing::warn!(platform = std::env::consts::OS, %error, "tray.install.failed");
        }
    }
    app.state::<TrayCapabilityState>().get()
}

#[cfg(test)]
mod tests {
    use super::run_builder;

    #[test]
    fn builder_errors_and_panics_are_degraded() {
        assert!(run_builder(|| Ok::<_, String>(()), true).is_ok());
        assert_eq!(run_builder(|| Err::<(), _>("no host".into()), true), Err("no host".into()));
        assert!(run_builder(|| -> Result<(), String> { panic!("missing dynamic library") }, true)
            .is_err());
    }
}

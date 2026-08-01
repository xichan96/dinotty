use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::{App, Wry};

use super::platform;
use super::state::TrayMenuHandles;
use super::{TRAY_QUIT, TRAY_SHOW_MAIN_WINDOW, TRAY_TOGGLE_MAIN_WINDOW};

pub struct TrayMenu {
    pub menu: Menu<Wry>,
    pub handles: TrayMenuHandles,
}

pub fn build(app: &App) -> tauri::Result<TrayMenu> {
    let show_id = if platform::platform_mode() == super::state::TrayMode::ShowOnly {
        TRAY_SHOW_MAIN_WINDOW
    } else {
        TRAY_TOGGLE_MAIN_WINDOW
    };
    let show_text = if platform::platform_mode() == super::state::TrayMode::ShowOnly {
        "Show Dinotty"
    } else {
        "Show/Hide Dinotty"
    };
    let show = MenuItemBuilder::with_id(show_id, show_text).build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT, "Quit Dinotty").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
    Ok(TrayMenu { menu, handles: TrayMenuHandles { _show: show, _quit: quit } })
}

use super::state::TrayMode;

pub fn platform_mode() -> TrayMode {
    if cfg!(target_os = "linux") {
        TrayMode::ShowOnly
    } else {
        TrayMode::Full
    }
}

pub fn show_menu_on_left_click() -> bool {
    !cfg!(target_os = "windows")
}

pub fn use_template_icon() -> bool {
    cfg!(target_os = "macos")
}

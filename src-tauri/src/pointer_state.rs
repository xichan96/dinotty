//! Pointer button introspection for the native-window dock gestures.
//!
//! Dragging a window by its native title bar hands the pointer to the OS: the
//! webview never sees the matching `mouseup`, so JavaScript cannot distinguish
//! "still holding the window" from "released over the target". Windows that
//! support docking poll this command while they are being dragged.
//!
//! `None` means the platform has no reliable answer; the frontend then keeps
//! its settle-timer fallback instead of release detection.

/// Bitmask of the mouse buttons currently pressed (0 = none), or `None` when
/// the platform cannot report it.
///
/// The command is `async` so it runs off the main thread: on macOS the native
/// window drag blocks the main thread for its whole duration, and a main-thread
/// command would only answer after the drag had already ended.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pointer_buttons_down() -> Option<u32> {
    Some(objc2_app_kit::NSEvent::pressedMouseButtons() as u32)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn pointer_buttons_down() -> Option<u32> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };

    let down = |key: u16| (unsafe { GetAsyncKeyState(key as i32) } as u16 & 0x8000) != 0;
    let mut mask = 0;
    if down(VK_LBUTTON) {
        mask |= 1;
    }
    if down(VK_RBUTTON) {
        mask |= 2;
    }
    if down(VK_MBUTTON) {
        mask |= 4;
    }
    Some(mask)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub async fn pointer_buttons_down() -> Option<u32> {
    None
}

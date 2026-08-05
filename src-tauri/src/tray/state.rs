use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::MenuItem;
use tauri::Wry;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayMode {
    Full,
    ShowOnly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrayCapability {
    NotAttempted,
    Installed { mode: TrayMode },
    Unavailable { reason: String },
}

impl TrayCapability {
    pub fn can_hide(&self) -> bool {
        matches!(self, Self::Installed { mode: TrayMode::Full })
    }

    pub fn is_available(&self) -> bool {
        matches!(self, Self::Installed { .. })
    }
}

pub struct TrayCapabilityState(Mutex<TrayCapability>);

impl Default for TrayCapabilityState {
    fn default() -> Self {
        Self(Mutex::new(TrayCapability::NotAttempted))
    }
}

impl TrayCapabilityState {
    pub fn get(&self) -> TrayCapability {
        self.0.lock().unwrap_or_else(|error| error.into_inner()).clone()
    }

    pub fn set_installed(&self, mode: TrayMode) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) =
            TrayCapability::Installed { mode };
    }

    pub fn set_unavailable(&self, reason: String) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) =
            TrayCapability::Unavailable { reason };
    }
}

#[derive(Default)]
pub struct TrayMenuState {
    handles: Mutex<Option<TrayMenuHandles>>,
}

pub struct TrayMenuHandles {
    pub _show: MenuItem<Wry>,
    pub _quit: MenuItem<Wry>,
}

impl TrayMenuState {
    pub fn store(&self, handles: TrayMenuHandles) {
        *self.handles.lock().unwrap_or_else(|error| error.into_inner()) = Some(handles);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_full_install_can_hide() {
        assert!(TrayCapability::Installed { mode: TrayMode::Full }.can_hide());
        assert!(!TrayCapability::Installed { mode: TrayMode::ShowOnly }.can_hide());
        assert!(!TrayCapability::NotAttempted.can_hide());
        assert!(!TrayCapability::Unavailable { reason: "missing host".into() }.can_hide());
        assert!(TrayCapability::Installed { mode: TrayMode::ShowOnly }.is_available());
        assert!(!TrayCapability::Unavailable { reason: "missing host".into() }.is_available());
    }
}

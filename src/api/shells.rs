use std::sync::Arc;

use axum::{
    extract::State,
    http::{header, HeaderValue},
    Json,
};
use serde::Serialize;

use crate::{
    platform::{
        shell::{DetectedShell, ShellPreference},
        shell_probe::{ProbeAvailability, ShellProbeService, ShellProbeSnapshot},
    },
    settings::SettingsState,
};

#[derive(Serialize)]
struct CurrentSelection {
    kind: String,
    distro: Option<String>,
    status: &'static str,
    reason: Option<String>,
}

#[derive(Serialize)]
struct ShellsResponse {
    platform: &'static str,
    default_shell: DetectedShell,
    current_selection: CurrentSelection,
    shells: Vec<DetectedShell>,
    warnings: Vec<String>,
}

pub async fn get_shells(
    State(settings): State<SettingsState>,
    State(service): State<Arc<ShellProbeService>>,
) -> ([(header::HeaderName, HeaderValue); 1], Json<impl Serialize>) {
    let preference = {
        let settings = settings.read().await;
        ShellPreference::new(
            settings.shell.clone(),
            settings.shell_path.clone(),
            settings.wsl_distro.clone(),
        )
    };
    let snapshot = service.probe().await;
    let current_selection = selection_status(&service, &preference, &snapshot).await;
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(ShellsResponse {
            platform: snapshot.platform,
            default_shell: snapshot.default_shell,
            current_selection,
            shells: snapshot.shells,
            warnings: snapshot.warnings,
        }),
    )
}

async fn selection_status(
    service: &ShellProbeService,
    preference: &ShellPreference,
    snapshot: &ShellProbeSnapshot,
) -> CurrentSelection {
    let kind = preference.kind.trim();
    let kind = if kind.is_empty() { "auto" } else { kind };
    let distro = (kind == "wsl")
        .then(|| preference.wsl_distro.clone())
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let (status, reason) = match kind {
        "auto" => ("available", None),
        "custom" => match service.resolve(preference).await {
            Ok(_) => ("available", None),
            Err(error) => ("unavailable", Some(error.code.to_string())),
        },
        "wsl" => {
            let selected =
                snapshot.shells.iter().any(|shell| shell.kind == "wsl" && shell.distro == distro);
            if selected {
                ("available", None)
            } else {
                match snapshot.wsl_availability {
                    ProbeAvailability::Available => {
                        ("unavailable", Some("wsl_distro_missing".to_string()))
                    }
                    ProbeAvailability::Unavailable { reason } => {
                        ("unavailable", Some(reason.to_string()))
                    }
                    ProbeAvailability::Unknown { reason } => ("unknown", Some(reason.to_string())),
                }
            }
        }
        other => {
            if snapshot.shells.iter().any(|shell| shell.kind == other) {
                ("available", None)
            } else {
                ("unavailable", Some("shell_unavailable".to_string()))
            }
        }
    };

    CurrentSelection { kind: kind.to_string(), distro, status, reason }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        extract::FromRef,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    #[derive(Clone)]
    struct TestState {
        settings: SettingsState,
        service: Arc<ShellProbeService>,
    }

    impl FromRef<TestState> for SettingsState {
        fn from_ref(state: &TestState) -> Self {
            state.settings.clone()
        }
    }

    impl FromRef<TestState> for Arc<ShellProbeService> {
        fn from_ref(state: &TestState) -> Self {
            state.service.clone()
        }
    }

    #[tokio::test]
    async fn endpoint_returns_shape_and_disables_caching() {
        let state = TestState {
            settings: Arc::new(tokio::sync::RwLock::new(crate::settings::Settings::default())),
            service: Arc::new(ShellProbeService::new()),
        };
        let app = Router::new().route("/api/shells", get(get_shells)).with_state(state);

        let response = app
            .oneshot(Request::builder().uri("/api/shells").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = to_bytes(response.into_body(), 2 * 1024 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(value["platform"].is_string());
        assert!(value["default_shell"]["kind"].is_string());
        assert_eq!(value["current_selection"]["kind"], "auto");
        assert_eq!(value["current_selection"]["status"], "available");
        assert!(value["shells"].is_array());
        assert!(value["warnings"].is_array());
    }

    #[tokio::test]
    async fn missing_saved_wsl_distribution_is_reported_without_changing_it() {
        let preference =
            ShellPreference::new("wsl", None, Some("Missing Distribution".to_string()));
        let snapshot = ShellProbeSnapshot {
            platform: "windows",
            default_shell: DetectedShell {
                kind: "powershell".to_string(),
                program: "pwsh.exe".to_string(),
                distro: None,
            },
            shells: vec![DetectedShell {
                kind: "wsl".to_string(),
                program: "wsl.exe".to_string(),
                distro: None,
            }],
            warnings: Vec::new(),
            wsl_availability: ProbeAvailability::Available,
        };

        let current = selection_status(&ShellProbeService::new(), &preference, &snapshot).await;

        assert_eq!(current.kind, "wsl");
        assert_eq!(current.distro.as_deref(), Some("Missing Distribution"));
        assert_eq!(current.status, "unavailable");
        assert_eq!(current.reason.as_deref(), Some("wsl_distro_missing"));
    }
}

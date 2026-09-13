#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value
)]
use super::BusEvent;
use crate::session::SyncMsg;

/// Map a backend `BusEvent` to a generic `SyncMsg::Event` for plugin consumption.
///
/// Returns `None` for variants that already have a dedicated `SyncMsg` channel
/// (`TabCreated`, `TabClosed`) or are not server-native (`Custom` - emitted by
/// plugins themselves).
///
/// `CommandFinished.stdout` is intentionally **not** bridged: it can be large
/// and may contain sensitive output. Plugins subscribing to `command.finished`
/// only receive the command name, exit code, duration, and detection method.
#[allow(clippy::too_many_lines)]
pub fn map_bus_event_to_sync_event(event: &BusEvent) -> Option<SyncMsg> {
    let (event_name, data) = match event {
        BusEvent::CommandFinished { pane_id, command, exit_code, duration_ms, method, .. } => (
            "command.finished",
            serde_json::json!({
                "pane_id": pane_id,
                "command": command,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "method": method,
            }),
        ),
        BusEvent::SessionCreated { pane_id, shell_type } => (
            "session.created",
            serde_json::json!({
                "pane_id": pane_id,
                "shell_type": shell_type,
            }),
        ),
        BusEvent::SessionClosed { pane_id, exit_code } => (
            "session.closed",
            serde_json::json!({
                "pane_id": pane_id,
                "exit_code": exit_code,
            }),
        ),
        BusEvent::AuthLoginFailed { ip, reason, attempt_count, locked_until } => (
            "auth.login_failed",
            serde_json::json!({
                "ip": ip,
                "reason": reason,
                "attempt_count": attempt_count,
                "locked_until": locked_until,
            }),
        ),
        BusEvent::VerificationCode { request_id, code, occurred_at } => (
            "auth.verification_code",
            serde_json::json!({
                "request_id": request_id,
                "code": code,
                "occurred_at": occurred_at,
            }),
        ),
        BusEvent::VerificationCodeConsumed { request_id, ip, user_agent, occurred_at } => (
            "auth.verification_code_consumed",
            serde_json::json!({
                "request_id": request_id,
                "ip": ip,
                "user_agent": user_agent,
                "occurred_at": occurred_at,
            }),
        ),
        BusEvent::TabCreated { tab_id, pane_id } => (
            "tab.created",
            serde_json::json!({
                "tab_id": tab_id,
                "pane_id": pane_id,
            }),
        ),
        BusEvent::TabClosed { tab_id } => (
            "tab.closed",
            serde_json::json!({
                "tab_id": tab_id,
            }),
        ),
        BusEvent::FileChanged { path, change_type } => (
            "file.changed",
            serde_json::json!({
                "path": path,
                "change_type": change_type,
            }),
        ),
        BusEvent::Notify { pane_id, title, body, notification_type, severity, occurred_at } => (
            "notification.received",
            serde_json::json!({
                "pane_id": pane_id,
                "title": title,
                "body": body,
                "notification_type": notification_type,
                "severity": severity,
                "occurred_at": occurred_at,
            }),
        ),
        BusEvent::ProcessExited { plugin_id, pid, exit_code } => (
            "process.exited",
            serde_json::json!({
                "plugin_id": plugin_id,
                "pid": pid,
                "exit_code": exit_code,
            }),
        ),
        BusEvent::PluginChanged { plugin_id, change } => (
            "plugin.changed",
            serde_json::json!({
                "plugin_id": plugin_id,
                "change": change,
            }),
        ),
        BusEvent::Custom { .. } => return None,
    };
    Some(SyncMsg::Event {
        source_pane_id: None,
        plugin_id: None,
        target_plugin_id: None,
        event_name: event_name.to_string(),
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_finished_omits_stdout() {
        let event = BusEvent::CommandFinished {
            pane_id: "p1".into(),
            command: "ls".into(),
            exit_code: 0,
            duration_ms: 100,
            stdout: "secret output".into(),
            method: "shell_integration".into(),
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "command.finished");
                assert_eq!(data["pane_id"], "p1");
                assert_eq!(data["command"], "ls");
                assert_eq!(data["exit_code"], 0);
                assert_eq!(data["duration_ms"], 100);
                assert_eq!(data["method"], "shell_integration");
                assert!(data.get("stdout").is_none());
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn session_created_maps() {
        let event = BusEvent::SessionCreated { pane_id: "p1".into(), shell_type: "zsh".into() };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "session.created");
                assert_eq!(data["pane_id"], "p1");
                assert_eq!(data["shell_type"], "zsh");
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn session_closed_maps() {
        let event = BusEvent::SessionClosed { pane_id: "p1".into(), exit_code: Some(0) };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "session.closed");
                assert_eq!(data["pane_id"], "p1");
                assert_eq!(data["exit_code"], 0);
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn auth_login_failed_maps_with_all_fields() {
        let event = BusEvent::AuthLoginFailed {
            ip: "1.2.3.4".into(),
            reason: "token_mismatch".into(),
            attempt_count: 3,
            locked_until: Some(1_700_000_000),
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "auth.login_failed");
                assert_eq!(data["ip"], "1.2.3.4");
                assert_eq!(data["reason"], "token_mismatch");
                assert_eq!(data["attempt_count"], 3);
                assert_eq!(data["locked_until"], 1_700_000_000);
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn auth_login_failed_without_lock() {
        let event = BusEvent::AuthLoginFailed {
            ip: "1.2.3.4".into(),
            reason: "token_mismatch".into(),
            attempt_count: 1,
            locked_until: None,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { data, .. } => {
                assert!(data.get("locked_until").is_none() || data["locked_until"].is_null());
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn verification_code_maps() {
        let event = BusEvent::VerificationCode {
            request_id: "req-abc".into(),
            code: "123456".into(),
            occurred_at: 1_700_000_000_000,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "auth.verification_code");
                assert_eq!(data["request_id"], "req-abc");
                assert_eq!(data["code"], "123456");
                assert_eq!(data["occurred_at"], serde_json::json!(1_700_000_000_000u64));
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn verification_code_consumed_maps_with_ua() {
        let event = BusEvent::VerificationCodeConsumed {
            request_id: "req-abc".into(),
            ip: "1.2.3.4".into(),
            user_agent: Some("Mozilla/5.0".into()),
            occurred_at: 1_700_000_000_000,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "auth.verification_code_consumed");
                assert_eq!(data["request_id"], "req-abc");
                assert_eq!(data["ip"], "1.2.3.4");
                assert_eq!(data["user_agent"], "Mozilla/5.0");
                assert_eq!(data["occurred_at"], serde_json::json!(1_700_000_000_000u64));
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn verification_code_consumed_without_ua_omits_field() {
        let event = BusEvent::VerificationCodeConsumed {
            request_id: "req-abc".into(),
            ip: "1.2.3.4".into(),
            user_agent: None,
            occurred_at: 0,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { data, .. } => {
                assert!(data.get("user_agent").is_none() || data["user_agent"].is_null());
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn unbridged_variants_return_none() {
        assert!(map_bus_event_to_sync_event(&BusEvent::Custom {
            plugin_id: "p".into(),
            event_name: "x".into(),
            data: serde_json::json!({}),
        })
        .is_none());
    }

    #[test]
    fn tab_created_maps() {
        let event = BusEvent::TabCreated { tab_id: "t1".into(), pane_id: "p1".into() };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "tab.created");
                assert_eq!(data["tab_id"], "t1");
                assert_eq!(data["pane_id"], "p1");
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn tab_closed_maps() {
        let event = BusEvent::TabClosed { tab_id: "t1".into() };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "tab.closed");
                assert_eq!(data["tab_id"], "t1");
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn file_changed_maps() {
        let event = BusEvent::FileChanged { path: "/x".into(), change_type: "changed".into() };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "file.changed");
                assert_eq!(data["path"], "/x");
                assert_eq!(data["change_type"], "changed");
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn notify_maps_with_all_fields() {
        let event = BusEvent::Notify {
            pane_id: "p1".into(),
            title: Some("Claude Code".into()),
            body: "等待输入".into(),
            notification_type: "warning".into(),
            severity: "warning".into(),
            occurred_at: 1_700_000_000_000,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "notification.received");
                assert_eq!(data["pane_id"], "p1");
                assert_eq!(data["title"], "Claude Code");
                assert_eq!(data["body"], "等待输入");
                assert_eq!(data["notification_type"], "warning");
                assert_eq!(data["severity"], "warning");
                assert_eq!(data["occurred_at"], serde_json::json!(1_700_000_000_000u64));
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn notify_without_title_omits_field_in_serialization() {
        let event = BusEvent::Notify {
            pane_id: "p1".into(),
            title: None,
            body: "bell".into(),
            notification_type: "bell".into(),
            severity: "info".into(),
            occurred_at: 0,
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { data, .. } => {
                assert!(data.get("title").is_none() || data["title"].is_null());
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn process_exited_maps() {
        let event = BusEvent::ProcessExited {
            plugin_id: "my-plugin".into(),
            pid: 1234,
            exit_code: Some(0),
        };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "process.exited");
                assert_eq!(data["plugin_id"], "my-plugin");
                assert_eq!(data["pid"], 1234);
                assert_eq!(data["exit_code"], 0);
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }

    #[test]
    fn plugin_changed_maps() {
        let event =
            BusEvent::PluginChanged { plugin_id: "my-plugin".into(), change: "installed".into() };
        let msg = map_bus_event_to_sync_event(&event).expect("should map");
        match msg {
            SyncMsg::Event { event_name, data, .. } => {
                assert_eq!(event_name, "plugin.changed");
                assert_eq!(data["plugin_id"], "my-plugin");
                assert_eq!(data["change"], "installed");
            }
            _ => panic!("expected SyncMsg::Event"),
        }
    }
}

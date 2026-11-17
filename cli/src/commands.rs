//! Read-only and input commands built on the HTTP client.

use std::collections::HashMap;

use serde_json::Value;

use crate::api::{encode_component, HttpClient};
use crate::error::CliError;

/// `GET /api/sessions` - requires Open API to be enabled.
///
/// # Errors
/// Returns API/connection errors.
pub fn sessions(http: &HttpClient) -> Result<Value, CliError> {
    http.get("/api/sessions")
}

/// `GET /api/tabs`.
///
/// # Errors
/// Returns API/connection errors.
pub fn tabs(http: &HttpClient) -> Result<Value, CliError> {
    http.get("/api/tabs")
}

/// `POST /api/sessions/:pane/input` - requires Open API to be enabled.
///
/// # Errors
/// Returns API/connection errors.
pub fn send_input(http: &HttpClient, pane_id: &str, text: &str) -> Result<Value, CliError> {
    http.post(
        &format!("/api/sessions/{}/input", encode_component(pane_id)),
        &serde_json::json!({ "data": text }),
    )
}

/// `GET /api/sessions/:pane/screen` - requires Open API to be enabled.
///
/// # Errors
/// Returns API/connection errors.
pub fn screen(http: &HttpClient, pane_id: &str, ansi: bool) -> Result<Value, CliError> {
    let format = if ansi { "ansi" } else { "plain" };
    http.get(&format!("/api/sessions/{}/screen?format={format}", encode_component(pane_id)))
}

/// # Errors
/// Returns an error when the payload cannot be pretty-printed.
pub fn print_json(value: &Value) -> Result<(), CliError> {
    let text = serde_json::to_string_pretty(value).map_err(|error| {
        CliError::runtime("INVALID_RESPONSE", format!("cannot serialise response: {error}"))
    })?;
    println!("{text}");
    Ok(())
}

#[must_use]
pub fn viewer_summary(value: &Value) -> String {
    let path = value.get("path").and_then(Value::as_str).unwrap_or("<unknown>");
    let request_id = value.get("request_id").and_then(Value::as_str).unwrap_or("<unknown>");
    let clients = value.get("delivered_clients").and_then(Value::as_u64).unwrap_or(0);
    format!("Opened {path}\nrequest_id: {request_id}\ndelivered_clients: {clients}")
}

/// Render `sessions list`.
///
/// `/api/sessions` currently returns `tab_id: null` even for panes that belong
/// to a tab, so `tabs` (the `/api/tabs` payload) is used to map pane id ->
/// tab id whenever the session field is missing.
#[must_use]
pub fn sessions_summary(value: &Value, tabs: Option<&Value>) -> String {
    let sessions = value.get("sessions").and_then(Value::as_array);
    let Some(sessions) = sessions.filter(|sessions| !sessions.is_empty()) else {
        return "No active sessions.".to_string();
    };
    let tab_ids = tabs.map(pane_tab_map).unwrap_or_default();

    let mut rows = vec![vec![
        "PANE ID".to_string(),
        "TAB ID".to_string(),
        "STATUS".to_string(),
        "SIZE".to_string(),
        "CWD".to_string(),
    ]];
    for session in sessions {
        rows.push(vec![
            string_field(session, "pane_id"),
            session_tab_id(session, &tab_ids),
            string_field(session, "status"),
            session.get("size").map_or_else(String::new, |size| {
                format!(
                    "{}x{}",
                    size.get("cols").and_then(Value::as_u64).unwrap_or(0),
                    size.get("rows").and_then(Value::as_u64).unwrap_or(0)
                )
            }),
            string_field(session, "cwd"),
        ]);
    }
    table(&rows)
}

/// Prefer the session's own `tab_id`; fall back to the pane -> tab mapping
/// built from `/api/tabs`.
fn session_tab_id(session: &Value, tab_ids: &HashMap<String, String>) -> String {
    if let Some(tab_id) =
        session.get("tab_id").and_then(Value::as_str).filter(|tab_id| !tab_id.is_empty())
    {
        return tab_id.to_string();
    }
    session
        .get("pane_id")
        .and_then(Value::as_str)
        .and_then(|pane_id| tab_ids.get(pane_id))
        .cloned()
        .unwrap_or_default()
}

/// Map every pane id in `/api/tabs` (top-level and nested layout leaves) to its
/// tab id.
fn pane_tab_map(tabs: &Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(tabs) = tabs.get("tabs").and_then(Value::as_array) else {
        return map;
    };
    for tab in tabs {
        let Some(tab_id) = tab.get("tab_id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(layout) = tab.get("layout") {
            let mut pane_ids = Vec::new();
            collect_layout_pane_ids(layout, &mut pane_ids);
            for pane_id in pane_ids {
                map.insert(pane_id, tab_id.to_string());
            }
        }
        if let Some(pane_id) = tab.get("pane_id").and_then(Value::as_str) {
            map.entry(pane_id.to_string()).or_insert_with(|| tab_id.to_string());
        }
    }
    map
}

fn collect_layout_pane_ids(node: &Value, out: &mut Vec<String>) {
    if let Some(pane_id) = node.get("paneId").and_then(Value::as_str) {
        out.push(pane_id.to_string());
    }
    if let Some(children) = node.get("children").and_then(Value::as_array) {
        for child in children {
            collect_layout_pane_ids(child, out);
        }
    }
}

#[must_use]
pub fn tabs_summary(value: &Value) -> String {
    let tabs = value.get("tabs").and_then(Value::as_array);
    let Some(tabs) = tabs.filter(|tabs| !tabs.is_empty()) else {
        return "No open tabs.".to_string();
    };

    let mut rows = vec![vec![
        "TAB ID".to_string(),
        "PANE ID".to_string(),
        "TITLE".to_string(),
        "CWD".to_string(),
    ]];
    for tab in tabs {
        rows.push(vec![
            string_field(tab, "tab_id"),
            string_field(tab, "pane_id"),
            tab_title(tab),
            string_field(tab, "cwd"),
        ]);
    }
    table(&rows)
}

/// Tabs usually have no top-level `title`; the visible title lives on the
/// layout (`layout.title`) or on its leaves (`layout.children[].title`).
#[must_use]
pub fn tab_title(tab: &Value) -> String {
    if let Some(title) = tab
        .pointer("/layout/title")
        .and_then(Value::as_str)
        .filter(|title| !title.trim().is_empty())
    {
        return title.to_string();
    }
    let mut titles = Vec::new();
    if let Some(layout) = tab.get("layout") {
        collect_layout_titles(layout, &mut titles);
    }
    if titles.is_empty() {
        return string_field(tab, "title");
    }
    titles.join(" | ")
}

fn collect_layout_titles(node: &Value, out: &mut Vec<String>) {
    if let Some(title) = node.get("title").and_then(Value::as_str) {
        let title = title.trim();
        if !title.is_empty() && !out.iter().any(|existing| existing == title) {
            out.push(title.to_string());
        }
    }
    if let Some(children) = node.get("children").and_then(Value::as_array) {
        for child in children {
            collect_layout_titles(child, out);
        }
    }
}

fn string_field(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn table(rows: &[Vec<String>]) -> String {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut widths = vec![0_usize; columns];
    for row in rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }
    let mut output = String::new();
    for row in rows {
        let mut line = String::new();
        for (index, cell) in row.iter().enumerate() {
            if index + 1 == row.len() {
                line.push_str(cell);
            } else {
                line.push_str(cell);
                line.push_str(&" ".repeat(widths[index] - cell.chars().count() + 2));
            }
        }
        output.push_str(line.trim_end());
        output.push('\n');
    }
    output.pop();
    output
}

#[must_use]
pub fn input_summary(pane_id: &str, text: &str) -> String {
    let count = text.chars().count();
    let characters = if count == 1 { "character" } else { "characters" };
    format!("Sent {count} {characters} to {pane_id}.")
}

#[must_use]
pub fn screen_output(value: &Value) -> String {
    value.get("content").and_then(Value::as_str).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewer_summary_reads_the_delivery_payload() {
        let summary = viewer_summary(&serde_json::json!({
            "ok": true,
            "request_id": "req-1",
            "path": ".claude/artifacts/a.html",
            "delivered_clients": 2
        }));
        assert!(summary.contains("Opened .claude/artifacts/a.html"));
        assert!(summary.contains("request_id: req-1"));
        assert!(summary.contains("delivered_clients: 2"));
    }

    #[test]
    fn sessions_summary_aligns_columns_and_handles_empty() {
        assert_eq!(
            sessions_summary(&serde_json::json!({ "sessions": [] }), None),
            "No active sessions."
        );
        let summary = sessions_summary(
            &serde_json::json!({
                "sessions": [{
                    "pane_id": "p1",
                    "tab_id": "t1",
                    "status": "connected",
                    "size": { "cols": 120, "rows": 40 },
                    "cwd": "/tmp"
                }]
            }),
            None,
        );
        let lines: Vec<&str> = summary.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("PANE ID"));
        assert!(lines[1].starts_with("p1"));
        assert!(lines[1].contains("t1"));
        assert!(lines[1].contains("120x40"));
    }

    #[test]
    fn sessions_summary_recovers_missing_tab_ids_from_tabs() {
        let sessions = serde_json::json!({
            "sessions": [
                { "pane_id": "p1", "tab_id": null, "status": "connected", "cwd": "/a" },
                // p2 is a nested leaf; only the tab's first leaf is top-level.
                { "pane_id": "p2", "tab_id": null, "status": "connected", "cwd": "/b" }
            ]
        });
        let tabs = serde_json::json!({
            "tabs": [{
                "tab_id": "tab-1",
                "pane_id": "p1",
                "layout": {
                    "type": "split",
                    "children": [
                        { "type": "leaf", "paneId": "p1" },
                        { "type": "leaf", "paneId": "p2" }
                    ]
                }
            }]
        });

        let summary = sessions_summary(&sessions, Some(&tabs));
        let lines: Vec<&str> = summary.lines().collect();
        assert!(lines[1].contains("tab-1"), "first pane: {summary}");
        assert!(lines[2].contains("tab-1"), "nested pane: {summary}");
    }

    #[test]
    fn sessions_summary_leaves_unknown_panes_with_an_empty_tab_id() {
        let sessions = serde_json::json!({
            "sessions": [{ "pane_id": "orphan", "tab_id": null, "status": "connected" }]
        });
        let summary = sessions_summary(&sessions, Some(&serde_json::json!({ "tabs": [] })));
        assert_eq!(summary.lines().count(), 2);
        assert!(!summary.contains("tab-1"));
    }

    #[test]
    fn tabs_summary_handles_empty() {
        assert_eq!(tabs_summary(&serde_json::json!({ "tabs": [] })), "No open tabs.");
    }

    #[test]
    fn tabs_summary_reads_titles_from_layout_children() {
        let summary = tabs_summary(&serde_json::json!({
            "tabs": [{
                "tab_id": "t1",
                "pane_id": "p1",
                "cwd": "/tmp",
                "layout": {
                    "type": "split",
                    "children": [
                        { "type": "leaf", "paneId": "p1", "title": "editor" },
                        {
                            "type": "split",
                            "children": [
                                { "type": "leaf", "paneId": "p2", "title": "shell" }
                            ]
                        }
                    ]
                }
            }]
        }));

        let line = summary.lines().nth(1).unwrap();
        assert!(line.contains("t1"), "{summary}");
        assert!(line.contains("editor | shell"), "{summary}");
    }

    #[test]
    fn tab_title_prefers_the_layout_title_then_falls_back() {
        assert_eq!(
            tab_title(&serde_json::json!({
                "layout": {
                    "title": "Combined",
                    "children": [{ "title": "leaf" }]
                }
            })),
            "Combined"
        );
        assert_eq!(
            tab_title(&serde_json::json!({ "layout": { "children": [{ "title": "leaf" }] } })),
            "leaf"
        );
        assert_eq!(tab_title(&serde_json::json!({ "title": "top-level" })), "top-level");
        assert_eq!(tab_title(&serde_json::json!({ "layout": {} })), "");
    }

    #[test]
    fn input_summary_counts_characters() {
        assert_eq!(input_summary("p1", "ls\n"), "Sent 3 characters to p1.");
        assert_eq!(input_summary("p1", "x"), "Sent 1 character to p1.");
    }
}

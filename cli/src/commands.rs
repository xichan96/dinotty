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

/// `POST /api/tabs`.
///
/// # Errors
/// Returns API/connection errors.
pub fn create_tab(http: &HttpClient, payload: &Value) -> Result<Value, CliError> {
    http.post("/api/tabs", payload)
}

/// Build the `POST /api/tabs` body.
///
/// The HTTP API has no `env` field, so `--env` assignments reuse the
/// documented `/usr/bin/env KEY=VALUE …` argv prefix.
///
/// # Errors
/// Returns a usage error when `env` is supplied without an argv or on a
/// platform without `/usr/bin/env`.
pub fn tabs_create_payload(
    cwd: Option<&std::path::Path>,
    title: Option<&str>,
    env: &[(String, String)],
    argv: &[String],
) -> Result<Value, CliError> {
    let argv = if env.is_empty() {
        argv.to_vec()
    } else {
        if argv.is_empty() {
            return Err(CliError::usage(
                "--env requires an argv command (the API has no env field)",
            ));
        }
        if !cfg!(unix) {
            return Err(CliError::usage(
                "--env is supported on POSIX platforms only (it prefixes the argv with /usr/bin/env)",
            ));
        }
        let mut prefixed = Vec::with_capacity(argv.len() + env.len() + 1);
        prefixed.push("/usr/bin/env".to_string());
        prefixed.extend(env.iter().map(|(key, value)| format!("{key}={value}")));
        prefixed.extend_from_slice(argv);
        prefixed
    };

    let mut payload = serde_json::Map::new();
    if let Some(cwd) = cwd {
        payload.insert("cwd".into(), Value::String(cwd.to_string_lossy().into_owned()));
    }
    if let Some(title) = title {
        payload.insert("title".into(), Value::String(title.to_string()));
    }
    if !argv.is_empty() {
        payload
            .insert("argv".into(), Value::Array(argv.iter().cloned().map(Value::String).collect()));
    }
    Ok(Value::Object(payload))
}

/// `DELETE /api/tabs/:tab_id`.
///
/// # Errors
/// Returns API/connection errors.
pub fn close_tab(http: &HttpClient, tab_id: &str) -> Result<Value, CliError> {
    http.delete(&format!("/api/tabs/{}", encode_component(tab_id)))
}

/// `POST /api/tabs/:tab_id/rename`.
///
/// # Errors
/// Returns API/connection errors.
pub fn rename_tab(http: &HttpClient, tab_id: &str, title: &str) -> Result<Value, CliError> {
    http.post(
        &format!("/api/tabs/{}/rename", encode_component(tab_id)),
        &serde_json::json!({ "title": title }),
    )
}

/// `POST /api/tabs/:tab_id/pane` with a `SplitPaneRequest` body.
///
/// # Errors
/// Returns API/connection errors.
pub fn split_pane(
    http: &HttpClient,
    tab_id: &str,
    pane_id: &str,
    direction: &str,
    cwd: Option<&std::path::Path>,
) -> Result<Value, CliError> {
    let mut body = serde_json::json!({
        "pane_id": pane_id,
        "direction": direction,
    });
    if let Some(cwd) = cwd {
        body["cwd"] = Value::String(cwd.to_string_lossy().into_owned());
    }
    http.post(&format!("/api/tabs/{}/pane", encode_component(tab_id)), &body)
}

/// `PUT /api/tabs/:tab_id/pane/:pane_id/activate`.
///
/// # Errors
/// Returns API/connection errors.
pub fn activate_pane(http: &HttpClient, tab_id: &str, pane_id: &str) -> Result<Value, CliError> {
    http.put(
        &format!(
            "/api/tabs/{}/pane/{}/activate",
            encode_component(tab_id),
            encode_component(pane_id)
        ),
        &Value::Null,
    )
}

/// Resolve a tab's first pane id from `GET /api/tabs`.
///
/// # Errors
/// Returns `TAB_NOT_FOUND` when the tab is absent and API/connection errors
/// otherwise.
pub fn tab_pane_id(http: &HttpClient, tab_id: &str) -> Result<String, CliError> {
    let tabs = tabs(http)?;
    find_tab(&tabs, tab_id)
        .and_then(|tab| tab.get("pane_id").and_then(Value::as_str).map(str::to_string))
        .ok_or_else(|| {
            CliError::runtime("TAB_NOT_FOUND", format!("tab {tab_id} is not open"))
                .with_hint("run `dinotty tabs list` to see open tabs")
        })
}

fn find_tab<'a>(tabs: &'a Value, tab_id: &str) -> Option<&'a Value> {
    tabs.get("tabs")
        .and_then(Value::as_array)?
        .iter()
        .find(|tab| tab.get("tab_id").and_then(Value::as_str) == Some(tab_id))
}

/// `GET /api/workspace/list`.
///
/// # Errors
/// Returns API/connection errors.
pub fn workspace_list(http: &HttpClient, pane_id: &str, path: &str) -> Result<Value, CliError> {
    http.get(&format!(
        "/api/workspace/list?pane_id={}&path={}",
        encode_component(pane_id),
        encode_component(path)
    ))
}

/// `GET /api/workspace/meta` (text preview capped at 512 KiB).
///
/// # Errors
/// Returns API/connection errors.
pub fn workspace_meta(http: &HttpClient, pane_id: &str, path: &str) -> Result<Value, CliError> {
    http.get(&format!(
        "/api/workspace/meta?pane_id={}&path={}",
        encode_component(pane_id),
        encode_component(path)
    ))
}

/// `GET /api/workspace/raw`, streamed into `out`.
///
/// # Errors
/// Returns API/connection errors and I/O errors while writing.
pub fn workspace_raw(
    http: &HttpClient,
    pane_id: &str,
    path: &str,
    out: &mut dyn std::io::Write,
) -> Result<crate::api::RawResponse, CliError> {
    http.download(
        &format!(
            "/api/workspace/raw?pane_id={}&path={}",
            encode_component(pane_id),
            encode_component(path)
        ),
        out,
    )
}

/// `PUT /api/workspace/file`.
///
/// # Errors
/// Returns API/connection errors.
pub fn workspace_write(
    http: &HttpClient,
    pane_id: &str,
    path: &str,
    content: &str,
) -> Result<Value, CliError> {
    http.put(
        &format!(
            "/api/workspace/file?pane_id={}&path={}",
            encode_component(pane_id),
            encode_component(path)
        ),
        &serde_json::json!({ "content": content }),
    )
}

/// `GET /api/workspace/git-changes`.
///
/// # Errors
/// Returns API/connection errors.
pub fn workspace_git_status(http: &HttpClient, pane_id: &str) -> Result<Value, CliError> {
    http.get(&format!("/api/workspace/git-changes?pane_id={}", encode_component(pane_id)))
}

/// `GET /api/workspace/git-file-diff`.
///
/// # Errors
/// Returns API/connection errors.
pub fn workspace_git_diff(http: &HttpClient, pane_id: &str, path: &str) -> Result<Value, CliError> {
    http.get(&format!(
        "/api/workspace/git-file-diff?pane_id={}&path={}",
        encode_component(pane_id),
        encode_component(path)
    ))
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

#[must_use]
pub fn created_tab_summary(value: &Value) -> String {
    let tab_id = value.get("tab_id").and_then(Value::as_str).unwrap_or("<unknown>");
    let pane_id = value.get("pane_id").and_then(Value::as_str).unwrap_or("<unknown>");
    let cwd = value.get("cwd").and_then(Value::as_str).unwrap_or("-");
    format!("Created tab {tab_id}\npane_id: {pane_id}\ncwd: {cwd}")
}

#[must_use]
pub fn created_pane_summary(value: &Value, tab_id: &str) -> String {
    let pane_id = value.get("new_pane_id").and_then(Value::as_str).unwrap_or("<unknown>");
    format!("Created pane {pane_id} in tab {tab_id}.")
}

/// `workspace list` table: name, type, and size.
#[must_use]
pub fn workspace_list_summary(value: &Value) -> String {
    let entries = value.get("entries").and_then(Value::as_array);
    let Some(entries) = entries.filter(|entries| !entries.is_empty()) else {
        return "No entries.".to_string();
    };
    let mut rows = vec![vec!["NAME".to_string(), "TYPE".to_string(), "SIZE".to_string()]];
    for entry in entries {
        let name = string_field(entry, "name");
        let is_dir = entry.get("is_dir").and_then(Value::as_bool).unwrap_or(false);
        let is_symlink = entry.get("is_symlink").and_then(Value::as_bool).unwrap_or(false);
        let is_cycle = entry.get("is_cycle").and_then(Value::as_bool).unwrap_or(false);
        let kind = if is_cycle {
            "link (cycle)".to_string()
        } else if is_symlink {
            format!("{} (link)", if is_dir { "dir" } else { "file" })
        } else if is_dir {
            "dir".to_string()
        } else {
            "file".to_string()
        };
        let size = if is_dir {
            "-".to_string()
        } else {
            human_size(entry.get("size").and_then(Value::as_u64).unwrap_or(0))
        };
        rows.push(vec![name, kind, size]);
    }
    table(&rows)
}

fn human_size(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    let bytes_f = bytes as f64;
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes_f < KIB * KIB {
        format!("{:.1} KiB", bytes_f / KIB)
    } else if bytes_f < KIB * KIB * KIB {
        format!("{:.1} MiB", bytes_f / (KIB * KIB))
    } else {
        format!("{:.1} GiB", bytes_f / (KIB * KIB * KIB))
    }
}

/// `workspace git status` from `/api/workspace/git-changes`.
#[must_use]
pub fn workspace_git_status_summary(value: &Value) -> String {
    if !value.get("is_git_repo").and_then(Value::as_bool).unwrap_or(false) {
        return "Not a git repository.".to_string();
    }
    let files = value.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut output = String::new();
    if let Some(root) = value.get("repo_root").and_then(Value::as_str) {
        output.push_str("repo: ");
        output.push_str(root);
        if let Some(head) = value.get("head").and_then(Value::as_str) {
            let short: String = head.chars().take(8).collect();
            output.push_str(&format!(" (HEAD {short})"));
        }
        output.push('\n');
    }
    if files.is_empty() {
        output.push_str("Working tree clean.");
        return output;
    }
    let mut rows = vec![vec!["STATUS".to_string(), "PATH".to_string(), "LINES".to_string()]];
    for file in &files {
        let status = string_field(file, "status");
        let path = if let Some(orig) = file.get("orig_path").and_then(Value::as_str) {
            format!("{orig} -> {}", string_field(file, "path"))
        } else {
            string_field(file, "path")
        };
        let lines = if file.get("binary").and_then(Value::as_bool).unwrap_or(false) {
            "binary".to_string()
        } else if file.get("conflicted").and_then(Value::as_bool).unwrap_or(false) {
            "conflict".to_string()
        } else {
            match (
                file.get("additions").and_then(Value::as_u64),
                file.get("deletions").and_then(Value::as_u64),
            ) {
                (Some(added), Some(removed)) => format!("+{added} -{removed}"),
                _ => "-".to_string(),
            }
        };
        rows.push(vec![status, path, lines]);
    }
    output.push_str(&table(&rows));
    if let Some(summary) = value.get("summary") {
        let count = summary.get("files").and_then(Value::as_u64).unwrap_or(0);
        let added = summary.get("additions").and_then(Value::as_u64).unwrap_or(0);
        let removed = summary.get("deletions").and_then(Value::as_u64).unwrap_or(0);
        let incomplete = !summary.get("counts_complete").and_then(Value::as_bool).unwrap_or(true);
        output.push_str(&format!(
            "\n{count} file(s), +{added} -{removed}{}",
            if incomplete { " (counts incomplete)" } else { "" }
        ));
    }
    output
}

/// `workspace git diff` from `/api/workspace/git-file-diff` (whole-file
/// contents for the working tree and HEAD).
#[must_use]
pub fn workspace_git_diff_summary(value: &Value) -> String {
    if !value.get("is_git_repo").and_then(Value::as_bool).unwrap_or(false) {
        return "Not a git repository.".to_string();
    }
    let path = value.get("path").and_then(Value::as_str).unwrap_or("<unknown>");
    let mut output = format!("path: {path}\nbase: {}\n", string_field(value, "base"));
    if value.get("binary").and_then(Value::as_bool).unwrap_or(false) {
        output.push_str("binary file: content not shown\n");
        return output;
    }
    if value.get("too_large").and_then(Value::as_bool).unwrap_or(false) {
        output.push_str("file too large: content not shown\n");
        return output;
    }
    let original = value.get("original").and_then(Value::as_str).unwrap_or("(not available)");
    let modified = value.get("modified").and_then(Value::as_str).unwrap_or("(not available)");
    output.push_str("\n--- original (HEAD) ---\n");
    output.push_str(original);
    if !original.ends_with('\n') {
        output.push('\n');
    }
    output.push_str("\n--- modified (working tree) ---\n");
    output.push_str(modified);
    if !modified.ends_with('\n') && !modified.is_empty() {
        output.push('\n');
    }
    output
}

/// Precedence: the explicit top-level `title` (written by `tabs rename`), then
/// `layout.title`, then the layout leaves (`layout.children[].title`) joined
/// with ` | `. Older tabs have no top-level title, so the layout fallbacks
/// still matter.
#[must_use]
pub fn tab_title(tab: &Value) -> String {
    if let Some(title) =
        tab.get("title").and_then(Value::as_str).filter(|title| !title.trim().is_empty())
    {
        return title.to_string();
    }
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
    fn tab_title_prefers_the_explicit_title_then_falls_back() {
        assert_eq!(
            tab_title(&serde_json::json!({
                "title": "renamed",
                "layout": { "title": "Combined", "children": [{ "title": "leaf" }] }
            })),
            "renamed"
        );
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
        assert_eq!(tab_title(&serde_json::json!({ "title": "" })), "");
        assert_eq!(tab_title(&serde_json::json!({ "layout": {} })), "");
    }

    #[test]
    fn input_summary_counts_characters() {
        assert_eq!(input_summary("p1", "ls\n"), "Sent 3 characters to p1.");
        assert_eq!(input_summary("p1", "x"), "Sent 1 character to p1.");
    }

    #[test]
    fn tabs_create_payload_omits_empty_fields() {
        let payload = tabs_create_payload(None, None, &[], &[]).unwrap();
        assert_eq!(payload, serde_json::json!({}));
    }

    #[test]
    fn tabs_create_payload_passes_argv_and_metadata() {
        let payload = tabs_create_payload(
            Some(std::path::Path::new("/tmp/ws")),
            Some("agent"),
            &[],
            &["claude".to_string(), "--model".to_string()],
        )
        .unwrap();
        assert_eq!(
            payload,
            serde_json::json!({
                "cwd": "/tmp/ws",
                "title": "agent",
                "argv": ["claude", "--model"]
            })
        );
    }

    #[test]
    fn tabs_create_payload_prefixes_env_with_the_env_binary() {
        let payload = tabs_create_payload(
            None,
            None,
            &[("A".to_string(), "1".to_string())],
            &["claude".to_string()],
        )
        .unwrap();
        assert_eq!(payload, serde_json::json!({ "argv": ["/usr/bin/env", "A=1", "claude"] }));
    }

    #[test]
    fn tabs_create_payload_rejects_env_without_argv() {
        let error = tabs_create_payload(None, None, &[("A".to_string(), "1".to_string())], &[])
            .unwrap_err();
        assert_eq!(error.code, "USAGE");
        assert!(error.message.contains("requires an argv"));
    }

    #[test]
    fn created_tab_and_pane_summaries_read_the_payloads() {
        assert_eq!(
            created_tab_summary(&serde_json::json!({
                "tab_id": "t1", "pane_id": "p1", "cwd": "/tmp"
            })),
            "Created tab t1\npane_id: p1\ncwd: /tmp"
        );
        assert_eq!(
            created_pane_summary(&serde_json::json!({ "new_pane_id": "p2" }), "t1"),
            "Created pane p2 in tab t1."
        );
    }

    #[test]
    fn workspace_list_summary_renders_entries() {
        let summary = workspace_list_summary(&serde_json::json!({
            "cwd": "/tmp",
            "path": "",
            "entries": [
                { "name": "src", "is_dir": true, "size": 0 },
                { "name": "a.rs", "is_dir": false, "size": 1536 },
                { "name": "link", "is_dir": true, "size": 0, "is_symlink": true, "is_cycle": true }
            ]
        }));
        let lines: Vec<&str> = summary.lines().collect();
        assert!(lines[0].starts_with("NAME"));
        assert!(lines[1].contains("src"));
        assert!(lines[1].contains("dir"));
        assert!(lines[2].contains("1.5 KiB"));
        assert!(lines[3].contains("link (cycle)"));
        assert_eq!(workspace_list_summary(&serde_json::json!({ "entries": [] })), "No entries.");
    }

    #[test]
    fn workspace_git_status_summary_handles_repos_and_clean_trees() {
        assert_eq!(
            workspace_git_status_summary(&serde_json::json!({ "is_git_repo": false })),
            "Not a git repository."
        );
        assert_eq!(
            workspace_git_status_summary(&serde_json::json!({
                "is_git_repo": true, "files": []
            })),
            "Working tree clean."
        );
        let summary = workspace_git_status_summary(&serde_json::json!({
            "is_git_repo": true,
            "repo_root": "/repo",
            "head": "1234567890abcdef",
            "files": [
                { "path": "src/a.rs", "status": "modified", "additions": 3, "deletions": 1 },
                { "path": "logo.png", "status": "untracked", "binary": true }
            ],
            "summary": { "files": 2, "additions": 3, "deletions": 1, "counts_complete": true }
        }));
        assert!(summary.contains("repo: /repo (HEAD 12345678)"));
        assert!(summary.contains("modified"));
        assert!(summary.contains("+3 -1"));
        assert!(summary.contains("binary"));
        assert!(summary.contains("2 file(s), +3 -1"));
    }

    #[test]
    fn workspace_git_diff_summary_labels_sides_and_binary_files() {
        let summary = workspace_git_diff_summary(&serde_json::json!({
            "is_git_repo": true,
            "path": "a.txt",
            "base": "head",
            "original": "old\n",
            "modified": "new"
        }));
        assert!(summary.contains("path: a.txt"));
        assert!(summary.contains("--- original (HEAD) ---\nold"));
        assert!(summary.contains("--- modified (working tree) ---\nnew"));
        assert!(workspace_git_diff_summary(&serde_json::json!({
            "is_git_repo": true,
            "path": "a.png",
            "binary": true
        }))
        .contains("binary file"));
    }
}

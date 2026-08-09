use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::session::{Session, SessionManager};

use super::types::SearchMatch;

pub(crate) const MAX_TEXT_PREVIEW: usize = 512 * 1024;
pub(crate) const MAX_DOWNLOAD: u64 = 500 * 1024 * 1024;

macro_rules! try_res {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => return e,
        }
    };
}
pub(crate) use try_res;

pub(crate) fn json_err(status: StatusCode, msg: &str) -> Response {
    (status, Json(serde_json::json!({ "error": msg }))).into_response()
}

pub(crate) fn get_session(
    manager: &SessionManager,
    pane_id: &str,
) -> Result<Arc<Session>, Response> {
    manager
        .sessions
        .get(pane_id)
        .map(|r| Arc::clone(r.value()))
        .ok_or_else(|| json_err(StatusCode::NOT_FOUND, "unknown pane"))
}

pub(crate) fn get_root(manager: &SessionManager, pane_id: &str) -> Result<PathBuf, Response> {
    let session = get_session(manager, pane_id)?;
    let cwd = session
        .cwd_for_workspace()
        .ok_or_else(|| json_err(StatusCode::CONFLICT, "cwd_unavailable_for_backend"))?;
    Ok(cwd.canonicalize().unwrap_or(cwd))
}

/// Check if a session is SSH. Returns `Some(session)` if SSH, `None` if local.
pub(crate) fn ssh_session(manager: &SessionManager, pane_id: &str) -> Option<Arc<Session>> {
    let session = manager.sessions.get(pane_id).map(|r| Arc::clone(r.value()))?;
    if session.is_ssh() {
        Some(session)
    } else {
        None
    }
}

pub(crate) fn normalize_join(root: &Path, rel: &str) -> Result<PathBuf, Response> {
    let rel = rel.trim().trim_start_matches('/');
    if rel.split('/').any(|p| p == "..") {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid path"));
    }
    let mut out = root.to_path_buf();
    for seg in rel.split('/').filter(|s| !s.is_empty() && *s != ".") {
        out.push(seg);
    }
    Ok(out)
}

pub(crate) fn path_must_be_under(root: &Path, candidate: &Path) -> Result<(), Response> {
    let root_canon = root.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "cwd"))?;
    let cand_canon =
        candidate.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "path"))?;
    if !cand_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

pub(crate) fn rel_from_root(root: &Path, full: &Path) -> Option<String> {
    full.strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn validate_entry_name(name: &str) -> Result<&str, Response> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid name"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(json_err(StatusCode::BAD_REQUEST, "invalid name"));
    }
    Ok(name)
}

pub(crate) fn parent_dir_must_be_in_workspace(
    root: &Path,
    file_path: &Path,
) -> Result<(), Response> {
    let root_canon = root.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "cwd"))?;
    let parent =
        file_path.parent().ok_or_else(|| json_err(StatusCode::BAD_REQUEST, "invalid path"))?;
    if !parent.exists() {
        return Err(json_err(StatusCode::NOT_FOUND, "parent not found"));
    }
    let parent_canon =
        parent.canonicalize().map_err(|_| json_err(StatusCode::NOT_FOUND, "parent not found"))?;
    if !parent_canon.starts_with(&root_canon) {
        return Err(json_err(StatusCode::FORBIDDEN, "outside workspace"));
    }
    Ok(())
}

pub(crate) fn resolve_user_path(home: Option<PathBuf>, raw: &str) -> PathBuf {
    let raw = raw.trim();
    if let Some(path) = expand_temp_token(raw) {
        return path;
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(h) = home.as_ref() {
            return h.join(rest);
        }
    }
    if raw == "~" {
        return home.unwrap_or_else(|| PathBuf::from("/"));
    }
    PathBuf::from(raw)
}

fn expand_temp_token(raw: &str) -> Option<PathBuf> {
    fn env_path(name: &str) -> PathBuf {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map_or_else(std::env::temp_dir, PathBuf::from)
    }

    fn token_remainder<'a>(raw: &'a str, token: &str, case_insensitive: bool) -> Option<&'a str> {
        let matches = if case_insensitive {
            raw.get(..token.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(token))
        } else {
            raw.starts_with(token)
        };
        if !matches {
            return None;
        }

        let rest = &raw[token.len()..];
        if rest.is_empty() {
            Some(rest)
        } else if rest.starts_with('/') || rest.starts_with('\\') {
            Some(rest.trim_start_matches(['/', '\\']))
        } else {
            None
        }
    }

    #[cfg(windows)]
    let tokens = [("%TEMP%", "TEMP", true), ("%TMP%", "TMP", true)];
    #[cfg(not(windows))]
    let tokens = [("$TMPDIR", "TMPDIR", false), ("${TMPDIR}", "TMPDIR", false)];

    for (token, env_name, case_insensitive) in tokens {
        if let Some(rest) = token_remainder(raw, token, case_insensitive) {
            let base = env_path(env_name);
            return Some(if rest.is_empty() { base } else { base.join(rest) });
        }
    }

    None
}

pub(crate) fn path_contains_parent_dir(path: &Path) -> bool {
    path.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

pub(crate) fn detect_language(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "mts" | "cts" | "tsx" => "typescript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" | "vue" => "xml",
        "html" | "htm" => "html",
        "css" | "scss" | "sass" => "css",
        "md" | "markdown" => "markdown",
        "sh" | "bash" | "zsh" => "bash",
        "sql" => "sql",
        _ => "plaintext",
    }
}

pub(crate) enum ByteRangeResult {
    Full,
    Partial { start: u64, end: u64 },
    NotSatisfiable,
}

pub(crate) fn resolve_byte_range(range_header: &str, size: u64) -> ByteRangeResult {
    if size == 0 {
        return ByteRangeResult::Full;
    }
    let Some(spec) = range_header.trim().strip_prefix("bytes=") else {
        return ByteRangeResult::Full;
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    if first.is_empty() {
        return ByteRangeResult::Full;
    }
    if let Some(suffix_len_s) = first.strip_prefix('-') {
        if suffix_len_s.is_empty() {
            return ByteRangeResult::Full;
        }
        let Ok(suffix_len) = suffix_len_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        if suffix_len == 0 {
            return ByteRangeResult::NotSatisfiable;
        }
        let start = size.saturating_sub(suffix_len);
        let end = size - 1;
        return ByteRangeResult::Partial { start, end };
    }
    let Some((from_s, to_s)) = first.split_once('-') else {
        return ByteRangeResult::Full;
    };
    let start = if from_s.is_empty() {
        0u64
    } else {
        let Ok(v) = from_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        v
    };
    let end = if to_s.is_empty() {
        size - 1
    } else {
        let Ok(v) = to_s.parse::<u64>() else {
            return ByteRangeResult::Full;
        };
        v
    };
    if start >= size {
        return ByteRangeResult::NotSatisfiable;
    }
    let end = end.min(size - 1);
    if end < start {
        return ByteRangeResult::NotSatisfiable;
    }
    ByteRangeResult::Partial { start, end }
}

pub(crate) fn media_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "svg" => ("image", "image/svg+xml"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "webm" => ("video", "video/webm"),
        "mov" => ("video", "video/quicktime"),
        "ogv" => ("video", "video/ogg"),
        "3gp" | "3gpp" => ("video", "video/3gpp"),
        "mkv" => ("video", "video/x-matroska"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "ogg" | "oga" => ("audio", "audio/ogg"),
        "m4a" => ("audio", "audio/mp4"),
        "flac" => ("audio", "audio/flac"),
        "pdf" => ("pdf", "application/pdf"),
        // html/htm handled as text with preview toggle
        _ => return None,
    })
}

pub(crate) fn skip_text_preview(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    matches!(ext.as_str(), "cube" | "lut" | "3dl" | "dat")
}

pub(crate) fn office_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "doc" => ("office", "application/msword"),
        "docx" => {
            ("office", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        }
        "xls" => ("office", "application/vnd.ms-excel"),
        "xlsx" => ("office", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        _ => return None,
    })
}

// Line numbers and byte offsets from ripgrep are always small (file-size bounded);
// narrowing to u32/usize is safe in practice.
#[allow(clippy::cast_possible_truncation)]
pub(crate) fn parse_rg_json(stdout: &str, max: usize) -> Vec<SearchMatch> {
    let mut results = Vec::with_capacity(max.min(256));
    for line in stdout.lines() {
        if results.len() >= max {
            break;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(serde_json::Value::as_str) != Some("match") {
            continue;
        }
        let Some(data) = v.get("data") else { continue };
        let file_path = data
            .pointer("/path/text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim_start_matches("./")
            .to_string();
        let line_number =
            data.get("line_number").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;
        let line_text = data
            .pointer("/lines/text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim_end_matches('\n')
            .to_string();
        let byte_offset_in_line =
            data.pointer("/submatches/0/start").and_then(serde_json::Value::as_u64).unwrap_or(0)
                as usize;
        let column = byte_offset_to_column(line_text.as_bytes(), byte_offset_in_line);

        results.push(SearchMatch { file_path, line: line_number, column, line_text });
    }
    results
}

/// Convert a UTF-8 byte offset (relative to line start) into a 1-based column
/// measured in UTF-16 code units (Monaco's coordinate system).
/// Falls back to byte index + 1 when input is pure ASCII.
pub(crate) fn byte_offset_to_column(line_bytes: &[u8], byte_offset: usize) -> u32 {
    let offset = byte_offset.min(line_bytes.len());
    let mut col: u32 = 1;
    let mut i = 0;
    while i < offset {
        // UTF-8 continuation byte: 0b10xxxxxx
        if line_bytes[i] & 0xC0 != 0x80 {
            col += 1;
        }
        i += 1;
    }
    col
}

use axum::http::StatusCode;
use axum::response::Response;

use crate::session::Session;
use crate::ssh::sftp::ssh_exec;
use crate::workspace::{json_err, DirEntry};

/// List directory via SSH exec with sudo as fallback.
/// Used when SFTP fails due to permission issues after user switch (e.g. `su root`).
pub(super) async fn list_via_ssh_exec(
    session: &Session,
    target: &str,
) -> Result<Vec<DirEntry>, Response> {
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    // Use `sudo ls -la` to get file types and names
    let cmd = format!("sudo ls -la {}", shell_escape_path(target));
    let (code, stdout, stderr) = ssh_exec(session, &cmd, &cwd)
        .await
        .map_err(|e| json_err(StatusCode::BAD_GATEWAY, &format!("SSH exec error: {e}")))?;
    if code != 0 {
        return Err(json_err(
            StatusCode::FORBIDDEN,
            &format!("Permission denied (sudo exit {code}): {}", stderr.trim()),
        ));
    }
    let entries = parse_ls_la_entries(&stdout, target);
    Ok(entries)
}

/// Parse `ls -la` output into `DirEntry` list with proper type detection.
fn parse_ls_la_entries(output: &str, _target: &str) -> Vec<DirEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((name, is_dir, size)) = parse_ls_la_full(line) {
            if name != "." && name != ".." {
                entries.push(DirEntry { name, is_dir, size });
            }
        }
    }
    entries.sort_by_key(|e| (!e.is_dir, e.name.to_lowercase()));
    entries
}

/// Parse a full `ls -la` line to extract name, type, and size.
fn parse_ls_la_full(line: &str) -> Option<(String, bool, u64)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    let first = parts[0];
    if first.is_empty() {
        return None;
    }
    let ft_char = first.as_bytes()[0];
    if !b"-dlcbps".contains(&ft_char) {
        return None;
    }
    let is_dir = ft_char == b'd';
    let size: u64 = parts[4].parse().unwrap_or(0);
    let name = parts[8..].join(" ");
    let name = name.split(" -> ").next().unwrap_or(&name).to_string();
    Some((name, is_dir, size))
}

/// Read file via SSH exec with sudo. Returns the file content as bytes.
pub(super) async fn read_via_ssh_exec(
    session: &Session,
    target: &str,
) -> Result<Vec<u8>, Response> {
    let cwd = session
        .cwd_for_workspace()
        .map_or_else(|| "/".to_string(), |path| path.to_string_lossy().into_owned());
    let cmd = format!("sudo cat {}", shell_escape_path(target));
    let (code, stdout, stderr) = ssh_exec(session, &cmd, &cwd)
        .await
        .map_err(|e| json_err(StatusCode::BAD_GATEWAY, &format!("SSH exec error: {e}")))?;
    if code != 0 {
        return Err(json_err(
            StatusCode::FORBIDDEN,
            &format!("Permission denied (sudo exit {code}): {}", stderr.trim()),
        ));
    }
    Ok(stdout.into_bytes())
}

/// Shell-escape a file path for safe use in SSH exec commands.
fn shell_escape_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

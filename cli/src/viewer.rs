//! `viewer open`: resolve a file against the pane's workspace, stage it under
//! `.claude/artifacts/` when it lives elsewhere, and ask the main UI to show it.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::api::{encode_component, HttpClient};
use crate::error::CliError;

/// Open `file` in the main UI's viewer for `pane_id`.
///
/// Returns the server's success payload:
/// `{ok, request_id, pane_id, path, title, delivered_clients}`.
///
/// # Errors
/// Returns API errors for unknown panes or missing UI clients, and local
/// errors when the file cannot be read or staged into the workspace.
pub fn open(http: &HttpClient, pane_id: &str, file: &Path) -> Result<Value, CliError> {
    let workspace = workspace_root(http, pane_id)?;
    let source = absolute_input_path(file)?;
    let relative = stage_into_workspace(&workspace, &source)?;
    let body = json!({ "path": slash_path(&relative) });
    http.post(&format!("/api/sessions/{}/viewer", encode_component(pane_id)), &body)
}

fn workspace_root(http: &HttpClient, pane_id: &str) -> Result<PathBuf, CliError> {
    let value = http.get(&format!("/api/workspace/cwd?pane_id={}", encode_component(pane_id)))?;
    let cwd = value.get("cwd").and_then(Value::as_str).ok_or_else(|| {
        CliError::runtime("INVALID_RESPONSE", "workspace cwd response has no string `cwd`")
    })?;
    fs::canonicalize(cwd).map_err(|error| {
        CliError::runtime(
            "CWD_UNAVAILABLE",
            format!("workspace cwd {cwd:?} is not accessible: {error}"),
        )
    })
}

/// Resolve a user-supplied path against the CLI's current directory and
/// canonicalise it so workspace containment is checked on real paths.
fn absolute_input_path(file: &Path) -> Result<PathBuf, CliError> {
    let absolute = if file.is_absolute() {
        file.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| {
                CliError::runtime("IO_ERROR", format!("cannot read current directory: {error}"))
            })?
            .join(file)
    };
    fs::canonicalize(&absolute).map_err(|error| {
        CliError::runtime("PATH_NOT_FOUND", format!("cannot read {}: {error}", absolute.display()))
    })
}

/// Return the workspace-relative path to send to the server, copying the file
/// into `.claude/artifacts/` first when it is outside the workspace.
fn stage_into_workspace(workspace: &Path, source: &Path) -> Result<PathBuf, CliError> {
    if let Ok(relative) = source.strip_prefix(workspace) {
        if !relative.as_os_str().is_empty() {
            return Ok(relative.to_path_buf());
        }
    }

    let metadata = fs::metadata(source).map_err(|error| {
        CliError::runtime("PATH_NOT_FOUND", format!("cannot read {}: {error}", source.display()))
    })?;
    if !metadata.is_file() {
        return Err(CliError::runtime(
            "NOT_A_FILE",
            format!("{} is not a regular file", source.display()),
        ));
    }

    let artifacts = workspace.join(".claude").join("artifacts");
    fs::create_dir_all(&artifacts).map_err(|error| {
        CliError::runtime(
            "ARTIFACT_COPY_FAILED",
            format!("cannot create {}: {error}", artifacts.display()),
        )
    })?;
    let target = unique_artifact_path(&artifacts, source);
    if !target.exists() {
        fs::copy(source, &target).map_err(|error| {
            CliError::runtime(
                "ARTIFACT_COPY_FAILED",
                format!("cannot copy {} to {}: {error}", source.display(), target.display()),
            )
        })?;
    }
    target.strip_prefix(workspace).map(Path::to_path_buf).map_err(|_| {
        CliError::runtime("OUTSIDE_WORKSPACE", "staged artifact escaped the workspace")
    })
}

/// Reuse an identical existing artifact, otherwise pick `-1`, `-2`, … suffixes
/// so two files that happen to share a name do not overwrite one another.
fn unique_artifact_path(artifacts: &Path, source: &Path) -> PathBuf {
    let name = source.file_name().unwrap_or_else(|| "artifact".as_ref());
    let first = artifacts.join(name);
    if !first.exists() || files_equal(&first, source) {
        return first;
    }

    let stem = source.file_stem().unwrap_or(name);
    let extension = source.extension();
    for index in 1..1000 {
        let candidate_name = match extension {
            Some(extension) => {
                let mut value = stem.to_os_string();
                value.push(format!("-{index}."));
                value.push(extension);
                value
            }
            None => {
                let mut value = stem.to_os_string();
                value.push(format!("-{index}"));
                value
            }
        };
        let candidate = artifacts.join(candidate_name);
        if !candidate.exists() || files_equal(&candidate, source) {
            return candidate;
        }
    }

    // Extremely unlikely; a timestamp keeps the copy lossless.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let mut fallback = stem.to_os_string();
    fallback.push(format!("-{stamp}"));
    if let Some(extension) = extension {
        fallback.push(".");
        fallback.push(extension);
    }
    artifacts.join(fallback)
}

fn files_equal(left: &Path, right: &Path) -> bool {
    let (Ok(left_meta), Ok(right_meta)) = (fs::metadata(left), fs::metadata(right)) else {
        return false;
    };
    if left_meta.len() != right_meta.len() {
        return false;
    }
    let (Ok(mut left), Ok(mut right)) = (fs::File::open(left), fs::File::open(right)) else {
        return false;
    };
    let mut left_buffer = [0_u8; 8192];
    let mut right_buffer = [0_u8; 8192];
    loop {
        let left_read = match left.read(&mut left_buffer) {
            Ok(read) => read,
            Err(_) => return false,
        };
        let right_read = match right.read(&mut right_buffer) {
            Ok(read) => read,
            Err(_) => return false,
        };
        if left_read != right_read {
            return false;
        }
        if left_read == 0 {
            return true;
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            return false;
        }
    }
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_files_inside_the_workspace_in_place() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("ws");
        let file = workspace.join("docs").join("a b.html");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "<h1>hi</h1>").unwrap();

        let relative = stage_into_workspace(&workspace, &file).unwrap();
        assert_eq!(relative, PathBuf::from("docs").join("a b.html"));
        assert_eq!(slash_path(&relative), "docs/a b.html");
    }

    #[test]
    fn copies_outside_files_into_artifacts() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("ws");
        let outside = directory.path().join("mockup.html");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(&outside, "<h1>mockup</h1>").unwrap();

        let relative = stage_into_workspace(&workspace, &outside).unwrap();
        assert_eq!(relative, PathBuf::from(".claude").join("artifacts").join("mockup.html"));
        assert_eq!(fs::read_to_string(workspace.join(&relative)).unwrap(), "<h1>mockup</h1>");
    }

    #[test]
    fn reuses_an_identical_artifact_without_duplicating() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("ws");
        let outside = directory.path().join("chart.html");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(&outside, "same").unwrap();

        let first = stage_into_workspace(&workspace, &outside).unwrap();
        let second = stage_into_workspace(&workspace, &outside).unwrap();
        assert_eq!(first, second);
        assert_eq!(fs::read_dir(workspace.join(".claude/artifacts")).unwrap().count(), 1);
    }

    #[test]
    fn suffixes_artifacts_that_share_a_name_but_differ() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("ws");
        let first_source = directory.path().join("a").join("report.html");
        let second_source = directory.path().join("b").join("report.html");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(first_source.parent().unwrap()).unwrap();
        fs::create_dir_all(second_source.parent().unwrap()).unwrap();
        fs::write(&first_source, "first").unwrap();
        fs::write(&second_source, "second").unwrap();

        let first = stage_into_workspace(&workspace, &first_source).unwrap();
        let second = stage_into_workspace(&workspace, &second_source).unwrap();
        assert_eq!(first, PathBuf::from(".claude/artifacts/report.html"));
        assert_eq!(second, PathBuf::from(".claude/artifacts/report-1.html"));
        assert_eq!(fs::read_to_string(workspace.join(second)).unwrap(), "second");
    }

    #[test]
    fn rejects_directories_outside_the_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("ws");
        let outside = directory.path().join("folder");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let error = stage_into_workspace(&workspace, &outside).unwrap_err();
        assert_eq!(error.code, "NOT_A_FILE");
    }
}

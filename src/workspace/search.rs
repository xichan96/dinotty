//! In-process fallback for workspace text search.
//!
//! The primary path shells out to ripgrep, which is fast and honours
//! `.gitignore`, but it is an optional external binary on desktop installs.
//! When `rg` is missing we still need search to work, so this walker performs
//! a bounded scan with the regex crate and skips the directories that make a
//! naive walk unusable (VCS metadata, dependency caches, build output).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use regex::Regex;

use super::types::SearchMatch;

/// Stop reading files larger than this; search is for source code, not blobs.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Do not walk more than this many entries in one request.
const MAX_ENTRIES: usize = 50_000;
const MAX_DURATION: Duration = Duration::from_secs(10);
const MAX_SNIPPET_BYTES: usize = 8 * 1024;

const SKIP_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".cache",
    ".venv",
    "vendor",
];

pub(crate) struct NativeSearchOptions<'a> {
    pub root: &'a Path,
    pub target: &'a Path,
    pub query: &'a str,
    pub regex: bool,
    pub word: bool,
    pub case_sensitive: bool,
    pub file_pattern: Option<&'a str>,
    pub max: usize,
}

pub(crate) struct NativeSearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

/// Owned search request. Unlike [`NativeSearchOptions`], this borrows nothing,
/// so it can be moved onto the blocking pool by the HTTP handler.
pub(crate) struct NativeSearchRequest {
    pub root: PathBuf,
    pub target: PathBuf,
    pub query: String,
    pub regex: bool,
    pub word: bool,
    pub case_sensitive: bool,
    pub file_pattern: Option<String>,
    pub max: usize,
}

impl NativeSearchRequest {
    pub(crate) fn run(&self) -> Result<NativeSearchResult, String> {
        native_search(&NativeSearchOptions {
            root: &self.root,
            target: &self.target,
            query: &self.query,
            regex: self.regex,
            word: self.word,
            case_sensitive: self.case_sensitive,
            file_pattern: self.file_pattern.as_deref(),
            max: self.max,
        })
    }
}

fn build_regex(opts: &NativeSearchOptions<'_>) -> Result<Regex, String> {
    let base = if opts.regex { opts.query.to_string() } else { regex::escape(opts.query) };
    let pattern = if opts.word { format!(r"\b(?:{base})\b") } else { base };
    let pattern = if opts.case_sensitive { pattern } else { format!("(?i:{pattern})") };
    Regex::new(&pattern).map_err(|e| e.to_string())
}

fn glob_to_regex(pattern: &str) -> Option<Regex> {
    let mut out = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '*' => out.push_str(".*"),
            '?' => out.push('.'),
            c => out.push_str(&regex::escape(&c.to_string())),
        }
    }
    out.push('$');
    Regex::new(&out).ok()
}

fn relative_path(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.to_string_lossy().replace('\\', "/")
}

fn column_at(line: &str, byte_offset: usize) -> u32 {
    // Monaco counts UTF-16 code units, not bytes.
    u32::try_from(line[..byte_offset.min(line.len())].encode_utf16().count().saturating_add(1))
        .unwrap_or(u32::MAX)
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(MAX_SNIPPET_BYTES).any(|b| *b == 0)
}

fn search_file(
    path: &Path,
    root: &Path,
    regex: &Regex,
    opts: &NativeSearchOptions<'_>,
    out: &mut Vec<SearchMatch>,
) -> Result<bool, ()> {
    let Ok(meta) = std::fs::metadata(path) else {
        return Err(());
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Ok(false);
    }
    let Ok(bytes) = std::fs::read(path) else {
        // Unreadable file (permissions): skip it, like ripgrep's exit-2-with-
        // matches behaviour.
        return Ok(false);
    };
    if looks_binary(&bytes) {
        return Ok(false);
    }
    let text = String::from_utf8_lossy(&bytes);
    let rel = relative_path(root, path);
    for (idx, raw_line) in text.split('\n').enumerate() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        for m in regex.find_iter(line) {
            out.push(SearchMatch {
                file_path: rel.clone(),
                line: u32::try_from(idx + 1).unwrap_or(u32::MAX),
                column: column_at(line, m.start()),
                line_text: line.to_string(),
            });
            if out.len() > opts.max {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Walk `target` and return at most `max` matches plus a truncation flag.
pub(crate) fn native_search(opts: &NativeSearchOptions<'_>) -> Result<NativeSearchResult, String> {
    let regex = build_regex(opts)?;
    let pattern = opts
        .file_pattern
        .and_then(glob_to_regex)
        .filter(|_| !opts.file_pattern.unwrap_or("").is_empty());
    let started = Instant::now();
    let mut out = Vec::new();
    let mut stack = vec![opts.target.to_path_buf()];
    let mut visited = 0usize;

    while let Some(dir) = stack.pop() {
        if started.elapsed() > MAX_DURATION {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if out.len() > opts.max || started.elapsed() > MAX_DURATION {
                break;
            }
            visited += 1;
            if visited > MAX_ENTRIES {
                break;
            }
            let path: PathBuf = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // Symlinks are skipped: following them can leave the root or loop.
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !SKIP_DIRS.contains(&name.as_ref()) {
                    stack.push(path);
                }
                continue;
            }
            if let Some(pattern) = &pattern {
                if !pattern.is_match(&relative_path(opts.root, &path)) {
                    continue;
                }
            }
            if search_file(&path, opts.root, &regex, opts, &mut out).unwrap_or(false) {
                break;
            }
        }
    }

    let truncated = out.len() > opts.max;
    out.truncate(opts.max);
    Ok(NativeSearchResult { matches: out, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(
            dir.path().join("src/main.go"),
            "package main\n// function example\nfunc main() {}\n",
        )
        .unwrap();
        fs::write(dir.path().join("README.md"), "# Function and function\n").unwrap();
        fs::write(dir.path().join("node_modules/pkg/index.js"), "function hidden()\n").unwrap();
        fs::write(dir.path().join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        dir
    }

    fn search<'a>(
        dir: &'a tempfile::TempDir,
        query: &'a str,
        regex: bool,
        word: bool,
        case_sensitive: bool,
        max: usize,
    ) -> NativeSearchResult {
        native_search(&NativeSearchOptions {
            root: dir.path(),
            target: dir.path(),
            query,
            regex,
            word,
            case_sensitive,
            file_pattern: None,
            max,
        })
        .unwrap()
    }

    #[test]
    fn finds_literals_case_insensitively_and_skips_ignored_dirs_and_binaries() {
        let dir = fixture();
        let result = search(&dir, "function", false, false, false, 100);
        let files: Vec<_> = result.matches.iter().map(|m| m.file_path.as_str()).collect();
        assert!(files.contains(&"src/main.go"));
        assert!(files.contains(&"README.md"));
        assert!(!files.iter().any(|f| f.starts_with("node_modules/")));
        assert!(!files.iter().any(|f| f.ends_with("blob.bin")));
        assert!(!result.truncated);
    }

    #[test]
    fn honours_case_sensitivity_and_whole_words() {
        let dir = fixture();
        let sensitive = search(&dir, "Function", false, false, true, 100);
        assert_eq!(sensitive.matches.len(), 1);
        assert_eq!(sensitive.matches[0].file_path, "README.md");

        let whole = search(&dir, "function", false, true, true, 100);
        assert!(whole.matches.len() >= 2);
        assert!(whole.matches.iter().all(|m| m.line_text.contains("function")));
    }

    #[test]
    fn supports_regex_and_reports_truncation() {
        let dir = fixture();
        let regex = search(&dir, r"fun\w+", true, false, false, 100);
        assert!(regex.matches.len() >= 3);

        let capped = search(&dir, "function", false, false, false, 1);
        assert_eq!(capped.matches.len(), 1);
        assert!(capped.truncated);
    }
}

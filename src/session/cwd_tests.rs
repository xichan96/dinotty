use super::*;

// ── find_subslice ────────────────────────────────────────────────

#[test]
fn find_subslice_finds_needle() {
    assert_eq!(find_subslice(b"hello world", b"world"), Some(6));
}

#[test]
fn find_subslice_returns_none_when_absent() {
    assert_eq!(find_subslice(b"hello", b"xyz"), None);
}

#[test]
fn find_subslice_at_start() {
    assert_eq!(find_subslice(b"abcdef", b"abc"), Some(0));
}

#[test]
fn find_subslice_needle_longer_than_haystack() {
    assert_eq!(find_subslice(b"ab", b"abc"), None);
}

// ── parse_title_cwd ─────────────────────────────────────────────

#[test]
fn parse_title_cwd_absolute_path() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:/var/log", &home);
    assert_eq!(result, Some(PathBuf::from("/var/log")));
}

#[test]
fn parse_title_cwd_home_shorthand() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:~", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user")));
}

#[test]
fn parse_title_cwd_relative_path() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:projects/foo", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user/projects/foo")));
}

#[test]
fn parse_title_cwd_home_slash_prefix() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:~/code", &home);
    assert_eq!(result, Some(PathBuf::from("/home/user/code")));
}

#[test]
fn parse_title_cwd_no_at_sign() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("no-at-sign", &home), None);
}

#[test]
fn parse_title_cwd_no_colon() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("user@host-no-colon", &home), None);
}

#[test]
fn parse_title_cwd_empty_path() {
    let home = PathBuf::from("/home/user");
    assert_eq!(parse_title_cwd("user@host:", &home), None);
}

#[test]
fn parse_title_cwd_whitespace_trimmed() {
    let home = PathBuf::from("/home/user");
    let result = parse_title_cwd("user@host:  /tmp  ", &home);
    assert_eq!(result, Some(PathBuf::from("/tmp")));
}

#[cfg(windows)]
#[test]
fn parse_title_cwd_windows_drive_path() {
    let home = PathBuf::from(r"C:\Users\dev");
    let result = parse_title_cwd(r"user@host:C:\Users\dev\project", &home);
    assert_eq!(result, Some(PathBuf::from(r"C:\Users\dev\project")));
}

// ── sniff_cwd_from_title_osc ────────────────────────────────────

#[test]
fn sniff_cwd_extracts_from_bel_terminated_osc() {
    // Use a real directory and canonicalize the expected local path, because
    // CWD sniffing resolves symlinks
    // (e.g. /tmp -> /private/tmp on macOS).
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    // Use the real temp dir path so canonicalize succeeds
    let tmp = std::env::temp_dir();
    let tmp_str = tmp.to_string_lossy();
    let data = format!("\x1b]0;user@host:{}\x07", tmp_str);
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, true);
    assert_eq!(cwd, dunce::canonicalize(&tmp).unwrap_or(tmp));
}

#[test]
fn sniff_cwd_extracts_from_st_terminated_osc() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    let tmp = std::env::temp_dir();
    let tmp_str = tmp.to_string_lossy();
    let data = format!("\x1b]0;user@host:{}\x1b\\", tmp_str);
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, true);
    assert_eq!(cwd, dunce::canonicalize(&tmp).unwrap_or(tmp));
}

#[test]
fn sniff_cwd_handles_chunked_input() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    let target = std::env::temp_dir();
    let target_str = target.to_string_lossy();
    sniff_cwd_from_title_osc(&mut buf, b"\x1b]0;user", &home, &mut cwd, true);
    assert_eq!(cwd, PathBuf::from("/home/user")); // not yet
    let chunk = format!("@host:{target_str}\x07");
    sniff_cwd_from_title_osc(&mut buf, chunk.as_bytes(), &home, &mut cwd, true);
    assert_eq!(cwd, dunce::canonicalize(&target).unwrap_or(target));
}

#[test]
fn sniff_cwd_buffers_beyond_cap() {
    let home = PathBuf::from("/home/user");
    let mut cwd = PathBuf::from("/home/user");
    let mut buf = Vec::new();
    // Fill buffer with garbage beyond the cap
    let big_data = vec![b'x'; OSC_SNIFF_CAP + 1000];
    sniff_cwd_from_title_osc(&mut buf, &big_data, &home, &mut cwd, true);
    assert!(buf.len() <= OSC_SNIFF_CAP);
}

#[cfg(windows)]
#[test]
fn sniff_cwd_accepts_powershell_title_with_windows_path() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let target = tmp.path().join("project");
    std::fs::create_dir(&target).unwrap();
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    let data = format!("\x1b]0;user@host:{}\x07", target.display());

    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, true);

    assert_eq!(cwd, dunce::canonicalize(target).unwrap());
}

#[cfg(windows)]
#[test]
fn sniff_cwd_buffers_chunked_powershell_title_with_windows_path() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let target = tmp.path().join("chunked-project");
    std::fs::create_dir(&target).unwrap();
    let mut cwd = home.clone();
    let mut buf = Vec::new();

    sniff_cwd_from_title_osc(&mut buf, b"\x1b]0;user@host:", &home, &mut cwd, true);
    assert_eq!(cwd, home);
    sniff_cwd_from_title_osc(
        &mut buf,
        format!("{}\x07", target.display()).as_bytes(),
        &home,
        &mut cwd,
        true,
    );

    assert_eq!(cwd, dunce::canonicalize(target).unwrap());
}

#[cfg(windows)]
#[test]
fn sniff_cwd_falls_back_to_raw_windows_path_when_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().to_path_buf();
    let old_cwd = tmp.path().join("old");
    std::fs::create_dir(&old_cwd).unwrap();
    let missing = tmp.path().join("missing");
    let mut cwd = old_cwd.canonicalize().unwrap();
    let mut buf = Vec::new();
    let data = format!("\x1b]0;user@host:{}\x07", missing.display());

    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, true);

    assert_eq!(cwd, missing);
}

// ── CWD state tracking ─────────────────────────────────────────────

#[test]
fn cwd_state_default_path() {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let state = CwdState { cwd: home.clone(), host_cwd: Some(home.clone()), sniff_buf: Vec::new() };
    assert_eq!(state.cwd, home);
}

#[test]
fn sniff_cwd_updates_cwd_state() {
    let home = PathBuf::from("/");
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    let target = std::env::temp_dir();
    let target_str = target.to_string_lossy();
    // OSC 0: \x1b]0;user@host:path\x07
    let data = format!("\x1b]0;user@host:{target_str}\x07");
    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, true);
    assert_eq!(cwd, dunce::canonicalize(&target).unwrap_or(target));
}

#[test]
fn sniff_cwd_falls_back_to_raw_path_when_canonicalize_fails() {
    let home = PathBuf::from("/");
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    // Path does not exist, so local canonicalization falls back to the parsed path.
    sniff_cwd_from_title_osc(
        &mut buf,
        b"\x1b]0;user@host:/nonexistent_path_12345\x07",
        &home,
        &mut cwd,
        true,
    );
    assert_eq!(cwd, PathBuf::from("/nonexistent_path_12345"));
}

#[test]
fn sniff_remote_cwd_does_not_canonicalize_against_host_filesystem() {
    let temp = tempfile::tempdir().unwrap();
    let nested = temp.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let remote_path = nested.join("..");
    let home = PathBuf::from("/remote/home");
    let mut cwd = home.clone();
    let mut buf = Vec::new();
    let data = format!("\x1b]0;user@host:{}\x07", remote_path.display());

    sniff_cwd_from_title_osc(&mut buf, data.as_bytes(), &home, &mut cwd, false);

    assert_eq!(cwd, remote_path);
}

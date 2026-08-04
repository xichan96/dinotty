use std::path::{Path, PathBuf};

pub struct CwdState {
    pub cwd: PathBuf,
    pub sniff_buf: Vec<u8>,
}

pub(crate) const OSC_SNIFF_CAP: usize = 32768;

/// Parse CWD from terminal title OSC sequences.
///
/// Made `pub(crate)` so `Session::on_pty_output` can call it from `super::`.
pub(crate) fn sniff_cwd_from_title_osc(
    buf: &mut Vec<u8>,
    chunk: &[u8],
    home: &Path,
    cwd: &mut PathBuf,
    canonicalize_local: bool,
) {
    buf.extend_from_slice(chunk);
    if buf.len() > OSC_SNIFF_CAP {
        let drop = buf.len() - OSC_SNIFF_CAP;
        buf.drain(..drop);
    }
    let needle = b"\x1b]0;";
    while let Some(i) = find_subslice(buf, needle) {
        let payload_start = i + needle.len();
        let bel_pos = buf[payload_start..].iter().position(|&b| b == 0x07);
        let st_pos = buf[payload_start..].windows(2).position(|w| w == b"\x1b\\");
        let rel = match (bel_pos, st_pos) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        let terminator_len = if st_pos == Some(rel) { 2 } else { 1 };
        let title_end = payload_start + rel;
        let title = String::from_utf8_lossy(&buf[payload_start..title_end]);
        if let Some(p) = parse_title_cwd(&title, home) {
            *cwd = if canonicalize_local { dunce::canonicalize(&p).unwrap_or(p) } else { p };
        }
        buf.drain(..title_end + terminator_len);
    }
}

pub(crate) fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

pub(crate) fn parse_title_cwd(title: &str, home: &Path) -> Option<PathBuf> {
    let at = title.rfind('@')?;
    let tail = title.get(at + 1..)?;
    let colon = tail.find(':')?;
    let path_part = tail.get(colon + 1..)?.trim();
    if path_part.is_empty() {
        return None;
    }
    let path = if let Some(rest) = path_part.strip_prefix("~/") {
        home.join(rest)
    } else if path_part == "~" {
        home.to_path_buf()
    } else if Path::new(path_part).is_absolute() {
        PathBuf::from(path_part)
    } else {
        home.join(path_part)
    };
    Some(path)
}

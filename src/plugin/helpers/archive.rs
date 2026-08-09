pub fn extract_tar_gz(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut archive = tar::Archive::new(decoder);
    archive.set_overwrite(false);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let raw_name = path.to_string_lossy();
        validate_archive_path(&raw_name, &path, dest)?;
    }

    let decoder2 = GzDecoder::new(Cursor::new(data));
    let mut archive2 = tar::Archive::new(decoder2);
    archive2.unpack(dest).map_err(|e| e.to_string())
}

pub fn extract_zip(data: &[u8], dest: &std::path::Path) -> Result<(), String> {
    use std::io::Cursor;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| format!("zip read error: {e}"))?;
        let raw_name = file.name().to_string();
        validate_archive_path(&raw_name, std::path::Path::new(&raw_name), dest)?;
    }

    let mut archive2 =
        zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("invalid zip: {e}"))?;
    archive2.extract(dest).map_err(|e| format!("zip extract error: {e}"))
}

fn validate_archive_path(
    raw_name: &str,
    path: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    use std::path::Component;

    if raw_name.trim().is_empty() {
        return Err("archive contains empty path".into());
    }
    if raw_name.starts_with('/') || raw_name.starts_with('\\') {
        return Err("archive contains absolute path".into());
    }
    if has_windows_drive_prefix(raw_name) {
        return Err("archive contains Windows drive path".into());
    }
    if raw_name.contains('\\') {
        return Err("archive contains Windows-style path separator".into());
    }
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err("archive contains path traversal or absolute path".into());
    }

    let outpath = dest.join(path);
    if !outpath.starts_with(dest) {
        return Err("archive entry escapes destination".into());
    }

    Ok(())
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[cfg(test)]
mod tests {
    use super::{extract_tar_gz, extract_zip};
    use std::io::{Cursor, Write};

    fn tar_gz_with_entry(name: &str, content: &[u8]) -> Vec<u8> {
        fn write_octal(field: &mut [u8], value: u64) {
            let encoded = format!("{value:0width$o}\0", width = field.len() - 1);
            field.copy_from_slice(encoded.as_bytes());
        }

        let mut tar = Vec::new();
        let mut header = [0_u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        write_octal(&mut header[100..108], 0o644);
        write_octal(&mut header[108..116], 0);
        write_octal(&mut header[116..124], 0);
        write_octal(&mut header[124..136], content.len() as u64);
        write_octal(&mut header[136..148], 0);
        header[148..156].fill(b' ');
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let checksum: u32 = header.iter().map(|&byte| u32::from(byte)).sum();
        let checksum = format!("{checksum:06o}\0 ");
        header[148..156].copy_from_slice(checksum.as_bytes());

        tar.extend_from_slice(&header);
        tar.extend_from_slice(content);
        let padding = (512 - (content.len() % 512)) % 512;
        tar.extend(std::iter::repeat_n(0, padding));
        tar.extend_from_slice(&[0_u8; 1024]);

        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&tar).unwrap();
        encoder.finish().unwrap()
    }

    fn zip_with_entry(name: &str, content: &[u8]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        writer.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn zip_with_directory_and_file(dir: &str, file: &str, content: &[u8]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        writer.add_directory(dir, zip::write::SimpleFileOptions::default()).unwrap();
        writer.start_file(file, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn assert_rejects_without_writes(
        entry_name: &str,
        archive: Vec<u8>,
        extract: fn(&[u8], &std::path::Path) -> Result<(), String>,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        let err = extract(&archive, &dest).unwrap_err();

        assert!(err.contains("archive contains"), "unexpected error: {err}");
        assert!(std::fs::read_dir(&dest).unwrap().next().is_none());
        assert!(!tmp.path().join("evil").exists(), "entry {entry_name} wrote outside dest");
    }

    // 验证 tar.gz 会拒绝路径穿越、绝对路径和 Windows drive path。
    #[test]
    fn extract_tar_gz_rejects_unsafe_archive_paths() {
        for name in ["../evil", "/absolute", r"..\evil", r"C:\evil", "C:/evil"] {
            assert_rejects_without_writes(name, tar_gz_with_entry(name, b"bad"), extract_tar_gz);
        }
    }

    // 验证 zip 会拒绝路径穿越、绝对路径和 Windows drive path。
    #[test]
    fn extract_zip_rejects_unsafe_archive_paths() {
        for name in ["../evil", "/absolute", r"..\evil", r"C:\evil", "C:/evil"] {
            assert_rejects_without_writes(name, zip_with_entry(name, b"bad"), extract_zip);
        }
    }

    // 验证 tar.gz 中正常嵌套相对路径可以解压。
    #[test]
    fn extract_tar_gz_allows_nested_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_tar_gz(&tar_gz_with_entry("safe/nested.txt", b"ok"), &dest).unwrap();

        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
    }

    // 验证 zip 中正常嵌套相对路径可以解压。
    #[test]
    fn extract_zip_allows_nested_relative_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_zip(&zip_with_entry("safe/nested.txt", b"ok"), &dest).unwrap();

        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
    }

    // 验证 zip 中目录项和文件项混合时安全路径仍可解压。
    #[test]
    fn extract_zip_allows_safe_directory_and_file_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();

        extract_zip(&zip_with_directory_and_file("safe/", "safe/nested.txt", b"ok"), &dest)
            .unwrap();

        assert!(dest.join("safe").is_dir());
        assert_eq!(std::fs::read_to_string(dest.join("safe/nested.txt")).unwrap(), "ok");
    }
}

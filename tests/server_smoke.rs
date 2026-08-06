#[cfg(windows)]
mod windows_smoke {
    use reqwest::blocking::Client;
    use serde_json::Value;
    use std::error::Error;
    use std::fs;
    use std::io;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;

    type TestResult<T = ()> = Result<T, Box<dyn Error>>;

    struct ChildGuard(Child);

    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn test_error(message: impl Into<String>) -> Box<dyn Error> {
        io::Error::other(message.into()).into()
    }

    fn free_loopback_port() -> TestResult<u16> {
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        Ok(listener.local_addr()?.port())
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn create_dir(path: &Path) -> TestResult {
        fs::create_dir_all(path)
            .map_err(|err| test_error(format!("create {}: {err}", path.display())))
    }

    #[test]
    fn background_process_launches_use_no_window() -> TestResult {
        let root = repo_root();
        let mut files = Vec::new();
        collect_rust_files(&root.join("src"), &mut files)?;
        collect_rust_files(&root.join("src-tauri").join("src"), &mut files)?;

        let mut violations = Vec::new();
        for file in files {
            collect_command_violations(&root, &file, &mut violations)?;
        }

        assert!(
            violations.is_empty(),
            "Windows background process launches must call a no-window helper near `Command::new(...)` \
             so GUI/portable builds do not flash transient console windows:\n{}",
            violations.join("\n")
        );
        Ok(())
    }

    #[test]
    fn server_starts_and_serves_core_routes() -> TestResult {
        let server = env!("CARGO_BIN_EXE_dinotty-server");
        let port = free_loopback_port()?;
        let tmp = tempfile::Builder::new().prefix("dinotty-smoke-").tempdir()?;

        let appdata = tmp.path().join("AppData").join("Roaming");
        let localappdata = tmp.path().join("AppData").join("Local");
        let userprofile = tmp.path().join("User");
        create_dir(&appdata)?;
        create_dir(&localappdata)?;
        create_dir(&userprofile)?;

        let mut child =
            spawn_server(server, port, &userprofile, &tmp, &appdata, &localappdata, &userprofile)?;

        let client = Client::builder().timeout(Duration::from_secs(2)).build()?;
        let base = format!("http://127.0.0.1:{port}");
        wait_until_ready(&client, &base, port, &mut child, tmp.path())?;

        let index = client.get(format!("{base}/")).send()?.error_for_status()?.text()?;
        assert!(index.contains("id=\"app\""), "index body should contain Vue app mount");

        let settings: Value = client
            .get(format!("{base}/api/settings"))
            .bearer_auth("smoke-token")
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)?
            .json()?;
        assert!(settings.get("theme").is_some(), "settings response should include theme");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_server(
        server: &str,
        port: u16,
        cwd: &Path,
        tmp: &TempDir,
        appdata: &Path,
        localappdata: &Path,
        userprofile: &Path,
    ) -> TestResult<ChildGuard> {
        let stdout = fs::File::create(tmp.path().join("server.out.log"))?;
        let stderr = fs::File::create(tmp.path().join("server.err.log"))?;

        let mut cmd = Command::new(server);
        cmd.args(["--port", &port.to_string()])
            .current_dir(cwd)
            .env("APPDATA", appdata)
            .env("LOCALAPPDATA", localappdata)
            .env("USERPROFILE", userprofile)
            .env("DINOTTY_TOKEN", "smoke-token")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000 | 0x0000_0008); // CREATE_NO_WINDOW | DETACHED_PROCESS
        }

        Ok(ChildGuard(cmd.spawn()?))
    }

    fn collect_rust_files(dir: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
        if !dir.is_dir() {
            return Ok(());
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                collect_rust_files(&path, files)?;
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                files.push(path);
            }
        }
        Ok(())
    }

    fn collect_command_violations(
        root: &Path,
        file: &Path,
        violations: &mut Vec<String>,
    ) -> TestResult {
        let content = fs::read_to_string(file)?;
        let lines: Vec<&str> = content.lines().collect();

        for (idx, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") || !is_process_command_new(trimmed) {
                continue;
            }
            let window = command_window(&lines, idx);
            if window.contains(".no_window()") || window.contains(".no_window_with_stdio()") {
                continue;
            }

            let display = file.strip_prefix(root).unwrap_or(file);
            violations.push(format!("{}:{}: {trimmed}", display.display(), idx + 1));
        }

        Ok(())
    }

    fn is_process_command_new(line: &str) -> bool {
        line.contains("Command::new(") && !line.contains("CommandBuilder::new(")
    }

    fn command_window(lines: &[&str], start: usize) -> String {
        const LOOKAHEAD_LINES: usize = 6;

        let mut window = String::new();
        for line in lines.iter().skip(start).take(LOOKAHEAD_LINES) {
            window.push_str(line);
            window.push('\n');
        }
        window
    }

    fn wait_until_ready(
        client: &Client,
        base: &str,
        port: u16,
        child: &mut ChildGuard,
        log_dir: &Path,
    ) -> TestResult {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last_error = String::new();

        while Instant::now() < deadline {
            if let Some(status) = child.0.try_wait()? {
                return Err(test_error(format!(
                    "server exited early with {status}; stderr:\n{}",
                    read_log(log_dir, "server.err.log")
                )));
            }

            match client.get(format!("{base}/api/info")).bearer_auth("smoke-token").send() {
                Ok(resp) => match resp.error_for_status() {
                    Ok(resp) => match resp.json::<Value>() {
                        Ok(info) => {
                            let actual = info.get("port").and_then(Value::as_u64);
                            if actual == Some(u64::from(port)) {
                                return Ok(());
                            }
                            return Err(test_error(format!(
                                "unexpected /api/info port: {actual:?}"
                            )));
                        }
                        Err(err) => last_error = err.to_string(),
                    },
                    Err(err) => last_error = err.to_string(),
                },
                Err(err) => last_error = err.to_string(),
            }

            std::thread::sleep(Duration::from_millis(500));
        }

        Err(test_error(format!(
            "server did not become ready: {last_error}; stderr:\n{}",
            read_log(log_dir, "server.err.log")
        )))
    }

    fn read_log(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap_or_else(|_| "<missing log>".to_string())
    }
}

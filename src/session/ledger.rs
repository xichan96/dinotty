//! Crash-orphan PID ledger and conservative boot-time process sweep.
#![allow(clippy::similar_names)] // The on-disk schema deliberately uses both `pid` and `pgid`.

#[cfg(unix)]
mod platform {
    use serde::{Deserialize, Serialize};
    use std::collections::HashMap;
    use std::fs::{File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::fd::AsRawFd;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tracing::{info, warn};

    const SCHEMA_VERSION: u32 = 1;
    const TERM_GRACE: Duration = Duration::from_millis(50);

    #[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
    struct ProcessIdentity {
        pid: u32,
        start_time: u64,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
    struct LedgerEntry {
        pane_id: String,
        pid: u32,
        pgid: u32,
        proc_start_time: u64,
        spawned_at: u64,
        owner: ProcessIdentity,
    }

    #[derive(Debug, Deserialize, Serialize)]
    struct Ledger {
        schema_version: u32,
        entries: Vec<LedgerEntry>,
    }

    impl Default for Ledger {
        fn default() -> Self {
            Self { schema_version: SCHEMA_VERSION, entries: Vec::new() }
        }
    }

    #[derive(Default)]
    struct SweepSummary {
        entries: usize,
        kept_foreign: usize,
        swept: usize,
        skipped_unverified: usize,
    }

    enum Probe {
        Alive,
        Dead,
        Unknown(io::Error),
    }

    struct LedgerLock {
        _file: File,
    }

    impl LedgerLock {
        fn acquire(path: &Path) -> Result<Self, String> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("create ledger directory: {error}"))?;
            }
            let lock_path = path.with_file_name("session-ledger.lock");
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&lock_path)
                .map_err(|error| format!("open ledger lock {}: {error}", lock_path.display()))?;
            let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result == 0 {
                Ok(Self { _file: file })
            } else {
                let error = io::Error::last_os_error();
                warn!(path = %path.display(), %error, "PID ledger lock contended; skipping operation");
                Err(format!("lock PID ledger: {error}"))
            }
        }
    }

    fn ledger_path() -> PathBuf {
        crate::settings::config_dir().join("session-ledger.json")
    }

    fn read_ledger(path: &Path) -> Ledger {
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ledger::default(),
            Err(error) => {
                warn!(path = %path.display(), %error, "PID ledger unreadable; treating as empty");
                return Ledger::default();
            }
        };
        let mut contents = String::new();
        if let Err(error) = file.read_to_string(&mut contents) {
            warn!(path = %path.display(), %error, "PID ledger unreadable; treating as empty");
            return Ledger::default();
        }
        match serde_json::from_str::<Ledger>(&contents) {
            Ok(ledger) if ledger.schema_version == SCHEMA_VERSION => ledger,
            Ok(ledger) => {
                warn!(
                    path = %path.display(),
                    schema_version = ledger.schema_version,
                    "Unsupported PID ledger schema; treating as empty"
                );
                Ledger::default()
            }
            Err(error) => {
                warn!(path = %path.display(), %error, "PID ledger corrupt; treating as empty");
                Ledger::default()
            }
        }
    }

    fn write_ledger(path: &Path, ledger: &Ledger) -> Result<(), String> {
        let temp_path = path.with_file_name("session-ledger.json.tmp");
        let bytes = serde_json::to_vec_pretty(ledger)
            .map_err(|error| format!("serialize PID ledger: {error}"))?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("open temporary PID ledger: {error}"))?;
        file.write_all(&bytes)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("write temporary PID ledger: {error}"))?;
        std::fs::rename(&temp_path, path)
            .map_err(|error| format!("replace PID ledger atomically: {error}"))
    }

    fn current_owner() -> Result<ProcessIdentity, String> {
        let pid = std::process::id();
        let start_time = process_start_time(pid)
            .ok_or_else(|| format!("cannot read owner process start time for pid {pid}"))?;
        Ok(ProcessIdentity { pid, start_time })
    }

    fn epoch_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }

    /// Returns the current process group for `pid` when it can be inspected.
    #[must_use]
    pub fn process_group_id(pid: u32) -> Option<u32> {
        let pid = i32::try_from(pid).ok()?;
        let pgid = unsafe { libc::getpgid(pid) };
        u32::try_from(pgid).ok().filter(|pgid| *pgid != 0)
    }

    /// Adds or replaces the crash-recovery entry for a pane.
    ///
    /// # Errors
    /// Returns an error when the owner identity, ledger lock, or atomic write is unavailable.
    pub fn add_entry(
        pane_id: &str,
        pid: u32,
        pgid: u32,
        proc_start_time: u64,
    ) -> Result<(), String> {
        let owner = current_owner()?;
        add_entry_at(&ledger_path(), pane_id, pid, pgid, proc_start_time, owner)
    }

    fn add_entry_at(
        path: &Path,
        pane_id: &str,
        pid: u32,
        pgid: u32,
        proc_start_time: u64,
        owner: ProcessIdentity,
    ) -> Result<(), String> {
        let _lock = LedgerLock::acquire(path)?;
        let mut ledger = read_ledger(path);
        ledger.entries.retain(|entry| entry.pane_id != pane_id || entry.owner != owner);
        ledger.entries.push(LedgerEntry {
            pane_id: pane_id.to_string(),
            pid,
            pgid,
            proc_start_time,
            spawned_at: epoch_millis(),
            owner,
        });
        write_ledger(path, &ledger)
    }

    /// Removes a pane after its process termination has been confirmed.
    ///
    /// # Errors
    /// Returns an error when the ledger lock or atomic write is unavailable.
    pub fn remove_entry(pane_id: &str) -> Result<(), String> {
        let path = ledger_path();
        if !path.exists() {
            return Ok(());
        }
        let owner = current_owner()?;
        remove_entry_at(&path, pane_id, &owner)
    }

    fn remove_entry_at(path: &Path, pane_id: &str, owner: &ProcessIdentity) -> Result<(), String> {
        if !path.exists() {
            return Ok(());
        }
        let _lock = LedgerLock::acquire(path)?;
        let mut ledger = read_ledger(path);
        let old_len = ledger.entries.len();
        ledger.entries.retain(|entry| entry.pane_id != pane_id || &entry.owner != owner);
        if ledger.entries.len() == old_len {
            return Ok(());
        }
        write_ledger(path, &ledger)
    }

    /// Conservatively confirms that this owner's recorded process group is gone.
    /// A live identity, live group, or any probe uncertainty keeps the ledger entry.
    #[must_use]
    pub fn termination_confirmed(pane_id: &str) -> bool {
        let path = ledger_path();
        if !path.exists() {
            return true;
        }
        let owner = match current_owner() {
            Ok(owner) => owner,
            Err(error) => {
                warn!(pane_id, %error, "Cannot identify PID ledger owner while confirming natural exit");
                return false;
            }
        };
        let _lock = match LedgerLock::acquire(&path) {
            Ok(lock) => lock,
            Err(error) => {
                warn!(pane_id, %error, "Cannot lock PID ledger while confirming natural exit");
                return false;
            }
        };
        let ledger = read_ledger(&path);
        let Some(entry) =
            ledger.entries.iter().find(|entry| entry.pane_id == pane_id && entry.owner == owner)
        else {
            return true;
        };

        match identity_probe(entry.pid, entry.proc_start_time) {
            Probe::Alive | Probe::Unknown(_) => false,
            Probe::Dead => matches!(group_probe(entry.pgid), Probe::Dead),
        }
    }

    pub fn boot_sweep() {
        let path = ledger_path();
        let summary = match sweep_at(&path) {
            Ok(summary) => summary,
            Err(error) => {
                warn!(%error, "PID ledger boot sweep skipped");
                SweepSummary::default()
            }
        };
        info!(
            entries = summary.entries,
            kept_foreign = summary.kept_foreign,
            swept = summary.swept,
            skipped_unverified = summary.skipped_unverified,
            "PID ledger boot sweep complete"
        );
    }

    fn sweep_at(path: &Path) -> Result<SweepSummary, String> {
        let _lock = LedgerLock::acquire(path)?;
        let mut ledger = read_ledger(path);
        let mut summary = SweepSummary { entries: ledger.entries.len(), ..SweepSummary::default() };
        let mut retained = Vec::with_capacity(ledger.entries.len());

        for entry in ledger.entries.drain(..) {
            match identity_probe(entry.owner.pid, entry.owner.start_time) {
                Probe::Alive => {
                    summary.kept_foreign += 1;
                    retained.push(entry);
                    continue;
                }
                Probe::Unknown(error) => {
                    warn!(pane_id = %entry.pane_id, owner_pid = entry.owner.pid, %error, "Cannot verify PID ledger owner; keeping entry");
                    summary.skipped_unverified += 1;
                    retained.push(entry);
                    continue;
                }
                Probe::Dead => {}
            }

            match sweep_entry(&entry) {
                SweepOutcome::Swept => summary.swept += 1,
                SweepOutcome::Skipped(reason) => {
                    warn!(pane_id = %entry.pane_id, pid = entry.pid, pgid = entry.pgid, %reason, "Orphan PID ledger entry could not be verified; keeping entry");
                    summary.skipped_unverified += 1;
                    retained.push(entry);
                }
            }
        }

        ledger.entries = retained;
        write_ledger(path, &ledger)?;
        Ok(summary)
    }

    enum SweepOutcome {
        Swept,
        Skipped(String),
    }

    fn sweep_entry(entry: &LedgerEntry) -> SweepOutcome {
        match group_probe(entry.pgid) {
            Probe::Dead => return SweepOutcome::Swept,
            Probe::Unknown(error) => return SweepOutcome::Skipped(format!("group probe: {error}")),
            Probe::Alive => {}
        }

        let before = match snapshot_group(entry.pgid) {
            Ok(members) => members,
            Err(error) => return SweepOutcome::Skipped(format!("group snapshot: {error}")),
        };
        if before.get(&entry.pid).copied() != Some(entry.proc_start_time) {
            return SweepOutcome::Skipped("recorded process identity mismatch".to_string());
        }

        if let Err(error) = signal_group(entry.pgid, libc::SIGTERM) {
            if error.raw_os_error() == Some(libc::ESRCH) {
                return SweepOutcome::Swept;
            }
            return SweepOutcome::Skipped(format!("TERM failed: {error}"));
        }
        std::thread::sleep(TERM_GRACE);

        match group_probe(entry.pgid) {
            Probe::Dead => return SweepOutcome::Swept,
            Probe::Unknown(error) => {
                return SweepOutcome::Skipped(format!("post-TERM group probe: {error}"));
            }
            Probe::Alive => {}
        }

        let after = match snapshot_group(entry.pgid) {
            Ok(members) if !members.is_empty() => members,
            Ok(_) => {
                return SweepOutcome::Skipped("live group had no verifiable members".to_string())
            }
            Err(error) => return SweepOutcome::Skipped(format!("post-TERM snapshot: {error}")),
        };
        for (pid, start_time) in &after {
            if before.get(pid) != Some(start_time) {
                return SweepOutcome::Skipped(format!(
                    "group member identity changed after TERM: pid {pid}"
                ));
            }
        }

        for (pid, start_time) in &after {
            match identity_probe(*pid, *start_time) {
                Probe::Alive => {
                    if let Err(error) = signal_process(*pid, libc::SIGKILL) {
                        if error.raw_os_error() != Some(libc::ESRCH) {
                            return SweepOutcome::Skipped(format!("KILL pid {pid}: {error}"));
                        }
                    }
                }
                Probe::Dead => {}
                Probe::Unknown(error) => {
                    return SweepOutcome::Skipped(format!("re-verify pid {pid}: {error}"));
                }
            }
        }
        std::thread::sleep(TERM_GRACE);

        match group_probe(entry.pgid) {
            Probe::Dead => SweepOutcome::Swept,
            Probe::Alive => {
                SweepOutcome::Skipped("process group still alive after KILL".to_string())
            }
            Probe::Unknown(error) => {
                SweepOutcome::Skipped(format!("post-KILL group probe: {error}"))
            }
        }
    }

    fn identity_probe(pid: u32, expected_start_time: u64) -> Probe {
        match process_probe(pid) {
            Probe::Alive => match process_start_time(pid) {
                Some(actual) if actual == expected_start_time => Probe::Alive,
                Some(_) => Probe::Dead,
                None => Probe::Unknown(io::Error::last_os_error()),
            },
            other => other,
        }
    }

    fn process_probe(pid: u32) -> Probe {
        let Ok(pid) = i32::try_from(pid) else {
            return Probe::Dead;
        };
        probe_kill(pid)
    }

    fn group_probe(pgid: u32) -> Probe {
        let Ok(pgid) = i32::try_from(pgid) else {
            return Probe::Dead;
        };
        probe_kill(-pgid)
    }

    fn probe_kill(pid: i32) -> Probe {
        if unsafe { libc::kill(pid, 0) } == 0 {
            return Probe::Alive;
        }
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::ESRCH) => Probe::Dead,
            Some(libc::EPERM) => Probe::Alive,
            _ => Probe::Unknown(error),
        }
    }

    fn signal_group(pgid: u32, signal: i32) -> io::Result<()> {
        let pgid = i32::try_from(pgid)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pgid exceeds i32"))?;
        signal_raw(-pgid, signal)
    }

    fn signal_process(pid: u32, signal: i32) -> io::Result<()> {
        let pid = i32::try_from(pid)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid exceeds i32"))?;
        signal_raw(pid, signal)
    }

    fn signal_raw(pid: i32, signal: i32) -> io::Result<()> {
        if unsafe { libc::kill(pid, signal) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(target_os = "macos")]
    /// Returns the kernel process start timestamp used to reject PID reuse.
    #[must_use]
    pub fn process_start_time(pid: u32) -> Option<u64> {
        let pid = i32::try_from(pid).ok()?;
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
        let size = std::mem::size_of::<libc::proc_bsdinfo>();
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                i32::try_from(size).ok()?,
            )
        };
        if usize::try_from(read).ok()? != size {
            return None;
        }
        let info = unsafe { info.assume_init() };
        info.pbi_start_tvsec
            .checked_mul(1_000_000)
            .and_then(|seconds| seconds.checked_add(info.pbi_start_tvusec))
    }

    #[cfg(target_os = "macos")]
    fn snapshot_group(pgid: u32) -> Result<HashMap<u32, u64>, String> {
        let pgid = i32::try_from(pgid).map_err(|_| "pgid exceeds i32".to_string())?;
        let count = unsafe { libc::proc_listpgrppids(pgid, std::ptr::null_mut(), 0) };
        if count < 0 {
            return Err(io::Error::last_os_error().to_string());
        }
        let capacity = usize::try_from(count).unwrap_or(0).saturating_add(32).max(32);
        let mut pids = vec![0_i32; capacity];
        let bytes = pids
            .len()
            .checked_mul(std::mem::size_of::<i32>())
            .and_then(|value| i32::try_from(value).ok())
            .ok_or_else(|| "group snapshot buffer too large".to_string())?;
        let count = unsafe { libc::proc_listpgrppids(pgid, pids.as_mut_ptr().cast(), bytes) };
        if count < 0 {
            return Err(io::Error::last_os_error().to_string());
        }
        pids.truncate(usize::try_from(count).unwrap_or(0).min(pids.len()));
        let mut members = HashMap::new();
        for pid in pids.into_iter().filter_map(|pid| u32::try_from(pid).ok()) {
            let start_time = process_start_time(pid)
                .ok_or_else(|| format!("cannot read group member start time for pid {pid}"))?;
            members.insert(pid, start_time);
        }
        Ok(members)
    }

    #[cfg(target_os = "linux")]
    /// Returns `/proc/<pid>/stat` field 22, used to reject PID reuse.
    #[must_use]
    pub fn process_start_time(pid: u32) -> Option<u64> {
        linux_stat(pid).map(|(_, start_time)| start_time)
    }

    #[cfg(target_os = "linux")]
    fn linux_stat(pid: u32) -> Option<(u32, u64)> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let fields = stat.get(stat.rfind(')')? + 1..)?.split_whitespace().collect::<Vec<_>>();
        let pgid = fields.get(2)?.parse().ok()?;
        let start_time = fields.get(19)?.parse().ok()?;
        Some((pgid, start_time))
    }

    #[cfg(target_os = "linux")]
    fn snapshot_group(pgid: u32) -> Result<HashMap<u32, u64>, String> {
        let entries = std::fs::read_dir("/proc").map_err(|error| error.to_string())?;
        let mut members = HashMap::new();
        for entry in entries.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            if let Some((actual_pgid, start_time)) = linux_stat(pid) {
                if actual_pgid == pgid {
                    members.insert(pid, start_time);
                }
            }
        }
        Ok(members)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    #[must_use]
    pub fn process_start_time(_pid: u32) -> Option<u64> {
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn snapshot_group(_pgid: u32) -> Result<HashMap<u32, u64>, String> {
        Err("process-group snapshots are unsupported on this Unix platform".to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn owner() -> ProcessIdentity {
            current_owner().expect("current process identity")
        }

        #[test]
        fn ledger_round_trip_add_remove_and_corrupt_fallback() {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("session-ledger.json");
            let identity = owner();
            let second_owner = ProcessIdentity {
                pid: identity.pid,
                start_time: identity.start_time.wrapping_add(1),
            };

            add_entry_at(&path, "pane-a", 101, 101, 1001, identity.clone()).unwrap();
            add_entry_at(&path, "pane-b", 202, 202, 2002, second_owner.clone()).unwrap();
            let ledger = read_ledger(&path);
            assert_eq!(ledger.entries.len(), 2);
            assert_eq!(ledger.entries[0].pane_id, "pane-a");
            assert_eq!(ledger.entries[0].owner, identity);
            assert_eq!(ledger.entries[1].owner, second_owner);

            remove_entry_at(&path, "pane-a", &identity).unwrap();
            let ledger = read_ledger(&path);
            assert_eq!(ledger.entries.len(), 1);
            assert_eq!(ledger.entries[0].pane_id, "pane-b");

            std::fs::write(&path, b"{not-json").unwrap();
            assert!(read_ledger(&path).entries.is_empty());
        }

        #[test]
        fn owner_scoped_rmw_preserves_same_pane_for_sibling_owner() {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("session-ledger.json");
            let identity = owner();
            let sibling = ProcessIdentity {
                pid: identity.pid,
                start_time: identity.start_time.wrapping_add(1),
            };

            add_entry_at(&path, "shared-pane", 101, 101, 1001, identity.clone()).unwrap();
            add_entry_at(&path, "shared-pane", 202, 202, 2002, sibling.clone()).unwrap();
            let ledger = read_ledger(&path);
            assert_eq!(ledger.entries.len(), 2);

            remove_entry_at(&path, "shared-pane", &identity).unwrap();
            let ledger = read_ledger(&path);
            assert_eq!(ledger.entries.len(), 1);
            assert_eq!(ledger.entries[0].owner, sibling);
            assert_eq!(ledger.entries[0].pid, 202);
        }

        #[test]
        fn boot_sweep_keeps_entry_owned_by_live_foreign_process() {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("session-ledger.json");
            add_entry_at(&path, "foreign", 999_999, 999_999, 1, owner()).unwrap();

            let summary = sweep_at(&path).unwrap();

            assert_eq!(summary.entries, 1);
            assert_eq!(summary.kept_foreign, 1);
            assert_eq!(read_ledger(&path).entries.len(), 1);
        }

        #[test]
        fn boot_sweep_skips_start_time_mismatch() {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("session-ledger.json");
            let pid = std::process::id();
            let start_time = process_start_time(pid).expect("current process start time");
            let pgid = process_group_id(pid).expect("current process group");
            let dead_owner = ProcessIdentity { pid, start_time: start_time.wrapping_add(1) };
            add_entry_at(&path, "mismatch", pid, pgid, start_time.wrapping_add(1), dead_owner)
                .unwrap();

            let summary = sweep_at(&path).unwrap();

            assert_eq!(summary.entries, 1);
            assert_eq!(summary.skipped_unverified, 1);
            assert_eq!(read_ledger(&path).entries.len(), 1);
        }
    }
}

#[cfg(unix)]
pub use platform::{
    add_entry, boot_sweep, process_group_id, process_start_time, remove_entry,
    termination_confirmed,
};

#[cfg(windows)]
mod platform {
    #[must_use]
    pub fn process_start_time(_pid: u32) -> Option<u64> {
        Some(0)
    }

    #[must_use]
    pub fn process_group_id(pid: u32) -> Option<u32> {
        Some(pid)
    }

    /// Windows no-op stub. Always succeeds.
    ///
    /// # Errors
    /// Never returns an error on Windows.
    pub fn add_entry(
        _pane_id: &str,
        _pid: u32,
        _pgid: u32,
        _proc_start_time: u64,
    ) -> Result<(), String> {
        Ok(())
    }

    /// Windows no-op stub. Always succeeds.
    ///
    /// # Errors
    /// Never returns an error on Windows.
    pub fn remove_entry(_pane_id: &str) -> Result<(), String> {
        Ok(())
    }

    #[must_use]
    pub fn termination_confirmed(_pane_id: &str) -> bool {
        true
    }

    pub fn boot_sweep() {}
}

#[cfg(windows)]
pub use platform::{
    add_entry, boot_sweep, process_group_id, process_start_time, remove_entry,
    termination_confirmed,
};

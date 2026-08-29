use dashmap::DashMap;
use serde::Serialize;
use std::{
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const DEFAULT_SESSION_TTL_DAYS: u64 = 7;
const SECS_PER_DAY: u64 = 86_400;
const CLEANUP_INTERVAL_SECS: u64 = 3600;
const LAST_USED_WRITE_THROTTLE: Duration = Duration::from_mins(1);

#[derive(Clone, Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: u64,
    pub last_used: u64,
    pub source_ip: Option<IpAddr>,
    pub user_agent: Option<String>,
}

struct Entry {
    id: String,
    created_at: Instant,
    last_used: Instant,
    source_ip: Option<IpAddr>,
    user_agent: Option<String>,
}

impl Entry {
    fn to_info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            created_at: instant_to_unix(self.created_at),
            last_used: instant_to_unix(self.last_used),
            source_ip: self.source_ip,
            user_agent: self.user_agent.clone(),
        }
    }
}

fn instant_to_unix(t: Instant) -> u64 {
    static BASE: OnceLock<(Instant, u64)> = OnceLock::new();
    let base = BASE.get_or_init(|| {
        let now_instant = Instant::now();
        let now_unix = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        (now_instant, now_unix)
    });
    let elapsed = t.duration_since(base.0).as_secs();
    base.1.saturating_add(elapsed)
}

fn ttl_from_days(days: u64) -> u64 {
    if days == 0 { DEFAULT_SESSION_TTL_DAYS } else { days }.saturating_mul(SECS_PER_DAY)
}

#[derive(Clone)]
pub struct SessionStore {
    sessions: Arc<DashMap<String, Entry>>,
    ttl_secs: Arc<AtomicU64>,
    last_used_throttle: Duration,
}

impl SessionStore {
    #[must_use]
    pub fn new(initial_ttl_days: u64) -> Self {
        Self::with_throttle(ttl_from_days(initial_ttl_days), LAST_USED_WRITE_THROTTLE)
    }

    fn with_throttle(ttl_secs: u64, last_used_throttle: Duration) -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            ttl_secs: Arc::new(AtomicU64::new(ttl_secs)),
            last_used_throttle,
        }
    }

    /// Update the TTL from settings. Called when settings change.
    pub fn update_ttl_days(&self, days: u64) {
        self.ttl_secs.store(ttl_from_days(days), Ordering::Relaxed);
    }

    fn current_ttl(&self) -> Duration {
        let secs = self.ttl_secs.load(Ordering::Relaxed);
        if secs == 0 {
            Duration::from_secs(DEFAULT_SESSION_TTL_DAYS * SECS_PER_DAY)
        } else {
            Duration::from_secs(secs)
        }
    }

    #[must_use]
    pub fn create(&self, source_ip: Option<IpAddr>, user_agent: Option<String>) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Instant::now();
        self.sessions.insert(
            id.clone(),
            Entry { id: id.clone(), created_at: now, last_used: now, source_ip, user_agent },
        );
        id
    }

    #[must_use]
    pub fn validate(&self, session_id: &str) -> bool {
        let ttl = self.current_ttl();
        let Some(entry) = self.sessions.get(session_id) else {
            return false;
        };
        let elapsed = entry.last_used.elapsed();
        drop(entry);
        if elapsed > ttl {
            self.sessions.remove(session_id);
            return false;
        }
        // Fast path: skip the shard write lock while last_used is fresh; the
        // refresh lag is bounded by the throttle window, so TTL holds.
        if elapsed < self.last_used_throttle {
            return true;
        }
        let Some(mut entry) = self.sessions.get_mut(session_id) else {
            return false;
        };
        if entry.last_used.elapsed() > ttl {
            drop(entry);
            self.sessions.remove(session_id);
            return false;
        }
        entry.last_used = Instant::now();
        true
    }

    #[must_use]
    pub fn revoke(&self, session_id: &str) -> bool {
        self.sessions.remove(session_id).is_some()
    }

    pub fn revoke_all(&self) {
        self.sessions.clear();
    }

    pub fn revoke_all_except(&self, keep: &str) {
        self.sessions.retain(|k, _| k == keep);
    }

    #[must_use]
    pub fn list(&self) -> Vec<SessionInfo> {
        let ttl = self.current_ttl();
        let now = Instant::now();
        self.sessions
            .iter()
            .filter(|e| now.duration_since(e.value().last_used) <= ttl)
            .map(|e| e.to_info())
            .collect()
    }

    pub fn start_cleanup_task(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(CLEANUP_INTERVAL_SECS)).await;
                let ttl = self.current_ttl();
                let now = Instant::now();
                self.sessions.retain(|_, e| now.duration_since(e.last_used) <= ttl);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry_last_used(store: &SessionStore, id: &str) -> Instant {
        store.sessions.get(id).map(|e| e.last_used).expect("session exists")
    }

    fn backdate_last_used(store: &SessionStore, id: &str, age: Duration) {
        let mut entry = store.sessions.get_mut(id).expect("session exists");
        entry.last_used = Instant::now().checked_sub(age).expect("host uptime exceeds age");
    }

    #[test]
    fn create_and_validate_session() {
        let store = SessionStore::new(7);
        let id = store.create(None, None);
        assert!(!id.is_empty());
        assert!(store.validate(&id));
    }

    #[test]
    fn validate_unknown_session_returns_false() {
        let store = SessionStore::new(7);
        assert!(!store.validate("nonexistent"));
    }

    #[test]
    fn revoke_removes_session() {
        let store = SessionStore::new(7);
        let id = store.create(None, None);
        assert!(store.revoke(&id));
        assert!(!store.validate(&id));
        assert!(!store.revoke(&id));
    }

    #[test]
    fn revoke_all_clears_everything() {
        let store = SessionStore::new(7);
        let _a = store.create(None, None);
        let _b = store.create(None, None);
        assert_eq!(store.list().len(), 2);
        store.revoke_all();
        assert_eq!(store.list().len(), 0);
    }

    #[test]
    fn revoke_all_except_keeps_one() {
        let store = SessionStore::new(7);
        let keep = store.create(None, None);
        let _drop = store.create(None, None);
        store.revoke_all_except(&keep);
        assert!(store.validate(&keep));
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn list_returns_info() {
        let store = SessionStore::new(7);
        let id = store.create(Some("127.0.0.1".parse().unwrap()), Some("test-ua".into()));
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].source_ip, Some("127.0.0.1".parse().unwrap()));
        assert_eq!(list[0].user_agent.as_deref(), Some("test-ua"));
    }

    #[test]
    fn update_ttl_days() {
        let store = SessionStore::new(7);
        store.update_ttl_days(1);
        assert_eq!(store.current_ttl(), Duration::from_secs(SECS_PER_DAY));
        store.update_ttl_days(0);
        assert_eq!(
            store.current_ttl(),
            Duration::from_secs(DEFAULT_SESSION_TTL_DAYS * SECS_PER_DAY)
        );
    }

    #[test]
    fn validate_within_throttle_window_skips_last_used_write() {
        let store = SessionStore::new(7);
        let id = store.create(None, None);
        let before = entry_last_used(&store, &id);
        assert!(store.validate(&id));
        assert_eq!(entry_last_used(&store, &id), before);
    }

    #[test]
    fn validate_beyond_throttle_window_updates_last_used() {
        let store = SessionStore::with_throttle(
            DEFAULT_SESSION_TTL_DAYS * SECS_PER_DAY,
            Duration::from_millis(100),
        );
        let id = store.create(None, None);
        backdate_last_used(&store, &id, Duration::from_millis(500));
        let stale = entry_last_used(&store, &id);
        assert!(store.validate(&id));
        assert!(entry_last_used(&store, &id) > stale);
    }

    #[test]
    fn validate_removes_expired_session_even_within_throttle_window() {
        let store = SessionStore::with_throttle(1, Duration::from_mins(1));
        let id = store.create(None, None);
        backdate_last_used(&store, &id, Duration::from_secs(2));
        assert!(!store.validate(&id));
        assert!(store.sessions.get(&id).is_none());
        assert!(!store.validate(&id));
    }
}

use dashmap::DashMap;
use std::{
    net::IpAddr,
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

#[allow(dead_code)]
const DEFAULT_TTL_SECS: u64 = 300;
#[allow(dead_code)]
const DEFAULT_RATE_LIMIT_PER_MINUTE: u32 = 5;
pub const MAX_ATTEMPTS: u32 = 5;
const RATE_WINDOW_SECS: u64 = 60;
const CLEANUP_INTERVAL_SECS: u64 = 60;

#[derive(Clone, Debug)]
pub struct CodeEntry {
    pub code: String,
    pub created_at: Instant,
    pub attempts: u32,
    pub consumed: bool,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum VerifyOutcome {
    Ok,
    NotFound,
    Expired,
    Consumed,
    TooManyAttempts,
    Mismatch,
}

#[derive(Debug)]
pub struct RateLimitError;

struct RateWindow {
    window_start: Instant,
    count: u32,
}

#[derive(Clone)]
pub struct CodeStore {
    codes: Arc<DashMap<String, CodeEntry>>,
    rate_map: Arc<DashMap<IpAddr, RateWindow>>,
    ttl_seconds: Arc<AtomicU64>,
    rate_limit_per_minute: Arc<AtomicU32>,
}

impl CodeStore {
    #[must_use]
    pub fn new(ttl_seconds: u64, rate_limit_per_minute: u32) -> Self {
        Self {
            codes: Arc::new(DashMap::new()),
            rate_map: Arc::new(DashMap::new()),
            ttl_seconds: Arc::new(AtomicU64::new(ttl_seconds.max(1))),
            rate_limit_per_minute: Arc::new(AtomicU32::new(rate_limit_per_minute.max(1))),
        }
    }

    pub fn update_ttl(&self, ttl: u64) {
        self.ttl_seconds.store(ttl.max(1), Ordering::Relaxed);
    }

    pub fn update_rate_limit(&self, limit: u32) {
        self.rate_limit_per_minute.store(limit.max(1), Ordering::Relaxed);
    }

    fn current_ttl(&self) -> Duration {
        Duration::from_secs(self.ttl_seconds.load(Ordering::Relaxed))
    }

    fn current_rate_limit(&self) -> u32 {
        self.rate_limit_per_minute.load(Ordering::Relaxed)
    }

    /// Try to create a new verification code.
    ///
    /// Returns `(request_id, code)` on success. The `request_id` is later
    /// presented by the client to verify; `code` is the 6-digit secret
    /// delivered to the user via a notifier plugin.
    ///
    /// # Errors
    ///
    /// Returns `Err(RateLimitError)` if the client IP has exceeded the
    /// per-minute creation limit (configurable via
    /// [`update_rate_limit`](Self::update_rate_limit)).
    pub fn create(&self, client_ip: IpAddr) -> Result<(String, String), RateLimitError> {
        let now = Instant::now();
        let limit = self.current_rate_limit();

        let mut rate_entry =
            self.rate_map.entry(client_ip).or_insert(RateWindow { window_start: now, count: 0 });
        let window = rate_entry.value_mut();
        if now.duration_since(window.window_start) < Duration::from_secs(RATE_WINDOW_SECS) {
            if window.count >= limit {
                return Err(RateLimitError);
            }
            window.count += 1;
        } else {
            window.window_start = now;
            window.count = 1;
        }
        drop(rate_entry);

        let code = generate_code();
        let request_id = Uuid::new_v4().to_string();
        self.codes.insert(
            request_id.clone(),
            CodeEntry { code: code.clone(), created_at: now, attempts: 0, consumed: false },
        );
        Ok((request_id, code))
    }

    /// Verify a code against a `request_id`. Consumes the code on success.
    #[must_use]
    pub fn verify(&self, request_id: &str, code: &str) -> VerifyOutcome {
        let ttl = self.current_ttl();
        let now = Instant::now();

        let Some(mut entry) = self.codes.get_mut(request_id) else {
            return VerifyOutcome::NotFound;
        };

        if now.duration_since(entry.created_at) > ttl {
            drop(entry);
            self.codes.remove(request_id);
            return VerifyOutcome::Expired;
        }

        if entry.consumed {
            return VerifyOutcome::Consumed;
        }

        if entry.attempts >= MAX_ATTEMPTS {
            drop(entry);
            self.codes.remove(request_id);
            return VerifyOutcome::TooManyAttempts;
        }

        if crate::auth::constant_time_eq(&entry.code, code) {
            entry.consumed = true;
            VerifyOutcome::Ok
        } else {
            entry.attempts += 1;
            if entry.attempts >= MAX_ATTEMPTS {
                drop(entry);
                self.codes.remove(request_id);
                VerifyOutcome::TooManyAttempts
            } else {
                VerifyOutcome::Mismatch
            }
        }
    }

    /// Start a background task that purges expired codes and stale rate-map entries.
    pub fn start_cleanup_task(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));
            loop {
                interval.tick().await;
                let ttl = self.current_ttl();
                let now = Instant::now();
                self.codes.retain(|_, entry| {
                    !entry.consumed && now.duration_since(entry.created_at) <= ttl
                });
                self.rate_map.retain(|_, window| {
                    now.duration_since(window.window_start) < Duration::from_secs(RATE_WINDOW_SECS)
                });
            }
        });
    }
}

fn generate_code() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    let n: u32 = rng.random_range(0..1_000_000);
    format!("{n:06}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn store() -> CodeStore {
        CodeStore::new(300, 5)
    }

    #[test]
    fn generate_code_is_six_digits() {
        for _ in 0..1000 {
            let code = generate_code();
            assert_eq!(code.len(), 6, "code must be 6 digits: {code}");
            assert!(code.chars().all(|c| c.is_ascii_digit()), "code must be digits: {code}");
        }
    }

    #[test]
    fn create_returns_request_id_and_code() {
        let s = store();
        let (req_id, code) = s.create(IpAddr::V4(Ipv4Addr::LOCALHOST)).expect("ok");
        assert_ne!(req_id, "");
        assert_eq!(code.len(), 6);
    }

    #[test]
    fn verify_ok_consumes_code() {
        let s = store();
        let (req_id, code) = s.create(IpAddr::V4(Ipv4Addr::LOCALHOST)).expect("ok");
        assert_eq!(s.verify(&req_id, &code), VerifyOutcome::Ok);
        // Second attempt on same request_id should be Consumed
        assert_eq!(s.verify(&req_id, &code), VerifyOutcome::Consumed);
    }

    #[test]
    fn verify_unknown_request_id() {
        let s = store();
        assert_eq!(s.verify("nonexistent", "123456"), VerifyOutcome::NotFound);
    }

    #[test]
    fn verify_mismatch_increments_attempts() {
        let s = store();
        let (req_id, _code) = s.create(IpAddr::V4(Ipv4Addr::LOCALHOST)).expect("ok");
        // 4 mismatches: each returns Mismatch
        for _ in 0..4 {
            assert_eq!(s.verify(&req_id, "000000"), VerifyOutcome::Mismatch);
        }
        // 5th mismatch: reaches MAX_ATTEMPTS -> TooManyAttempts
        assert_eq!(s.verify(&req_id, "000000"), VerifyOutcome::TooManyAttempts);
        // Subsequent: NotFound (entry removed)
        assert_eq!(s.verify(&req_id, "000000"), VerifyOutcome::NotFound);
    }

    #[test]
    fn verify_correct_after_mismatches_then_consumes() {
        let s = store();
        let (req_id, code) = s.create(IpAddr::V4(Ipv4Addr::LOCALHOST)).expect("ok");
        assert_eq!(s.verify(&req_id, "000000"), VerifyOutcome::Mismatch);
        assert_eq!(s.verify(&req_id, &code), VerifyOutcome::Ok);
        assert_eq!(s.verify(&req_id, &code), VerifyOutcome::Consumed);
    }

    #[test]
    fn rate_limit_blocks_after_max() {
        let s = store();
        let ip = IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4));
        for _ in 0..5 {
            assert!(s.create(ip).is_ok());
        }
        // 6th should be rate limited
        assert!(s.create(ip).is_err());
    }

    #[test]
    fn rate_limit_different_ips_independent() {
        let s = store();
        let ip1 = IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4));
        let ip2 = IpAddr::V4(Ipv4Addr::new(5, 6, 7, 8));
        for _ in 0..5 {
            assert!(s.create(ip1).is_ok());
        }
        // ip1 is rate-limited, but ip2 should still work
        assert!(s.create(ip2).is_ok());
        assert!(s.create(ip1).is_err());
    }

    #[test]
    fn update_ttl_changes_expiry() {
        let s = CodeStore::new(300, 5);
        s.update_ttl(0); // clamp to 1 second
        assert_eq!(s.current_ttl(), Duration::from_secs(1));
    }

    #[test]
    fn update_rate_limit_changes_threshold() {
        let s = store();
        s.update_rate_limit(2);
        let ip = IpAddr::V4(Ipv4Addr::new(9, 9, 9, 9));
        assert!(s.create(ip).is_ok());
        assert!(s.create(ip).is_ok());
        // 3rd blocked after limit lowered to 2
        assert!(s.create(ip).is_err());
    }
}

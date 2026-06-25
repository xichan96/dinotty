use dashmap::DashMap;
use std::sync::Arc;
use std::time::Instant;

const CODE_TTL_SECS: u64 = 300; // 5 minutes

struct CodeEntry {
    token: String,
    created: Instant,
}

#[derive(Clone)]
pub struct QrCodeState {
    codes: Arc<DashMap<String, CodeEntry>>,
}

impl Default for QrCodeState {
    fn default() -> Self {
        Self { codes: Arc::new(DashMap::new()) }
    }
}

impl QrCodeState {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Generate a one-time code mapped to the given token.
    #[must_use]
    pub fn generate(&self, token: &str) -> String {
        let code = uuid::Uuid::new_v4().to_string();
        self.codes
            .insert(code.clone(), CodeEntry { token: token.to_string(), created: Instant::now() });
        code
    }

    /// Consume a one-time code, returning the mapped token. The code is
    /// invalidated after a single use.
    #[must_use]
    pub fn consume(&self, code: &str) -> Option<String> {
        let entry = self.codes.remove(code)?;
        if entry.1.created.elapsed().as_secs() > CODE_TTL_SECS {
            return None;
        }
        Some(entry.1.token)
    }

    /// Periodic cleanup of expired codes.
    pub fn start_cleanup_task(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_mins(1)).await;
                self.codes.retain(|_, entry| entry.created.elapsed().as_secs() <= CODE_TTL_SECS);
            }
        });
    }
}

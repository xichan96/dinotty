//! Global event bus, `BusEvent` → `SyncMsg` bridging, HTTP emit handlers, and webhooks.

mod bridge;
mod bus;
mod handlers;
pub mod webhook;

pub use bridge::map_bus_event_to_sync_event;
pub use bus::{BusEvent, EventBus};
pub use handlers::{emit_event, EmitEventRequest};
pub use webhook::{WebhookConfig, WebhookDispatcher, WebhookState};

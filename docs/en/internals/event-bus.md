# Event Bus

Dinotty uses a global event bus built on `tokio::sync::broadcast` to distribute events across system modules.

## Table of Contents

- [Overview](#overview)
- [Event Types](#event-types)
- [Subscribing](#subscribing)
- [Serialization Format](#serialization-format)
- [Integration](#integration)

---

## Overview

The EventBus is Dinotty's core event distribution mechanism:

- **Publish/subscribe**: any module can publish and subscribe to events
- **Broadcast**: every subscriber receives all events and filters them itself
- **Async**: built on a tokio broadcast channel; publishers never block
- **Capacity**: 1024 buffered events; slow consumers lose older events

```rust
use crate::event_bus::{EventBus, BusEvent};

// Subscribe
let mut rx = event_bus.subscribe();

// Publish
event_bus.publish(BusEvent::SessionCreated {
    pane_id: "pane-1".into(),
    shell_type: "zsh".into(),
});

// Receive
while let Ok(event) = rx.recv().await {
    match event {
        BusEvent::CommandFinished { exit_code, .. } => { /* handle */ }
        _ => {}
    }
}
```

---

## Event Types

### CommandFinished

Fired when a command finishes (detected via OSC 133 or prompt detection).

```json
{
  "event": "command_finished",
  "data": {
    "pane_id": "pane-abc123",
    "command": "",
    "exit_code": 0,
    "duration_ms": 150,
    "stdout": "file1.txt\n",
    "method": "shell_integration"
  }
}
```

**Trigger points:**
- The PTY read task detects an OSC 133 D sequence
- Prompt detection fallback (a prompt pattern matched after 100ms of silence)
- Agent API command timeout

### SessionCreated

Fired when a new terminal session is created.

```json
{
  "event": "session_created",
  "data": {
    "pane_id": "pane-abc123",
    "shell_type": "zsh"
  }
}
```

### SessionClosed

Fired when a terminal session closes (the PTY process exits).

```json
{
  "event": "session_closed",
  "data": {
    "pane_id": "pane-abc123",
    "exit_code": null
  }
}
```

### TabCreated / TabClosed

Fired when tabs are created / closed.

```json
{"event": "tab_created", "data": {"tab_id": "tab-1", "pane_id": "pane-abc"}}
{"event": "tab_closed", "data": {"tab_id": "tab-1"}}
```

### FileChanged

Fired when the file watcher detects a change. `path` uses the server platform's native path format; Windows paths are escaped when serialized to JSON, e.g. `C:\\Users\\dev\\project\\file.txt`.

```json
{
  "event": "file_changed",
  "data": {
    "path": "/Users/dev/project/src/main.rs",
    "change_type": "modified"
  }
}
```

### Custom

Custom plugin events.

```json
{
  "event": "custom",
  "data": {
    "plugin_id": "my-plugin",
    "event_name": "build_complete",
    "data": {"success": true, "duration": 5000}
  }
}
```

---

## Subscribing

### Rust code

```rust
let mut rx = manager.event_bus.subscribe();
tokio::spawn(async move {
    while let Ok(event) = rx.recv().await {
        // handle event
    }
});
```

### WebSocket event stream

After connecting to `WS /ws/events`, all events are delivered automatically:

```json
{
  "type": "event",
  "event": {"event": "command_finished", "data": {...}}
}
```

### Webhook

Once a webhook is configured, matching events are pushed via HTTP POST.

---

## Serialization Format

Events are serialized as a serde tagged union:

```rust
#[derive(Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum BusEvent { ... }
```

JSON format: `{"event": "<variant_name>", "data": {...}}`

---

## Integration

### Publishing from a module

```rust
manager.event_bus.publish(BusEvent::CommandFinished {
    pane_id: pane_id.clone(),
    command: String::new(),
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    stdout: output,
    method: result.method,
});
```

### Subscribing from a module

```rust
let mut rx = manager.event_bus.subscribe();
tokio::spawn(async move {
    while let Ok(event) = rx.recv().await {
        match event {
            BusEvent::SessionCreated { pane_id, .. } => {
                // initialize resources for the new session
            }
            BusEvent::CommandFinished { exit_code, .. } => {
                // record command results
            }
            _ => {}
        }
    }
});
```

### Caveats

- **No delivery guarantee**: if a consumer is too slow, older events are dropped
- **No ordering guarantee**: broadcast channels do not guarantee cross-subscriber ordering
- **Handle idempotently**: consumers should tolerate duplicated or missing events

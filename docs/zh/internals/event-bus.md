# Event Bus 技术文档

Dinotty 使用基于 `tokio::sync::broadcast` 的全局事件总线，在系统各模块间分发事件。

## 目录

- [概述](#概述)
- [事件类型](#事件类型)
- [订阅方式](#订阅方式)
- [序列化格式](#序列化格式)
- [集成方式](#集成方式)

---

## 概述

EventBus 是 Dinotty 的核心事件分发机制：

- **发布/订阅模式**：所有模块都可以发布和订阅事件
- **广播**：每个订阅者收到所有事件，自行过滤
- **异步**：基于 tokio broadcast channel，不阻塞发布者
- **容量**：1024 条事件缓冲，慢消费者会丢失旧事件

```rust
use crate::event_bus::{EventBus, BusEvent};

// 订阅
let mut rx = event_bus.subscribe();

// 发布
event_bus.publish(BusEvent::SessionCreated {
    pane_id: "pane-1".into(),
    shell_type: "zsh".into(),
});

// 接收
while let Ok(event) = rx.recv().await {
    match event {
        BusEvent::CommandFinished { exit_code, .. } => { /* 处理 */ }
        _ => {}
    }
}
```

---

## 事件类型

### CommandFinished

命令执行完成时触发（通过 OSC 133 或 prompt 检测）。

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

**触发时机：**
- PTY 读取任务检测到 OSC 133 D 序列
- Prompt 检测 fallback（100ms 无输出后匹配到 prompt 模式）
- Agent API 命令超时

### SessionCreated

新终端会话创建时触发。

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

终端会话关闭时触发（PTY 进程退出）。

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

标签页创建/关闭时触发。

```json
{"event": "tab_created", "data": {"tab_id": "tab-1", "pane_id": "pane-abc"}}
{"event": "tab_closed", "data": {"tab_id": "tab-1"}}
```

### FileChanged

文件监视器检测到文件变更时触发。`path` 使用服务端平台的原生路径格式；Windows 事件序列化为 JSON 时会转义为 `C:\\Users\\dev\\project\\file.txt`。

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

插件自定义事件。

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

## 订阅方式

### Rust 代码

```rust
let mut rx = manager.event_bus.subscribe();
tokio::spawn(async move {
    while let Ok(event) = rx.recv().await {
        // 处理事件
    }
});
```

### WebSocket Agent API

连接 `WS /ws/agent` 后自动接收所有事件：

```json
{
  "type": "event",
  "event": {"event": "command_finished", "data": {...}}
}
```

### Webhook

配置 webhook 后，匹配的事件会通过 HTTP POST 推送。

---

## 序列化格式

事件使用 serde 标签联合序列化：

```rust
#[derive(Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum BusEvent { ... }
```

JSON 格式：`{"event": "<variant_name>", "data": {...}}`

---

## 集成方式

### 在模块中发布事件

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

### 在模块中订阅事件

```rust
let mut rx = manager.event_bus.subscribe();
tokio::spawn(async move {
    while let Ok(event) = rx.recv().await {
        match event {
            BusEvent::SessionCreated { pane_id, .. } => {
                // 初始化新会话的资源
            }
            BusEvent::CommandFinished { exit_code, .. } => {
                // 记录命令执行结果
            }
            _ => {}
        }
    }
});
```

### 注意事项

- **不保证送达**：如果消费者处理太慢，旧事件会被丢弃
- **不保证顺序**：broadcast channel 不保证跨订阅者的顺序
- **幂等处理**：消费者应能处理重复或丢失的事件

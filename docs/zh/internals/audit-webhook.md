# 审计日志与 Webhook 技术文档

Dinotty 提供审计日志和 Webhook 机制，用于追踪 API 使用和外部通知。

## 目录

- [审计日志](#审计日志)
  - [概述](#概述)
  - [日志格式](#日志格式)
  - [记录的操作](#记录的操作)
  - [日志位置](#日志位置)
- [Webhook](#webhook)
  - [概述](#概述-1)
  - [配置](#配置)
  - [请求格式](#请求格式)
  - [签名验证](#签名验证)
  - [事件过滤](#事件过滤)

---

## 审计日志

### 概述

审计日志记录所有 Agent API 调用，用于安全审计和问题排查。

### 日志格式

JSONL 格式（每行一个 JSON 对象）：

```json
{
  "ts": "2026-06-25T10:30:00Z",
  "token_id": "agent",
  "action": "terminal:execute",
  "resource": "pane-abc123",
  "details": {
    "command": "ls -la",
    "exit_code": 0,
    "duration": 150
  },
  "audit_id": "uuid-xxx"
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | string | ISO 8601 时间戳 |
| `token_id` | string | 调用者标识（"agent" 或 token ID） |
| `action` | string | 操作类型 |
| `resource` | string | 操作目标（pane_id 等） |
| `details` | object | 操作详情（命令、结果等） |
| `audit_id` | string | 唯一审计 ID |

### 记录的操作

| 操作 | 说明 |
|------|------|
| `agent:terminal:execute` | Agent API 执行命令 |
| `agent:terminal:send` | Agent API 发送输入 |

### 日志位置

审计日志位于平台配置目录下：

| 平台 | 日志路径 |
|------|----------|
| Linux | `~/.config/dinotty/audit.log` |
| macOS | `~/Library/Application Support/dinotty/audit.log` |
| Windows | `%APPDATA%\dinotty\audit.log` |

### 使用示例

```bash
# 查看最近的命令执行记录
tail -20 ~/.config/dinotty/audit.log | jq .

# 统计每个 token 的调用次数
cat ~/.config/dinotty/audit.log | jq -r '.token_id' | sort | uniq -c

# 查找失败的命令
cat ~/.config/dinotty/audit.log | jq 'select(.details.exit_code != 0)'
```

Windows PowerShell 示例：

```powershell
$log = Join-Path $env:APPDATA "dinotty\audit.log"
Get-Content $log -Tail 20 | ConvertFrom-Json
Get-Content $log | ConvertFrom-Json | Group-Object token_id
Get-Content $log | ConvertFrom-Json | Where-Object { $_.details.exit_code -ne 0 }
```

---

## Webhook

### 概述

Webhook 允许 Dinotty 在事件发生时向外部服务发送 HTTP POST 通知。

### 配置

Webhook 配置在平台配置目录的 `settings.json` 中。Linux 为 `~/.config/dinotty/settings.json`，macOS 为 `~/Library/Application Support/dinotty/settings.json`，Windows 为 `%APPDATA%\dinotty\settings.json`：

```json
{
  "webhooks": [
    {
      "url": "https://hooks.slack.com/services/xxx",
      "events": ["command_finished", "session_created"],
      "secret_ref": "slack-signing-secret",
      "enabled": true
    }
  ]
}
```

### 配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 目标 URL |
| `events` | string[] | 是 | 监听的事件列表（`"*"` 匹配所有） |
| `secret_ref` | string | 否 | 签名密钥引用（见下方） |
| `enabled` | bool | 否 | 是否启用（默认 true） |

### 密钥管理

密钥存储在平台配置目录的 `secrets.json`。Linux 为 `~/.config/dinotty/secrets.json`，macOS 为 `~/Library/Application Support/dinotty/secrets.json`，Windows 为 `%APPDATA%\dinotty\secrets.json`。Unix 上建议权限为 0600：

```json
{
  "slack-signing-secret": "your-secret-here",
  "github-webhook-secret": "another-secret"
}
```

通过 `secret_ref` 字段引用密钥名称。

### 请求格式

```http
POST /your-webhook-url HTTP/1.1
Content-Type: application/json
User-Agent: dinotty-webhook/1.0
X-Dinotty-Signature: sha256=<hex-signature>

{
  "event": "command_finished",
  "timestamp": "2026-06-25T10:30:00Z",
  "data": {
    "pane_id": "pane-abc123",
    "command": "",
    "exit_code": 0,
    "duration_ms": 150,
    "stdout": "",
    "method": "shell_integration"
  }
}
```

### 签名验证

如果配置了 `secret_ref`，请求会包含 `X-Dinotty-Signature` 头：

```
X-Dinotty-Signature: sha256=<64位十六进制HMAC-SHA256>
```

验证方式：

```python
import hmac
import hashlib

def verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

### 事件过滤

`events` 数组支持：

- 具体事件名：`"command_finished"`, `"session_created"` 等
- 通配符：`"*"` 匹配所有事件

### 可用事件

| 事件名 | 说明 |
|--------|------|
| `command_finished` | 命令执行完成 |
| `session_created` | 终端会话创建 |
| `session_closed` | 终端会话关闭 |
| `tab_created` | 标签页创建 |
| `tab_closed` | 标签页关闭 |
| `file_changed` | 文件变更 |
| `custom` | 自定义事件 |

### 错误处理

- Webhook 采用 fire-and-forget 模式
- HTTP 错误会记录到服务器日志，不影响主流程
- 没有重试机制（可自行在接收端实现幂等处理）

### 使用场景

- **Slack/飞书通知**：命令执行完成时通知团队
- **CI/CD 集成**：终端输出触发构建流程
- **监控告警**：异常退出码触发告警
- **日志收集**：将事件转发到 ELK/Datadog

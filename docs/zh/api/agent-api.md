# Agent API 技术文档

Dinotty Agent API 允许外部程序（AI Agent、自动化脚本、CI/CD 流水线）通过 HTTP/WebSocket 与终端会话进行结构化交互。

## 目录

- [概述](#概述)
- [认证](#认证)
- [HTTP 接口](#http-接口)
  - [POST /api/agent/run](#post-apiagentrun)
  - [POST /api/agent/send](#post-apiagentsend)
  - [GET /api/agent/read](#get-apiagentread)
- [WebSocket 接口](#websocket-接口)
- [错误格式](#错误格式)
- [并发控制](#并发控制)
- [Shell 集成](#shell-集成)
- [权限要求](#权限要求)

---

## 概述

Agent API 提供三种交互模式：

| 模式 | 端点 | 说明 |
|------|------|------|
| 同步执行 | `POST /api/agent/run` | 发送命令并等待完成，返回 exit_code + stdout |
| 异步发送 | `POST /api/agent/send` | 发送输入，不等待结果（fire-and-forget） |
| 屏幕读取 | `GET /api/agent/read` | 读取当前终端屏幕内容 |
| 长连接 | `WS /ws/agent` | WebSocket，支持命令执行 + 事件订阅 |

所有接口需要 `open_api.enabled = true`（在设置中开启）。

---

## 认证

Agent API 支持两种认证方式：

### 全局 Token

服务器启动时配置的全局 token，拥有所有权限。

```bash
curl -H "Authorization: Bearer <global-token>" \
     http://localhost:8999/api/agent/run \
     -d '{"command": "ls -la"}'
```

### Agent Token

通过 `/api/tokens` 创建的细粒度 token，支持权限控制：

```bash
# 创建一个只读 token
curl -X POST -H "Authorization: Bearer <global-token>" \
     http://localhost:8999/api/tokens \
     -d '{
       "name": "monitoring-agent",
       "capabilities": ["terminal:read"],
       "expires_in": 86400
     }'
# 返回: {"token": "dnt_...", "token_info": {...}}
```

Token 格式：`dnt_<64位十六进制>`，使用 SHA-256 哈希存储。

---

## HTTP 接口

### POST /api/agent/run

同步执行命令，等待命令完成或超时。

**请求体：**

```json
{
  "command": "ls -la",
  "cwd": "/tmp",           // 可选，工作目录；Windows 示例："C:\\Users\\dev\\project"
  "env": {"KEY": "val"},   // 可选，环境变量（暂未实现）
  "timeout": 30000,        // 可选，超时毫秒数（默认 300000，最大 3600000）
  "pane_id": "auto",       // 可选，目标 pane（默认 "auto" 使用活跃 pane）
  "strip_ansi": true       // 可选，是否去除 ANSI 转义序列（默认 true）
}
```

**成功响应 (200)：**

```json
{
  "exit_code": 0,
  "stdout": "file1.txt\nfile2.txt\n",
  "stderr": "",
  "duration": 150,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**`method` 字段说明：**

| 值 | 说明 |
|----|------|
| `shell_integration` | 通过 OSC 133 协议检测到命令完成（最准确） |
| `prompt_detection` | 通过 prompt 模式匹配检测（后备方案） |
| `timeout` | 命令超时 |

### POST /api/agent/send

发送输入到终端，不等待结果。

**请求体：**

```json
{
  "command": "echo hello",
  "pane_id": "auto"
}
```

**响应 (200)：**

```json
{"ok": true, "pane_id": "pane-abc123"}
```

### GET /api/agent/read

读取终端屏幕内容。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pane_id` | string | "active" | 目标 pane |
| `scrollback` | int | 无 | 返回最近 N 行历史（最大 10000） |
| `strip_ansi` | bool | true | 去除 ANSI 转义 |

**响应 (200)：**

```json
{
  "pane_id": "pane-abc123",
  "lines": ["$ ls -la", "total 0", "drwxr-xr-x  ..."],
  "scrollback": ["previous command output..."],
  "cursor": {"row": 5, "col": 12},
  "cwd": "/Users/dev/project"
}
```

---

## WebSocket 接口

连接：`ws://localhost:8999/ws/agent`

### 客户端消息格式

**执行命令：**

```json
{
  "type": "run",
  "id": "req-1",           // 请求 ID，用于匹配响应
  "command": "npm test",
  "timeout": 60000
}
```

**订阅事件（已自动订阅所有事件）：**

```json
{"type": "subscribe"}
```

**心跳：**

```json
{"type": "ping"}
```

### 服务端消息格式

**命令结果：**

```json
{
  "type": "result",
  "id": "req-1",
  "exit_code": 0,
  "stdout": "All tests passed\n",
  "stderr": "",
  "duration": 3200,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**事件推送：**

```json
{
  "type": "event",
  "event": {
    "event": "command_finished",
    "data": {
      "pane_id": "pane-abc123",
      "command": "",
      "exit_code": 0,
      "duration_ms": 150,
      "stdout": "",
      "method": "shell_integration"
    }
  }
}
```

**错误：**

```json
{
  "type": "error",
  "id": "req-1",
  "error": {"code": "NOT_FOUND", "message": "No active session"}
}
```

**心跳响应：**

```json
{"type": "pong"}
```

---

## 错误格式

所有错误返回统一格式：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP 状态码 | 错误码 | 说明 |
|-------------|--------|------|
| 400 | `INVALID_REQUEST` | 请求参数无效 |
| 403 | `CAPABILITY_DENIED` | Agent API 未启用或 token 权限不足 |
| 404 | `NOT_FOUND` | 无活跃终端会话或 pane 不存在 |
| 429 | `RATE_LIMITED` | 并发请求数超限 |
| 500 | `INTERNAL_ERROR` | 内部错误 |

---

## 并发控制

- 每个 token 最多 **10** 个并发 `run` 请求
- 超限返回 `429 Too Many Requests`，包含 `Retry-After: 5` 头
- `send` 和 `read` 不受并发限制

---

## Shell 集成

Agent API 优先依赖 OSC 133 Shell Integration 协议检测命令边界，并在 shell 不完整支持时降级到 prompt 检测：

```
ESC ] 133 ; A ESC \    → Prompt 开始
ESC ] 133 ; B ESC \    → 命令开始（用户按下回车）
ESC ] 133 ; D ; N ESC \ → 命令完成，N 为 exit code
```

Dinotty 会根据本地 shell 自动注入或启用对应的集成：

- **zsh**: 通过 `precmd_functions` 和 `preexec_functions` 钩子注入 OSC 133
- **bash**: 通过 `PROMPT_COMMAND` 和 `BASH_ENV` trap 注入 OSC 133
- **PowerShell / pwsh (Windows)**: 启动时注入 `prompt` 函数，用于同步窗口标题、当前目录和 prompt 边界；命令完成检测可能继续使用 `prompt_detection` 后备方案
- **cmd.exe / sh / 其他 shell**: 不保证支持 OSC 133，会自动降级到 prompt 检测模式

Windows 下 `command` 字段会发送到当前 pane 的实际 shell；PowerShell 可使用 `Get-ChildItem`，cmd 可使用 `dir`。JSON 字符串中的 Windows 路径需要写成 `C:\\Users\\dev\\project`。

---

## 权限要求

| 操作 | 所需 Capability |
|------|----------------|
| `POST /api/agent/run` | `terminal:write` |
| `POST /api/agent/send` | `terminal:write` |
| `GET /api/agent/read` | `terminal:read` |
| `WS /ws/agent` | `terminal:read` + `terminal:write` |

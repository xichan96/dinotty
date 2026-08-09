# Open API（终端会话读写）

Open API 是一组 HTTP / WebSocket 接口，让外部程序直接读取终端屏幕、scrollback，向指定 Pane 写入输入，调整 Pane 尺寸，以及同步执行命令、订阅事件。它不创建或销毁 Tab / Pane，那是 [Tabs & Panes API](./tabs-panes-api.md) 的职责。

## 目录

- [概述](#概述)
- [启用开关](#启用开关)
- [认证](#认证)
- [HTTP 接口](#http-接口)
  - [GET /api/sessions](#get-apisessions)
  - [GET /api/sessions/:pane_id/screen](#get-apisessionspane_idscreen)
  - [GET /api/sessions/:pane_id/scrollback](#get-apisessionspane_idscrollback)
  - [POST /api/sessions/:pane_id/input](#post-apisessionspane_idinput)
  - [POST /api/sessions/:pane_id/resize](#post-apisessionspane_idresize)
  - [POST /api/sessions/:pane_id/run](#post-apisessionspane_idrun)
  - [POST /api/sessions/:pane_id/send](#post-apisessionspane_idsend)
  - [GET /api/sessions/:pane_id/read](#get-apisessionspane_idread)
  - [POST /api/input](#post-apiinput)
- [WebSocket 接口](#websocket-接口)
- [并发控制](#并发控制)
- [Shell 集成](#shell-集成)
- [权限要求](#权限要求)
- [错误格式](#错误格式)

---

## 概述

| 操作 | 端点 | 说明 |
|------|------|------|
| 列出会话 | `GET /api/sessions` | 所有 PTY 会话的元数据 + active_pane_id |
| 读屏幕 | `GET /api/sessions/:pane_id/screen` | 当前可见区域（plain / ansi） |
| 读 scrollback | `GET /api/sessions/:pane_id/scrollback` | 最近 N 行历史输出 |
| 写输入（raw bytes） | `POST /api/sessions/:pane_id/input` | 向指定 Pane 注入字节 |
| 调整尺寸 | `POST /api/sessions/:pane_id/resize` | 改 PTY cols/rows |
| 同步执行命令 | `POST /api/sessions/:pane_id/run` | 发送命令并等待完成，返回 exit_code + stdout |
| 异步发送命令 | `POST /api/sessions/:pane_id/send` | 发送命令 + `\n`，不等待结果 |
| 结构化读取 | `GET /api/sessions/:pane_id/read` | 屏幕内容 + cursor + cwd（一次调用） |
| 写入活跃 Pane | `POST /api/input` | 不指定 pane_id 时落到 active pane |
| 事件订阅 | `WS /ws/events` | WebSocket，命令执行 + 事件流 |

`input` vs `send`：`input` 写入 raw bytes（不追加换行，无审计），`send` 自动追加 `\n` 并写审计日志（仅 agent token 时）。简单脚本用 `input`，命令级自动化用 `send`。

`screen`/`scrollback` vs `read`：`screen`/`scrollback` 返回 plain/ansi 文本，`read` 返回结构化 JSON（含 cursor/cwd/scrollback）。操作员场景用前者，agent 场景用后者。

Open API 操作的是已经存在的 PTY 会话。要创建新会话，请用 [Tabs API](./tabs-panes-api.md)。

---

## 启用开关

Open API 默认关闭。在设置 `open_api.enabled = true` 后才会放行 `/api/sessions/*` 和 `/api/input`。

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/settings \
     -d '{"open_api":{"enabled":true}, /* ...其他设置原样回传 */ }'
```

未启用时所有 Open API 端点返回：

```json
{ "error": "open_api is disabled" }
```

HTTP 状态码 403。

---

## 认证

Open API 走双轨鉴权：

- **Session Cookie**：浏览器同源场景（操作员模式）
- **全局 Bearer Token**：`Authorization: Bearer <global-token>`，拥有所有权限
- **Agent Bearer Token**：通过 `/api/tokens` 创建的细粒度 token，按 capability 校验

`run` / `send` / `read` / `WS /ws/events` 同时接受三种凭据；`sessions` / `screen` / `scrollback` / `input` / `resize` 仅接受 session cookie 或全局 token（无 capability 校验）。

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

### 审计日志

当请求使用 agent token 时，`run` / `send` 会写审计日志（`~/.config/dinotty/audit.log`）；session cookie / 全局 token 路径不写审计（操作员模式 = 可信 UI 用户）。

---

## HTTP 接口

### GET /api/sessions

列出所有 PTY 会话。

**响应 (200)：**

```json
{
  "sessions": [
    {
      "pane_id": "pane-1",
      "tab_id": "tab-aaa",
      "shell_type": "zsh",
      "status": "connected",
      "size": { "cols": 120, "rows": 32 },
      "cwd": "/Users/dev/project"
    },
    {
      "pane_id": "pane-2",
      "tab_id": "tab-bbb",
      "shell_type": "ssh",
      "status": "detached",
      "size": { "cols": 80, "rows": 24 },
      "cwd": null
    }
  ],
  "active_pane_id": "pane-1"
}
```

`status` 取值：

- `connected` - PTY 活跃
- `detached` - PTY 已退出但布局未清理

`cwd` 是服务端通过 shell 集成（OSC 7 / 同步探测）得到的当前工作目录；SSH 会话或未支持集成的 shell 可能为 `null`。

---

### GET /api/sessions/:pane_id/screen

读取当前可见屏幕内容。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `format` | string | `plain` | `plain` 去 ANSI 转义；`ansi` 保留颜色和光标序列 |

**响应 (200)：**

```json
{
  "pane_id": "pane-1",
  "content": "$ ls -la\ntotal 0\ndrwxr-xr-x  2 dev  staff   64 Aug  8 10:00 .\n",
  "size": { "cols": 120, "rows": 32 }
}
```

`content` 是按行拼接的字符串（`\n` 分隔）。`ansi` 模式适合录制 / 回放终端画面；`plain` 适合日志抓取与正则匹配。

---

### GET /api/sessions/:pane_id/scrollback

读取 scrollback 历史输出。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `lines` | int | 200 (ansi 模式) / 全部 (plain) | 返回最近 N 行 |
| `format` | string | `plain` | `plain` / `ansi` |

**响应 (200)：**

```json
{
  "pane_id": "pane-1",
  "lines": [
    "$ npm install",
    "added 312 packages in 4s",
    "$ npm run build",
    "> build",
    "> esbuild src/main.ts --bundle"
  ],
  "total": 1247
}
```

`total` 是 scrollback 缓冲区的总行数，可用于判断是否还有更早的输出。`lines` 上限 10000。

---

### POST /api/sessions/:pane_id/input

向指定 Pane 注入输入字节（raw bytes，不追加换行）。

**请求体：**

```json
{ "data": "ls -la\r" }
```

`data` 是字符串，会以 UTF-8 字节流写入 PTY。回车用 `\r`，Ctrl+C 用 ``，Ctrl+D 用 ``。

**响应：**

- 200 `{"ok": true}`
- 404 - Pane 不存在
- 500 - PTY 写入失败（会话已退出）

> **注意**：此接口绕过 [Mission Control 安全网](./mission-control-api.md#inputmc-开启时的安全网)。即使 MC 已开启，输入仍会进入 PTY。如果需要"用户视角"语义（MC 开启时丢弃输入），请通过 `/ws/sync` 发送 `Input` 消息。

---

### POST /api/sessions/:pane_id/resize

调整 Pane 尺寸（PTY cols × rows）。

**请求体：**

```json
{ "cols": 120, "rows": 32 }
```

**响应：**

- 200 `{"ok": true}`
- 400 - `cols` 或 `rows` 为 0
- 404 - Pane 不存在
- 500 - PTY resize 失败

resize 会触发 TIOCSWINSZ，shell 内运行的程序会收到 `SIGWINCH`。

---

### POST /api/sessions/:pane_id/run

同步执行命令，等待命令完成或超时。依赖 [Shell 集成](#shell-集成)检测命令边界。

**请求体：**

```json
{
  "command": "ls -la",
  "cwd": "/tmp",           // 可选，工作目录；Windows 示例："C:\\Users\\dev\\project"
  "env": {"KEY": "val"},   // 可选，环境变量（暂未实现）
  "timeout": 30000,        // 可选，超时毫秒数（默认 300000，最大 3600000）
  "strip_ansi": true       // 可选，是否去除 ANSI 转义序列（默认 true）
}
```

`pane_id` 在路径中指定，不再放在请求体。

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

**Capability：** `terminal:write`（agent token 路径）

---

### POST /api/sessions/:pane_id/send

发送命令到终端（自动追加 `\n`），不等待结果。

**请求体：**

```json
{
  "command": "echo hello"
}
```

**响应 (200)：**

```json
{"ok": true, "pane_id": "pane-abc123"}
```

**Capability：** `terminal:write`（agent token 路径）

---

### GET /api/sessions/:pane_id/read

结构化读取终端屏幕，含 cursor / cwd / scrollback。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
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

**Capability：** `terminal:read`（agent token 路径）

---

### POST /api/input

向 active Pane 注入输入。等价于 `POST /api/sessions/:pane_id/input`，但无需调用方手动跟踪 active pane。

**请求体：**

```json
{
  "pane_id": "pane-1",
  "data": "echo hi\r"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `data` | 是 | 注入的字节序列 |
| `pane_id` | 否 | 目标 Pane；省略时落到 `active_pane_id`；若 active 为空则取 sessions 中第一个 |

**响应：**

- 200 `{"ok": true}`
- 400 - 没有任何可用会话
- 404 - 指定 `pane_id` 不存在

---

## WebSocket 接口

连接：`ws://localhost:8999/ws/events`

鉴权：Bearer header 或 `?token=<agent_token>` query param（浏览器 WS 客户端无法设 header 时用 query param）。Session cookie 路径不支持（WS 路由在 outer auth 豁免列表里）。

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

## 并发控制

- 每个 token 最多 **10** 个并发 `run` 请求
- 超限返回 `429 Too Many Requests`，包含 `Retry-After: 5` 头
- `send` 和 `read` 不受并发限制

---

## Shell 集成

`run` 端点优先依赖 OSC 133 Shell Integration 协议检测命令边界，并在 shell 不完整支持时降级到 prompt 检测：

```
ESC ] 133 ; A ESC \    -> Prompt 开始
ESC ] 133 ; B ESC \    -> 命令开始（用户按下回车）
ESC ] 133 ; D ; N ESC \ -> 命令完成，N 为 exit code
```

Dinotty 会根据本地 shell 自动注入或启用对应的集成：

- **zsh**: 通过 `precmd_functions` 和 `preexec_functions` 钩子注入 OSC 133
- **bash**: 通过 `PROMPT_COMMAND` 和 `BASH_ENV` trap 注入 OSC 133
- **PowerShell / pwsh (Windows)**: 启动时注入 `prompt` 函数，用于同步窗口标题、当前目录和 prompt 边界；命令完成检测可能继续使用 `prompt_detection` 后备方案
- **cmd.exe / sh / 其他 shell**: 不保证支持 OSC 133，会自动降级到 prompt 检测模式

Windows 下 `command` 字段会发送到当前 pane 的实际 shell；PowerShell 可使用 `Get-ChildItem`，cmd 可使用 `dir`。JSON 字符串中的 Windows 路径需要写成 `C:\\Users\\dev\\project`。

---

## 权限要求

仅 agent token 路径需要 capability 校验；session cookie / 全局 token 自动通过。

| 操作 | 所需 Capability |
|------|----------------|
| `POST /api/sessions/:pane_id/run` | `terminal:write` |
| `POST /api/sessions/:pane_id/send` | `terminal:write` |
| `GET /api/sessions/:pane_id/read` | `terminal:read` |
| `WS /ws/events` | 无（订阅只读） |

---

## 错误格式

```json
{ "error": "pane not found" }
```

| HTTP | 含义 |
|------|------|
| 400 | 参数无效（cols/rows=0、无 active pane） |
| 401 | 未认证 |
| 403 | `open_api.enabled = false` 或 token 缺少 capability |
| 404 | Pane 不存在 |
| 429 | 并发 `run` 超限 |
| 500 | PTY 写入 / resize 失败 |

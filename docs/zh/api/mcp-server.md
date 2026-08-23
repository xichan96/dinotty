# MCP Server 技术文档

Dinotty 内置 MCP (Model Context Protocol) JSON-RPC 2.0 服务器，允许 AI 助手（如 Claude、Cursor）直接操作终端会话。

## 目录

- [概述](#概述)
- [传输协议](#传输协议)
  - [HTTP](#http)
  - [stdio](#stdio)
- [MCP 开关](#mcp-开关)
- [认证](#认证)
- [工具列表](#工具列表)
- [资源列表](#资源列表)
- [JSON-RPC 方法](#json-rpc-方法)
- [配置示例](#配置示例)

---

## 概述

MCP Server 实现了 MCP 协议版本 `2024-11-05`，支持：

- **9 个工具**：终端操作、文件读写、Git 查询
- **3 个资源**：会话列表、屏幕内容、历史记录
- **2 种传输**：HTTP（Streamable HTTP 兼容）、stdio（legacy HTTP+SSE 流仅作兼容保留）

---

## 传输协议

### HTTP

适合 Web 集成和远程访问。`POST /mcp/message` 直接返回完整 JSON-RPC 响应体，语义与 MCP 规范的 Streamable HTTP transport 一致，兼容当前主流客户端（Claude Code、Claude.ai、Cursor 等）。

**端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp/message` | POST | 发送 JSON-RPC 请求，直接返回 JSON-RPC 响应体（无 id 的通知返回空 body） |
| `/mcp/sse` | GET | legacy HTTP+SSE 流，接收服务端推送（规范已废弃，保留兼容） |

**工作流程（POST /mcp/message）：**

1. 客户端向 `POST /mcp/message` 发送 JSON-RPC 请求（带 Bearer token）
2. 服务端返回完整 JSON-RPC 响应体

**legacy SSE 流（GET /mcp/sse）：**

MCP 规范已废弃 HTTP+SSE transport（2025-03-26 起由 Streamable HTTP 取代）。`GET /mcp/sse` 保留以兼容旧客户端：连接后接收 `endpoint` 事件，再向 `POST /mcp/message` 发送请求；响应会同时广播到所有已连接的 SSE 客户端。

**endpoint 事件：**

```json
{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}
```

### stdio

适合本地 CLI 集成。`dinotty-server --mcp-stdio` 作为 stdio 代理：通过 stdin 逐行接收 JSON-RPC，转发到本地主服务（`POST /mcp/message`，带 Bearer token），再把响应体写回 stdout。它本身不启动 HTTP 服务，而是连接已经在跑的 dinotty 主进程。

**前置条件：**

1. 主服务已启动，且端口一致（`--port` 缺省为 8999）
2. 设置中 `mcp.stdio_enabled` 为 `true`（否则进程报错退出）
3. 进程可读取 token（`settings::load_token()`，失败时回退环境变量 `DINOTTY_TOKEN`）

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | dinotty-server --mcp-stdio --port 8999
```

Windows PowerShell：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | .\dinotty-server.exe --mcp-stdio --port 8999
```

---

## MCP 开关

MCP 服务默认开启，可通过设置中的 `mcp` 块按需关闭 HTTP 和/或 stdio（请求时判定，改设置即时生效，无需重启）：

```json
"mcp": { "http_enabled": true, "stdio_enabled": false }
```

| 开关 | 默认 | 作用 |
|------|------|------|
| `mcp.http_enabled` | `true` | 控制 HTTP 端点（`POST /mcp/message` 与 legacy `GET /mcp/sse`）；为 `false` 时两者返回 404 |
| `mcp.stdio_enabled` | `false` | 控制 `--mcp-stdio` 代理；为 `false` 时代理进程启动即报错退出 |

`POST /mcp/message` 由两个开关共同控制：只要 `http_enabled || stdio_enabled` 为 `true` 就放行（stdio 代理也走这个端点），否则返回 404。四种组合：

| `http_enabled` | `stdio_enabled` | 行为 |
|----------------|-----------------|------|
| `true` | `false` | HTTP 可用，stdio 代理不可用（默认） |
| `false` | `true` | 仅 stdio 代理可用，HTTP 端点 404 |
| `true` | `true` | 两种模式都可用 |
| `false` | `false` | 完全关闭，`/mcp/sse` 与 `/mcp/message` 均返回 404 |

---

## 认证

MCP 端点需要 Bearer Token 认证，支持全局 Token 和 Agent Token。

```bash
# 使用 curl 测试
curl -H "Authorization: Bearer <token>" \
     -X POST http://localhost:8999/mcp/message \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Agent Token 需要相应 capability：

| 操作 | 所需 Capability |
|------|----------------|
| `terminal_*` 工具 | `terminal:read` / `terminal:write` |
| `file_*` 工具 | `workspace:read` / `workspace:write` |
| `git_*` 工具 | `workspace:read` |

Agent Token 的 scope 同样生效（详见 [Token 系统](/zh/internals/token-system)）：`terminal:read` / `terminal:write` 的 scope 限制可访问的 pane（`terminal_list` 会过滤 scope 外的 pane），`workspace:read` / `workspace:write` 的 scope 限制可访问的目录（按目录前缀匹配）。`git_status` 作用于进程工作目录，不受 workspace scope 限制。

---

## 工具列表

### terminal_execute

执行 shell 命令并等待完成。

```json
{
  "name": "terminal_execute",
  "arguments": {
    "command": "ls -la",
    "cwd": "/tmp",
    "pane_id": "active",
    "timeout": 30000
  }
}
```

`pane_id` 可选，默认 `active`（当前激活 pane，无激活时取第一个）。

**返回：** JSON 字符串，包含 `exit_code`、`stdout`、`duration_ms`、`method`

**注解：** `readOnlyHint: false`, `destructiveHint: true`

### terminal_read

读取终端屏幕内容。

```json
{
  "name": "terminal_read",
  "arguments": {
    "pane_id": "active"
  }
}
```

**返回：** 屏幕纯文本内容

### terminal_send

发送输入到终端（不等待完成）。

```json
{
  "name": "terminal_send",
  "arguments": {
    "command": "echo hello",
    "pane_id": "active"
  }
}
```

### terminal_list

列出所有活跃终端会话。

```json
{"name": "terminal_list", "arguments": {}}
```

**返回：** JSON 数组，每项包含 `pane_id`、`shell`、`cols`、`rows`、`cwd`

### file_read

读取文件内容（限制在用户 home 目录内）。路径使用服务端平台的原生格式；Windows 路径在 JSON 中需要转义反斜杠，例如 `C:\\Users\\dev\\project\\main.rs`。

```json
{
  "name": "file_read",
  "arguments": {
    "path": "/Users/dev/project/main.rs",
    "pane_id": "active"
  }
}
```

### file_write

写入文件（限制在用户 home 目录内）。

```json
{
  "name": "file_write",
  "arguments": {
    "path": "/Users/dev/project/output.txt",
    "content": "Hello World"
  }
}
```

### file_list

列出目录内容。

```json
{
  "name": "file_list",
  "arguments": {
    "path": "/Users/dev/project"
  }
}
```

### git_status

获取 git 状态（等同 `git status --porcelain`）。

```json
{"name": "git_status", "arguments": {}}
```

### git_diff

获取文件的 git diff。

```json
{
  "name": "git_diff",
  "arguments": {
    "path": "src/main.rs"
  }
}
```

---

## 资源列表

### terminal://sessions

所有活跃终端会话的 JSON 列表。

```json
{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"terminal://sessions"}}
```

### terminal://{pane_id}/screen

指定 pane 的当前屏幕内容（URI 模板）。

```json
{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"terminal://pane-abc/screen"}}
```

### terminal://{pane_id}/scrollback

指定 pane 的历史记录（最近 1000 行）。

---

## JSON-RPC 方法

| 方法 | 说明 |
|------|------|
| `initialize` | 初始化连接，返回协议版本和服务端能力 |
| `ping` | 心跳检测 |
| `tools/list` | 列出所有可用工具 |
| `tools/call` | 调用指定工具 |
| `resources/list` | 列出静态资源 |
| `resources/read` | 读取资源内容 |
| `resources/subscribe` | 订阅资源变更（暂为空操作） |
| `resources/templates/list` | 列出 URI 模板 |
| `prompts/list` | 列出 prompt 模板（暂为空） |

---

## 配置示例

### Claude Desktop

```json
{
  "mcpServers": {
    "dinotty": {
      "url": "http://localhost:8999/mcp/sse",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### Cursor

在 `.cursor/mcp.json` 中：

```json
{
  "mcpServers": {
    "dinotty": {
      "url": "http://localhost:8999/mcp/sse",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### 安全建议

1. **为 MCP 客户端创建专用 Agent Token**，只授予必要的 capability
2. **设置过期时间**，避免长期有效的 token
3. **定期审计** MCP 调用记录：Linux 为 `~/.config/dinotty/audit.log`，macOS 为 `~/Library/Application Support/dinotty/audit.log`，Windows 为 `%APPDATA%\dinotty\audit.log`

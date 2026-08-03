# MCP Server 技术文档

Dinotty 内置 MCP (Model Context Protocol) JSON-RPC 2.0 服务器，允许 AI 助手（如 Claude、Cursor）直接操作终端会话。

## 目录

- [概述](#概述)
- [传输协议](#传输协议)
  - [HTTP + SSE](#http--sse)
  - [stdio](#stdio)
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
- **2 种传输**：HTTP + SSE（推荐）、stdio

---

## 传输协议

### HTTP + SSE

适合 Web 集成和远程访问。

**端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp/sse` | GET | SSE 流，接收服务端消息 |
| `/mcp/message` | POST | 发送 JSON-RPC 请求 |

**工作流程：**

1. 客户端连接 `GET /mcp/sse`，接收 `endpoint` 事件
2. 客户端向 `POST /mcp/message` 发送 JSON-RPC 请求
3. 服务端处理请求，返回响应并广播到所有 SSE 客户端

**endpoint 事件：**

```json
{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}
```

### stdio

适合本地 CLI 集成。通过 stdin 接收 JSON-RPC，stdout 返回响应。

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | dinotty-server --mcp-stdio
```

Windows PowerShell：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | .\dinotty-server.exe --mcp-stdio
```

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
    "timeout": 30000
  }
}
```

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

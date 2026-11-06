# 独立文件查看器 API

在只读查看器中打开单个文件：桌面端为独立原生窗口，Web / 移动端为主窗口全屏浮层。调用方指定一个终端 Pane，该 Pane 的当前工作目录即限定路径的工作区根。查看器没有目录树、没有编辑器标签页，也没有保存 / 编辑入口。

## 目录

- [概述](#概述)
- [认证](#认证)
- [路径解析](#路径解析)
- [接口列表](#接口列表)
  - [POST /api/sessions/:pane_id/viewer](#post-apisessionspane_idviewer)
  - [MCP 工具 file_viewer_open](#mcp-工具-file_viewer_open)
- [响应](#响应)
- [错误码](#错误码)
- [投递模型](#投递模型)
- [示例](#示例)
- [与 Open API 的关系](#与-open-api-的关系)
- [限制](#限制)

---

## 概述

| 触发方式 | 通道 | 适用场景 |
|----------|------|----------|
| `POST /api/sessions/:pane_id/viewer` | HTTP REST | 外部脚本与服务 |
| `file_viewer_open` | MCP | 运行在 Dinotty 终端 Pane 内的 Agent（Claude Code 等） |

两种触发方式共用同一套服务端路径解析与投递逻辑，行为完全一致，区别只在于错误如何序列化。

请求通过 `/ws/sync` 广播给已连接的主界面客户端：

- **桌面端**：创建 label 为 `preview-file-<paneId>` 的原生窗口，首次打开时新建；同一 Pane 再次打开其他文件时聚焦已有窗口并导航，不会创建第二个窗口。
- **Web / 移动端**：在主窗口内打开全屏浮层，`Esc` 关闭。

支持的格式与现有预览一致：Markdown、图片、SVG、PDF、音视频、CSV、Excel、Office 文档、日志、ipynb、JSON/YAML/TOML、纯文本。

---

## 认证

路由挂在 **sessions token 中间件分组**内，这是唯一同时接受三种凭据的路由组：

- **Session Cookie**：通过 `POST /api/auth` 登录后获得。
- **全局 Token**：`Authorization: Bearer <global-token>`。
- **Agent Token**：`Authorization: Bearer dnt_...`，通过 `/api/tokens` 创建。

Agent Token 需要 `workspace:read` 能力，且 canonical 后的目标路径必须通过 token 的 `workspace:read` 路径 scope（否则返回 `SCOPE_DENIED`）。额外的安全约束是：Agent Token 只能访问用户 home 目录下的文件，与 `file_read` 的沙箱规则一致。

该接口**不受** `settings.open_api.enabled` 门控，详见[与 Open API 的关系](#与-open-api-的关系)。

```bash
curl -H "Authorization: Bearer <token>" \
     -X POST http://localhost:8999/api/sessions/pane-123/viewer \
     -H "Content-Type: application/json" \
     -d '{"path":"docs/design.md"}'
```

---

## 路径解析

工作区根是**请求时 Pane 的当前 cwd**，行为与 `/api/workspace/*` 一致。如果 Agent 在 shell 中 `cd` 过，相对路径的解析基准也会随之变化。

| 输入 | 处理结果 |
|------|---------|
| `docs/design.md` | 拼接到工作区根（`normalize_join`） |
| `/Users/me/project/docs/a.md`（位于根内） | 允许——canonicalize 后必须仍在根内 |
| `~/project/docs/a.md` | 先展开 home，再按绝对路径处理 |
| `../../etc/passwd` 或任何含 `..` 的路径 | `INVALID_PATH` |
| 指向工作区外的符号链接 | `OUTSIDE_WORKSPACE` |
| 目录或特殊文件 | `NOT_A_FILE` |
| 超过 500 MiB 的文件 | `FILE_TOO_LARGE` |
| 不存在的文件 | `PATH_NOT_FOUND` |

允许“工作区内的绝对路径”是为了解决 Agent 进程 cwd 与 Pane 工作区根不一致的问题：Agent 可以先 `pwd` 再传完整路径，服务端仍然只提供工作区内的文件。工作区外的路径在第一版一律拒绝，即使使用全局 Token。

---

## 接口列表

### POST /api/sessions/:pane_id/viewer

在指定 Pane 拥有的独立查看器中打开文件。

**请求体：**

```json
{
  "path": "docs/design.md"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | Pane 工作区根下的文件路径。相对路径相对于工作区根解析；绝对路径只有在 canonicalize 后仍位于工作区内时才被接受。 |

**成功响应 (200)：**

```json
{
  "ok": true,
  "request_id": "5f4c1d2e-…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md",
  "delivered_clients": 1
}
```

`path` 会规范化为工作区相对路径，`title` 为文件名。字段语义见[响应](#响应)。

**错误：** 见[错误码](#错误码)。

---

### MCP 工具 file_viewer_open

HTTP 接口的 MCP 对应物。Dinotty 的 MCP Server 已管理凭据，这是 Agent 触发查看器最简单的方式。

**输入 schema：**

```json
{
  "name": "file_viewer_open",
  "description": "Open a file in a standalone read-only viewer window.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path under the pane's workspace root. Relative paths are resolved against the workspace root; absolute paths are accepted only if they stay inside it."
      },
      "pane_id": {
        "type": "string",
        "description": "Terminal pane whose workspace root confines the path; defaults to the active pane. Agents should pass DINOTTY_PANE_ID."
      }
    },
    "required": ["path"]
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 规则同 HTTP 的 `path` 字段。 |
| `pane_id` | 否 | 提供工作区根的 Pane，默认 `active`（当前激活 Pane）。Agent 应传 `DINOTTY_PANE_ID`，使路径相对于自己的终端解析。 |

**所需能力：** `workspace:read`（同时受 token 的路径 scope 约束）。

**返回：** JSON 字符串，字段与 HTTP 成功响应相同（`ok`、`request_id`、`pane_id`、`path`、`title`、`delivered_clients`）。

MCP 错误以工具错误消息返回（由 JSON-RPC 层包装），而不是 HTTP 的 `{ "error": { "code", "message" } }` 结构；底层错误条件与错误码完全相同。

---

## 响应

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 成功时恒为 `true` |
| `request_id` | string | 本次投递的唯一 id；前端用它作为浮层的 `key` |
| `pane_id` | string | 提供工作区根、用于解析路径的 Pane |
| `path` | string | 实际投递的工作区相对路径 |
| `title` | string | 原生窗口 / 浮层标题栏显示的文件名 |
| `delivered_clients` | number | sync 消息入队到的主界面客户端数量 |

---

## 错误码

错误响应统一为：

```json
{ "error": { "code": "OUTSIDE_WORKSPACE", "message": "outside workspace" } }
```

| code | HTTP | 含义 |
|------|------|------|
| `UNKNOWN_PANE` | 404 | Pane 不存在 |
| `CWD_UNAVAILABLE` | 409 | Pane 尚未上报可用 cwd |
| `INVALID_PATH` | 400 | 路径为空、含 `..` 或格式非法 |
| `PATH_NOT_FOUND` | 404 | 文件不存在 |
| `OUTSIDE_WORKSPACE` | 403 | canonicalize 后不在工作区根内（含符号链接逃逸） |
| `NOT_A_FILE` | 400 | 目标是目录或特殊文件 |
| `FILE_TOO_LARGE` | 413 | 超过 500 MiB |
| `SCOPE_DENIED` | 403 | Agent Token 的 `workspace:read` 路径 scope 不包含目标 |
| `SSH_UNSUPPORTED` | 400 | 第一版不支持 SSH Pane |
| `NO_UI_CLIENT` | 409 | 没有任何已连接的主界面客户端可以展示查看器 |

---

## 投递模型

服务端校验请求后，通过 `/ws/sync` 广播 sync 消息：

```json
{
  "type": "open_file_viewer",
  "request_id": "5f4c1d2e-…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md"
}
```

- 只有**主窗口**客户端会收到消息。游离终端窗口也连接同一个 socket，但会被忽略，因此 `delivered_clients` 反映的是真正能展示查看器的客户端数量。
- 桌面端创建或聚焦 `preview-file-<paneId>`，并导航到新文件；同一 Pane 重复打开绝不会创建第二个窗口。
- Web / 移动端打开全屏浮层。所有已连接主界面客户端都会收到消息，这属于第一版可接受的多端行为。
- `delivered_clients > 0` 只表示消息已入队到至少一个客户端，**不**代表窗口已渲染或文件已读取；第一版没有 ACK。
- `delivered_clients == 0` 返回 `NO_UI_CLIENT`，因此接口不会在无人可展示时误报成功。

---

## 示例

### 通过 HTTP 打开 Markdown

```bash
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"README.md"}'
```

### 让同一窗口导航到另一个文件

```bash
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"docs/logo.png"}'
```

第一次调用打开的桌面窗口会被聚焦并导航到图片，而不是再弹出第二个窗口。

### 调用 MCP 工具

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "file_viewer_open",
    "arguments": { "pane_id": "pane-123", "path": "docs/design.md" }
  }
}
```

### Agent 可用的环境变量

| 变量 | 用途 |
|------|------|
| `DINOTTY_PANE_ID` | 提供限定路径的工作区根的 Pane |
| `DINOTTY_URL` | 当前服务的 HTTP 基址（`http://127.0.0.1:<port>`） |

HTTP 接口需要 Bearer Token。Agent 通常应直接使用 MCP 工具，因为 Dinotty 已为其管理凭据。

---

## 与 Open API 的关系

| | Open API | 独立文件查看器 |
|--|----------|----------------|
| 用途 | 读写终端会话 | 在界面中展示文件 |
| 受 `open_api.enabled` 门控 | 是 | **否** |
| Agent Token 所需能力 | `terminal:read` / `terminal:write` | `workspace:read` |
| 示例 | `POST /api/sessions/:pane_id/run` | `POST /api/sessions/:pane_id/viewer` |

查看器是界面呈现动作，不是终端 I/O，因此和 `/api/tabs/*` 一样始终启用。这一点在 dispatch 模式下尤为重要：Open API 会被关闭，但 Agent 仍需要向用户展示文件。

---

## 限制

- **SSH Pane** 在第一版返回 `SSH_UNSUPPORTED`。
- **强制工作区限制**：工作区根之外的路径一律拒绝，即使使用全局 Token。
- **只读**：没有编辑、保存、目录树或编辑器标签页。
- **一次一个文件**：每个 Pane 拥有一个查看器窗口，打开新文件会导航已有窗口。
- **无 ACK**：成功响应只表示已投递给某个界面客户端，不代表渲染完成。
- **不恢复**：查看器窗口不跨应用重启恢复，也不参与预览窗口停靠（dock）。

## 相关文档

- [MCP Server](./mcp-server.md) —— 工具列表与能力映射
- [Open API](./open-api.md) —— 终端读写端点
- [Tabs & Panes API](./tabs-panes-api.md) —— 创建与分屏 Pane
- [Token 权限系统](../internals/token-system.md) —— capability 与 scope 模型

# API 总览

Dinotty 的对外接口按用途分为四层。本文档帮助你快速找到需要的 API。

## 接口分层

| 层 | 通道 | 适合场景 | 文档 |
|----|------|---------|------|
| **Tabs & Panes API** | HTTP REST | 创建 / 关闭 / 重命名 Tab，分屏，跨 Tab 移动 Pane | [tabs-panes-api.md](./tabs-panes-api.md) |
| **Open API** | HTTP + WebSocket | 读写已有终端：字节流（screen/scrollback/input/resize）+ 命令级语义（run/send/read）+ 事件订阅 | [open-api.md](./open-api.md) |
| **Mission Control API** | WebSocket (`/ws/sync`) | 程序化打开 / 导航 / 关闭 MC 概览 | [mission-control-api.md](./mission-control-api.md) |

此外还有两个独立子系统的 API 文档：

- [Clipboard API](./clipboard-api.md) - 读取主机剪贴板
- [MCP Server](./mcp-server.md) - Model Context Protocol 服务端

## 按场景找接口

### 我想...

- **从外部启动一个终端 Tab** -> [POST /api/tabs](./tabs-panes-api.md#post-apitabs)
- **连接 SSH 并自动开 Tab** -> [POST /api/tabs/ssh/quick](./tabs-panes-api.md#post-apitabssshquick)
- **在已有终端旁分屏** -> [POST /api/tabs/:tab_id/pane](./tabs-panes-api.md#post-apitabstab_idpane)
- **把一个 Pane 抽成独立 Tab** -> [POST /api/tabs/extract](./tabs-panes-api.md#post-apitabsextract)
- **抓取当前终端屏幕内容** -> [GET /api/sessions/:pane_id/screen](./open-api.md#get-apisessionspane_idscreen)
- **向终端注入字符** -> [POST /api/sessions/:pane_id/input](./open-api.md#post-apisessionspane_idinput)
- **执行命令并拿 exit code** -> [POST /api/sessions/:pane_id/run](./open-api.md#post-apisessionspane_idrun)
- **订阅命令完成事件** -> [WS /ws/events](./open-api.md#websocket-接口)
- **远程打开 Mission Control** -> [mission_control_op / toggle](./mission-control-api.md#toggle)
- **从 MC 跳到指定工作区** -> [mission_control_op / jump](./mission-control-api.md#jump)
- **读取主机剪贴板** -> [GET /api/clipboard](./clipboard-api.md)
- **接入 Claude / LLM 的 MCP 客户端** -> [MCP Server](./mcp-server.md)

## 认证体系

Dinotty 的鉴权分两层，Open API 的 `run`/`send`/`read`/`WS /ws/events` 同时接受两种凭据（双轨鉴权）：

```
┌─────────────────────────────────────────────────────────────────┐
│  全局 Token / Session Cookie                                     │
│  - 启动时配置的 master token，或 POST /api/auth 登录后的 cookie   │
│  - 覆盖：Tabs API、Open API（全部端点）、Clipboard、Settings、    │
│    Plugins 等所有 /api/* 端点                                    │
└─────────────────────────────────────────────────────────────────┘
         │
         │  /api/sessions/{run,send,read} + /ws/events 也接受
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agent Token (dnt_*)                                             │
│  - 通过 /api/tokens 创建的细粒度 token                            │
│  - 携带 capability: terminal:read / terminal:write 等             │
│  - 覆盖：/api/sessions/{run,send,read}、/ws/events、              │
│    /api/tokens/*、/mcp/*                                         │
└─────────────────────────────────────────────────────────────────┘
```

Mission Control 走 `/ws/sync`，使用全局 token（query string `?token=<token>`）或 session cookie。

## 启用条件速查

| API | 启用条件 |
|-----|---------|
| Tabs & Panes API | 始终启用（仅需认证） |
| Open API | 需在 settings 中开启 `open_api.enabled = true`；`run`/`send`/`read` 额外接受 Agent Token（capability 校验） |
| Mission Control API | 始终启用（通过 `/ws/sync`） |
| Clipboard | 始终启用，但需要 token 或 session + 同源校验 |
| MCP Server | 需要 `open_api.enabled = true` 并使用 Agent Token |

## 内部机制

如果想了解事件系统、权限模型、审计日志等"非接口"层面的设计：

- [Event Bus](../internals/event-bus.md) - 服务端内部事件总线
- [Token 权限系统](../internals/token-system.md) - Agent Token 的 capability 模型
- [审计与 Webhook](../internals/audit-webhook.md) - 操作审计日志与外部 webhook 推送

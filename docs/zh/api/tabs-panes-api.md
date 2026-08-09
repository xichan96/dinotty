# Tabs & Panes API

外部程序通过 HTTP REST 接口创建、关闭、重命名终端 Tab，分屏创建新 Pane，或把 Pane 在 Tab 之间移动 / 抽取成独立 Tab。覆盖本地 PTY、SSH 会话、插件 / 文件 / 网页等所有 Pane 类型。

## 目录

- [概述](#概述)
- [认证](#认证)
- [Tab 模型](#tab-模型)
- [接口列表](#接口列表)
  - [GET /api/tabs](#get-apitabs)
  - [POST /api/tabs](#post-apitabs)
  - [POST /api/tabs/ssh/quick](#post-apitabssshquick)
  - [POST /api/tabs/ssh](#post-apitabsssh)
  - [POST /api/tabs/plugin](#post-apitabsplugin)
  - [DELETE /api/tabs/:tab_id](#delete-apitabstab_id)
  - [POST /api/tabs/:tab_id/rename](#post-apitabstab_idrename)
  - [POST /api/tabs/:tab_id/pane](#post-apitabstab_idpane)
  - [POST /api/tabs/:tab_id/pane/plugin](#post-apitabstab_idpaneplugin)
  - [POST /api/tabs/:tab_id/pane/files](#post-apitabstab_idpanefiles)
  - [POST /api/tabs/:tab_id/pane/web](#post-apitabstab_idpaneweb)
  - [POST /api/tabs/:tab_id/pane/move](#post-apitabstab_idpanemove)
  - [POST /api/tabs/extract](#post-apitabsextract)
  - [DELETE /api/tabs/:tab_id/pane/:pane_id](#delete-apitabstab_idpanepane_id)
  - [PUT /api/tabs/:tab_id/pane/:pane_id/activate](#put-apitabstab_idpanepane_idactivate)
  - [PUT /api/tabs/:tab_id/layout](#put-apitabstab_idlayout)
- [错误格式](#错误格式)
- [典型场景](#典型场景)

---

## 概述

| 操作 | 端点 | 说明 |
|------|------|------|
| 列出 Tab | `GET /api/tabs` | 返回所有 Tab 布局 + 当前活跃 Pane |
| 创建终端 Tab | `POST /api/tabs` | 启动本地 PTY，建立独立 Tab |
| 创建 SSH Tab | `POST /api/tabs/ssh/quick` / `POST /api/tabs/ssh` | 用参数或 profile 建立 SSH 会话 Tab |
| 创建插件 Tab | `POST /api/tabs/plugin` | 无 PTY，整 Tab 渲染插件 |
| 关闭 Tab | `DELETE /api/tabs/:tab_id` | 关闭 Tab 内所有 Pane |
| 重命名 Tab | `POST /api/tabs/:tab_id/rename` | 修改 Tab 标题 |
| 分屏 | `POST /api/tabs/:tab_id/pane` | 在已有 Pane 旁边分出新 Pane |
| 创建非终端 Pane | `POST /api/tabs/:tab_id/pane/{plugin,files,web}` | 插入插件 / 文件 / 网页 Pane |
| 跨 Tab 移动 | `POST /api/tabs/:tab_id/pane/move` | 整 Tab 合并或单 Pane 移动 |
| 抽取成新 Tab | `POST /api/tabs/extract` | 把 Pane 拆出成独立 Tab |
| 关闭 Pane | `DELETE /api/tabs/:tab_id/pane/:pane_id` | 移除单个 Pane |
| 激活 Pane | `PUT /api/tabs/:tab_id/pane/:pane_id/activate` | 切换活跃 Pane |
| 更新布局 | `PUT /api/tabs/:tab_id/layout` | 整体替换 Tab 布局树 |

所有写入操作会同步通过 `/ws/sync` 广播 `TabCreated` / `TabClosed` / `LayoutUpdated` / `TabActivated` / `TabRenamed` 消息给已连接的多端客户端，保证多端同步。

---

## 认证

所有 `/api/tabs/*` 接口都受全局 auth middleware 保护。请求需携带以下任意一种凭证：

- **Session Cookie**：通过 `POST /api/auth` 登录后获得的 cookie（名称形如 `dinotty_session_<port>`）。浏览器同源场景默认走这条路径。
- **Bearer Token**：`Authorization: Bearer <global-token>`，token 即服务端启动时配置的全局 token。

```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/tabs
```

`/api/tabs/*` 不需要 `open_api.enabled`。如需让 Agent 通过细粒度 Token 调用终端，请使用 [Open API](./open-api.md) 的 `run`/`send`/`read` 端点。

---

## Tab 模型

每个 Tab 持有一棵布局树，叶子节点 (`type: "leaf"`) 即 Pane。布局节点统一用 JSON 描述：

```json
{
  "type": "leaf",
  "paneId": "pane-uuid",
  "title": "Terminal",
  "shell_type": "zsh",
  "ratio": 1,
  "zoomed": false
}
```

非终端 Pane 在 leaf 上额外携带类型字段：

| `kind` | 携带字段 | 说明 |
|--------|---------|------|
| `plugin` | `pluginId` | 渲染一个插件 |
| `files` | `path`, `sourcePaneId` | 文件浏览器，根目录为 `path` |
| `web` | `url`, `sourcePaneId` | iframe 网页预览 |
| (省略) | — | 终端 Pane，由 PTY 驱动 |

分屏布局使用 `type: "split"` 节点包裹子节点（具体格式见 [统一布局系统设计](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/layout-system-unification-design.md)）。本 API 不要求客户端理解 split 节点细节——`split_pane` / `create_*_pane` 接口由服务端负责生成新布局树，调用方只需传入 `direction` 和目标 `pane_id`。

---

## 接口列表

### GET /api/tabs

列出所有 Tab 及当前活跃 Pane。

**响应 (200)：**

```json
{
  "tabs": [
    {
      "tab_id": "tab-aaa",
      "layout": { "type": "leaf", "paneId": "pane-1", "title": "Terminal", "shell_type": "zsh", "ratio": 1, "zoomed": false },
      "active_pane_id": "pane-1"
    }
  ],
  "active_pane_id": "pane-1"
}
```

---

### POST /api/tabs

创建一个本地终端 Tab，启动新 PTY 会话。

**请求体：**

```json
{
  "cwd": "/Users/dev/project",
  "argv": ["npm", "run", "dev"],
  "title": "dev server"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | string | 否 | 工作目录，必须存在；省略时使用设置中的默认工作区根 |
| `argv` | string[] | 否 | 以 `argv[0]` 为命令启动新进程（绕过 shell）；非空时忽略 shell 偏好 |
| `title` | string | 否 | Tab 标题，默认 `"Terminal"` |

**成功响应 (200)：**

```json
{
  "tab_id": "tab-aaa",
  "pane_id": "pane-1",
  "layout": { "type": "leaf", "paneId": "pane-1", "title": "dev server", "shell_type": "zsh", "ratio": 1, "zoomed": false },
  "cwd": "/Users/dev/project"
}
```

**错误：**

| 状态码 | 触发条件 |
|--------|---------|
| 400 | `cwd` 不存在或不是目录；`argv` 为空数组或 `argv[0]` 为空 |
| 409 | Shell 解析失败（如 WSL 列表失败但要求走 WSL） |
| 503 | WSL 超时 / WSL 列表失败 |
| 500 | PTY 创建失败，或会话在 Tab 发布前已退出 |

---

### POST /api/tabs/ssh/quick

用直接参数创建一个 SSH Tab，无需预先在设置中保存 profile。

**请求体：**

```json
{
  "host": "192.168.1.10",
  "port": 22,
  "username": "dev",
  "auth_method": "password",
  "password": "secret",
  "profile_id": "ad-hoc",
  "workspace_id": null,
  "initial_cwd": "/srv/app"
}
```

字段定义与 `SshConnectRequest` 一致（见 `src/ssh/mod.rs`）。`auth_method` 支持 `password` / `publickey` / `keyboard-interactive`。`keyboard-interactive` 会触发 `SshAuthResponse` 交互流程（通过 `/ws/sync` 完成）。

**成功响应 (200)：**

```json
{
  "tab_id": "tab-bbb",
  "pane_id": "pane-2",
  "layout": { "type": "leaf", "paneId": "pane-2", "title": "dev@192.168.1.10", "shell_type": "ssh", "ratio": 1, "zoomed": false },
  "connection_id": "ad-hoc"
}
```

---

### POST /api/tabs/ssh

用设置中已保存的 SSH profile 创建 Tab。

**请求体：**

```json
{
  "profile_id": "profile-uuid",
  "workspace_id": "ws-xxx",
  "initial_cwd": "/srv/app"
}
```

`profile_id` 必须已在 settings 的 `ssh_profiles` 中存在，否则返回 404。`workspace_id` / `initial_cwd` 可选。

**成功响应 (200)：** 同 `ssh/quick`，但 `connection_id` 等于 `profile_id`，且响应里携带 `workspace_id`。

---

### POST /api/tabs/plugin

创建一个无 PTY 的纯插件 Tab。整 Tab 渲染单个插件 leaf。

**请求体：**

```json
{
  "plugin_id": "my-plugin",
  "title": "My Plugin",
  "tab_id": "custom-tab-id"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `plugin_id` | string | 是 | 已安装的插件 ID |
| `title` | string | 否 | Tab 标题，默认等于 `plugin_id` |
| `tab_id` | string | 否 | 自定义 Tab ID；省略则生成 UUID。前端约定插件 Tab 的 `tab_id == pane_id` |

**成功响应 (200)：**

```json
{
  "tab_id": "custom-tab-id",
  "pane_id": "custom-tab-id",
  "layout": { "type": "leaf", "kind": "plugin", "paneId": "custom-tab-id", "title": "My Plugin", "ratio": 1, "zoomed": false, "pluginId": "my-plugin" }
}
```

---

### DELETE /api/tabs/:tab_id

关闭整个 Tab，杀掉内部所有 PTY 会话。

**响应 (200)：**

```json
{ "ok": true }
```

无论 Tab 是否存在都返回 200。删除后服务端会广播 `TabClosed`。

---

### POST /api/tabs/:tab_id/rename

修改 Tab 标题。

**请求体：**

```json
{ "title": "new name" }
```

**响应：**

- 200 `{"ok": true}` — 成功
- 400 — `title` 为空
- 404 — Tab 不存在

成功后服务端会广播 `TabRenamed`。

---

### POST /api/tabs/:tab_id/pane

在已有 Pane 旁分屏，创建一个新终端 Pane。新 Pane 默认继承源 Pane 的环境：

- 源是 SSH Pane → 新 Pane 自动建立一条新的 SSH 连接到同一 host（除非 `force_local`）
- 源是本地 PTY → 新 Pane 继承源 Pane 当前工作目录

**请求体：**

```json
{
  "pane_id": "pane-1",
  "direction": "vertical",
  "force_local": false,
  "cwd": "/tmp"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pane_id` | string | 是 | 源 Pane ID，必须是当前 Tab 内的 leaf |
| `direction` | string | 是 | `"horizontal"` 或 `"vertical"` |
| `force_local` | bool | 否 | 强制创建本地 PTY，不继承 SSH；与 `cwd` 配合使用 |
| `cwd` | string | 否 | 仅在 `force_local=true` 时生效；省略则继承源 Pane CWD |

**成功响应 (200)：**

```json
{
  "new_pane_id": "pane-2",
  "layout": { /* 更新后的整棵布局树 */ }
}
```

---

### POST /api/tabs/:tab_id/pane/plugin

在已有 Pane 旁插入一个插件 Pane（无 PTY）。

**请求体：**

```json
{
  "plugin_id": "my-plugin",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

**成功响应 (200)：**

```json
{
  "new_pane_id": "pane-3",
  "layout": { /* 更新后的布局树 */ }
}
```

---

### POST /api/tabs/:tab_id/pane/files

在已有 Pane 旁插入一个文件浏览器 Pane。

**请求体：**

```json
{
  "path": "/Users/dev/project",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

`path` 必须存在。新 leaf 会同时记录 `sourcePaneId`，便于前端联动（如在文件 Pane 打开文件时回写到源终端 Pane 的 CWD）。

---

### POST /api/tabs/:tab_id/pane/web

在已有 Pane 旁插入一个网页预览 Pane。

**请求体：**

```json
{
  "url": "http://localhost:3000",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

`url` 会被作为 iframe `src` 加载。需要服务端 `/api/proxy` 转发的场景，请参考 [网页预览设计](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/web-preview-design.md)。

---

### POST /api/tabs/:tab_id/pane/move

把 Pane 或整 Tab 移动到目标 Tab 内。支持两种模式：

**Mode A（整 Tab 合并）** — `source_pane_id` 省略：把 `source_tab_id` 整棵布局作为子树插入到目标 Tab 的 `target_pane_id` 旁，源 Tab 被删除。

**Mode B（单 Pane 移动）** — `source_pane_id` 给定：把指定 Pane 抽出，插入到目标 Tab。源 Tab 必须至少有 2 个 Pane。

**请求体：**

```json
{
  "source_tab_id": "tab-aaa",
  "source_pane_id": "pane-1",
  "target_pane_id": "pane-2",
  "direction": "horizontal"
}
```

**成功响应 (200)：**

- Mode A: `{ "layout": <dst>, "active_pane_id": "...", "mode": "a" }`
- Mode B: `{ "source_layout": <src>, "layout": <dst>, "active_pane_id": "...", "mode": "b" }`

**错误：**

| 状态码 | 触发条件 |
|--------|---------|
| 400 | 源和目标 Tab 相同；Mode B 但源 Tab 只有 1 个 Pane |
| 404 | 源 / 目标 Tab 不存在；`target_pane_id` / `source_pane_id` 不在对应布局中 |
| 500 | 布局插入失败（通常意味着布局树损坏） |

---

### POST /api/tabs/extract

把目标 Pane 从源 Tab 抽出，作为整棵布局新建一个 Tab。PTY 会话保留，不重新创建。

**请求体：**

```json
{
  "source_tab_id": "tab-aaa",
  "pane_id": "pane-1"
}
```

**成功响应 (200)：**

```json
{
  "new_tab_id": "tab-ccc",
  "pane_id": "pane-1",
  "source_layout": { /* 源 Tab 更新后的布局 */ }
}
```

源 Tab 必须至少有 2 个 Pane，否则返回 400。

---

### DELETE /api/tabs/:tab_id/pane/:pane_id

关闭单个 Pane。终端 Pane 会杀掉 PTY；非终端 Pane 仅从布局中移除。当 Tab 内最后一个 Pane 被关闭时，Tab 也会一并关闭（响应中 `tab_closed: true`）。

**响应 (200)：**

```json
{ "ok": true, "tab_closed": false }
```

---

### PUT /api/tabs/:tab_id/pane/:pane_id/activate

把指定 Pane 设为当前活跃 Pane。仅更新 `active_pane_id`，不改变布局结构。

**响应 (200)：** `{"ok": true}`

服务端会广播 `TabActivated` 同步到其他端。

---

### PUT /api/tabs/:tab_id/layout

整体替换 Tab 的布局树。客户端拖拽 / 缩放调整后通常调用此接口持久化。

**请求体：**

```json
{
  "layout": { /* 完整布局树 */ },
  "active_pane_id": "pane-1"
}
```

**响应 (200)：** `{"ok": true}`

服务端不做布局合法性深度校验，调用方需保证 `paneId` 引用的 Pane 在树中存在。

---

## 错误格式

错误响应统一为 JSON：

```json
{ "error": "tab not found" }
```

或对于 shell 解析失败：

```json
{ "error": { "code": "wsl_timeout" } }
```

常见错误码：

| HTTP | 含义 |
|------|------|
| 400 | 请求参数无效（空标题、非法 direction、cwd 不存在等） |
| 401 | 未认证 |
| 404 | Tab / Pane 不存在 |
| 409 | Shell 解析冲突（如要求 WSL 但 WSL 不可用） |
| 500 | PTY 创建失败、布局更新失败、会话过早退出 |
| 503 | WSL 超时 / WSL 列表失败 |

---

## 典型场景

### 启动开发环境

```bash
# 1. 创建一个跑 dev server 的 Tab
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs \
     -d '{"cwd":"/Users/dev/app","argv":["npm","run","dev"],"title":"dev"}'

# 2. 创建一个 SSH Tab 连到生产机
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/ssh/quick \
     -d '{"host":"10.0.0.5","port":22,"username":"ops","auth_method":"password","password":"..."}'
```

### 在已有 Tab 内分屏

```bash
# 拿到 tab_id 和 pane_id 后，分出一个右侧 Pane
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/$TAB_ID/pane \
     -d '{"pane_id":"pane-1","direction":"horizontal"}'
```

### 把临时 Pane 抽成独立 Tab

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/extract \
     -d '{"source_tab_id":"tab-aaa","pane_id":"pane-3"}'
```

### 程序化打开 Mission Control

Mission Control 没有独立 HTTP 端点，需通过 `/ws/sync` 发送 `MissionControlOp` 消息，详见 [Mission Control API](./mission-control-api.md)。

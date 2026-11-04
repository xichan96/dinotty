# 独立文件查看器设计

> 状态：设计稿，未开工  
> 更新时间：2026-11-04  
> 范围：桌面端（macOS / Windows / Linux）、Web、移动端  
> 英文名：Standalone File Viewer  
> 触发方：终端内的 Agent（Claude Code 等）、外部脚本

## 1. 背景与目标

Agent 在终端里生成长文档、设计稿、图表、截图时，目前只能让用户自己去文件树里找文件，或者用终端输出把内容“打印”出来。Dinotty 已有的文件预览能力都面向“人手动浏览”：

| 能力 | 形态 | 问题 |
| --- | --- | --- |
| 文件浏览器预览 `kind=files` | 左侧目录树 + 编辑器标签页 | 只看一个文件时界面过重 |
| Web Preview `kind=web` | 独立窗口 / 分屏 iframe | 只支持 URL，不支持本地文件 |
| `POST /api/tabs/:tab_id/pane/files` | 在主窗口插入文件面板 | 仍是带树的完整文件浏览器 |
| 终端输出 | 纯文本 | 图片、Markdown、PDF 无法呈现 |

本设计增加**独立文件查看器**：Agent 通过接口打开一个文件，用户在独立页面里只读查看；没有目录树、没有编辑器标签页、没有保存/编辑入口。

### 目标

1. 支持 Markdown、图片、SVG、PDF、音视频、CSV、Excel、Office、日志、ipynb、JSON/YAML/TOML、纯文本等现有预览格式。
2. 桌面端打开**独立原生窗口**；Web / 移动端在主窗口内打开**全屏浮层**。
3. 查看器只读：无目录树、无标签页、无编辑/保存。
4. Agent 可以通过 **MCP 工具**或 **HTTP 接口**触发；Claude Code 开箱即用。
5. 同一终端 pane 重复打开时复用并导航已有窗口，避免窗口爆炸。
6. 路径严格限制在该 pane 的工作区内。

### 非目标（第一版）

- 编辑、保存、另存为。
- 多文件标签页、文件间跳转导航。
- 拖拽停靠到主窗口 tab 栏（查看器不参与 dock 手势）。
- 工作区外的绝对路径。
- SSH pane（先返回明确错误，后续再支持）。
- 跨应用重启恢复查看器窗口。
- 针对指定客户端的定向投递（当前广播给所有主界面客户端）。

---

## 2. 产品形态

### 2.1 桌面：原生窗口

```text
┌─ Dinotty ─ docs/design.md ────────────────┐
│ [刷新]  design.md                         │
│  docs/design.md                           │
├───────────────────────────────────────────┤
│                                           │
│         只读内容（Markdown / 图片 / PDF）  │
│                                           │
└───────────────────────────────────────────┘
```

- 窗口标题为文件名，由原生标题栏承载。
- 顶部只有一条细工具栏：刷新、文件名、工作区相对路径；不提供编辑、保存、目录树展开。
- Markdown 正文居中限宽（约 860px）；图片、PDF、视频全宽。
- 窗口尺寸沿用现有预览窗口（约 1100 × 800），设最小尺寸。

### 2.2 Web / 移动端：全屏浮层

- 在主窗口内覆盖 `100dvh` 的浮层，带标题栏和关闭按钮。
- `Esc` 关闭；打开时自动聚焦关闭按钮，关闭后恢复原焦点。
- 移动端处理安全区（safe-area inset），打开时主动让终端输入框失焦，避免键盘残留。

### 2.3 与现有窗口的关系

| 类型 | 窗口 label | 复用策略 | 内容 |
| --- | --- | --- | --- |
| 文件浏览器 `kind=files` | `preview-files-<sourcePaneId>` | 每个终端 pane 一个 | `FileWorkspacePreview`（带树/标签/编辑） |
| Web 预览 `kind=web` | `preview-web-<uuid>` | 每次新建 | `WebPreview` |
| **独立文件查看器 `kind=file`** | `preview-file-<sourcePaneId>` | 每个终端 pane 一个，重复打开聚焦 + 导航 | `FileViewer`（只读单文件） |

查看器使用独立的 label 前缀，不会劫持或复用文件浏览器窗口。

---

## 3. 架构与数据流

```text
Agent（终端 pane 内，持有 DINOTTY_PANE_ID / DINOTTY_URL）
  ├─ MCP: file_viewer_open { path, pane_id? }
  └─ HTTP: POST /api/sessions/:pane_id/viewer { path }
        │
        ▼
服务端
  1. 解析 pane 工作区根（pane 当前 cwd）
  2. 校验路径：canonicalize → 必须位于工作区内 → 普通文件 → 大小上限
  3. 校验 token：workspace:read 能力 + 路径 scope（agent token）
  4. broadcast SyncMsg::OpenFileViewer { request_id, pane_id, path, title }
        │
        ├─ 桌面主窗口（/ws/sync）
        │    invoke open_preview_window(kind="file", sourcePaneId, path, title)
        │    → 创建或聚焦 preview-file-<paneId>，发送 preview-window-navigate
        │
        └─ Web / 移动端主窗口（/ws/sync）
             → 打开全屏浮层
        │
        ▼
FileViewer（无树/无标签）
  GET /api/workspace/meta?pane_id&path=<rel>
  GET /api/workspace/raw?pane_id&path=<rel>
  → FilePreviewContent（Markdown / 图片 / PDF / 视频 / CSV / Office / 日志 / 文本）
```

### 3.1 为什么由主窗口开窗口，而不是服务端直接开

服务端 crate（`dinotty-server`）没有 Tauri `AppHandle`：

- 桌面端是 Tauri 内嵌服务端；
- 同一套服务端还能以 `--server` 独立运行，或被远程桌面连接；
- 只有主窗口 webview 能调用 `open_preview_window`。

因此采用统一的 **sync WebSocket 广播** 机制。它在桌面本地、远程服务端、Web 客户端上都成立。

### 3.2 为什么复用 `preview.html`

`src-tauri/src/preview_windows.rs` 已经实现：

- 窗口创建竞态处理（reservation + Condvar）；
- 多实例 registry；
- 窗口关闭清理；
- 按 pane 复用、聚焦、导航；
- URL 参数编码；
- 权限 capability（`preview-*`）。

新增一个 Vite 入口或独立 Rust 窗口模块都会重复这些逻辑，因此选择扩展 `PreviewKind`。

---

## 4. 触发接口

### 4.1 MCP 工具 `file_viewer_open`

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

调用示例：

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

返回：

```json
{
  "ok": true,
  "request_id": "5f4c…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md",
  "delivered_clients": 1
}
```

实现位置：

- `src/mcp/tools.rs`：工具定义与 `tool_file_viewer_open`；
- `src/mcp/server.rs::handle_tools_call`：`"file_viewer_open" => "workspace:read"`。
  两处都要改，否则工具在进入业务逻辑前就会被判定为未知工具或缺少能力。

### 4.2 HTTP 接口

```http
POST /api/sessions/:pane_id/viewer
Authorization: Bearer <global-token 或 agent-token>
Content-Type: application/json

{ "path": "docs/design.md" }
```

成功响应：

```json
{
  "ok": true,
  "request_id": "5f4c…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md",
  "delivered_clients": 1
}
```

错误响应统一为：

```json
{ "error": { "code": "OUTSIDE_WORKSPACE", "message": "outside workspace" } }
```

#### 路由归属

- 路由必须加在 **`token::sessions_token_middleware` 分组**内，这是唯一同时接受 Agent Token、全局 Token 和会话 Cookie 的路由组。
- 两套路由表都要改：
  - `src/main.rs`
  - `src-tauri/src/embedded_server/router.rs`
  - `src-tauri/tests/router_parity.rs` 会检查两边是否一致。
- `src/auth/mod.rs::is_agent_managed_path` 需要放行 `["api","sessions",_,"viewer"]`，否则外层中间件会在进入 sessions 中间件前拒绝 Agent Token。

#### 与 `open_api` 开关的关系

该接口**不受** `settings.open_api.enabled` 门控，和 MCP、`/api/tabs/*` 一致。原因是：

- Open API 的开关面向终端读写（`/api/sessions/*screen|input|run…`）；
- 本接口是 UI 呈现动作；
- dispatch 模式会关闭 Open API，但 Agent 仍需要展示文件。

### 4.3 Agent 可用环境变量

| 变量 | 用途 |
| --- | --- |
| `DINOTTY_PANE_ID` | 指定工作区根所属的终端 pane |
| `DINOTTY_URL` | 当前服务的 HTTP 基址（`http://127.0.0.1:<port>`） |

> HTTP 接口需要 Bearer Token。Agent 侧最简单的方式是使用 MCP；MCP 已由 Dinotty 管理凭据。

### 4.4 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `UNKNOWN_PANE` | 404 | pane 不存在 |
| `CWD_UNAVAILABLE` | 409 | pane 尚未上报可用 cwd |
| `INVALID_PATH` | 400 | 路径为空、含 `..`、格式非法 |
| `PATH_NOT_FOUND` | 404 | 文件不存在 |
| `OUTSIDE_WORKSPACE` | 403 | canonicalize 后不在工作区根内（含符号链接逃逸） |
| `NOT_A_FILE` | 400 | 目标是目录或特殊文件 |
| `FILE_TOO_LARGE` | 413 | 超过 500 MiB |
| `SCOPE_DENIED` | 403 | Agent Token 的 `workspace:read` 路径 scope 不包含目标 |
| `SSH_UNSUPPORTED` | 400 | 第一版不支持 SSH pane |
| `NO_UI_CLIENT` | 409 | 没有任何已连接的主界面客户端 |

---

## 5. 服务端设计

### 5.1 路径解析与约束

新增 `src/workspace/viewer.rs`，放在 `workspace` 模块内以复用 `pub(crate)` 的路径工具：

- `get_root(manager, pane_id)`：工作区根 = pane 当前 cwd；
- `normalize_join(root, rel)`：拒绝 `..`；
- `path_must_be_under(root, candidate)`：canonicalize 后做前缀检查；
- `rel_from_root(root, full)`：返回工作区相对路径；
- `MAX_DOWNLOAD`：500 MiB。

解析规则：

| 输入 | 处理 |
| --- | --- |
| `docs/design.md` | `normalize_join(root, path)` |
| `/Users/me/project/docs/a.md` | 绝对路径，canonicalize 后必须 `starts_with(root)` |
| `~/project/docs/a.md` | 展开 home，再按绝对路径处理 |
| `../../etc/passwd` | `INVALID_PATH` |
| 指向工作区外的符号链接 | canonicalize 后 `OUTSIDE_WORKSPACE` |
| 目录 | `NOT_A_FILE` |
| 大于 500 MiB | `FILE_TOO_LARGE` |

> 允许“工作区内的绝对路径”是为了解决 Agent 进程 cwd 与 pane 工作区根不一致的问题：Agent 可以先 `pwd` 再传绝对路径，服务端仍然只认工作区内的文件。

`ViewerTarget`：

```rust
struct ViewerTarget {
    pane_id: String,
    rel_path: String,       // 工作区相对路径，投递给前端
    canonical_path: PathBuf, // 用于 scope 检查
    title: String,           // 文件名
}
```

### 5.2 投递：Sync 消息

`src/session/types.rs` 新增：

```rust
SyncMsg::OpenFileViewer {
    request_id: String,
    pane_id: String,
    path: String,   // 工作区相对路径
    title: Option<String>,
}
```

线上格式（`type` snake_case）：

```json
{
  "type": "open_file_viewer",
  "request_id": "5f4c…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md"
}
```

#### 主窗口与游离窗口的区分

`/ws/sync` 同时被主窗口和游离终端窗口连接。为了准确判断“是否有界面可以展示”，引入客户端角色：

- `SyncClientRole { Main, Detached }`；
- 主窗口默认 `Main`；游离窗口连接时带 `?role=detached`；
- `broadcast_sync_counted_role(msg, Main)` 只投递给主窗口，并返回投递数量；
- 数量为 0 时返回 `NO_UI_CLIENT`。

这避免出现“只有游离终端窗口连着，接口却返回成功”的假阳性。

> 投递成功只代表消息已入队到主窗口 WebSocket，不代表原生窗口已经渲染完成。需要强一致时可以后续增加 ACK。

### 5.3 共享服务

HTTP handler 与 MCP 工具共用同一套服务函数，避免逻辑分叉：

```rust
resolve_viewer_target(manager, pane_id, raw_path) -> Result<ViewerTarget, ViewerError>
present_file_viewer(manager, &target) -> Result<ViewerDelivery, ViewerError>
```

差异只在错误序列化：

- HTTP：`{ "error": { "code", "message" } }`；
- MCP：`Err(message)`，由 JSON-RPC 层包装。

### 5.4 权限

| 调用者 | 要求 |
| --- | --- |
| 会话 Cookie / 全局 Token | 通过；路径仍受工作区 jail 限制 |
| Agent Token | `workspace:read` 能力 + `check_path_scope` 通过 |
| Agent Token（额外约束） | canonical 路径必须在用户 home 下（与 `file_read` 的 `sandbox_path` 对齐），防止 pane 根在 `/` 时扩大 Token 可达范围 |

### 5.5 Tauri 窗口

`src-tauri/src/preview_windows.rs`：

- 新增 `PreviewKind::File`，slug 为 `"file"`；
- 新增 `file_label(source_pane_id) -> "preview-file-<paneId>"`；
- `SourcePaneId` 对 `File` 必填（与 `Files` 相同）；
- 复用现有 `preview_url`、`NavigatePayload`、`close_preview_window`、`handle_preview_window_event`；
- `src-tauri/capabilities/preview.json` 已覆盖 `preview-*`，无需新增权限。

入口 URL：

```text
preview.html?kind=file&windowLabel=preview-file-<pane>&sourcePaneId=<pane>&path=<rel>
```

---

## 6. 前端设计

### 6.1 `FileViewer.vue`

新增 `frontend/src/components/preview/FileViewer.vue`，只读、自包含：

- Props：`sourcePaneId`、`path`（工作区相对路径）、可选 `title`；
- Expose：`reload()`；
- 加载：
  - `GET /api/workspace/meta?pane_id=<sourcePaneId>&path=<rel>`；
  - `rawUrl` 构造方式与 `EditorPane.vue` 一致：Tauri 下附 `token`，附 `_t` 防缓存；
  - Office 走 `useOfficePreview`；
  - 音频走 `useAudioPlayer`；
- 渲染 `FilePreviewContent`，传入 `readOnly`、`showSave=false`、`canSaveEditor=false`、`editorDirty=false`；
- 使用单调递增的 load token，避免快速导航时旧响应覆盖新文件。

> 必须使用真实终端 pane id，而不是 `window:files:<id>` 这类合成状态键；`LogPreview`、`IpynbPreview`、`StructuredPreview`、`SpreadsheetPreview` 都依赖它发起后续请求。

### 6.2 只读传播

仅设置 `showSave=false` 不够：内部 Monaco 仍然可编辑。需要：

- `FilePreviewContent.vue` 新增可选 `readOnly`；
- 两个 Monaco 分支：`:readonly="readOnly || !!meta?.truncated"`；
- 透传给 `LogPreview`、`IpynbPreview`、`StructuredPreview`、`SvgPreview`；
- 上述子组件新增可选 `readOnly` 并作用于自己的 Monaco。

#### HTML 沙箱收紧

当前 HTML 预览：

```html
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
```

`allow-same-origin` 会让工作区 HTML 获得 Dinotty 同源权限，可能访问已认证 API。查看器只读模式下改为：

```html
sandbox="allow-scripts"
```

保留脚本是为了图表类 HTML 仍可交互；去掉同源、表单、弹窗权限。

### 6.3 Markdown 渲染

从 `frontend/src/composables/useFileEditor.ts` 抽出：

```ts
renderMarkdownPreview(src, filePath, paneId): Promise<string>
```

复用现有 `getMarked()` → `rewriteImageSrcs()` → `getDOMPurify()` 流程；`useFileEditor` 的 watcher 也改为调用同一函数，保证唯一净化入口。

### 6.4 主窗口投递

- `frontend/src/types/protocol.ts`：增加 `open_file_viewer` 消息类型；
- `frontend/src/composables/useSyncWebSocket.ts`：增加 `onOpenFileViewer(handler)` 注册表并分发；
- `frontend/src/composables/useFileViewerPresenter.ts`：
  - 仅在主窗口注册；
  - Tauri：`tauriInvoke('open_preview_window', { kind: 'file', sourcePaneId, path, title })`；
  - 调用失败回退到全屏浮层；
  - Web / 移动端：直接打开浮层；
  - 不读取 `settings.preview_open_modes`——查看器始终是桌面原生窗口 / Web 浮层；
- `frontend/src/stores/fileViewerStore.ts`：保存当前浮层请求；
- `frontend/src/components/preview/FileViewerOverlay.vue`：
  - `Teleport` 到 body，`100dvh`，标题栏 + 关闭；
  - `Esc` 关闭，焦点管理，安全区；
  - 使用 `request_id` 作为 `key`；
- `frontend/src/App.vue`：调用 presenter，并以 `defineAsyncComponent` 懒加载浮层（避免 Monaco 进入首屏 chunk）。

游离终端窗口不注册 presenter，因此收到消息后忽略；预览窗口本身不连接 sync WebSocket。

### 6.5 原生窗口壳

`frontend/src/PreviewWindowApp.vue`：

- 解析 `kind=file`；
- 渲染 `<FileViewer :source-pane-id="sourcePaneId" :path="filePath" />`；
- 处理 `preview-window-navigate`，更新路径并重新加载；
- `kind=file` 时**不安装** `usePreviewWindowDock`，不显示 dock 提示；
- `frontend/src/composables/previewWindowBridge.ts` 的 kind 类型补充 `file`。

### 6.6 状态与边界

| 状态 | 表现 |
| --- | --- |
| 加载中 | 居中 loading |
| 文件不存在 / 已被删除 | 错误占位 + 刷新按钮 |
| 不支持类型 | `filePreview.unsupported` 文案 |
| 文本截断 | 显示“已截断”提示（复用现有 meta 字段） |
| 窗口关闭后再次打开 | 重新创建窗口并加载最新内容 |
| 同一 pane 连续打开 | 聚焦已有窗口并导航到新文件 |

---

## 7. 安全设计

| 边界 | 措施 |
| --- | --- |
| 路径逃逸 | `normalize_join` 拒绝 `..`；canonicalize 后 `path_must_be_under`；符号链接同样被拦截 |
| Agent Token 越权 | `workspace:read` + `check_path_scope`；非全局 Token 额外限制在 home 下 |
| 读取时二次校验 | `meta` / `raw` 自身仍执行工作区 jail，触发时校验与读取时校验一致 |
| HTML 注入 | Markdown 继续走 DOMPurify；只读 HTML 预览去掉 `allow-same-origin` |
| 外链 | 查看器中非锚点链接禁止在窗口内导航，交给系统浏览器（`noopener`） |
| 资源耗尽 | 触发时拒绝大于 500 MiB 的文件；文本预览保持 512 KiB 截断 |
| 窗口滥用 | 每个 pane 固定 label，重复打开只聚焦/导航，不无限创建窗口 |
| 多端干扰 | 广播给所有主界面客户端；Web 端每个打开的客户端都会显示浮层，属可接受行为 |

### 7.1 投递语义

`delivered_clients > 0` 只表示消息已发送给至少一个主界面客户端。窗口是否成功创建、文件是否成功读取，需要用户侧可见性验证；这一点在文档和工具描述中明确。

---

## 8. 兼容性与边界

- **工作区根跟随 pane 当前 cwd**：Agent 在 shell 中 `cd` 后，相对路径的解析基准会变化。与现有 `/api/workspace/*` 行为一致。
- **SSH pane**：第一版返回 `SSH_UNSUPPORTED`。远程 `remote_meta` / `remote_raw` 已存在，后续只需补远程路径解析与 scope 校验。
- **工作区外路径**：第一版不支持。若未来需要展示 `/tmp` 等 Agent 生成文件，可增加显式 `allow_outside_workspace`（仅全局 Token）并新增自由读取通道。
- **多客户端**：所有连接的主界面客户端都会收到消息。若需要“只给发起者的桌面看”，后续增加 `target_client_id` 或按 pane 绑定客户端。
- **应用在托盘**：主窗口 WebSocket 仍保持连接；`focus_window()` 会 show / unminimize / 聚焦新窗口。
- **窗口恢复**：与现有 preview 窗口一致，不跨应用重启恢复。
- **Windows 路径**：绝对路径判定需覆盖盘符与 UNC；canonicalize 后再做前缀比较。
- **不参与 dock**：把查看器窗口拖到 tab 栏不会合并；这是产品选择，不是遗漏。

---

## 9. 测试与验收

### 9.1 Rust

| 模块 | 用例 |
| --- | --- |
| `src-tauri/src/preview_windows.rs` | `file` kind 解析/slug；`file_label` 确定性、与 `preview-files-*` 不同、拒绝非法 id；URL 含 `kind=file` |
| `src/workspace/viewer_tests.rs` | 相对路径、绝对路径（工作区内）、Unicode/空格；`..`、工作区外、符号链接逃逸、目录、缺失、超大、未知 pane、SSH |
| `src/session/tests.rs` | `OpenFileViewer` 序列化；按 Main 角色投递、游离窗口不计数、关闭客户端被清理 |
| `src/mcp/tools_tests.rs` | 缺少 `workspace:read` 被拒；scope 外被拒；scope 内且有主界面时返回 `delivered_clients: 1` |
| 路由 | `router_parity.rs` 通过 |

### 9.2 前端（Vitest）

| 文件 | 用例 |
| --- | --- |
| `FileViewer.test.ts` | 使用真实 pane id 请求 meta/raw；只读 props；Markdown 净化；reload 与路径变化 |
| `PreviewWindowApp.test.ts` | `kind=file` 渲染查看器；navigate 更新路径；不安装 dock |
| `useFileViewerPresenter.test.ts` | Tauri invoke 参数；失败回退浮层；Web 直接浮层；卸载时取消订阅 |
| `FilePreviewContent.readonly.test.ts` | Monaco 只读传播；HTML sandbox 字符串 |
| sync dispatch | `open_file_viewer` 触发注册的 handler |

### 9.3 手工 E2E

```bash
# 1. 在 Dinotty 终端 pane 中读取
echo "$DINOTTY_URL $DINOTTY_PANE_ID"

# 2. HTTP 触发（需要全局或 agent token）
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"README.md"}'

# 3. 再打开另一张图片，验证同一个窗口聚焦并导航
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"docs/logo.png"}'
```

验收点：

1. 桌面端出现无目录树的原生窗口，标题为文件名。
2. Markdown 正确渲染，相对图片可加载。
3. 图片可缩放/平移，PDF/视频可播放。
4. 重复打开同一 pane 不会创建第二个窗口。
5. Web 端出现全屏浮层，`Esc` 可关闭。
6. 负例路径返回对应错误码，不打开窗口。
7. 文本、SVG、ipynb、结构化文件不可编辑，无保存按钮。
8. HTML 预览脚本无法访问父页面同源 API。

---

## 10. 实施拆分

| 顺序 | 提交内容 | 主要文件 |
| --- | --- | --- |
| 1 | Sync 基础设施：`OpenFileViewer`、客户端角色、计数广播、WS role 参数 | `src/session/types.rs`、`manager.rs`、`src/ws/sync.rs`、`useSyncWebSocket.ts` |
| 2 | 查看器后端服务：路径解析、投递、错误映射 | `src/workspace/viewer.rs`、`workspace/mod.rs` |
| 3 | HTTP 路由、中间件放行、双路由表 | `src/main.rs`、`embedded_server/router.rs`、`auth/mod.rs` |
| 4 | MCP 工具与能力映射 | `src/mcp/tools.rs`、`src/mcp/server.rs` |
| 5 | Tauri 窗口 kind | `src-tauri/src/preview_windows.rs` |
| 6 | 查看器 UI、Markdown 复用、只读传播、HTML 沙箱 | `FileViewer.vue`、`FilePreviewContent.vue`、子预览组件、`useFileEditor.ts` |
| 7 | 主窗口投递、浮层、Tauri 窗口壳 | `useFileViewerPresenter.ts`、`fileViewerStore.ts`、`FileViewerOverlay.vue`、`PreviewWindowApp.vue`、`App.vue` |
| 8 | i18n、文档、手工 E2E | 语言包、`docs/*/api/mcp-server.md`、本文档 |

代码约束：单文件不超过 1000 行；新增 `FileViewer.vue` 与 `viewer.rs` 预计各 250–350 行。

---

## 11. 风险与后续

| 风险 | 说明 | 后续 |
| --- | --- | --- |
| 异步投递 | 返回成功不代表窗口已渲染 | 增加 ACK / 渲染回执 |
| 多客户端广播 | 所有主界面客户端都会弹查看器 | 增加 `target_client_id` |
| 工作区根漂移 | pane `cd` 后相对路径基准变化 | 与现有 API 一致，文档说明；可增加“锁定根”参数 |
| SSH 未支持 | 远程 pane 返回明确错误 | 复用 `remote_resolve` / `remote_meta` / `remote_raw` |
| 工作区外文件 | Agent 生成的 `/tmp` 文件无法展示 | 增加受控的 `allow_outside_workspace` |
| 停靠 | 查看器不参与 dock | 若产品需要，再扩展 `PreviewDockRequest` |
| 多文件 | 一次只能展示一个文件 | 后续可加“文档集”窗口或上一页/下一页 |

---

## 12. 相关文件索引

| 领域 | 文件 |
| --- | --- |
| 窗口注册与创建 | `src-tauri/src/preview_windows.rs`、`src-tauri/src/window_host.rs` |
| 窗口入口 | `frontend/preview.html`、`frontend/src/preview.ts`、`frontend/src/PreviewWindowApp.vue` |
| 文件预览渲染 | `frontend/src/components/workspace/FilePreviewContent.vue`、`EditorPane.vue` |
| 工作区 API | `src/workspace/handlers.rs`、`src/workspace/util.rs` |
| Sync 协议 | `src/session/types.rs`、`src/ws/sync.rs`、`frontend/src/composables/useSyncWebSocket.ts` |
| MCP | `src/mcp/tools.rs`、`src/mcp/server.rs` |
| 路由与鉴权 | `src/main.rs`、`src-tauri/src/embedded_server/router.rs`、`src/auth/mod.rs`、`src/token.rs` |
| 现有设计参考 | `docs/zh/internals/detached-terminal-window.md`、`docs/en/internals/float-previews.md` |

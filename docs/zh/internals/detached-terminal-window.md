# 游离终端窗口设计

> 状态：设计稿，未开工  
> 更新时间：2026-11-02  
> 范围：桌面端（macOS / Windows / Linux）  
> 英文名：Detached Terminal Window

## 1. 背景与目标

Dinotty 的终端 tab 目前只能存在于主窗口中。随着多 tab、分屏、SSH 和 Agent 长任务增多，主窗口会变得拥挤，也不利于多显示器或“一个终端常驻可见”的工作方式。

本设计引入**游离终端窗口**：

- 把一个 tab 从主窗口“游离”到一个独立原生窗口；
- 窗口仍然只是同一个 tab 的另一个视图，PTY、layout、工作区归属都不变；
- 可以随时收回主窗口；
- 不改变 Dinotty 现有的多端同步模型。

### 目标

1. 桌面端可以把任意终端 tab 打开为独立原生窗口。
2. 独立窗口是**纯终端窗口**：没有顶部 tab 栏、工具栏、状态栏、Mission Control。
3. 一个窗口同一时间只显示一个 tab；该 tab 的完整 layout（含分屏）可用。
4. 关闭窗口 = tab 收回主窗口，不杀会话；显式“关闭终端”才结束 PTY。
5. 主窗口的 Mission Control 能看到游离中的 tab，并能点击聚焦对应窗口。
6. Web、手机、另一台桌面看到的行为保持一致：仍按普通 tab 显示。

### 非目标（本阶段）

- 桌面宠物 / 桌面挂件（已评估，暂缓）。
- 跨原生窗口拖拽（Tauri 自定义 payload DnD 成本高，暂缓）。
- 窗口布局在多端之间同步。
- 游离开启状态跨应用重启恢复。
- files / web / plugin pane 的游离。
- 同一 tab 同时镜像到多个窗口。
- per-client active tab / active workspace 的完整重构。

---

## 2. 命名

| 场景 | 文案 |
| --- | --- |
| 中文产品名 | 游离终端窗口 |
| 英文名 | Detached Terminal Window |
| 动作 | 游离到新窗口 |
| 反向动作 | 收回主窗口 |
| 结束会话 | 关闭终端 |
| 代码标识 | `detached`，带 `Window` 限定 |

不使用 `floating` / `float`：Dinotty 已经用 float 表示应用内的插件浮层（`docs/en/internals/float-previews.md`、`pluginFloatWindows`）。也不要在代码里裸用 `detached` 指代窗口，因为 `SessionStatus::Detached` / `pty_detach` 已经表示 PTY 会话状态。

建议代码命名：

- `DetachedTabWindow`
- `detached_tab_id`
- 窗口 label：`tab-<tab_id>`
- 前端模式：`detached`

---

## 3. 核心模型：全局层 vs 本机展示层

Dinotty 的数据必须分成两层理解：

| 层 | 内容 | 是否跨端同步 |
| --- | --- | --- |
| **全局层** | tab、pane、PTY、layout、workspace 归属、运行状态 | 是，服务端权威 |
| **本机展示层** | 主窗口 / 游离窗口的划分、窗口几何、本客户端当前看哪个 tab | 否，每个客户端独立 |

关键原则：

> **游离窗口是“本机展示层”的状态，不是服务端对象。**

- tab 仍然在服务端的 `SessionManager` 中，id 不变；
- 不新建 PTY，不改变 pane id；
- 不在服务端增加 `detached` 标记；
- 不因为某台桌面游离了 tab，就从 Web/手机/另一台桌面隐藏它；
- 窗口关闭或桌面崩溃，不应该让 tab 在其他端消失。

这也意味着：

- Web / 手机没有“游离窗口”概念，只看到普通 tab；
- 另一台桌面照常在自己的主窗口显示该 tab；
- 只有发起游离的那台桌面，主窗口 tab 栏会隐藏它、Mission Control 会显示“游离中”标识。

---

## 4. 工作区归属

### 4.1 窗口没有独立工作区

一个游离窗口 = 一个 tab = 一个工作区。窗口跟随 tab 的有效工作区，不持有自己的 workspace 状态。

有效工作区解析顺序（沿用现有规则，见 `frontend/src/composables/useWorkspaces.ts:147-184`）：

1. 显式 `tab.workspaceId`；
2. SSH tab 按 `connectionId` 对应的工作区；
3. 本地 tab 按 cwd 最长路径前缀匹配；
4. 都没有则归默认工作区。

### 4.2 默认工作区兜底

Dinotty 没有真正的“无工作区”UI 状态，只有默认工作区 `__default__`（`useWorkspaces.ts:63-75`）。

- 默认工作区永远存在，名称来自设置或 i18n，路径可选；
- 不匹配任何工作区的 tab 在默认视图中显示（`useAppCore.ts:312-336`）；
- **不新增“未分配”第三种分组**；
- Mission Control、手机端、游离窗口都统一把这类 tab 放在默认分区；
- 移动端在具体工作区中看不到这些 tab，切到默认工作区即可看到，这是现有行为。

### 4.3 移动到其他工作区

“移动到工作区”是**全局变更**，不是窗口本机状态。

当前本地 tab 的工作区归属主要靠 cwd 前缀匹配；服务端 `TabInfo.workspace_id` 基本只在 SSH tab 上有值（`src/session/manager.rs:749-761`）。因此这个能力有一个前置条件：

- 为 tab 增加显式 workspace 归属（tab layout 字段或独立端点，例如 `PUT /api/tabs/:id/workspace`）；
- 前端优先使用显式归属，其次才是 connection/cwd 匹配；
- 所有端都能一致看到移动结果，刷新/重启后不丢。

在补上显式归属之前，“移动到其他工作区”只能是前端本地覆盖，跨端和刷新后不一致，不建议发布。

---

## 5. 窗口架构（Rust / Tauri）

### 5.1 窗口类型与 registry

主窗口仍然是 `main`。游离窗口使用独立 label：

```text
tab-<tab_id>
```

Rust 侧维护 registry，用于去重、聚焦和清理：

```rust
struct DetachedTabWindows {
    // label <-> tab_id 双向映射
}
```

需要提供的最小命令：

| 命令 | 作用 |
| --- | --- |
| `open_tab_window(tab_id, title)` | 创建或聚焦该 tab 的游离窗口 |
| `focus_tab_window(tab_id)` | show / unminimize / set_focus |
| `list_detached_tab_windows()` | 主窗口重载后恢复“哪些 tab 已游离” |
| `close_tab_window(tab_id)` | 可选：程序化收回 |

创建时：

- 使用 `WebviewWindowBuilder`（可参考 `src-tauri/src/window_actions.rs:120-172` 的主窗口创建模式）；
- URL：`WebviewUrl::App("detached.html?tabId=<tab_id>".into())`，dev/prod 都可用；
- 原生标题栏、正常最小尺寸、不可用 `dragDropEnabled`（保持 false，避免破坏现有 HTML5 拖拽，`src-tauri/tauri.conf.json:22`）；
- 同一 tab 已有窗口时只聚焦，不重复创建；
- 窗口关闭时从 registry 移除，并向主窗口发 `tab-window-closed`。

### 5.2 Capability

现有 capability 只覆盖 `main`（`src-tauri/capabilities/default.json:4`），新 label 默认没有任何权限。需要新增一个 capability，例如：

```json
{
  "identifier": "detached-window",
  "windows": ["tab-*"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-unminimize",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "shell:allow-open"
  ]
}
```

说明：

- 窗口由 Rust 命令创建，不需要给 `main` 授予 `core:window:allow-create`；
- 终端复制/粘贴和链接打开仍需要 clipboard / shell 权限；
- 不要授予 `global-shortcut`，游离窗口不注册全局快捷键；
- 如果将来在游离窗口里嵌入远程页面，该 webview 应使用零 capability（参考 Dojo Edge 的做法）。

### 5.3 关闭、聚焦与生命周期

- **主窗口**保持现有“隐藏到托盘 / 退出 / 取消”流程；
- **游离窗口**的 `CloseRequested` 不再走主窗口退出对话框，而是：
  1. 从 registry 移除；
  2. 向 `main` 发 `tab-window-closed { tab_id }`；
  3. 允许窗口关闭；
- 关闭窗口 = tab 收回主窗口，**不杀 PTY**；
- 显式“关闭终端”才调用关闭 tab 的 API，结束会话；
- `focus_tab_window` 要处理最小化、隐藏、另一个 Space、macOS app 未激活等情况；
- 如果 registry 里没有该窗口（崩溃/已关闭），返回明确错误，让前端做兜底。

当前 `src-tauri/src/main.rs:821-829` 对所有窗口的 `CloseRequested` 都执行主窗口关闭流程；这是必须修改的点。`shutdown.rs` 仍只协调主窗口，游离窗口随应用退出即可。

Tray、全局快捷键、单实例行为保持以主窗口为目标；第二次启动 Dinotty 时仍唤回主窗口，不主动重建游离窗口。

### 5.4 服务端绑定

游离窗口必须固定它打开时的：

```text
(server_id, tab_id)
```

不跟随主窗口切换活跃服务器。否则同一个窗口会突然指向另一台 server 上同名的 tab id。

- 主窗口切 server 时，已有游离窗口保持原 server；
- 收回主窗口时，如果主窗口当前不在该 server，先切回，或提示“该 tab 属于 server X”；
- Web/手机只可能看到它们所连 server 上的 tab，不存在跨 server 的同一窗口。

---

## 6. 前端架构

### 6.1 独立入口优先

建议使用独立的 Vite 入口：

```text
frontend/detached.html
frontend/src/DetachedApp.vue
```

而不是在 `App.vue` 里加大量 `if (detached)` 分支。

原因：`App.vue` 的 setup 会带起通知面板、命令面板、Mission Control、插件 host、移动端键盘、全局快捷键等整套单例；用 flag 屏蔽容易漏，且会让“纯终端窗口”变成第二个工作台。

独立入口只加载：

- 认证 / apiBase / settings / theme；
- session store；
- 同步 WebSocket（用于 tab/layout/rename/close）；
- 终端组件（含搜索、分屏）；
- 窗口级 keymap 和右键菜单。

公共 bootstrap 抽成 composable，与主窗口共用。

### 6.2 单 tab 模式

- 启动时读取 `?tabId=<id>`；
- 只渲染该 tab 的 `SplitContainer`；
- 不渲染 TabBar、StatusBar、NotificationPanel、CommandPalette、SettingsPanel、Mission Control、PluginFloatWindowHost、移动端键盘；
- 不写 `dinotty_tabs` 持久化（`useTabPersistence.ts:22-48` 的 key 是主窗口共用的）；
- 不响应 `tab_activated` / `workspace_activated`（`useSyncWebSocket.ts:539-553`、`:677-708`）；
- 不调用 `apiActivatePane`，避免抢主窗口的全局 active；
- 窗口标题跟随 tab 标题；未读/铃铛用标题前缀或系统 badge 表示。

### 6.3 传输：强制 WebSocket

游离窗口应显式使用 `WebSocketTransport`，不要走 `TauriIpcTransport`：

- `TauriIpcTransport` 依赖每个 session 唯一的 `tauri_client_id`（`src/session/mod.rs:111`）；
- `pty_spawn` 会替换旧的 Tauri forwarder（`src-tauri/src/main.rs:285-296`）；
- 多个原生窗口同时 attach 同一个 pane 时，单 owner 模型会互相踢掉。

WebSocket 路径本来就是多客户端设计：

- 每个连接独立 `ClientEndpoint`，输出 fan-out（`src/session/mod.rs:627-663`）；
- 重连时服务端发送 snapshot + scrollback（`src/ws/terminal.rs:103-282`）；
- 本地 WS 有 loopback 认证路径，远程走 relay。

`createTransport`（`frontend/src/composables/useTransport.ts:302-307`）需要增加显式的 `forceWebSocket` 选项，或在 detached 模式下覆盖选择。

同时注意：多个客户端看同一个 pane 时，resize 仍是“最后一次 resize 生效”，输入/输出共享。这是 Dinotty 现有行为，不是游离窗口引入的新问题。

### 6.4 主窗口的过滤

主窗口需要维护 `detachedTabIds`（来自 Rust registry + `tab-window-closed` 事件），并：

- 从 TabBar 的 `visibleTabList` 中过滤；
- 从内容区渲染循环中过滤（`App.vue:162-211` 当前遍历的是全部 `tabs`，不是 `visibleTabList`）；
- 保留 session store 中的 tab，便于 MC、工作区计数和收回；
- 不渲染对应 `TerminalPane`，避免双 attach；
- 主窗口重载后调用 `list_detached_tab_windows()` 恢复状态。

### 6.5 快捷键与右键菜单

游离窗口只加载终端需要的子集：

- 复制 / 粘贴；
- 终端内搜索；
- 字号；
- 分屏；
- 关闭窗口（收回主窗口）；
- 关闭终端（kill PTY，二次确认）。

不要复用主窗口整套 keymap（命令面板、workspace 切换、Mission Control、新建 tab 等）。

右键菜单建议：

- 收回主窗口；
- 重命名；
- 搜索；
- 新建终端窗口；
- 关闭终端；
- 复制 / 粘贴（终端自身菜单）。

---

## 7. 游离 / 收回流程

### 7.1 游离

1. 用户在 tab 右键菜单或 MC 中选择“游离到新窗口”。
2. 主窗口调用 `open_tab_window(tab_id, title)`。
3. Rust 创建或聚焦 `tab-<id>` 窗口。
4. 主窗口把 tab 加入 `detachedTabIds`，并从渲染树卸载对应 `TerminalPane`。
5. 游离窗口加载 `detached.html?tabId=<id>`，等待 apiBase/auth 就绪。
6. 游离窗口通过 REST/sync 获取 tab，挂载终端，使用 WebSocket attach。
7. 服务端执行 resize + snapshot 回放，终端内容恢复。
8. 主窗口本地选择相邻 tab 作为显示项；**不调用 `apiActivatePane`**。

顺序很重要：主窗口必须先卸载，游离窗口再 attach，否则会出现双 attach / resize 互抢。

### 7.2 收回

1. 用户关闭游离窗口，或右键选择“收回主窗口”。
2. 游离窗口卸载终端，WebSocket 断开。
3. Rust 从 registry 移除，向主窗口发 `tab-window-closed`。
4. 主窗口从 `detachedTabIds` 移除，重新挂载该 tab。
5. 主窗口本地激活或聚焦该 tab；是否切换 workspace 按下面规则处理。

### 7.3 收回后的工作区

- tab 仍属于它自己的有效工作区；
- 没有工作区归属的 tab 回到默认工作区；
- 如果主窗口当前停在别的具体工作区，建议给出“已收回默认/工作区 X”的提示，允许一键切换，不要静默消失；
- 收回不重启 PTY，内容通过 snapshot 恢复。

---

## 8. 分屏

### 8.1 基本决定

游离的单位是 **tab**，而 tab 可以是分屏。因此：

- 必须正确渲染已有分屏，否则会静默丢失 pane；
- v1 支持基本分屏操作，避免游离窗口变成“只能看不能调”的死胡同。

### 8.2 v1 支持范围

| 能力 | 是否支持 |
| --- | --- |
| 渲染整个 tab layout（含分屏） | 支持 |
| 分屏时显示 `PaneHeader` | 支持 |
| 点击聚焦、分隔条 resize | 支持 |
| 关闭 pane | 支持 |
| 在游离窗口里继续分屏 | 支持（复用 `useSplitPane`） |
| pane 拖到 tab 栏 / extract 成新 tab / merge 到其他 tab | 不支持（主窗口手势） |
| files / web / plugin pane | 不支持（v1 只支持 terminal / SSH leaf） |

单 pane 的 tab 仍然完全没有任何 header，是纯终端；只有分屏时才出现 per-pane header。`PaneHeader` 是 pane 的一部分，不是全局工具栏。

### 8.3 边界

- **broadcast 必须可见**：tab 开启输入广播时，游离窗口要在标题或右键菜单里显示“广播中”，否则用户会在不知情的情况下向多个 pane 发送输入。
- 关闭最后一个 pane → tab 被关闭 → 游离窗口同步关闭。
- 在游离窗口里新建 tab → 开一个新的游离窗口，不回到主窗口。
- pane 聚焦只更新该 tab 的 layout / active pane，不调用 `apiActivatePane`。
- `syncTabLayout` 继续走全局同步，Web/其他端能看到分屏和 layout 变化。
- 含 files / web / plugin leaf 的混合 tab v1 不允许游离；需要先 extract 出终端 pane。

---

## 9. Mission Control 集成

### 9.1 卡片标识

`TabCard` 增加：

```ts
detached: boolean
windowLabel?: string
```

游离卡片显示：

- 窗口图标 + “游离中”小胶囊；
- `aria-label` 明确说明，不能只靠颜色；
- 多窗口时 tooltip 显示窗口标题；
- 保留 tab 的实际工作区归属（无归属进默认分区）。

### 9.2 点击行为

在 `useOverviewCallbacks.ts:90-97` 的 `onOverviewActivate` 中分支：

- 普通 tab → 保持现有 `activateTab` + `termRefs` focus；
- 游离 tab → 调用 `focus_tab_window(tab_id)`（show / unminimize / set_focus），关闭 MC；**不要**调用 `activateTab`，也不要找 `termRefs`。

失败兜底：

- registry 里没有该窗口 → 刷新 `list_detached_tab_windows()`，按普通 tab 激活/收回，并提示；
- 窗口在另一台显示器或另一个 Space → 正常聚焦，不额外提示。

### 9.3 上下文菜单

- 聚焦窗口；
- 收回主窗口；
- 关闭终端（确认后结束 PTY）。

卡片上的关闭按钮如果沿用现有 `close-tab`，会全局关闭 tab，游离窗口随后收到 `tab_closed` 自行关闭；保留该行为即可，但要二次确认。

### 9.4 预览

MC 的预览目前依赖主窗口的 `termRefs` 抓 xterm buffer（`frontend/src/composables/useTabPreview.ts:166-202`）。游离 tab 不在主窗口挂载，因此抓不到内容。

v1 建议：

- 卡片显示占位：“已在游离窗口中打开”；
- 或显示游离前缓存的最后一帧（灰显）；
- **不要**为了预览在 MC 里再挂一个 `TerminalPane`，否则会变成第二个终端客户端。

### 9.5 计数与其他端

- 游离 tab 仍计入所属工作区的 tab 数量，包括默认分区；
- 手机、Web、另一台桌面看到的仍是普通卡片，没有“游离中”标识；
- 可选在主窗口状态栏显示“游离窗口 (N)”，点击打开 MC 或聚焦最近一个游离窗口。

---

## 10. 多端同步语义

| 端 | 表现 |
| --- | --- |
| 发起游离的桌面主窗口 | tab 从 tab 栏/内容区隐藏，只在该游离窗口 |
| 同一台桌面再次打开 | 聚焦已有窗口，不重复创建 |
| 另一台桌面 | 主窗口照常显示该 tab，不受影响 |
| Web / 手机 | 按普通 tab 显示，可查看、输入、关闭 |
| MC（发起端桌面） | 显示“游离中”卡片，点击聚焦窗口 |

规则：

- 重命名、layout、workspace 变更、tab 关闭照常通过 `/ws/sync` 同步；
- 任意端关闭该 tab → 游离窗口收到 `tab_closed`，关闭/提示；
- 其他端激活该 tab → 游离窗口忽略 `tab_activated`；
- Web 与游离窗口同时看同一个 tab 是现有“多客户端”关系，输入/输出共享，resize 最后写入者生效；
- 不要把“窗口”做成同步对象；后续如果要做“该 tab 正在某台桌面游离”的提示，只能是临时的 presence，断线即清除，且不能阻止其他端访问。

### Active tab / active workspace 的现状

服务端目前只有全局 `active_pane_id` 和 active workspace。多窗口会放大这个限制。

v1 约定：

- 游离窗口忽略 `tab_activated` / `workspace_activated`；
- 主窗口 detach 当前 active tab 时，不调用 `apiActivatePane`，只做本地选择；
- 主窗口与 Web 可能短暂不一致，这是可接受的 v1 行为；
- 真正的 per-client active 是独立架构项，不在本设计内。

---

## 11. 持久化

- tab 快照仍由服务端全局保存（`src/session/snapshot.rs:26-64`、`restore.rs:27-49`）；
- 游离窗口列表、窗口位置、窗口与 tab 的对应关系：只存本机（localStorage 或本地配置），不上传、不同步；
- v1 不恢复游离窗口：应用重启后所有 tab 回到主窗口，Web 无感；
- 后续如果恢复，也只在本机恢复，不影响其他端；
- 窗口几何可参考 `tauri-plugin-window-state` 或应用内浮窗的本地持久化模式（`dinotty:floating-win:<id>`）。

---

## 12. 边界与异常

| 场景 | 行为 |
| --- | --- |
| tab 在其他端被关闭 | 游离窗口收到 `tab_closed`，关闭或显示已关闭 |
| PTY 退出 | 沿用现有 session exit UI，不自动销毁窗口 |
| 主窗口隐藏到托盘 | 游离窗口继续运行 |
| 应用退出 | 所有窗口关闭，服务端快照落盘 |
| 游离窗口崩溃/刷新 | 可从 registry 重建，重新 attach + snapshot |
| registry 与窗口不一致 | 以实际窗口存在性为准，刷新 registry 并兜底 |
| 主窗口切换 server | 游离窗口固定原 `(server_id, tab_id)` |
| 远程 server 离线 | 终端显示连接状态，窗口保留 |
| 工作区被删除 | tab 回到默认/未归属，窗口保持打开，提示归属变化 |
| SSH 认证提示 | 需要决定在游离窗口内显示认证对话框，还是转交主窗口；v1 必须在实现前明确 |
| 通知/铃铛 | 游离窗口用标题/badge 提示；避免与主窗口通知面板重复 |
| 多次点击游离 | 聚焦已有窗口，不创建第二个 |
| 分屏含非终端 leaf | v1 不允许游离 |
| 输入广播开启 | 标题/菜单显示“广播中” |

---

## 13. 已评估但暂缓

### 13.1 跨窗口拖拽合并

- Tauri 没有跨 webview 的自定义 payload DnD；
- 现有 tab/pane 拖拽是 DOM pointer 逻辑，无法跨原生窗口；
- 原生拖拽需要 macOS NSPasteboard / Windows OLE / Linux XDND，每平台单独实现；
- 开关 `dragDropEnabled` 会影响现有 HTML5 拖拽（当前保持 false）；
- v1 用“收回主窗口 / 移动到工作区”菜单 + MC 完成，拖拽作为后续 macOS-only 实验。

### 13.2 桌面宠物

- 评估结论：非必要，暂缓；先做游离终端窗口；
- 现成参考是 Dojo Edge 的 macOS NSPanel（透明、置顶、不抢焦点）；
- 成本主要在 macOS 专属窗口行为、美术资产和长期真机维护；
- 现有托盘、铃铛、系统通知、Mission Control 已覆盖大部分“环境感知”需求；
- 如后续重启，建议先做轻量状态胶囊，不直接做完整宠物动画。

### 13.3 其他

- 同一 tab 镜像到多个窗口；
- 窗口布局跨端同步；
- 游离开启状态跨重启恢复；
- 在游离窗口里渲染 files / web / plugin；
- per-client active tab / active workspace；
- 让 Web 远程控制桌面聚焦某个游离窗口。

---

## 14. 实施阶段

### Phase 0：多窗口底座

- Rust 窗口 registry、`tab-*` label、创建/聚焦/列表/关闭命令；
- 新增 detached capability；
- `CloseRequested` 分支、退出/tray/单实例回归；
- 单元测试：registry 去重、关闭清理、label 解析。

### Phase 1：游离窗口

- `detached.html` + `DetachedApp.vue`；
- 共享 bootstrap；
- 单 tab 渲染、强制 WebSocket、sync 屏蔽、持久化屏蔽；
- 主窗口 `detachedTabIds` 过滤与卸载顺序；
- 终端单 pane 可用，分屏可显示。

### Phase 2：收回与 MC

- 关闭窗口收回、右键/快捷键收回；
- MC 卡片“游离中”标识、点击聚焦、上下文菜单；
- 默认工作区兜底与收回提示；
- 显式 workspace 归属（移动到其他工作区的前置）。

### Phase 3：分屏与打磨

- 分屏创建、关闭 pane、resize、广播状态提示；
- SSH 认证提示、通知路由、异常兜底；
- Windows / Linux 真机回归。

### Phase 4：可选

- macOS 原生拖拽实验；
- 本机窗口恢复；
- 临时 presence 提示；
- 桌面宠物（另立设计）。

粗略工作量：Phase 0-2 约 8–13 人日；Phase 3 另加 2–4 人日；跨窗口原生拖拽和宠物不在 v1 估算内。

---

## 15. 验证计划

### Rust

- `window_actions.rs` 现有创建去重测试可复用（`:249-263`）；
- 新增 registry 测试：重复打开、关闭清理、缺失窗口兜底；
- capability 在开发构建中验证：游离窗口能 listen 事件、剪贴板/链接可用；
- 关闭/退出流程测试：主窗口 hide-to-tray、游离窗口关闭不弹主窗口退出框。

### 前端

- detached 模式：忽略 `tab_activated` / `workspace_activated`；
- 不写 `dinotty_tabs`；
- `createTransport` 强制 WS；
- 主窗口过滤：tab 栏、内容区、MC 计数、`termRefs`；
- MC `onOverviewActivate` 分支：游离 → focus，普通 → activate；
- 分屏 layout/resize/close 的组件测试。

### 手工端到端

1. 游离一个终端 tab，输入/resize/搜索正常。
2. 关闭游离窗口 → tab 回主窗口，PTY 未中断。
3. 显式“关闭终端” → 会话结束。
4. MC 显示“游离中”，点击聚焦窗口，不重复激活。
5. Web/手机看到普通 tab，可输入、可关闭。
6. 任意端关闭 tab → 游离窗口关闭。
7. 分屏 tab 游离后，分屏、resize、关闭 pane 正常；广播提示可见。
8. 主窗口隐藏到托盘后，游离窗口继续工作。
9. 主窗口切换 server，游离窗口仍指向原 server。
10. 应用重启后所有 tab 回主窗口（v1）。
11. 重复点击游离 → 聚焦已有窗口。
12. 回归现有 tab/pane 拖拽、文件拖入、MC 预览、通知。

---

## 16. 待拍板 / 实现前确认

| 问题 | 建议 |
| --- | --- |
| detach 当前 active tab 时是否全局激活邻居 | v1 不建议，只做本地选择 |
| 关闭游离窗口是收回还是杀会话 | 收回；kill 走显式“关闭终端” |
| 显式 workspace 归属的 API 形态 | tab layout 字段或 `PUT /api/tabs/:id/workspace` |
| SSH 认证提示在游离窗口还是主窗口 | 实现前定；建议游离窗口内复用认证对话框 |
| 通知/铃铛在哪个窗口展示 | 游离窗口标题/badge，避免与主窗口重复 |
| MC 预览占位还是缓存最后一帧 | v1 先用占位，缓存帧作为增强 |
| 是否跨重启恢复游离窗口 | v1 不做 |
| Windows/Linux 是否与 macOS 同步上线 | 窗口逻辑跨平台，按真机回归结果决定 |

---

## 17. 关键代码位置

| 模块 | 位置 |
| --- | --- |
| Session / tab 权威状态 | `src/session/manager.rs:86-114` |
| 多客户端连接与输出 fan-out | `src/session/mod.rs:103-155`、`:627-663` |
| 终端 WS attach / snapshot | `src/ws/terminal.rs:103-282` |
| Sync WS | `src/ws/sync.rs:115-178` |
| Tab 创建 / extract | `src/tabs/service.rs:27-125`、`src/tabs/handlers/panes.rs:274-398` |
| 快照与恢复 | `src/session/snapshot.rs:26-64`、`restore.rs:27-49` |
| 单窗口配置 | `src-tauri/tauri.conf.json:11-24` |
| Capability | `src-tauri/capabilities/default.json:4-16` |
| 主窗口创建/显示 | `src-tauri/src/window_actions.rs:113-208` |
| Tauri IPC / forwarder | `src-tauri/src/main.rs:130-169`、`:285-360` |
| 关闭/单实例/后台 | `src-tauri/src/main.rs:711-736`、`:821-829` |
| 退出协调 | `src-tauri/src/shutdown.rs:97-114` |
| 前端入口 | `frontend/src/main.ts:36-50` |
| 工作台渲染 | `frontend/src/App.vue:162-211` |
| Tab 状态 | `frontend/src/stores/sessionStore.ts:10-19` |
| 传输选择 | `frontend/src/composables/useTransport.ts:302-307` |
| Sync 处理 | `frontend/src/composables/useSyncWebSocket.ts:271-416`、`:539-553` |
| Tab 持久化 | `frontend/src/composables/useTabPersistence.ts:22-48` |
| 工作区解析 | `frontend/src/composables/useWorkspaces.ts:147-205` |
| 默认工作区视图 | `frontend/src/composables/useAppCore.ts:312-336` |
| MC 激活 | `frontend/src/composables/useOverviewCallbacks.ts:90-97` |
| MC 预览抓取 | `frontend/src/composables/useTabPreview.ts:166-202` |
| MC 卡片 | `frontend/src/components/overview/TabOverview.vue`、`WorkspaceTabGrid.vue` |
| 移动端 tab 栏 | `frontend/src/components/terminal/TabBar.vue:1-31` |

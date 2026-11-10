# 游离终端窗口设计

> 状态：已实现（Waves 1–3 已合入/在分支验证），第 18 节为实现状态与手工 E2E 清单  
> 更新时间：2026-11-03  
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
2. 独立窗口是**纯终端窗口**：没有顶部 tab 栏、自绘标题栏/工具栏、状态栏、Mission Control；当前 tab 标题与路径由原生标题栏显示。
3. 一个窗口同一时间只显示一个 tab；该 tab 的完整 layout（含分屏）可用。
4. 关闭窗口 = 直接关闭终端；要保留会话则把窗口标题栏拖到主窗口 tab 栏上，或在 Mission Control 中选择“收回主窗口”。
5. 主窗口的 Mission Control 能看到游离中的 tab，并能点击聚焦对应窗口。
6. Web、手机、另一台桌面看到的行为保持一致：仍按普通 tab 显示。

### 非目标（本阶段）

- 桌面宠物 / 桌面挂件（已评估，暂缓）。
- 跨原生窗口拖拽（Tauri 自定义 payload DnD 成本高，暂缓）。
- 窗口布局在多端之间同步。
- 游离开启状态跨应用重启恢复。
- 同一 tab 同时镜像到多个窗口。
- per-client active tab / active workspace 的完整重构。

---

## 2. 命名

| 场景 | 文案 |
| --- | --- |
| 中文产品名 | 游离终端窗口 |
| 英文名 | Detached Terminal Window |
| 动作 | 在新窗口打开 |
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
- 只有发起游离的那台桌面，主窗口 tab 栏会隐藏它、Mission Control 会显示“已在新窗口打开”标识。

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

服务端已提供显式归属端点 `PUT /api/tabs/:id/workspace`（`src/tabs/handlers/tabs.rs`），并把结果通过 `tab_workspace_updated` 广播给所有 sync 客户端：

- 前端优先使用显式归属，其次才是 connection/cwd 匹配；
- 显式写入 `__default__` 表示**固定到默认工作区**；传 `null` 才是清除归属、回退派生匹配；
- 所有端都能一致看到移动结果，刷新/重启后不丢。

收回游离窗口时自动走这条路径，把 tab 归到主窗口当前工作区（见 7.3）。

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
| `close_tab_window(tab_id, reattach)` | `reattach: true` 表示收回主窗口；默认关闭终端 |

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
  2. 向 `main` 发 `tab-window-closed { tab_id, reattach }`；
  3. 允许窗口关闭；
- 关闭窗口默认 = **关闭终端**（`reattach: false`），主窗口调用自己的 tab 关闭流程结束会话；
- 收回主窗口（`reattach: true`）只来自 Mission Control 的“收回主窗口”或把窗口标题栏拖到主窗口 tab 栏上，不杀 PTY；
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

### 6.5 快捷键与菜单

游离窗口不绘制自己的标题栏或工具栏：tab 标题/路径和广播状态写在原生窗口标题里，没有右侧操作按钮。窗口内只保留终端需要的子集：

- 复制 / 粘贴；
- 终端内搜索；
- 字号；
- 分屏。

不要复用主窗口整套 keymap（命令面板、workspace 切换、Mission Control、新建 tab 等）。收回主窗口只通过把窗口标题栏拖到主窗口 tab 栏上，或 Mission Control 的“收回主窗口”完成；关闭原生窗口等于关闭终端。

---

## 7. 游离 / 收回流程

### 7.1 游离

1. 用户在 tab 右键菜单或 MC 中选择“在新窗口打开”，或把 tab 拖出主窗口后松开；分屏时也可以把某个 pane 的 header 拖出主窗口——该 pane 会先被 extract 成新 tab，再在新窗口中打开（源 tab 保留其余 pane）。
2. 主窗口调用 `open_tab_window(tab_id, title)`。
3. Rust 创建或聚焦 `tab-<id>` 窗口。
4. 主窗口把 tab 加入 `detachedTabIds`，并从渲染树卸载对应 `TerminalPane`。
5. 游离窗口加载 `detached.html?tabId=<id>`，等待 apiBase/auth 就绪。
6. 游离窗口通过 REST/sync 获取 tab，挂载终端，使用 WebSocket attach。
7. 服务端执行 resize + snapshot 回放，终端内容恢复。
8. 主窗口本地选择相邻 tab 作为显示项；**不调用 `apiActivatePane`**。

顺序很重要：主窗口必须先卸载，游离窗口再 attach，否则会出现双 attach / resize 互抢。

### 7.2 收回

1. 用户把游离窗口的标题栏拖到主窗口 tab 栏上，或在 Mission Control 选择“收回主窗口”。
2. Rust 以 `reattach: true` 关闭窗口；游离窗口卸载终端，WebSocket 断开。
3. Rust 从 registry 移除，向主窗口发 `tab-window-closed { tab_id, reattach: true }`。
4. 主窗口从 `detachedTabIds` 移除，重新挂载该 tab。
5. 如果 tab 的工作区与主窗口当前工作区不一致，把 tab 改归到主窗口当前工作区，再激活/聚焦（见 7.3）。

> 直接点原生关闭按钮不走进这里：那是 `reattach: false`，主窗口会调用 tab 关闭流程结束会话。

### 7.3 收回后的工作区

收回以“用户正看着的主窗口”为准：

- 主窗口停在具体工作区 X → 收回的 tab 改归 X（`PUT /api/tabs/:id/workspace`，服务端广播 `tab_workspace_updated`）；
- 主窗口在默认工作区 → 显式写入 `__default__`。不能只清空归属，否则 cwd / SSH 派生匹配会把 tab 拉回原工作区；
- 本地先乐观更新归属再发请求，使 tab 在下一帧就能渲染；请求失败则回滚并提示 `tab.recallWorkspaceFailed`；
- 收回不重启 PTY，内容通过 snapshot 恢复。

### 7.4 拖拽反馈

两类跨窗口手势都要有和 pane/tab 拖放一致的“落点提示”：

| 手势 | 主窗口 | 游离窗口 |
| --- | --- | --- |
| tab 拖出主窗口 | 指针离开窗口后显示整窗虚线框 + “松开即在新窗口打开” | — |
| 分屏 pane header 拖出主窗口 | 同上；松开后 pane 先 extract 成新 tab，再打开为新窗口 | — |
| 游离窗口标题栏拖到主窗口 tab 栏 | tab 栏本身高亮 + “松开即在此收回标签页” | 顶部标题栏区高亮 + “松开即收回主窗口” |
| 收回完成 | tab 回到 tab 栏时高亮闪烁一次 | 窗口关闭 |

- 收回的落点是主窗口的 **tab 栏**，不是整个主窗口：只有拖动游离窗口的**原生标题栏**、并让标题栏覆盖 tab 栏（按标题栏面积 ≥50%）才算命中；把窗口主体压在主窗口任意位置不会触发，避免目标过大、过于敏感；
- tab 栏矩形由主窗口按需测量：游离窗口发 `detached-dock-target-request { tab_id, request_id }`，主窗口回 `detached-dock-target { tab_id, request_id, rect }`；矩形用物理屏幕像素返回，兼容 tab 栏在上/下/左/右以及移动端布局；
- 命中后停稳 400ms 才执行收回，避免拖拽路径经过 tab 栏时误触；
- 游离窗口通过 Tauri 事件 `detached-dock-hint { tab_id, active }` 把命中状态告诉主窗口（`core:event:default` 已包含 `emit-to`）；
- 手势只在桌面壳启用：拖出要求 `isTauri() && !isMobile` 且为 terminal tab（`useTabDrag.canDetachTab`）；pane 拖出要求同样的平台条件且只挂在 `PaneHeader` 上（单 pane 没有 header，整 tab 拖出仍走 tab 栏）；收回只存在于原生游离窗口；移动端浏览器 / Web 不会显示提示，也不会误开窗口；
- 尊重 `prefers-reduced-motion`，关闭脉冲/弹出动画。

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
| pane header 拖出窗口 → 新窗口 | 不支持（主窗口手势；在游离窗口内再拆窗口没有意义） |
| files / web / plugin pane | 支持（渲染同一 layout；plugin 由游离窗口加载插件运行时） |

单 pane 的 tab 仍然不显示任何 header；terminal leaf 就是纯终端，只有分屏时才出现 per-pane header。`PaneHeader` 是 pane 的一部分，不是全局工具栏。

### 8.3 边界

- **broadcast 必须可见**：tab 开启输入广播时，原生窗口标题会追加“广播中”，否则用户会在不知情的情况下向多个 pane 发送输入。
- 关闭最后一个 pane → tab 被关闭 → 游离窗口同步关闭。
- 在游离窗口里新建 tab → 开一个新的游离窗口，不回到主窗口。
- pane 聚焦只更新该 tab 的 layout / active pane，不调用 `apiActivatePane`。
- `syncTabLayout` 继续走全局同步，Web/其他端能看到分屏和 layout 变化。
- 含 files / web / plugin leaf 的 tab 可以直接在新窗口打开；没有 terminal leaf 时不建立终端 WebSocket。

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
- v1 已支持**窗口级**命中：把游离窗口的标题栏拖到主窗口 tab 栏上停住即收回（比较标题栏矩形与按需测量的 tab 栏矩形，不传输内容）；反向的“把 tab 拖出主窗口即开新窗口”“把分屏 pane header 拖出主窗口即 extract 后开新窗口”也已支持（鼠标离开窗口/在窗口外松开判定）。内容级跨 webview payload DnD 仍暂缓。

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

- 把窗口标题栏拖到 tab 栏收回、MC 收回；
- MC 卡片“已在新窗口打开”标识、点击聚焦、上下文菜单；
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

1. 游离一个终端 tab（右键或拖出主窗口），输入/resize/搜索正常；窗口内没有自绘标题栏/工具栏。
2. 关闭原生窗口 → 会话结束，主窗口对应 tab 消失。
3. 把游离窗口的标题栏拖到主窗口 tab 栏上 → tab 收回主窗口，PTY 未中断。
4. MC 显示“已在新窗口打开”，点击聚焦窗口，不重复激活；选择“收回主窗口”同样收回。
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
| 关闭游离窗口是收回还是杀会话 | 杀会话；收回走把标题栏拖到 tab 栏或 MC |
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

---

## 18. 实现状态与手工 E2E 清单（2026-11）

### 已实现（Waves 1–3）

- **多窗口底座**：`tab-<tab_id>` 窗口 registry、去重/聚焦/关闭、`detached.html` 独立入口、`detached-window` capability。
- **游离/收回**：主窗口游离入口（右键菜单、把 tab 拖出主窗口、把分屏 pane header 拖出主窗口）与过滤、Mission Control 聚焦游离窗口（Waves 1–2）；收回走 MC 或把窗口标题栏拖到主窗口 tab 栏上。pane 拖出会先 `extract` 成新 tab 再开窗，源 tab 保留其余 pane。
- **单 tab 视图**：单 tab、终端强制 WebSocket、忽略 `tab_activated` / `workspace_activated`、不写 `dinotty_tabs`。
- **非终端 tab**：插件 / 文件浏览 / 网页 leaf 也能在新窗口打开；游离窗口会加载插件运行时与宿主 bridge，纯非终端 tab 不建立终端 WebSocket。
- **分屏**：新建水平/垂直终端分屏、点击聚焦、分隔条 resize、关闭 pane；单 pane 不显示 `PaneHeader`；跨 tab 拖拽/extract/merge 不提供（游离窗口没有 TabBar 落点，相关事件有意不绑定），同 tab 内 pane reorder 保留。
- **广播指示**：`broadcastMode` 且存在多个 pane 时，原生窗口标题追加“广播中”（`split.broadcastActive`）；窗口内不再绘制自绘标题栏。
- **窗口 chrome**：不显示自绘 header/工具栏/右侧按钮；tab 标题与路径由原生标题栏显示；`document.title` 与原生标题同步。
- **链接**：外部 http(s) 链接（含 localhost 预览链接）经 shell 插件用系统浏览器打开；文件链接不加载主窗口的 files pane，仅提示（v1 缺口）。
- **SSH 认证**：复用 sync WS 的 `ssh_auth_prompt` / `ssh_auth_response`，`SshAuthPromptDialog` 在游离窗口内提交/取消。
- **同步与重连**：任意端 `tab_closed` 关闭游离窗口；`tab_renamed`、`layout_updated`、`tab_workspace_updated` 生效；重连时 `tab_list` 会恢复 pane 集合变化，终端内容由终端 WS snapshot 回放。
- **关闭语义**：关闭原生窗口 = 直接关闭终端，不弹确认；收回主窗口走拖拽到主窗口或 MC（`reattach: true`），不杀 PTY；PTY 退出只影响该终端，不销毁窗口。
- **拖拽反馈**：tab 拖出主窗口时整窗虚线框 + “松开即在新窗口打开”；游离窗口的标题栏覆盖主窗口 tab 栏时，主窗口高亮 tab 栏、游离窗口高亮标题栏，停稳 400ms 收回；收回后 tab 回到 tab 栏时高亮闪烁一次（见 7.4）。
- **收回工作区**：收回的 tab 改归主窗口当前工作区；主窗口在默认工作区时显式写入 `__default__`，避免派生匹配把 tab 拉回原工作区（见 7.3）。

### 已知缺口（v1）

- 游离窗口内的文件链接不会打开主窗口的 files pane，仅显示提示；localhost 预览链接改为交给系统浏览器。
- 输入广播状态按窗口本地维护，不跨窗口同步（与现有 `sessionStore` 语义一致）。
- Mission Control 的“游离中”卡片/预览属任务 F，不在本波次；跨重启恢复游离窗口、跨原生窗口拖拽按设计暂缓。

### 手工 E2E 清单（桌面端）

1. **游离**：右键“在新窗口打开”，或把 tab 拖出主窗口后松开；新窗口打开且主窗口 tab 栏隐藏该项。分屏时把某个 pane header 拖出主窗口：该 pane 变成一个新 tab 的独立窗口，源 tab 保留其余 pane 且不中断。
2. **输入/resize/搜索**：游离窗口输入正常、拖动边框改变尺寸后终端重新 fit、Ctrl/Cmd+F 搜索可用，内容通过 snapshot 恢复。
3. **关闭窗口 = 关闭终端**：点击原生关闭按钮后会话结束，主窗口对应 tab 消失，无确认弹窗。
4. **拖到 tab 栏收回**：把游离窗口的标题栏拖到主窗口 tab 栏上，主窗口 tab 栏与游离窗口标题栏出现落点提示；停住后窗口关闭、tab 回主窗口并高亮一次，PTY 未中断。只把窗口主体压在主窗口上不应触发收回。
5. **MC 聚焦/收回**：Mission Control 点击“已在新窗口打开”卡片聚焦已有窗口，不重复激活/创建；“收回主窗口”把 tab 放回主窗口。
7. **Web/手机不受影响**：Web 与手机仍按普通 tab 显示，可输入、可关闭；拖 tab 出窗口不会出现“新窗口打开”提示或开窗；任意端关闭 tab 后游离窗口关闭。
8. **分屏**：在游离窗口新建水平/垂直分屏、点击聚焦、拖分隔条 resize、关闭其中一个 pane；单 pane 时无 pane header；跨 tab 拖拽无落点。
9. **广播指示**：开启广播后原生窗口标题含“广播中”；窗口内无自绘标题栏。
10. **server 切换**：主窗口切换服务器后，游离窗口仍固定原 `(server_id, tab_id)`。
11. **托盘**：主窗口隐藏到托盘后，游离窗口继续工作。
12. **SSH 认证**：SSH tab 游离后触发键盘交互认证，对话框在游离窗口弹出，可提交与取消。
13. **重复打开**：再次点击“在新窗口打开”只聚焦已有窗口，不创建第二个。
14. **非终端 tab**：设备插件 tab、文件浏览器 tab 在新窗口打开后正常渲染与操作。

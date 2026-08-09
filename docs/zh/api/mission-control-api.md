# Mission Control API

Mission Control（MC）是 Dinotty 的多端概览模式：在所有同步客户端上覆盖一个工作区 / Tab 网格，用户可以用键盘方向键导航、Enter 切换、Esc 退出。本页面文档化如何从外部程序（自动化脚本、移动端硬件键盘、桌面端遥控器等）控制 MC。

## 目录

- [设计说明](#设计说明)
- [通道与认证](#通道与认证)
- [客户端消息](#客户端消息)
  - [Toggle](#toggle)
  - [Navigate](#navigate)
  - [Jump](#jump)
  - [Confirm](#confirm)
  - [Cancel](#cancel)
  - [Input（MC 开启时的安全网）](#inputmc-开启时的安全网)
- [服务端消息](#服务端消息)
  - [MissionControlToggled](#missioncontroltoggled)
  - [SelectionChanged](#selectionchanged)
  - [McSnapshot](#mcsnapshot)
- [典型流程](#典型流程)

---

## 设计说明

**MC 没有独立 HTTP 端点。** 所有控制通过 `/ws/sync` WebSocket 发送 `mission_control_op` 消息完成。设计原因：

- MC 是有状态的实时控件（开启 / 关闭 / 当前选中卡片），HTTP 一问一答模型不适合
- MC 操作必须同步到所有已连接客户端（手机、桌面、网页），通过 sync WS 的事件广播天然完成
- MC 与多端同步共享同一个 WS 通道，避免新建一个仅做开关的连接

如果只想从外部"打开 MC 概览"，等同于发送一次 `Toggle` 消息（详见下文）。

---

## 通道与认证

- **WebSocket**：`ws://localhost:8999/ws/sync`
- **认证**：与所有 `/api/*` 一致，通过 query string 携带 token：

  ```
  ws://localhost:8999/ws/sync?token=<global-token>
  ```

  或在浏览器场景下使用 session cookie（同源时无需附加 token）。

- **协议格式**：JSON 文本帧，`type` 字段做 tagged union 区分。

连接建立后，服务端会先发送初始快照 `McSnapshot`，再开始接受客户端消息。

---

## 客户端消息

所有 MC 控制消息的 `type` 都是 `mission_control_op`，通过 `op` 字段区分具体操作。

### Toggle

打开或关闭 MC。再次发送 Toggle 会切到相反状态。

```json
{
  "type": "mission_control_op",
  "op": { "kind": "toggle" }
}
```

**服务侧行为：**

- 打开时：从当前 `active_pane_id` 推导 `selected_tab_id`，让高亮落在用户当前所在的 Tab 上；`selected_workspace_id` 保持上一次的值（首次打开为 `null` = 默认工作区 `__default__`）。
- 关闭时：保留 `selected_*`，下次打开时回到上次位置。

服务端会广播 `MissionControlToggled` 给所有客户端（包括发送方）。

---

### Navigate

移动 MC 内的高亮卡片。仅当 MC 已开启时生效；未开启时静默忽略。

```json
{
  "type": "mission_control_op",
  "op": { "kind": "navigate", "dir": "right" }
}
```

`dir` 取值：

| `dir` | 行为 |
|-------|------|
| `up` / `down` | 在工作区列表中纵向移动（工作区在 MC 左侧堆叠） |
| `left` / `right` | 在当前工作区的 Tab 网格中横向移动 |

跨工作区移动时（up/down）会清空 `selected_tab_id`，因为旧 Tab ID 属于上一个工作区。`left` / `right` 会在当前工作区的 Tab 列表内循环，跳过其他工作区的 Tab，与前端 `filteredCards` 的过滤逻辑一致。

服务端广播 `SelectionChanged`。

---

### Jump

直接跳到指定工作区，跳过 Navigate 的一步步移动。常用于鼠标点击工作区卡片时的单次往返。

```json
{
  "type": "mission_control_op",
  "op": { "kind": "jump", "workspace_id": "ws-xxx" }
}
```

`workspace_id`：

- 字符串 = 已存在的工作区 ID
- `null` = 默认工作区 `__default__`

仅当 MC 已开启时生效。Jump 总是清空 `selected_tab_id`，让高亮回到目标工作区的第一张卡片。

服务端广播 `SelectionChanged`。

---

### Confirm

确认当前选择：把 `selected_tab_id` 解析为对应的 leaf Pane，设为全局 `active_pane_id`，然后关闭 MC。等同于在概览中按 Enter。

```json
{
  "type": "mission_control_op",
  "op": { "kind": "confirm" }
}
```

**服务侧行为：**

1. 若 MC 未开启，no-op
2. 把 `selected_tab_id` 对应 Tab 的首个 leaf `paneId` 设为 active（广播 `TabActivated`）
3. 关闭 MC（广播 `MissionControlToggled`，`open: false`）

如果 `selected_tab_id` 为 `null` 或对应 Tab 已不存在，仍会关闭 MC 但不切换 active pane。

---

### Cancel

关闭 MC，不切换 active pane。等同于按 Esc。

```json
{
  "type": "mission_control_op",
  "op": { "kind": "cancel" }
}
```

仅当 MC 已开启时生效。服务端广播 `MissionControlToggled`，`open: false`。

---

### Input（MC 开启时的安全网）

硬件键盘客户端没有自己的 `/ws/<paneId>` 终端通道，会通过 sync WS 的 `Input` 消息把按键发给服务端，再由服务端转发到 active pane 的 PTY。

```json
{ "type": "input", "data": "ls -la\r" }
```

**安全网**：当 MC 已开启时，服务端会**丢弃**所有 `Input` 消息，避免用户在概览中按方向键时按键被泄漏到终端 PTY。MC 关闭后恢复正常转发。

外部程序想在 MC 开启期间向终端输入，必须显式确认 MC 已关闭，或直接使用 [Open API](./open-api.md) 的 `POST /api/sessions/:pane_id/send` / `POST /api/sessions/:pane_id/input`（这两个端点不受 MC 安全网影响）。

---

## 服务端消息

### MissionControlToggled

MC 开启 / 关闭时广播，包含完整快照。客户端应据此刷新 `open` 字段和选中状态。

```json
{
  "type": "mission_control_toggled",
  "open": true,
  "selected_workspace_id": "ws-xxx",
  "selected_tab_id": "tab-aaa"
}
```

`selected_*` 总是被发送（值为 `null` 表示已清空，区别于"未变化"）。这对于默认工作区很重要：默认工作区编码为 `selected_workspace_id: null`。

---

### SelectionChanged

MC 内高亮卡片移动时广播（Navigate / Jump 触发）。

```json
{
  "type": "selection_changed",
  "selected_workspace_id": "ws-xxx",
  "selected_tab_id": "tab-aaa",
  "tab_title": "dev server"
}
```

`tab_title` 是服务端查表得到的 Tab 标题，便于触屏客户端在不调用 `tab_list` 的情况下直接渲染卡片名。`tab_title` 在没有选中 Tab 时省略（`Option::is_none`）。

---

### McSnapshot

sync WS 连接建立后，服务端先发送 `tab_list` / `workspace_list`，再发送 `McSnapshot` 让客户端初始化 MC 状态。

```json
{
  "type": "mc_snapshot",
  "open": false,
  "selected_workspace_id": null,
  "selected_tab_id": null
}
```

---

## 典型流程

### 程序化打开 Mission Control

```javascript
const ws = new WebSocket("ws://localhost:8999/ws/sync?token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "mission_control_op",
    op: { kind: "toggle" }
  }));
};
// 服务端广播: { type: "mission_control_toggled", open: true, ... }
```

### 用方向键导航后确认

```javascript
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "navigate", dir: "right" } }));
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "navigate", dir: "right" } }));
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "confirm" } }));
// 服务端: SelectionChanged -> SelectionChanged -> TabActivated -> MissionControlToggled(open:false)
```

### 跳到指定工作区后退出

```javascript
ws.send(JSON.stringify({
  type: "mission_control_op",
  op: { kind: "jump", workspace_id: "ws-prod" }
}));
ws.send(JSON.stringify({
  type: "mission_control_op",
  op: { kind: "cancel" }
}));
```

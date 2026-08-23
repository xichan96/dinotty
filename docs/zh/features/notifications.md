# 通知系统

dinotty 内建通知系统，自动检测终端输出中的通知转义序列（OSC 9 / OSC 777 / BEL），并支持自定义通知推送，适用于 AI agent 和自动化工具集成。

## 用户侧

### 通知面板

收到通知时，屏幕右下角弹出 Toast，同时在通知面板（侧边栏铃铛图标）累积历史：

- **Toast**：弹出 5 秒后自动消失；带「跳转」按钮
- **通知面板**：按时间倒序列出所有通知，未读高亮
- **未读计数**：铃铛图标上的徽章数字
- **清除**：通知面板顶部「全部已读」按钮

### 通知类型

| 类型 | 用途 | 视觉 |
|------|------|------|
| `info` | 一般提示 | 灰色 |
| `success` | 任务成功 | 绿色 |
| `warning` | 需要关注 | 黄色 |
| `error` | 出错 | 红色 |
| `urgent` | 紧急（agent 等待输入） | 红色 + 强调 |

### 点击跳转

通知卡片会显示 `工作区名 › tab名 / pane名` 标签，方便识别来源：

- **通知面板点击卡片**：自动切换工作区 -> 打开对应 tab -> 聚焦 pane
- **Toast 点击「跳转」按钮**：同上完整跳转链

跳转需要通知发送方在 API 调用时附带 `pane_id`（见下方 HTTP API）。

## 终端通知自动检测（零配置）

dinotty 会在后端解析每个终端 pane 的输出流，自动识别程序发出的终端通知转义序列并转为通知，**无需任何 hook 或额外配置**：

| 序列 | 格式 | 来源 | 效果 |
|------|------|------|------|
| `OSC 9` | `ESC ] 9 ; <消息> BEL`/`ST` | iTerm2 / Windows Terminal / WezTerm 通知协议 | info 通知，正文为消息 |
| `OSC 777` | `ESC ] 777 ; notifysend ; <标题> ; <正文> BEL` | ConEmu / urxvt / Ghostty 通知协议 | info 通知，带标题 |
| `BEL` | `\a` | 所有终端；agent 的退化路径 | bell 通知 |

特性：

- **覆盖后台 tab**：检测在后端进行。切到其他 tab 或工作区，通知照常弹出，且来源 tab 出现未读标记；通知带 `pane_id`，可点击跳转
- **agent 零配置接入**：Claude Code、Codex CLI、OpenCode 等在任务完成、等待输入时原生发出这些序列，开箱即得通知（无需再配 hook）
- **防刷屏**：同内容通知在去重窗口（默认 2 秒）内只弹一条；二进制输出中的连续 `BEL` 被限流为每 pane 每窗口至多一条
- **不误报**：`OSC 9;4`（任务栏进度）、`OSC 9;9`（工作目录追踪）等 terminal-announce 序列会被忽略

手动验证：

```bash
printf '\e]9;任务完成\a'                # OSC 9 通知
printf '\e]777;notifysend;标题;正文\a'   # OSC 777 通知
printf '\a'                             # bell 通知
```

> **注意弹窗抑制规则**：通知来源 pane 是聚焦 pane 且应用在前台，或开启了「当前标签页不弹窗」（默认开启）时，当前 tab 内的通知不弹 toast（设计行为，避免打扰正盯着看的用户），但通知仍会进入铃铛面板的历史列表。验证 toast 的正确姿势：`sleep 3; printf '\e]9;hello\a'`，3 秒内切到其他 tab。

仓库内的 `scripts/test-osc-notifications.sh` 提供完整的交互式验证脚本。

相关设置：

- **通知序列**（设置面板，`notification.osc_notify`）：总开关，默认开启
- **去重窗口**（设置面板，`notification.osc_notify_debounce_ms`）：同内容去重窗口毫秒数，默认 2000

## HTTP API

通过 `POST /api/notify` 发送通知：

```bash
curl -s -X POST ${DINOTTY_URL}/api/notify \
  -H "Content-Type: application/json" \
  -d '{"body": "任务完成", "title": "My Agent", "notification_type": "info"}'
```

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `body` | string | ✅ | 通知正文 |
| `title` | string | ❌ | 通知标题 |
| `pane_id` | string | ❌ | 关联的面板 ID（填了可点击跳转） |
| `notification_type` | string | ❌ | 类型：`info`（默认）/ `success` / `warning` / `error` / `urgent` |

带上 `pane_id` 即可让通知支持点击跳转（详见上方 [用户侧 -> 点击跳转](#点击跳转)）。

## 环境变量

dinotty 在每个终端创建时自动注入以下环境变量：

| 变量 | 说明 |
|------|------|
| `DINOTTY_PANE_ID` | 当前终端面板的唯一 ID（叶子 pane） |
| `DINOTTY_TAB_ID` | 当前面板所属 tab 的唯一 ID |
| `DINOTTY_URL` | 当前面板所属 dinotty 服务的通知地址（`http://127.0.0.1:<端口>`），发送通知时用它替代硬编码端口 |

环境变量是**进程级别隔离**的，每个 pane 独立设置，多个 pane 之间不会互相覆盖。

发送通知时带上这些 ID，即可实现精准跳转：

```bash
curl -X POST ${DINOTTY_URL}/api/notify \
  -H "Content-Type: application/json" \
  -d "{
    \"pane_id\": \"$DINOTTY_PANE_ID\",
    \"title\": \"Task Complete\",
    \"body\": \"Build finished\",
    \"notification_type\": \"success\"
  }"
```

## 与 Claude Code 集成

新版 Claude Code 在任务完成、等待输入时会原生发出 OSC 9 通知序列，dinotty 自动检测，**无需配置即可收到通知**。如需自定义通知类型、文案或触发时机，可继续使用 hook：

```jsonc
// .claude/settings.json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST ${DINOTTY_URL}/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Claude 需要你的输入\",\"title\":\"Claude Code\",\"notification_type\":\"warning\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST ${DINOTTY_URL}/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"任务已完成\",\"title\":\"Claude Code\",\"notification_type\":\"success\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'"
          }
        ]
      }
    ]
  }
}
```

| Hook | 用途 |
|------|------|
| `Notification` | Claude 需要用户输入或确认权限时通知 |
| `Stop` | 任务完成时通知 |

> **提示**：在 Hook 命令中可直接使用 `$DINOTTY_PANE_ID` 和 `$DINOTTY_TAB_ID` 环境变量，确保通知能跳转到正确的面板。

其他 AI agent 或自动化脚本同样可以调用 HTTP API 发送通知，无需额外配置。

## 通知命令钩子

可在设置中配置 shell 命令，当通知事件发生时自动执行。适用于触发系统级提醒（如 macOS `osascript`、Linux `notify-send`、Windows PowerShell 声音或 Toast 等）。

命令钩子按**服务端平台**执行：

| 平台 | 执行方式 |
|------|----------|
| Linux / macOS | `sh -c <command>` |
| Windows | 优先 `pwsh.exe -NoProfile -Command <command>`，其次 `powershell.exe`，最后 `cmd.exe /C` |

示例：

```bash
# Linux
notify-send "Dinotty" "$DINOTTY_TITLE: $DINOTTY_BODY"

# macOS
osascript -e 'display notification "'$DINOTTY_BODY'" with title "Dinotty"'
```

```powershell
# Windows PowerShell
[System.Media.SystemSounds]::Asterisk.Play()
```

钩子会收到以下环境变量：

| 变量 | 说明 |
|------|------|
| `DINOTTY_NOTIFICATION_TYPE` | 通知类型 |
| `DINOTTY_PANE_ID` | 触发通知的面板 ID |
| `DINOTTY_TITLE` | 通知标题 |
| `DINOTTY_BODY` | 通知正文 |

## Open API（外部设备控制）

通过 `POST /api/input` 端点，外部设备（Stream Deck、iOS 快捷指令、自动化脚本等）可以向终端发送输入，实现远程控制。

需要在设置中启用 Open API 功能。

```bash
# 向活跃面板发送输入
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "ls -la\n"}'

# 向指定面板发送输入
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "echo hello\n", "pane_id": "pane-1"}'
```

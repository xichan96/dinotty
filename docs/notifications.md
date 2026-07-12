# 通知系统

dinotty 内建通知系统，支持终端 bell 检测和自定义通知推送，适用于 AI agent 和自动化工具集成。

## HTTP API

通过 `POST /api/notify` 发送通知：

```bash
curl -s -X POST http://127.0.0.1:8999/api/notify \
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

### 点击跳转

收到通知后，可通过以下方式直接跳转到目标位置：

- **通知面板**：点击通知卡片 → 自动切换工作区 → 打开对应 tab → 聚焦 pane
- **Toast 弹窗**：点击 **「跳转」** 按钮 → 同上完整跳转链

通知卡片会显示 `工作区名 › tab名 / pane名` 格式的标签，方便识别来源。

## 环境变量

dinotty 在每个终端创建时自动注入以下环境变量：

| 变量 | 说明 |
|------|------|
| `DINOTTY_PANE_ID` | 当前终端面板的唯一 ID（叶子 pane） |
| `DINOTTY_TAB_ID` | 当前面板所属 tab 的唯一 ID |

环境变量是**进程级别隔离**的，每个 pane 独立设置，多个 pane 之间不会互相覆盖。

发送通知时带上这些 ID，即可实现精准跳转：

```bash
curl -X POST http://127.0.0.1:8999/api/notify \
  -H "Content-Type: application/json" \
  -d "{
    \"pane_id\": \"$DINOTTY_PANE_ID\",
    \"title\": \"Task Complete\",
    \"body\": \"Build finished\",
    \"notification_type\": \"success\"
  }"
```

## 与 Claude Code 集成

在 dinotty 终端中运行 Claude Code 时，可通过 hook 在关键节点自动发送通知：

```jsonc
// .claude/settings.json
{
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Claude 需要你的输入\",\"title\":\"Claude Code\",\"notification_type\":\"warning\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:8999/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"任务已完成\",\"title\":\"Claude Code\",\"notification_type\":\"success\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'" }]
    }]
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

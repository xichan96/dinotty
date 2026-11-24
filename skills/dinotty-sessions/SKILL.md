---
name: dinotty-sessions
description: 查看 Dinotty 的终端 session：列出 pane/tab、读取某个 pane 的屏幕、向 pane 发送文本或按键（回车、Ctrl-C、方向键、/model 选择等）。凡是要看某个 tab 里 agent 在干什么、判断是否卡在审批提示、给运行中的会话发指令，或做多 tab 审批/进度管理时使用。发送输入前必须确认目标 pane 并遵守安全边界。
allowed-tools: Bash, Read
---

# Dinotty session 读屏与输入

用 `dinotty sessions/screen/input` 观察和驱动 Dinotty 里的终端会话。典型场景：
多 tab 并行 agent 的审批与进度管理、检查某个 tab 是否卡在 API 错误、给 agent
补一句「继续」。

## 何时使用

- 需要知道某个 pane 当前屏幕上有什么（agent 状态、审批提示、报错）
- 需要给一个已经存在的 pane 发文本或按键
- 多 tab 分派的进度/审批循环

创建/关闭/分屏 tab 用 `dinotty-tabs`；读写文件用 `dinotty-workspace`；给用户
看文件用 `dinotty-viewer`。

## 前置检查（关键）

`/api/sessions`、`/screen`、`/input` 都要求服务端 **Settings → Open API** 已
开启；否则返回 `OPEN_API_DISABLED`。`tabs list` 不需要 Open API，可先用它确认
实例和 tab。

```bash
dinotty tabs list              # 不需要 Open API
dinotty sessions list          # 需要 Open API
```

在 Dinotty tab 里 `DINOTTY_PANE_ID`/`DINOTTY_URL` 已注入；外部调用给
`--pane` / `--url` / `--token`。

## 列出 session

```bash
dinotty sessions list
dinotty sessions list --json
```

人类输出包含 `PANE ID / TAB ID / STATUS / SIZE / CWD`。用它找到目标 pane，并确认
它属于哪个 tab（`/api/sessions` 的 tab_id 可能为空，CLI 会从 `/api/tabs` 补全；
`--json` 保留原始 payload）。

## 读屏

```bash
dinotty screen <pane_id>
dinotty screen <pane_id> --ansi
dinotty --pane <pane_id> screen        # pane 来自 --pane/DINOTTY_PANE_ID
dinotty screen <pane_id> --json        # {"pane_id","content","size"}
```

默认输出纯文本；`--ansi` 保留转义序列。屏幕内容在 JSON 的 `content` 字段。
读屏是只读操作，先读再决定是否输入。

判读提示：审批类提示常见 `to proceed?`、`Do you want to…`；agent 工作中常见
`Bash(`/`Read(`/`Edit(`；空闲常见 `✻ Churned/Cooked for 0s`。**空闲不等于完成**
——还要看任务列表和最终总结（见 `dinotty-dispatch-tabs`）。

## 发送输入

API 把文本原样写入 PTY，不会自动加回车：

```bash
dinotty input send <pane_id> 'ls -la
'
dinotty --pane <pane_id> input send $'ls -la\n'
dinotty input send <pane_id> $'\r'          # 回车
dinotty input send <pane_id> $'\x03'        # Ctrl-C
dinotty input send <pane_id> $'\x1b[A'      # 上方向键
```

要点：

- 文本必须是单独一个参数；含空格/换行时用 shell 引号（`$'...'` 最直观）
- 回车用 `\r`（不是 `\n` 在交互式 TUI 里更可靠）；审批提示常需再发一次 `\r`
- 发送后 `sleep` 几秒再读屏确认生效（渲染有延迟）
- 输入可能被排队（composer 未就绪时屏幕出现 `Press up to edit queued messages`），
  再发一次 `\r` 提交

## 安全边界（必须遵守）

1. **确认目标 pane**：发送前用 `tabs list` / `sessions list` / `screen` 核对
   pane id 与 tab 标题、cwd，避免发错会话
2. **不要在别人的 pane 里乱发**：用户自己开的 tab 只做只读观察；未经明确授权
   不输入
3. **破坏性输入先征得用户同意**：`rm -rf`、`git reset --hard`、`git push`、
   部署、kill 非自建进程、重启 8999 等，一律先问用户
4. **不代答用户问题**：agent 在 tab 里向用户提问（非权限提示）时，转告用户，
   不替用户决定
5. **审批选择要精确**：`don't ask again` 只用于窄规则，别批 `git add *` 这类
   全量规则；回车用 `printf '\r'` / `$'\r'`

## 错误处理

| code | 处理 |
|---|---|
| `OPEN_API_DISABLED` | 让用户在 Settings → Open API 开启；读屏/输入不可用 |
| `UNKNOWN_PANE` | pane 已关闭或 id 过期；`tabs list` 重新定位 |
| `UNAUTHORIZED` / `FORBIDDEN` | 检查 `--token`/`DINOTTY_TOKEN` |
| `REQUEST_FAILED` | 实例没启动或 `--url` 错 |

相关：`dinotty-cli`（命令与错误码）、`dinotty-tabs`（创建/关闭/分屏）、
`dinotty-dispatch-tabs`（多 tab 分派与审批流程）。

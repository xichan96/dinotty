---
name: dinotty-tabs
description: 管理 Dinotty 的 tab 与分屏：列出 tab、创建 tab（指定 cwd/标题/argv/环境变量）、关闭、重命名、分屏、激活。凡是用户要求「开个 tab / 新开终端 / 分屏 / 把这些任务放到不同 tab / 关掉这个 tab」或需要为 agent 创建独立会话时使用；创建测试 tab 时要遵守端口隔离并在结束后关闭。
allowed-tools: Bash, Read
---

# Dinotty tab 与分屏管理

所有操作走 `dinotty tabs ...`，HTTP 层分别是 `GET/POST /api/tabs`、
`DELETE /api/tabs/:id`、`/rename`、`/pane`（split）、`/pane/:pane/activate`。
这些接口都不要求 Open API，只需要服务端 token。

## 何时使用

- 查看当前有哪些 tab、它们属于哪个 pane、在哪个目录
- 为并行任务创建独立 tab，并指定工作目录、标题、启动命令
- 关闭自己创建的 tab、重命名、分屏、把某个 tab 切到前台
- 多 tab 分派（配合 `dinotty-sessions` 读屏/发输入）

只是观察 pane 内容用 `dinotty-sessions`；打开文件用 `dinotty-viewer`。

## 前置检查

1. `dinotty --version` 可用；实例通常是 `DINOTTY_URL` 或 `http://127.0.0.1:8999`
2. `dinotty tabs list` 能出结果（确认 token 和实例）
3. 创建 tab 前确认 `cwd` 存在；否则服务端返回 400 `cwd must exist and be a directory`

```bash
dinotty tabs list
dinotty tabs list --json
```

## 列出 tab

人类输出列：`TAB ID / PANE ID / TITLE / CWD`。标题来自 `layout.title` 或各叶子
的 title；多叶子用 ` | ` 连接。记住 `tab_id`——关闭、重命名、分屏都用它。

## 创建 tab

```bash
# 默认 shell，指定目录与标题
dinotty tabs create --cwd /path/to/worktree --title "agent-1"

# 直接启动命令；-- 之后全部原样传给服务端 argv
dinotty tabs create --cwd /path/to/repo --title "build" -- \
  /bin/bash -lc 'cargo test && cargo clippy'

# 带环境变量启动 agent（POSIX）
dinotty tabs create --cwd /path/to/repo --title "claude" \
  --env ANTHROPIC_BASE_URL=https://api.example.com \
  --env ANTHROPIC_AUTH_TOKEN=sk-... \
  -- /opt/homebrew/bin/claude --permission-mode acceptEdits "完成 README 校对"
```

约定：

- `cwd` 传绝对路径；不传时服务端用默认工作区
- `title` 写短标题（tab 栏可读），不传时默认 `Terminal`
- `argv` 原样传给 `POST /api/tabs`，**不经过 shell**；需要 shell 特性时显式用
  `/bin/bash -lc '...'`
- agent/工具用**绝对路径**：Dinotty 的 PATH 注入只覆盖 `/opt/homebrew/bin` 和
  `/usr/local/bin`，nvm 目录里的裸名可能 spawn 失败
- `--env KEY=VALUE` 会在 argv 前加 `/usr/bin/env KEY=VALUE ...`（HTTP API 没有
  env 字段，这是现有约定）；必须同时给 argv，且仅 POSIX。服务端不重启进程的
  情况下改不了 provider env，换供应商要重建 tab
- `--` 之后的内容全部属于 argv，**包括 `--json`**；全局选项要放在 `--` 前：
  `dinotty --json tabs create --cwd /tmp -- /bin/sh -c 'sleep 60'`

成功输出：

```
Created tab <tab_id>
pane_id: <pane_id>
cwd: <resolved cwd>
```

## 关闭 / 重命名 / 激活

```bash
dinotty tabs close <tab_id>
dinotty tabs rename <tab_id> "新标题"
dinotty tabs activate <tab_id>          # 激活 tab 的第一个 pane
dinotty tabs activate <tab_id> <pane_id>
```

`tabs close` 会结束该 tab 里的所有进程。只关闭**自己创建的** tab；用户原有的
tab（尤其 8999 上的）必须先征得同意。

已知服务端行为：rename 写的是 tab 级 title，之后的布局更新（如 split）可能把它
覆盖掉；需要保留标题时先分屏、最后再 rename。

## 分屏

```bash
dinotty tabs split <tab_id> --direction horizontal          # 右侧新 pane
dinotty tabs split <tab_id> --direction vertical --cwd /tmp  # 下方新 pane
```

- `--direction`：`horizontal`（左右）或 `vertical`（上下），也接受 `h`/`v`
- `--pane`（全局参数）指定从哪个 pane 分；省略时用该 tab 的第一个 pane
- `--cwd` 只对本地 PTY 分屏生效，省略时继承源 pane 的 cwd
- 成功输出 `Created pane <new_pane_id> in tab <tab_id>.`；新 pane 可用
  `dinotty screen <new_pane_id>` 观察（Open API）

## 测试实例端口隔离（重要）

端到端测试不要碰用户的 8999 实例：

```bash
DINOTTY_CONFIG_SUFFIX=-skills DINOTTY_TOKEN=<random> \
  ./target/debug/dinotty-server --port 589xx &

dinotty --url http://127.0.0.1:589xx --token <random> tabs list
dinotty --url http://127.0.0.1:589xx --token <random> tabs create --cwd "$PWD" --title test
# 测完：close 自己创建的 tab，再 kill 自己启动的 589xx 进程
```

- 589xx 端口每个任务独占；`DINOTTY_CONFIG_SUFFIX` 隔离配置和 token 文件
- 只 kill 自己启动的进程；**绝不** kill/restart 8999
- 测试 tab 用完必须 `tabs close`，避免污染用户界面

## 错误处理

| code / 现象 | 处理 |
|---|---|
| 400 `cwd must exist and be a directory` | `cwd` 不存在或不是目录；改用绝对路径 |
| 400 `argv must be a non-empty array` | `--` 后没给命令却带了 `--env`，或 argv[0] 为空 |
| 404 `tab not found` | tab 已关闭；重新 `tabs list` |
| `TAB_NOT_FOUND` | CLI 在 `/api/tabs` 里找不到该 tab（`split`/`activate` 解析 pane 时） |
| `UNKNOWN_PANE` | 目标 pane 不是 live session |
| `REQUEST_FAILED` | 实例没启动或 `--url` 错 |

相关：`dinotty-cli`（全局参数/错误码）、`dinotty-sessions`（读屏与输入）、
`dinotty-dispatch-tabs`（把任务分派到多个 tab 的完整流程）。

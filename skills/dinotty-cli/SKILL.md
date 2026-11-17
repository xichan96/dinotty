---
name: dinotty-cli
description: Dinotty 命令行客户端 dinotty 的通用参考：安装、token 解析、全局参数、命令表、JSON 输出与错误码。凡是要操作 Dinotty（开文件、看 tab/session、读屏、发输入、读写工作区文件），先查这个 skill 确定命令与参数；其他 dinotty-* skill 都用它作为基础。
allowed-tools: Bash, Read
---

# dinotty CLI 基础参考

所有 Dinotty 操作统一走 `dinotty` 命令，不再为每个 skill 写临时 Python/bash
脚本。本 skill 是命令、参数、鉴权和错误码的总入口。

## 何时使用

- 需要确认某个 Dinotty 操作有没有对应命令、参数怎么写
- 需要安装/升级 `dinotty`，或排查 token、端口、连接问题
- 其他 skill（viewer/sessions/tabs/workspace）里的命令报错，需要查错误码

具体任务优先看专用 skill：打开文件用 `dinotty-viewer`，管理 tab 用
`dinotty-tabs`，读屏/发输入用 `dinotty-sessions`，读写文件用
`dinotty-workspace`。

## 安装与自检

```bash
cargo install --path <dinotty-repo>/cli   # 安装到 ~/.cargo/bin/dinotty
dinotty --version
dinotty --help
```

`command -v dinotty` 找不到时，先完成用户任务（可用 `dinotty-html-viewer`
的 legacy 脚本兜底），并提示用户安装 CLI。

## 运行环境

在 Dinotty 的终端 tab 里，Dinotty 自动注入：

- `DINOTTY_URL`：当前实例地址，桌面默认 `http://127.0.0.1:8999`
- `DINOTTY_PANE_ID`：当前 pane，`viewer`/`workspace`/`screen` 可直接省略 `--pane`

不在 Dinotty tab 里时，显式传 `--url` 和 `--pane`（或设置同名环境变量）。

## 全局参数

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--url <URL>` | `DINOTTY_URL` | `http://127.0.0.1:8999` | 无 scheme 自动补 `http://` |
| `--pane <ID>` | `DINOTTY_PANE_ID` | — | 默认 pane id |
| `--token <TOKEN>` | `DINOTTY_TOKEN` | — | 鉴权 token |
| `--json` | — | 关 | 输出机器可读 JSON；错误走 stderr |
| `--ansi` | — | 关 | `screen` 保留 ANSI 转义 |
| `-h/--help` | — | — | 加在命令后看子命令帮助 |
| `-V/--version` | — | — | 版本 |

全局参数可以放在命令前后任意位置。`--` 之后的参数不再当选项解析（用于
`tabs create -- <argv...>`）。

### token 解析顺序

1. `--token`
2. `DINOTTY_TOKEN`
3. `GET /api/auto-token`（仅回环地址）
4. 桌面 app 写的 token 文件：macOS `~/Library/Application Support/dinotty/token`，
   Linux `~/.local/share/dinotty/token`（或 `$XDG_DATA_HOME`），Windows
   `%APPDATA%\dinotty\token`
5. 设置了 `DINOTTY_CONFIG_SUFFIX`（如 `-skills`）时优先找 `dinotty<suffix>/token`

都没有时请求不带 `Authorization`；服务端无 token 或回环放行时仍可用。

## 命令表

| 命令 | 作用 | 需要 Open API |
|---|---|---|
| `viewer open <file>` | 在主界面文件查看器打开文件（工作区外自动 staging） | 否 |
| `sessions list` | 列出终端 session | 是 |
| `screen [pane_id]` | 打印 pane 当前屏幕 | 是 |
| `input send <pane_id> <text>` | 向 pane 写入文本 | 是 |
| `tabs list` | 列出 tab（id/pane/title/cwd） | 否 |
| `tabs create [--cwd --title --env] [-- argv...]` | 新建 tab | 否 |
| `tabs close <tab_id>` | 关闭 tab（会结束其中 pane） | 否 |
| `tabs rename <tab_id> <title>` | 重命名 tab | 否 |
| `tabs split <tab_id> --direction h\|v` | 分屏 | 否 |
| `tabs activate <tab_id> [pane_id]` | 激活 tab/pane | 否 |
| `workspace list [path]` | 列出工作区目录 | 否 |
| `workspace read <path>` | 输出文件原始字节 | 否 |
| `workspace write <path> -` | 从 stdin 写文件 | 否 |
| `workspace git status` | 工作区 git 改动概览 | 否 |
| `workspace git diff <path>` | 单文件 HEAD/工作区内容 | 否 |

完整参数见仓库 `docs/dinotty-cli.md` 和 `dinotty <group> --help`。

## 输出与错误

- 人类输出直接打印表格/内容；`--json` 打印服务端 payload 或 `{"ok":false,...}`
- 退出码：`0` 成功，`1` API/运行错误，`2` 用法错误
- 错误格式：`CODE: message` + 可选 `hint:`

常见 code：`REQUEST_FAILED`（连不上或 URL 错）、`UNAUTHORIZED`/`FORBIDDEN`
（token）、`OPEN_API_DISABLED`（去设置里开 Open API）、`UNKNOWN_PANE`
（pane 过期，重新 `sessions list`）、`TAB_NOT_FOUND`/`NOT_FOUND`（tab 或路径
不存在）、`FILE_TOO_LARGE`、`PATH_NOT_FOUND`、`SCOPE_DENIED`。

## 边界

- 不要 kill/重启用户正在用的实例（默认 8999）。端到端测试用 589xx 临时实例，
  见 `dinotty-tabs` 的端口隔离一节。
- 不要 push、不要改用户数据；CLI 只做读和显式写入。
- 远程实例上 `viewer open` 不能在服务端 staging 本地文件，只能打开服务端工作区
  内已存在的文件。

相关：`dinotty-viewer`、`dinotty-sessions`、`dinotty-tabs`、`dinotty-workspace`、
`dinotty-html-viewer`（HTML 专用入口）。

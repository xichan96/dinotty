---
name: dinotty-viewer
description: 在用户正在使用的 Dinotty 界面里打开文件（HTML、Markdown、PDF、office 文档、图片等），而不是在本机启动浏览器或执行 open。凡是用户说「打开这个文件 / 给我看看这个报告/页面/图片/PDF / 用文件浏览器打开」、生成的交付物需要展示、或文件在工作区外需要自动 staging 时使用。HTML 专用场景仍可用 dinotty-html-viewer。
allowed-tools: Bash, Read
---

# 用 Dinotty 打开文件

用户经常通过网页端 / 远程操作 Dinotty：在本机 `open file.html` 开的窗口用户
看不到。所有要给用户看的文件都推到 Dinotty 的文件查看器；Web 端会以全屏
overlay 呈现，桌面端在主窗口内打开。

## 何时使用

- 交付物是 HTML / Markdown / PDF / office 文档 / 图片，需要用户直接看
- 用户说「打开 / 预览 / 展示这个文件」，或要求用文件浏览器打开
- 文件在 `/tmp` 等当前工作区之外，需要 Dinotty 自动复制进工作区

只需要管理 tab、读屏或写文件时，用 `dinotty-tabs` / `dinotty-sessions` /
`dinotty-workspace`。HTML 专用的老流程（含 legacy Python 兜底）在
`dinotty-html-viewer`，本 skill 是通用入口。

## 前置检查

1. `command -v dinotty` 成功；否则先按 `dinotty-cli` 安装
2. 运行在 Dinotty tab 里时 `DINOTTY_PANE_ID`/`DINOTTY_URL` 已注入，无需额外参数
3. Dinotty 主界面（桌面窗口或浏览器端）已连接；否则返回 `NO_UI_CLIENT`

```bash
dinotty tabs list          # 确认实例和 pane 可用（只读）
dinotty --help             # 确认 CLI 已安装
```

## 命令

```bash
dinotty viewer open /path/to/report.pdf
dinotty viewer open ./docs/mockups/layout.html
dinotty viewer open --json ./chart.png
```

指定实例 / pane / token（不在 Dinotty tab 里时）：

```bash
dinotty --url http://127.0.0.1:8999 --pane <pane_id> viewer open /tmp/page.html
```

成功输出：

```
Opened .claude/artifacts/page.html
request_id: 2ce0f5b3-...
delivered_clients: 2
```

`delivered_clients` 为 0 表示没有连着的 UI（通常是 `NO_UI_CLIENT`）。

## 路径与 staging

| 情况 | 处理 |
|---|---|
| 文件在工作区内 | 按工作区相对路径直接打开 |
| 文件在工作区外（`/tmp`、`~/Downloads` 等） | 先复制到 `<workspace>/.claude/artifacts/`；同名同内容复用，同名不同内容加 `-1`、`-2` |
| 相对路径 | 相对于 CLI 当前目录解析，再 canonicalize |
| 目录 / 特殊文件 | `NOT_A_FILE` |
| 超过查看器上限 | `FILE_TOO_LARGE` |

path jail 与工作区文件浏览器一致：`GET /api/workspace/cwd?pane_id=...` 决定
工作区根；跨工作区文件通过 `.claude/artifacts/` 进入。

## 文件类型

查看器是只读的，按扩展名决定渲染方式：

- `.html`：预览 iframe（`allow-scripts`，不带 same-origin），自包含页面可交互
- `.md` / `.markdown`：Markdown 渲染
- `.pdf`：内嵌 PDF
- `.docx` / `.xlsx` / `.pptx` 等 office：转换为预览
- `.png` / `.jpg` / `.webp` / `.gif` 等图片：直接显示
- 其他文本：语法高亮只读文本

HTML 引用同目录 CSS/JS/图片时，Dinotty 通过 preview-token 解析相对路径；把
资源放在 HTML 旁边即可。

## 错误处理

| code | 处理 |
|---|---|
| `NO_UI_CLIENT` | 让用户先打开 Dinotty 桌面窗口或网页端 |
| `UNKNOWN_PANE` | `DINOTTY_PANE_ID` 过期（tab 已关）；在当前 tab 重跑，或先 `tabs list` |
| `PATH_NOT_FOUND` | 路径不存在/不可读；用绝对路径重试 |
| `OUTSIDE_WORKSPACE` | staging 失败；检查工作区是否可写 |
| `CWD_UNAVAILABLE` / `SSH_UNSUPPORTED` | SSH/远程 pane 没有本地工作区，查看器不可用 |
| `REQUEST_FAILED` | Dinotty 没启动或 `--url` 错 |

## 安全边界

- **不要**再执行 `open`、`xdg-open`、`start` 或起本地浏览器
- 查看器只读，不会改用户文件；staging 只写 `<workspace>/.claude/artifacts/`
- 临时产物放 `.claude/artifacts/`（已被 gitignore）；要长期保留的放
  `docs/mockups/` 并随代码提交
- 远程实例上只能打开服务端工作区内已存在的文件；本地 staging 对服务端不可见

相关：`dinotty-cli`（token/错误码）、`dinotty-html-viewer`（HTML 专用与
legacy 脚本）、`dinotty-workspace`（查看/写入工作区文件）、`dinotty-tabs`。

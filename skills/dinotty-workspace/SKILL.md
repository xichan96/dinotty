---
name: dinotty-workspace
description: 通过 dinotty workspace 命令查看和修改某个 pane 工作区内的文件：列目录、读取内容、从 stdin 写入、查看 git status/diff。凡是要检查用户 Dinotty tab 的工作区、读一个约定路径、在用户工作区里落文件、或需要遵守 Dinotty 路径 jail 时使用。优先用 CLI 命令；缺能力时扩展 CLI，而不是写临时脚本。
allowed-tools: Bash, Read, Write, Edit
---

# Dinotty 工作区文件操作

`dinotty workspace ...` 访问的是**某个 pane 的工作区**（pane 的 cwd），走
`/api/workspace/{list,raw,meta,file,git-changes,git-file-diff}`。路径 jail 和
Dinotty 文件浏览器一致。

## 何时使用

- 需要确认用户 Dinotty tab 的工作区里有什么（目录、大小、链接）
- 读取工作区文件内容（尤其是远程/别人的 pane，或本机路径不确定时）
- 往用户工作区写文件（从 stdin 落盘）
- 看工作区的 git 改动概览或单文件 HEAD/工作区内容
- 要给用户展示 HTML/图片/PDF：改用 `dinotty-viewer`

如果只是在自己 worktree 里做开发，直接用 `cat`/`rg`/`git` 更快；当目标是
**用户正在用的 pane** 或远程实例时，用本 skill 的 CLI。

## 前置检查

1. `dinotty tabs list` 找到目标 `tab_id`/`pane_id`
2. pane 必须是 local 或受支持的 remote session；SSH 的 git 命令会返回 409
3. 在 Dinotty tab 里 `DINOTTY_PANE_ID` 已注入；否则传 `--pane`

## 路径规则（重要）

- 路径相对 pane 工作区，**不是**运行 CLI 的当前目录
- 服务端会去掉前导 `/`，并拒绝任何 `..` 段：`/tmp/a` 等于
  `<workspace>/tmp/a`，不是本机 `/tmp/a`
- 符号链接按 canonical 路径做 jail 检查；越界返回 403 `outside workspace`
- 需要打开工作区外的本机文件时用 `dinotty-viewer`（它会 staging 到
  `.claude/artifacts/`），不要试图用 workspace 命令绕过 jail

## 列目录

```bash
dinotty workspace list              # 工作区根
dinotty workspace list src          # 相对子目录
dinotty workspace list src --json   # {cwd, path, entries:[{name,is_dir,size,is_symlink,is_cycle}]}
```

人类输出 `NAME / TYPE / SIZE`；`dir`、`file`、`link`、`link (cycle)` 区分目录、
文件和符号链接。`is_cycle` 的链接不要递归展开。

## 读取

```bash
dinotty workspace read Cargo.toml
dinotty workspace read assets/logo.png | file -
dinotty workspace read Cargo.toml --json       # 文本预览（/meta）
```

- 普通输出走 `/api/workspace/raw`，字节原样写到 stdout，可管道、可处理二进制
- 服务端单文件下载上限 500 MiB；超过是 `FILE_TOO_LARGE`
- `--json` 改为请求 `/api/workspace/meta`：返回 `kind`、`language`、`content`、
  `truncated`、`mime`。文本预览上限 512 KiB；需要完整内容用普通输出
- 二进制文件在 `--json` 下是 `kind: "unsupported"`，用普通输出读原始字节

## 写入

```bash
printf '# Notes\n' | dinotty workspace write notes.md -
dinotty workspace write src/generated.rs - < /tmp/generated.rs
```

- 必须带结尾的 `-`，内容从 stdin 读取
- 内容是 UTF-8 字符串（`PUT /api/workspace/file` 的 `content` 字段）；服务端上限
  500 MiB
- 目标父目录必须已存在；路径越界会被拒绝
- 会覆盖已有文件——写入前先 `workspace read <path>` 或确认用户意图；不要覆盖
  用户未提及的文件

## git

```bash
dinotty workspace git status            # 变更文件 + 增删行 + repo/HEAD
dinotty workspace git status --json     # 完整 /git-changes payload
dinotty workspace git diff src/a.rs      # HEAD 与工作区整文件内容
dinotty workspace git diff src/a.rs --json
```

- `git status` 对应 `/api/workspace/git-changes`：`is_git_repo`、`repo_root`、
  `head`、summary、每文件 `status/additions/deletions/binary/conflicted`
- `git diff` 对应 `/api/workspace/git-file-diff`，返回的是**整文件**原文与当前
  内容，不是 unified patch；需要 hunk 时在本地 worktree 直接跑 `git diff`
- SSH pane 的 git 接口返回 409 `git_unavailable_for_backend`

## 错误处理

| code / 现象 | 处理 |
|---|---|
| `INVALID_PATH` | 路径含 `..`；改成工作区相对路径 |
| `OUTSIDE_WORKSPACE` / `SCOPE_DENIED` | 越界或敏感目录；用 `dinotty-viewer` 走 staging |
| `NOT_FOUND` / `NOT_A_FILE` / `NOT_A_DIRECTORY` | 路径或类型不对；先 `workspace list` |
| `CWD_UNAVAILABLE` | 远程 pane 没有本地工作区 |
| `GIT_UNAVAILABLE` | SSH/remote pane 不提供 git 数据 |
| `UNKNOWN_PANE` | pane 已关闭；重新定位 |
| `FILE_TOO_LARGE` | 超过 500 MiB 下载上限 |

## 扩展而不是造脚本

CLI 暂未覆盖的能力（建/删/改名/移动、`.claude` 之外的搜索、full `free` 列表）：

- 优先在 `cli/` 增加子命令（复用 `api.rs`/`error.rs`，补 `--json`、`--help` 和
  单元测试），再更新 `docs/dinotty-cli.md`
- 不要在 skill 目录放临时 Python/bash 脚本；一次性排障脚本也不要提交

## 安全边界

- 写操作只落在目标 pane 的工作区内；不要用 workspace 命令做删除/清理
- 写前确认目标路径和用户意图；覆盖已有文件属于破坏性操作
- 不要操作主仓之外的系统目录，不要改 `/Applications` 或用户数据
- 测试实例用 589xx 端口并隔离配置，见 `dinotty-tabs`

相关：`dinotty-cli`（全局参数/错误码）、`dinotty-viewer`（把文件展示给用户）、
`dinotty-tabs`（定位 pane/tab）、`dinotty-sessions`（读屏与输入）。

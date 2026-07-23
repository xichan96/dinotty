<p align="center">
  <img src="docs/images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="GitHub Stars"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="GitHub Downloads"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="GitHub Issues"></a>
</p>

<p align="center">
  <a href="./README.en.md">English</a> | 中文
</p>

---

为 **Coding Agent** 打造的**多端同步**终端服务器。在任意设备上运行 Claude Code、opencode、Codex 或 OpenClaw，桌面端专业高效，移动端随时掌控——无缝切换，会话永不丢失。

## 截图

<p align="center">
  <img src="docs/images/1.png" alt="手机上运行 Claude Code" width="250" />
  <img src="docs/images/2.png" alt="完整键盘布局与 htop" width="250" />
  <img src="docs/images/3.png" alt="主题设置" width="250" />
</p>
<p align="center">
  <img src="docs/images/4.png" alt="快捷键盘自定义" width="250" />
  <img src="docs/images/5.png" alt="系统监控" width="250" />
  <img src="docs/images/6.png" alt="通知系统" width="250" />
</p>
<p align="center">
  <img src="docs/images/7.png" alt="平板横屏桌面级布局" width="500" />
</p>

## 桌面端演示

桌面端同样专业好用，媲美 iTerm2 的终端体验：

**分屏广播** — 可拖拽的多面板分屏，一个 pane 输入，多个 pane 同步执行：

<p align="center">
  <img src="docs/images/gif/1-split-broadcast.gif" alt="分屏广播演示" width="600" />
</p>

**命令收藏** — 右键终端文本直接收藏，分组管理，一键执行：

<p align="center">
  <img src="docs/images/gif/2-command-bookmark.gif" alt="命令收藏演示" width="600" />
</p>

**SSH 连接与文件浏览器** — 内建 SSH 客户端，远程会话与本地体验一致，SFTP 文件管理全覆盖：

<p align="center">
  <img src="docs/images/gif/3-ssh-file-browser.gif" alt="SSH 连接与文件浏览器演示" width="600" />
</p>

**工作区管理与 Mission Control** — 多工作区隔离，Mission Control 概览，快速切换：

<p align="center">
  <img src="docs/images/gif/4-workspace-mission-control.gif" alt="工作区管理演示" width="600" />
</p>

**插件系统** — JS 插件热重载，内置 CC Switch、JSON Formatter 等：

<p align="center">
  <img src="docs/images/gif/5-plugin.gif" alt="插件系统演示" width="600" />
</p>

## 为什么选择 Dinotty？

终端 Coding Agent（Claude Code、opencode、Codex、OpenClaw 等）功能强大，但它们被束缚在单一终端窗口里。Dinotty 让你：

- **在任意设备上管理 agent**——桌面端深度编码，离开工位时手机扫码即可继续查看和管理 agent 工作，工作连贯不中断
- **多端同步，无缝切换**——电脑上写到一半，掏出手机继续；回到电脑，一切原样
- **直接验证 agent 产出**——代码 diff、渲染的网页、生成的文件，内置浏览器一目了然
- **永远不会丢失会话**——断网、息屏、切换设备——回来后一切都在原处

### 轻量级——不是远程桌面

| | Dinotty | 远程桌面 (VNC/RDP/Parsec) |
|---|---|---|
| **传输数据** | 纯文本（JSON，字节流） | 全屏像素流，30-60 fps |
| **带宽消耗** | 通常 ~1–10 KB/s | ~1–10 MB/s（多 100–1000 倍） |
| **移动网络友好** | ✅ 3G/4G 下流畅无延迟 | ❌ 卡顿、高延迟、流量消耗大 |
| **弱信号容忍度** | ✅ 自动重连，无画面丢失 | ❌ 画面冻结、输入延迟 |
| **电量消耗** | 低（文本渲染） | 高（视频解码） |
| **分辨率适配** | 任意尺寸下原生文本渲染 | 位图缩放，手机上模糊 |
| **交互方式** | 原生触控 + 自定义键盘 | 模拟鼠标，桌面 UI 在手机上很小 |

## 核心特性

- **服务端虚拟终端** — 完整 VTE 解析，服务端掌握精确屏幕状态，支持会话恢复与屏幕快照
- **会话持久化** — PTY 进程在断网后存活，自动重连 + 指数退避，刷新页面即可恢复
- **分屏与多 Tab** — 可拖拽分屏、多 Tab 管理，服务端主导的 Pane 生命周期
- **工作区管理** — 多工作区隔离，Mission Control 概览，工作区级插件 Tab
- **广播模式** — 一个 pane 输入，多个 pane 同步执行，免费
- **命令收藏** — 右键终端文本直接收藏，分组管理，一键执行
- **SSH 远程连接** — 内建 SSH 客户端，支持密码/密钥认证，远程会话与本地体验一致
- **远程文件管理（SFTP）** — SSH 连接下自动启用 SFTP，文件浏览、编辑、上传、下载全覆盖
- **服务器列表** — 管理多台远程服务器，快速切换连接
- **响应式布局** — 竖屏上下排列，横屏左右并排；触控优化的按钮与面板缩放
- **可自定义快捷键盘** — 为手机补齐 Ctrl/Esc/功能键，支持任意转义序列
- **内建文件浏览器** — 代码高亮、Markdown 渲染、Office 文档预览、音视频播放
- **Git 变更指示** — 编辑器 gutter 增/改/删标记，inline diff，Stage/Revert
- **网页预览** — 内建反向代理，在 iframe 中预览本地开发服务器
- **通知系统** — 终端 bell/OSC 检测，WebSocket 推送，可配置声音提醒
- **系统监控** — 实时 CPU/内存/网络图表
- **插件系统** — JS 插件 + CLI 桥接，热重载，内置 CC Switch、JSON Formatter、Claude Code 对话管理等
- **Open API** — HTTP 端点，支持 Stream Deck、快捷指令等外部设备控制
- **命令面板** — 快速访问命令启动器
- **桌面应用** — 可选 Tauri 原生客户端

## 差异化亮点

- **服务端虚拟终端** - 不是 WebSocket-to-PTY 透传，PTY 在断网后存活，刷新页面即恢复会话
- **多端同步** - 浏览器即同步，桌面深度编码、移动随时接管
- **轻量纯文本传输** - ~1-10 KB/s，3G/4G 流畅，远胜远程桌面 100-1000 倍带宽
- **自包含工作环境** - 内建文件浏览、网页预览、Git 变更、SSH/SFTP、插件系统
- **免费开源** - 自托管，无订阅无中继

完整方案对比见 [方案对比](docs/comparison.md)。

## 安装

前往 [GitHub Releases](https://github.com/xichan96/dinotty/releases) 下载对应平台的安装包或二进制：

| 平台 | 格式 | 说明 |
|------|------|------|
| **macOS** | `.dmg` | 双击打开，拖入 Applications 即可 |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |
| **Windows** | `.exe` / 源码构建 | 在 PowerShell 中运行 `dinotty-server.exe`，也可从源码构建 |

> 也可以从源码构建，见下方「快速开始」。

**macOS 注意事项**：由于应用未签名，macOS 可能会提示 **"Dinotty" is damaged and can't be opened**。安装后请在终端执行以下命令解除限制：

```bash
xattr -cr /Applications/Dinotty.app
```

**Linux 一键下载安装**：

```bash
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"
```

**Linux 启动方式**：

```bash
# systemd
systemctl start dinotty
systemctl enable dinotty  # 开机自启

# Docker 容器
nohup dinotty-server &
```

**Windows 启动方式**：

```powershell
# PowerShell
.\dinotty-server.exe -p 8999

# 可选：指定默认 shell（优先级高于自动检测）
$env:DINOTTY_SHELL = "pwsh.exe"
.\dinotty-server.exe
```

Windows 默认 shell 检测顺序为 `DINOTTY_SHELL` → `pwsh.exe` → `powershell.exe` → `%ComSpec%` / `cmd.exe`。

默认监听端口 **8999**，启动后访问 `http://<your-ip>:8999`。可通过 `-p` 参数指定端口：

```bash
dinotty-server -p 3000
```

## 快速开始

```bash
# 克隆仓库（推荐 shallow clone，体积小速度快）
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# 构建前端
cd frontend && pnpm install && pnpm run build && cd ..

# 运行服务器
cargo run
```

Windows PowerShell 下可使用等价的分步命令：

```powershell
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty
cd frontend
pnpm install
pnpm run build
cd ..
cargo run
```

在浏览器中打开 http://127.0.0.1:8999 。

```bash
# 带调试日志运行
RUST_LOG=debug cargo run

# 前端类型检查
cd frontend && npx vue-tsc --noEmit
```

```powershell
# Windows PowerShell 带调试日志运行
$env:RUST_LOG = "debug"
cargo run
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Rust, Axum 0.7, Tokio, portable-pty, vte, russh, russh-sftp |
| 前端 | Vue 3, TypeScript, Vite, xterm.js 5 |
| 桌面端 | Tauri |

**Rust 编写 · 单二进制 · 零依赖部署** — 服务端跑完整 VT 状态机，不是管道转发，断线会话不丢失。

## 更多文档

- [方案对比](docs/comparison.md) — 与 ttyd/gotty/Wetty 及其他 AI Coding 远程方案的差异
- [部署指南](docs/deployment.md) — systemd、Docker、Windows 原生运行、跨平台构建、配置说明
- [文件编辑器](docs/file-editor.md) — 分屏、多光标编辑、Cursor Group 跨文件同步
- [通知系统](docs/notifications.md) — HTTP API、Claude Code 集成、Open API
- [插件系统](docs/plugins.md) — 安装、清单、API、内置插件
- [插件开发](docs/plugin-development.md) — 完整的插件开发文档
- [Agent API](docs/agent-api.md) — HTTP/WebSocket 结构化交互，供 AI Agent 与自动化脚本调用
- [主机剪贴板 API](docs/clipboard-api.md) — 移动端主机粘贴使用的敏感认证接口
- [MCP Server](docs/mcp-server.md) — 内置 MCP JSON-RPC 服务器，AI 助手直接操作终端会话
- [Token 权限系统](docs/token-system.md) — 基于 Capability 的多 Token 细粒度访问控制
- [Event Bus](docs/event-bus.md) — 全局事件总线，模块间事件分发
- [审计日志与 Webhook](docs/audit-webhook.md) — API 使用追踪与外部通知
- [贡献指南](docs/contributing.md) — 分支策略、Commit 规范、代码风格

## 贡献者

感谢所有为 Dinotty 做出贡献的人！

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## 加入 QQ 群

<p align="center">
  <img src="docs/images/qq.png" alt="QQ 群" width="200" />
</p>

## Star History

![Star History](docs/images/star-history.svg)

## 许可证

MIT

# 与其他方案对比

Dinotty 与常见 Web 终端、AI Coding 远程方案的差异对比。

## 与其他终端的对比

| 能力 | Dinotty | ttyd | gotty | Wetty |
|---|---|---|---|---|
| 服务端虚拟终端（VT Screen） | ✅ | ❌ | ❌ | ❌ |
| 会话在断网后存活 | ✅ | ❌ | ❌ | ❌ |
| 刷新页面 = 恢复会话 | ✅ | ❌ | ❌ | ❌ |
| 内建文件浏览器和预览 | ✅ | ❌ | ❌ | ❌ |
| Git 变更指示 | ✅ | ❌ | ❌ | ❌ |
| 内建网页预览（反向代理） | ✅ | ❌ | ❌ | ❌ |
| 可自定义快捷键盘 | ✅ | ❌ | ❌ | ❌ |
| 广播模式 | ✅ | ❌ | ❌ | ❌ |
| 命令收藏 | ✅ | ❌ | ❌ | ❌ |
| 插件系统 | ✅ | ❌ | ❌ | ❌ |
| 工作区管理 | ✅ | ❌ | ❌ | ❌ |
| SSH 远程连接 + SFTP | ✅ | ❌ | ❌ | ❌ |
| Cookie Session + Token 认证 | ✅ | ✅ | ❌ | ✅ |

其他 Web 终端只是 WebSocket 到 PTY 的透传管道。Dinotty 在服务端运行**完整的虚拟终端仿真器**，使得会话恢复、屏幕快照成为可能，结合内建文件/网页浏览器，提供自包含的 Coding Agent 工作环境。

## AI Coding 方案对比

| | Dinotty | Claude Code Remote | Codex Web | Happy | hapi | Termius | tmux |
|---|---|---|---|---|---|---|---|
| 定位 | Web 终端服务器 | 内建多端同步 | 云端 Agent | AI Agent 远程客户端 | AI Agent 远程客户端 | SSH 客户端 | 终端复用器 |
| 技术方案 | 服务端 VTE + Web UI | Anthropic 云 + 本地 | OpenAI 云 | CLI 代理包装 | CLI 代理包装 | 原生 App | 服务端进程 |
| Web 访问 | ✅ | ✅ claude.ai/code | ✅ chatgpt.com/codex | ✅ | ✅ PWA | ❌ | ❌ |
| 原生 App | Tauri（macOS/Linux/Windows） | iOS + Android | ❌ | iOS + Android | ❌（PWA） | 全平台 | ❌ |
| 通用终端 | ✅ 本地 + SSH | ❌ 仅 AI Agent | ❌ 仅 AI Agent | ❌ 仅 AI Agent | ❌ 仅 AI Agent | ✅ SSH | ✅ |
| Coding Agent 适配 | ✅ 文件浏览/预览/通知 | ✅ 内建 | ✅ 内建 | ✅ 语音/审批 | ✅ 语音/工作区 | ❌ | ❌ |
| 分屏 | ✅ 原生拖拽 | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ tmux 命令 |
| 广播模式 | ✅ 免费 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 命令收藏 | ✅ 免费 | ❌ | ❌ | ❌ | ❌ | 💰 付费 | ❌ |
| 插件系统 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 工作区管理 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 多端同步 | ✅ 浏览器即同步 | ✅ 跨设备会话同步 | ✅ 云端会话 | ✅ | ✅ | ✅ Vault | ❌ 需 SSH |
| 中继服务 | 计划中 | ✅ Anthropic 托管 | ✅ OpenAI 托管 | ✅ | ✅ | SaaS | ❌ |
| 部署方式 | 自托管 | SaaS | SaaS | 中继服务 | 自托管/中继 | SaaS | 自托管 |
| 代码运行位置 | 自有服务器 | 本地 / Anthropic 云 | OpenAI 云 | 本地 | 本地 | 远程 SSH | 远程服务器 |
| 价格 | 🆓 免费开源 | 💰 需 Pro 订阅 | 💰 需 Plus | 中继服务 | 自托管/中继 | 💰 $10/月 | 🆓 但折腾 |

Claude Code 和 Codex 各自提供了内建的远程方案，但仅限于自身 Agent 生态。Happy/hapi 是第三方远程控制层，包装 CLI 实现手机审批和语音交互。Dinotty 是通用 Web 终端服务器，Agent 在服务端原生运行，同时提供文件浏览、网页预览、插件系统等完整工作环境，桌面端和移动端均有专业体验。

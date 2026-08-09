# 介绍

为 Coding Agent 场景打造的终端。

在任意设备上运行 Claude Code、opencode、Codex 或 OpenClaw -- 简洁、可拓展、多端同步，会话永不丢失。

**手机 · iPad · 桌面，一个会话**

电脑上写到一半，掏出手机继续，回到桌面一切原样。断网不丢，刷新即回。

**一切皆 pane，像搭积木一样**

终端、插件、文件、SSH、网页预览 —— 每个面板都是一块积木，拖拽拼装出你的专属工作台。

## 理念

终端 Coding Agent -- Claude Code、opencode、Codex、OpenClaw -- 功能强大，却总被束缚在单一窗口里。Dinotty 把它解放出来。一个终端，所有设备，所有可能。

### 多端同步

会话常驻服务端，断网不丢、刷新即回。手机、iPad、桌面随时接管同一会话。详见 [多端同步与 Mission Control](guide/multi-device-sync)。

### 拓展无界

JS 插件热重载。CC Switch、JSON Formatter、Claude Code 对话管理开箱即用。自定义命令、终端交互、事件订阅、CLI 集成 -- API 皆已就位。

### 一切皆 pane

终端、插件、文件、SSH、网页预览都是 pane，拖拽拼装出专属工作台。详见 [Tab 与分屏管理](guide/tabs-and-panes)。

### 永不掉线

服务端 VTE，PTY 断网存活。刷新页面，回到原处。

### 自由开源

自托管。无订阅。无中继。数据，始终在你手中。

### 轻量级 -- 不是远程桌面

| | Dinotty | 远程桌面 (VNC/RDP) |
|---|---|---|
| **传输数据** | 纯文本（字节流） | 全屏像素流 30-60 fps |
| **带宽消耗** | ~1-10 KB/s | ~1-10 MB/s（100-1000 倍） |
| **移动网络友好** | 3G/4G 流畅 | 卡顿、高延迟 |
| **弱信号容忍度** | 自动重连，无丢失 | 画面冻结、输入延迟 |
| **电量消耗** | 低 | 高（视频解码） |

## 核心特性

- **服务端虚拟终端** - 完整 VTE 解析，服务端掌握精确屏幕状态，PTY 进程断网后存活
- **会话持久化** - 自动重连 + 指数退避，刷新页面即可恢复
- **分屏与多 Tab** - 拖拽分屏、跨标签拖拽，服务端主导的 Pane 生命周期
- **工作区管理** - 多工作区隔离，Mission Control 概览，工作区级插件 Tab
- **广播模式** - 一个 pane 输入，多个 pane 同步执行
- **命令收藏** - 右键终端文本直接收藏，分组管理，一键执行
- **SSH 远程连接** - 内建 SSH 客户端，支持密码/密钥认证
- **远程文件管理（SFTP）** - 文件浏览、编辑、上传、下载全覆盖
- **响应式布局** - 竖屏上下排列，横屏左右并排
- **可自定义快捷键盘** - 为手机补齐 Ctrl/Esc/功能键
- **内建文件浏览器** - 代码高亮、Markdown 渲染、Office 文档预览
- **Git 变更指示** - 编辑器 gutter 增/改/删标记，inline diff
- **网页预览** - 内建反向代理，在 iframe 中预览本地开发服务器
- **通知系统** - 终端 bell/OSC 检测，WebSocket 推送
- **系统监控** - 实时 CPU/内存/网络图表
- **插件系统** - JS 插件 + CLI 桥接，热重载
- **Open API** - HTTP 端点，支持 Stream Deck 等外部设备
- **桌面应用** - 可选 Tauri 原生客户端

## 下一步

- [部署指南](getting-started/deployment) - 安装和部署 Dinotty
- [方案对比](getting-started/comparison) - 与 ttyd/gotty/Wetty 等方案对比
- [插件开发](plugins/plugin-development) - 开发自己的插件

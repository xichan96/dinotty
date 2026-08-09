# Dinotty 文档

为 Coding Agent 场景打造的终端。

在任意设备上运行 Claude Code、opencode、Codex 或 OpenClaw -- 简洁、可拓展、多端同步，会话永不丢失。

**手机 · iPad · 桌面，一个会话**

电脑上写到一半，掏出手机继续，回到桌面一切原样。断网不丢，刷新即回。

**一切皆 pane，像搭积木一样**

终端、插件、文件、SSH、网页预览 —— 每个面板都是一块积木，拖拽拼装出你的专属工作台。

文档分两条轨道：**使用文档**面向最终用户，**开发文档**面向插件作者、API 集成方与项目贡献者。

## 使用文档

- [介绍](introduction) - 项目介绍、为什么选择 Dinotty、核心特性
- [方案对比](getting-started/comparison) - 与 ttyd/gotty/Wetty 及其他 AI Coding 远程方案对比
- [安装](installation) - 从 GitHub Release 下载各平台产物
- [部署指南](getting-started/deployment) - systemd、Docker、Windows、跨平台构建

### 使用指南

- [多端同步与 Mission Control](guide/multi-device-sync) - 三端连接、设备切换、会话恢复
- [Tab 与分屏管理](guide/tabs-and-panes) - 分屏、跨 Tab 拖拽、布局模板
- [工作区管理](guide/workspace) - 多工作区隔离、Mission Control 概览
- [SSH 远程与 SFTP](guide/ssh-sftp) - 内建 SSH 客户端、远程文件管理
- [广播模式](guide/broadcast) - 一个 pane 输入，多个 pane 同步执行
- [命令收藏](guide/command-favorites) - 右键收藏、分组管理、一键执行
- [网页预览](guide/web-preview) - 内建反代，pane 内预览本地开发服务器
- [移动键盘与快捷键](guide/mobile-keyboard) - 移动键盘、自定义布局、快捷键速查
- [系统监控](guide/system-monitor) - CPU/内存/网络实时图表
- [外观主题](guide/appearance) - 主题管理、字体设置、颜色 token

### 功能

- [文件编辑器](features/file-editor) - 分屏、多光标编辑、Cursor Group 跨文件同步
- [通知系统](features/notifications) - HTTP API、Claude Code 集成、Open API

### 插件

- [安装与使用](plugins/plugins) - 安装插件、内置插件、插件 API 概览

## 开发文档

- [插件开发指南](plugins/plugin-development) - 完整的插件开发文档

### API

- [Open API](api/open-api) - 终端读写、命令执行、事件订阅（支持 AI Agent 与自动化脚本）
- [主机剪贴板 API](api/clipboard-api) - 移动端主机粘贴使用的敏感认证接口
- [MCP Server](api/mcp-server) - 内置 MCP JSON-RPC 服务器

### 内部机制

- [Event Bus](internals/event-bus) - 全局事件总线，模块间事件分发
- [Token 权限系统](internals/token-system) - 基于 Capability 的多 Token 细粒度访问控制
- [审计日志与 Webhook](internals/audit-webhook) - API 使用追踪与外部通知

### 贡献

- [贡献指南](getting-started/contributing) - 分支策略、Commit 规范、代码风格
- [发布指南](getting-started/releasing) - 版本管理、版本 PR、Tag 与 GitHub Release

## 资源

- [GitHub 仓库](https://github.com/xichan96/dinotty)
- [Releases 下载](https://github.com/xichan96/dinotty/releases)
- [Issue 反馈](https://github.com/xichan96/dinotty/issues)

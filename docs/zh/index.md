# Dinotty 文档

Dinotty 是为 Coding Agent 打造的多端同步终端服务器。在任意设备上运行 Claude Code、opencode、Codex 或 OpenClaw，桌面端专业高效，移动端随时掌控 -- 无缝切换，会话永不丢失。

## 开始

- [介绍](introduction) - 项目介绍、为什么选择 Dinotty、核心特性
- [方案对比](getting-started/comparison) - 与 ttyd/gotty/Wetty 及其他 AI Coding 远程方案对比
- [部署指南](getting-started/deployment) - systemd、Docker、Windows、跨平台构建
- [发布指南](getting-started/releasing) - 版本管理、版本 PR、Tag 与 GitHub Release
- [贡献指南](getting-started/contributing) - 分支策略、Commit 规范、代码风格

## 功能

- [文件编辑器](features/file-editor) - 分屏、多光标编辑、Cursor Group 跨文件同步
- [通知系统](features/notifications) - HTTP API、Claude Code 集成、Open API

## 插件

- [插件系统](plugins/plugins) - 安装、清单、API、内置插件
- [插件开发指南](plugins/plugin-development) - 完整的插件开发文档

## API

- [Agent API](api/agent-api) - HTTP/WebSocket 结构化交互，供 AI Agent 与自动化脚本调用
- [主机剪贴板 API](api/clipboard-api) - 移动端主机粘贴使用的敏感认证接口
- [MCP Server](api/mcp-server) - 内置 MCP JSON-RPC 服务器

## 内部机制

- [Event Bus](internals/event-bus) - 全局事件总线，模块间事件分发
- [Token 权限系统](internals/token-system) - 基于 Capability 的多 Token 细粒度访问控制
- [审计日志与 Webhook](internals/audit-webhook) - API 使用追踪与外部通知

## 资源

- [GitHub 仓库](https://github.com/xichan96/dinotty)
- [Releases 下载](https://github.com/xichan96/dinotty/releases)
- [Issue 反馈](https://github.com/xichan96/dinotty/issues)

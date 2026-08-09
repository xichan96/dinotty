# Roadmap

Dinotty 的演进方向。状态随版本迭代更新，已完成项归档到 [Releases](https://github.com/xichan96/dinotty/releases)。

## 计划中

### 终端工作流

记录终端操作流程，支持回放、分享与重放。便于团队协作与 Agent 操作复盘。

### 定时任务插件

内置插件，cron 表达式定时执行命令。配合通知系统实现任务完成提醒。

### 待办清单插件

内置插件，在终端侧管理 todo 列表，与 Coding Agent 工作流整合。

### 客户端管理

集中管理多台 dinotty 服务端，统一的服务器列表与连接管理。

### 文档与官网

补充文档截图，搭建项目官网。

## 已交付

### 多端同步与 Mission Control

- 三端会话实时同步，Mission Control 概览所有 Tab 与工作区
- 多端同步稳定性修复：broadcast 回声、PTY exit、REST API 广播、replay 协议
- 重连渲染、SSH 分屏 resize 防抖
- Mission Control 动画与方向键导航
- Mission Control 概览状态后端主导

### 工作区管理

- 多工作区隔离，Mission Control 内新建/删除/切换
- 当前工作区指示（状态栏右下角）、浅色模式配色优化
- Mission Control 工作区拖拽排序

### SSH 远程与 SFTP

- 内建 SSH 客户端，密码/密钥认证
- SSH 连接管理：方向键选择、拖拽排序、移动端不弹自带键盘
- 分屏继承 SSH 连接、SSH resize 防抖
- SFTP 文件浏览、编辑、上传、下载

### 终端与 Tab

- 自动布局、Tab 序号、标题编辑、滚动条
- 长按复制（苹果式可拖动调整选择范围）
- 关闭空 Tab 退出、Mission Control 切 Tab 错位等修复
- 高输出 CLI 工具卡死修复（write queue 上限）
- 终端最后一行被遮挡修复
- 启动时恢复上次会话（session.json 快照持久化）
- Shell 自动发现、WSL 选择

### 分屏与广播

- 右键菜单支持分屏（左右/上下/广播）
- 广播模式下命令收藏全局生效
- 广播 + 书签分发链路修复

### 命令收藏

- 编辑模式不再显示删除按钮，避免误操作
- 命令删除二次确认
- 拖拽排序

### 文件浏览器

- 文件树空白修复、支持分屏
- README 内嵌图片预览修复
- SSH 连接下目录定位修复
- SFTP 上传/下载修复
- 网页/文件预览改为 layout leaf，与终端、插件 pane 统一
- 网页预览 toolbar：前进/后退、地址栏、书签、外部浏览器、DevTools
- Markdown 预览按文件类型初始化展示状态
- 文件/网页 pane 支持拖动排列（统一布局系统）

### 快捷键与输入

- Shift+回车换行
- 设置页快捷键整理、SSH 快捷键调整
- Esc 键在 opencode 误转换行修复
- 桌面端/Ubuntu 右键粘贴修复
- iOS Safari 滚动修复、WKWebView 中文标点修复

### 设置与外观

- 配置项按功能边界分组
- 主题导出可选保存路径
- 保存按钮不再破坏当前页面
- About 标签页加文档与反馈链接

### 桌面端

- 关闭窗口后 Dock 可重新打开
- VSCode 拖文件支持粘贴路径
- 自动更新检查、登录自启动
- 桌面端路由漂移修复
- macOS 签名公证

### 移动端

- 系统输入法模式
- 硬件键盘多端同步
- 触屏端 SSH 列表不弹自带键盘

### 安全

- Cookie Session 鉴权
- Token 权限系统（基于 Capability 的细粒度访问控制）
- WebSocket Origin 校验、登录锁定
- 开放接口鉴权（键盘 API 不再默认发送到默认终端）
- Token 不再暴露在 query 参数中
- 验证码登录模式（替代 token 的可选方式）

### Agent API 与 MCP

- HTTP/WebSocket 结构化交互，供 AI Agent 与自动化脚本调用
- 内置 JSON-RPC MCP 服务器
- Event Bus、审计日志、Webhook
- 插件 API 传递 pane 身份与 Tab 级可见性

### 布局模板

- 保存当前 Tab 布局为模板
- 一键应用、模板列表预览
- 应用模板进入指定工作区

### 通知与监控

- 通知区分 Tab 来源
- 系统监控本机标识
- 状态栏点击外部自动折叠

### 文档

- README 完善桌面端/移动端 gif 与场景 gif

## 反馈与建议

Roadmap 项随版本演进调整。如有需求或建议，欢迎在 [GitHub Issues](https://github.com/xichan96/dinotty/issues) 反馈。

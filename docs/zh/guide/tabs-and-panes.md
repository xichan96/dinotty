# Tab 与分屏管理

Dinotty 的布局系统统一了终端、文件编辑器、插件、网页预览四种 pane 类型--它们都可以拖拽分屏、跨 Tab 移动、提取为独立 Tab。

## Tab 操作

| 操作 | 快捷键 |
|------|--------|
| 新建 Tab | `Cmd + T`（Windows/Linux `Ctrl + T`） |
| 关闭当前 Tab | `Cmd + W` |
| 切换到下一个 / 上一个 Tab | `Cmd + Shift + ]` / `[` |
| 跳转到第 N 个 Tab | `Cmd + <N>`（如 `Cmd + 3`） |
| 重命名 Tab | 双击 Tab 标题 |

Tab 顺序按工作区持久化，刷新页面后恢复。

## 分屏

| 操作 | macOS | Windows/Linux |
|------|-------|---------------|
| 水平分屏（新面板在右侧） | `Cmd + \` | `Ctrl + \` |
| 垂直分屏（新面板在下方） | `Cmd + Shift + \` | `Ctrl + Shift + \` |
| 切换到下一个 / 上一个面板 | `Cmd + Shift + ]` / `[` | `Ctrl + Shift + ]` / `[` |
| 当前面板最大化 / 还原 | `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` |
| 等分所有面板 | `Cmd + =` | `Ctrl + =` |
| 关闭当前面板 | `Cmd + W`（焦点在 pane 上时） | `Ctrl + W` |

## 拖拽分屏

除了快捷键，还可以用鼠标拖拽：

1. **拖拽 pane 标题栏**：按住后拖到目标区域（上下左右半区 / 中心覆盖）
2. **拖拽 Tab 到 pane 内**：把 Tab 从标签栏拖到某个 pane，转换为该 pane 的内容
3. **拖拽到屏幕边缘**：自动吸附为半屏

拖拽过程中会显示**高亮指示器**标示放置位置。

## 跨 Tab 拖拽

把一个 pane 从当前 Tab 拖到另一个 Tab：

1. 按住 pane 标题栏开始拖动
2. 拖到目标 Tab 的标签上停留 0.5 秒，目标 Tab 自动切换到前台
3. 切换后继续拖到目标 pane 区域释放

也可以把 pane 拖到 Tab 栏外的空白处，自动**提取为新 Tab**。

## 布局模板

复杂分屏布局可以保存为模板，重复使用：

- **保存模板**：当前 Tab 的分屏布局 -> 工具栏「保存为模板」按钮 -> 命名
- **应用模板**：新建 Tab 时选择模板，或在已有 Tab 上应用模板
- **管理模板**：在设置面板查看/编辑/删除已保存模板

模板包含 pane 类型（终端/文件/插件/网页）、相对尺寸、关联的 SSH 连接（如适用）。

::: tip Phase 5 待做
模板管理界面（Phase 5）尚未完成，目前模板只能通过保存/应用流程管理。详见 [布局模板设计](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/layout-templates-design.md)。
:::

## Pane 类型

| 类型 | 说明 |
|------|------|
| 终端 | 默认 pane，运行 shell / Coding Agent |
| 文件编辑器 | Monaco 编辑器，详见 [文件编辑器](../features/file-editor) |
| 插件 | Vue 3 渲染的插件 UI，详见 [插件](../plugins/plugins) |
| 网页预览 | 内建反代 + iframe，详见 [网页预览](web-preview) |

四种 pane 共享同一套分屏/拖拽/Tab 规则。

## 多光标与 Cursor Group

- **Monaco 原生多光标**：单文件内多光标编辑，详见 [文件编辑器](../features/file-editor#多行编辑-多光标)
- **Cursor Group**：跨文件 / 跨分屏广播光标位置，多端协同编辑时使用

## 下一步

- [文件编辑器](../features/file-editor) - Monaco 编辑功能详解
- [网页预览](web-preview) - 内建网页预览 pane
- [工作区管理](workspace) - 多工作区隔离

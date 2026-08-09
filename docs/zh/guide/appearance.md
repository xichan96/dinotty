# 外观主题

Dinotty 视觉风格遵循 VSCode 暗灰主题（中性灰 `#8a8a8a`）。内置主题管理器让你切换主题、调整字体、自定义颜色。

## 主题管理

打开 设置 -> 外观，顶部是主题管理器：

- **主题列表**：内置 + 自定义主题
- **当前主题**：高亮显示
- **新建主题**：基于当前主题克隆
- **导入主题**：从 JSON 文件导入
- **导出主题**：把当前主题导出为 JSON 分享

## 内置主题

| 主题 | 风格 |
|------|------|
| One Dark Pro Muted | 默认主题，低饱和度暗灰 |
| GitHub Dark | 深蓝灰，偏冷 |
| Monokai Pro | 暖色调，经典编辑器配色 |
| Solarized Dark | 蓝绿底，柔和不刺眼 |
| Dracula | 紫色调，对比度高 |

色板统一遵循 muted 风格，避免高饱和糖果色（`#FF5D5D` 等）。

## 字体设置

| 设置 | 范围 | 默认 |
|------|------|------|
| 字体大小 | 8-32 px | 14 |
| 字体族 | 系统字体 + 常见等宽字体 | SF Mono / Cascadia Code / Consolas |
| 行高 | 1.0-2.0 | 1.4 |
| 字符间距 | -2 to 5 | 0 |

字体下拉菜单显示**当前字体的预览**（每个字体项用自身字体渲染）。

::: tip 等宽字体推荐
- macOS: SF Mono, JetBrains Mono
- Windows: Cascadia Code, Consolas
- Linux: Fira Code, JetBrains Mono
:::

## 主题编辑器

点击主题管理器的「编辑」按钮打开主题编辑器：

- **颜色 token 编辑**：每个 token 一行，颜色选择器修改
- **实时预览**：右侧 sample terminal 实时显示效果
- **保存 / 另存为**：覆盖当前主题或保存为新主题

### 颜色 token

主题由一组 token 定义：

| Token | 用途 |
|-------|------|
| `--bg-*` | 背景层级（base / panel / hover / active） |
| `--fg-*` | 前景层级（base / muted / subtle） |
| `--color-*` | 强调色（accent / success / warning / error） |
| `--border-*` | 边框层级 |

新增颜色应先在 `frontend/src/styles/base.css` 注册为 token，再在主题里引用 `var(--color-*)`，避免在组件里硬编码 hex。详见 [Visual Style](https://github.com/xichan96/dinotty/blob/dev/CLAUDE.md#visual-style)。

## 工作区颜色

工作区徽章的颜色独立于主题：

- 创建工作区时自动分配
- 从 One Dark Pro muted 色板选
- 右键工作区 -> 修改颜色

详见 [工作区管理 -> 工作区颜色](workspace#工作区颜色)。

## 多端共享

主题是**服务端级别**的配置，所有连接的端共享同一份。手机上切换主题，桌面端实时生效。

## 配置目录

主题配置保存在：

| 平台 | 路径 |
|------|------|
| macOS / Linux | `~/.config/dinotty/themes/` |
| Windows | `%APPDATA%\dinotty\themes\` |
| Linux 服务端 | `/var/lib/dinotty/themes/` |

每个主题一个 JSON 文件，可直接编辑或备份。

## 下一步

- [移动键盘与快捷键](mobile-keyboard) - 字体大小影响键盘高度
- [文件编辑器](../features/file-editor) - 编辑器配色随主题
- [多端同步与 Mission Control](multi-device-sync) - 主题多端共享

# 外观主题

Dinotty 视觉风格遵循 VSCode 暗灰主题（中性灰 `#8a8a8a`）。内置主题管理器让你切换主题、调整字体、自定义颜色。

## 主题管理

打开 设置 -> 外观，顶部是主题管理器：

- **主题列表**：内置、已安装、以及你自己的自定义主题
- **当前主题**：高亮显示
- **新建主题**：基于当前主题克隆
- **导入主题**：把主题文件加入你自己的主题库
- **安装到服务器**：把主题文件装到服务器上，供该服务器上的所有设备使用
- **导出主题**：把当前主题导出为 `.conf` 文件
- **主题商店**：安装已配置的主题源里列出的主题（见下文）

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

## 主题来源

共有三种，彼此并不等价：

| 来源 | 存放位置 | 谁可见 | 可否编辑 |
|------|----------|--------|----------|
| 内置（12 套） | 编译进应用 | 所有人 | 不可，但可隐藏 |
| 已安装 | 服务器上的 `themes/` | 该服务器上的所有设备 | 不可，只能移除后重装 |
| 自定义 | 服务器上的 `settings.json` | 该服务器上的所有设备 | 可以，上限 15 套 |

已安装主题刻意不计入 15 套的自定义主题库：它们是分享来的文件，而不是你自己的作品，
否则会被这个上限截断。

**当前主题是每个设备各自的**，保存在本地，因此手机和桌面可以选择不同的主题，
同时共用同一份已安装主题和自定义主题。

## 配置目录

已安装的主题文件保存在：

| 平台 | 路径 |
|------|------|
| macOS / Linux | `~/.config/dinotty/themes/` |
| Windows | `%APPDATA%\dinotty\themes\` |
| Linux 服务端 | `/var/lib/dinotty/themes/` |

每个主题一个文件，可以是 `<id>.json`（应用自己写入的格式），也可以是 Ghostty
`.conf`（**导出主题**产出的格式）——两种都会被读取，所以导出的主题可以直接放回来。
文件只被当作数据读取，绝不会被执行，也可以手工编辑或备份。

你的自定义主题**不在这里**：它们位于 `settings.json`，因为那是可编辑的设置，
而不是共享内容。

## 主题商店

默认不启用，需要把服务器指向一个主题源：

```sh
DINOTTY_THEMES_REGISTRY_URL=https://example.com/dinotty/themes/registry.json dinotty
```

主题源是一个 JSON 文档：

```json
{
  "schema": 1,
  "themes": [
    {
      "id": "dracula-soft",
      "name": "Dracula Soft",
      "version": "1.0.0",
      "minAppVersion": "0.28.0",
      "url": "https://example.com/dinotty/themes/dracula-soft.json",
      "sha256": "<可选>"
    }
  ]
}
```

主题源和主题文件都由服务器去拉取，客户端只能指定 id，无法让服务器去抓取任意地址。
条目里带了 `sha256` 时会与下载到的字节比对，不匹配则拒绝安装。

## 下一步

- [移动键盘与快捷键](mobile-keyboard) - 字体大小影响键盘高度
- [文件编辑器](../features/file-editor) - 编辑器配色随主题
- [多端同步与 Mission Control](multi-device-sync) - 主题多端共享

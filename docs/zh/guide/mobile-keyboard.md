# 移动键盘与快捷键

Dinotty 为手机/平板优化的输入体验：内置可自定义的快捷键盘补齐 Ctrl/Esc/方向键/功能键，并支持硬件键盘多端同步。

## 移动键盘

### 启用

移动端默认显示快捷键盘栏（在屏幕底部，原生键盘上方）。可通过键盘切换按钮（`KbToggleButton`）开关。

### 布局

移动键盘分多行：

| 行 | 按键 |
|----|------|
| 修饰键行 | `Ctrl` `Alt` `Shift` `Esc` `Tab` `Meta` |
| 方向键行 | `←` `↑` `↓` `→` `Home` `End` `PageUp` `PageDown` |
| 功能键行 | `F1`-`F12` |
| 自定义行 | 用户配置的常用键 |
| 历史栏 | 最近输入的命令（点击快速重发） |

修饰键支持**粘滞模式**：点击 `Ctrl` 高亮（不松开），再点击字母，相当于 `Ctrl + 字母`。

### 自定义布局

设置 -> 键盘 -> 编辑布局：

- 添加 / 删除按键
- 修改按键标签和发送的字符
- 设置按键宽度（flex-grow）
- 拖拽调整顺序

布局保存在服务端，多端共享。详见 [Keyboard Layout 设计](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/additional-features-design.md)。

## 历史栏

键盘顶部的历史栏显示最近 N 条输入命令：

- 点击重发命令（自动回车）
- 长按删除条目
- 横向滑动查看更多

## 硬件键盘多端同步

多个设备同时连接时，硬件键盘事件会同步：

| 同步内容 | 行为 |
|---------|------|
| 选中状态 | 某端选中文本，其他端高亮同样位置 |
| 打开状态 | 某端打开文件，其他端文件树同步展开 |
| 输入协调 | 同一时刻只有一个端能输入（聚焦判定） |

详细设计见 [Hardware Keyboard Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/hardware-keyboard-design.md)。

## 快捷键速查表

### 全局

| 操作 | macOS | Windows/Linux |
|------|-------|---------------|
| Command Palette | `Cmd + Shift + P` | `Ctrl + Shift + P` |
| 切换全屏 | `Cmd + Shift + F` | `F11` |
| 设置面板 | `Cmd + ,` | `Ctrl + ,` |
| Mission Control | `Cmd + Shift + M` | `Ctrl + Shift + M` |

### Tab / Pane

| 操作 | macOS | Windows/Linux |
|------|-------|---------------|
| 新建 Tab | `Cmd + T` | `Ctrl + T` |
| 关闭 Tab | `Cmd + W` | `Ctrl + W` |
| 水平分屏 | `Cmd + \` | `Ctrl + \` |
| 垂直分屏 | `Cmd + Shift + \` | `Ctrl + Shift + \` |
| 切换 pane | `Cmd + Shift + ]` / `[` | `Ctrl + Shift + ]` / `[` |
| pane 最大化 | `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` |
| 广播模式 | `Cmd + Shift + B` | `Ctrl + Shift + B` |

### 文件编辑器

| 操作 | macOS | Windows/Linux |
|------|-------|---------------|
| 保存 | `Cmd + S` | `Ctrl + S` |
| 多光标（下方加） | `Cmd + Option + ↓` | `Ctrl + Alt + ↓` |
| 多光标（点击加） | `Option + Click` | `Alt + Click` |
| 命令面板 | `Cmd + Shift + P` | `Ctrl + Shift + P` |

详见 [文件编辑器](../features/file-editor)。

## 已知问题

- **iOS Safari 中文输入**：见 [WKWebView 中文标点问题](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/tech-debt-wkwebview-composition.md)，已通过 compositionend 直接 sendData 绕过

## 下一步

- [多端同步与 Mission Control](multi-device-sync) - 三端协同
- [Tab 与分屏管理](tabs-and-panes) - 完整快捷键列表
- [外观主题](appearance) - 字体大小 / 字体家族设置

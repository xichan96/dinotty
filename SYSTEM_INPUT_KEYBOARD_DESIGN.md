# Dinotty 系统输入法模式设计

> 状态：实施中。本文是该功能的统一产品与技术设计文档。

## 1. 背景与目标

Dinotty 当前在移动端提供完整的内置键盘，其中同时包含两类能力：

1. 字母、数字、符号、空格、退格、回车等常规文字输入；
2. `Ctrl`、`Alt`、`Esc`、`Tab`、方向键、功能键、自定义动作、历史和文件操作等终端快捷能力。

第一类能力与手机系统输入法重复，并且无法完整覆盖中文、日文、韩文、语音、滑行输入、联想候选和第三方输入法。第二类能力则是普通手机输入法没有的，也是 Dinotty 移动端键盘的核心价值。

本功能新增“系统输入法”模式：用户使用手机输入法完成常规文字输入，同时继续使用 Dinotty 原有的终端快捷键盘。

核心原则是：**只替换与手机输入法重复的字符输入区，不替换、不删除、不重置快捷键盘。**

## 2. 产品决定

- 在“设置 -> 键盘 -> 移动端输入方式”中提供模式切换。
- 提供“Dinotty 内置键盘”和“系统输入法”两个模式。
- 全局配置尚未选择输入方式时，首次请求打开终端键盘会显示选择向导。
- 选择结果通过现有全局设置保存，并同步到所有设备。
- 系统输入法只接管字母、数字、常规符号、空格、退格和回车等字符输入。
- Dinotty 的终端快捷键、操作键盘、历史、自定义动作、文件与粘贴工具继续保留。
- 现有内置键盘保持完整可用，作为兼容模式和随时可切换的回退方案。
- 不修改后端 PTY 输入协议和现有 WebSocket `input` 消息格式。

## 3. 键盘区域边界

### 3.1 逻辑区域

| 区域         | 示例                                       | 内置键盘模式          | 系统输入法模式                   |
| ------------ | ------------------------------------------ | --------------------- | -------------------------------- |
| 字符输入区   | QWERTY、数字、符号、空格、退格、回车       | 使用 Dinotty 内置按键 | 使用手机系统输入法               |
| 终端快捷键区 | `Esc`、`Tab`、修饰键、符号和控制组合键     | 保持现状              | 继续由 Dinotty 显示和发送        |
| 自定义快捷区 | `toolbar_quick_keys`、操作键盘、自定义动作 | 保持现状              | 保持现状                         |
| 辅助工具区   | 历史、文件、上传、粘贴、收起键盘           | 保持现状              | 保持现状或按输入目标调整发送方式 |

不能把当前 `#mkb-main-panel` 整体当作字符输入区直接隐藏。该面板内同时存在字符键和方向键、修饰键等终端快捷键。实现时需要按键职责拆分：

- 与手机输入法重复的字符键交给系统输入法；
- 系统输入法上方固定显示与 Termius 对齐的 `Esc`、`Tab`、`Ctrl`、`Alt`、`/`、`|`、`~`、`-`、`^C`、`^I`、`^S`、`^Z`；方向键和其他终端键仍可在完整操作键盘中使用；
- `#mkb-action-panel`、`toolbar_quick_keys`、历史和用户已有的操作键盘配置继续使用原数据和行为，不建立第二份配置。

### 3.2 系统输入法模式布局

```text
┌─────────────────────────────────┐
│              终端               │
├─────────────────────────────────┤
│ 历史 / 收藏 / 扩展键盘 / 快捷键盘 │  Dinotty 工具入口
├─────────────────────────────────┤
│ Esc Tab Ctrl Alt / | ~ - ^C ... │  Termius 风格快捷键盘
├─────────────────────────────────┤
│          手机系统输入法           │  仅替代字符输入区
└─────────────────────────────────┘
```

系统输入法上方的工具栏固定提供历史、收藏、Termius 风格扩展键盘和用户可配置的快捷键盘，最右侧是收起键盘。文件、上传和独立粘贴入口不在这一行显示。点击扩展键盘图标时打开与 Termius 相近的 8×8 终端按键面板；“快捷键盘”继续打开用户现有的 `action_keyboard` 配置。打开任一面板时收起系统输入法，返回字符输入时再聚焦终端并呼出系统输入法。

## 4. 设置入口

在“设置 -> 键盘”中增加“移动端输入方式”分段选择控件：

| 选项             | 说明                                                      |
| ---------------- | --------------------------------------------------------- |
| Dinotty 内置键盘 | 使用当前完整内置键盘，行为与现有版本一致                  |
| 系统输入法       | 使用手机输入法输入字符，同时保留 Dinotty 快捷键盘和工具栏 |

推荐类型：

```ts
export type MobileInputMode = "builtin" | "system";
```

设置属于全局配置。手机上的选择会同步影响平板、另一台手机和桌面浏览器后续使用的移动端输入方式。

设置变更原则上在下一次呼出键盘时生效。如果切换设置时终端键盘仍然打开，应按以下顺序处理：

1. 等待当前 IME composition 正常结束，或明确取消本次预编辑；
2. blur 旧输入目标并收起旧键盘；
3. 应用新的 textarea 输入策略；
4. 由用户下一次点击终端或键盘按钮重新打开目标键盘。

不要在 composition 过程中直接替换输入模式，否则可能造成预编辑文字丢失或重复发送。

## 5. 首次呼出选择向导

### 5.1 触发条件

只有以下条件同时满足时才显示向导：

- 当前设备支持触摸输入；
- 用户正在请求终端输入，例如点击终端区域或点击键盘悬浮按钮；
- 全局设置尚未保存 `mobile_input_mode`。

登录框、搜索框、设置项、文件编辑器、命令面板和网页预览地址栏等普通输入框不得触发该向导。

### 5.2 向导内容

向导显示两个清晰的可选卡片：

- **系统输入法（推荐）**：支持手机语言切换、中文联想、语音、滑行输入和第三方输入法；Dinotty 快捷键盘仍然保留。
- **Dinotty 内置键盘**：使用固定的终端键位布局，不依赖系统输入法，适合作为兼容模式。

两张卡片都应明确显示“快捷键盘保留”，避免用户误以为选择系统输入法后会失去 `Ctrl`、`Esc`、方向键或自定义操作。

### 5.3 选择与关闭行为

状态模型：

```text
未选择
  └─ 首次请求终端键盘 -> 选择向导
       ├─ 选择 builtin -> 保存 -> 打开现有内置键盘
       └─ 选择 system  -> 保存 -> 聚焦 xterm -> 打开系统输入法 + 快捷工具栏
```

不需要额外维护 `guide_seen`。全局设置中没有 `mobile_input_mode` 就表示尚未完成首次选择，避免两个状态字段失配。任意设备完成选择后，其他设备加载设置时不会再次显示向导。

如果用户关闭向导而未选择，推荐本次不打开键盘，并在下一次请求终端键盘时再次显示向导。只有用户明确选择一种模式后才持久化。这样不会替用户做不可见的默认决定；如果后续产品决定“关闭即使用内置键盘”，也必须在关闭按钮附近明确说明。

### 5.4 iOS 用户手势约束

选择“系统输入法”的卡片点击本身必须作为打开软键盘的用户手势。在同一个同步点击调用栈中完成：

1. 同步更新内存中的全局设置并发起异步保存（不能等待网络请求）；
2. 配置活动 xterm textarea；
3. 调用活动终端的 `focus()`。

不能在 `await`、定时器或仅在 `nextTick()` 之后才 focus。iOS Safari/PWA 可能允许焦点变化，却拒绝弹出系统软键盘。

## 6. 配置持久化

移动端输入方式应扩展现有 `/api/settings` 全局设置，通过服务端设置文件持久化并同步到所有设备。`ime_keyboard_overlap_px` 仍然是设备视口校准值，继续由 `useDeviceKeyboardSettings` 保存在 `localStorage`。

建议前端全局设置状态：

```ts
interface SettingsData {
  mobile_input_mode: MobileInputMode | null;
}
```

后端使用等价的可选枚举字段：

```rust
pub mobile_input_mode: Option<MobileInputMode>
```

- 字段缺失或为 `null`：全局首次选择尚未完成；
- `builtin`：使用现有内置字符键盘；
- `system`：使用手机输入法替代字符输入区。

已产生的 `dinotty.device-keyboard.v2` 本地数据可能带有旧版 `mobile_input_mode`。读取时必须忽略并清理该本地字段，同时保留用户已有的 `ime_keyboard_overlap_px`；本地模式不得覆盖服务端全局设置。

## 7. 系统输入法技术方案

### 7.1 复用 xterm 输入链路

系统输入法模式直接复用 xterm.js 的 `.xterm-helper-textarea`：

```text
用户请求终端输入
  -> 聚焦活动 pane 的 xterm textarea
  -> 手机系统输入法打开
  -> xterm 处理 compositionstart/update/end
  -> xterm onData
  -> TerminalInstance._handleXtermData
  -> WebSocket / PTY
```

当前触屏设备会对 xterm textarea 设置：

```ts
textarea.inputMode = "none";
textarea.setAttribute("virtualkeyboardpolicy", "manual");
```

这些属性需要改为模式驱动：

```ts
if (mobileInputMode === "system") {
  textarea.inputMode = "text";
  textarea.setAttribute("virtualkeyboardpolicy", "auto");
  textarea.enterKeyHint = "enter";
} else {
  textarea.inputMode = "none";
  textarea.setAttribute("virtualkeyboardpolicy", "manual");
}
```

应抽出统一的 `configureMobileInputTextarea()`，既配置已经存在的 pane，也保证之后创建的 pane 使用当前全局模式。

不要新增另一个隐藏 textarea，再通过 `beforeinput` 自行计算增量并实时发送。xterm 已经处理 IME composition、预编辑文本显示和最终输入发送；复用它可以减少中文、韩文、emoji 和第三方输入法的重复发送风险。

### 7.2 焦点所有权

需要明确三种焦点状态：

```ts
type MobileKeyboardFocusOwner = "none" | "builtin-input" | "xterm-input";
```

- `builtin-input`：现有独立编辑 textarea 持有焦点，继续使用当前 `setKbTypingLock()` 防止 xterm 抢焦点；
- `xterm-input`：系统输入法模式，活动 xterm textarea 必须可用，不能被 typing lock 禁用；
- `none`：终端键盘已收起或焦点进入其他真实输入框。

当前 `focusActive()` 中“触屏且键盘可见就禁止终端 focus”的条件需要收窄为“内置输入框持有 typing lock 时禁止”。否则系统输入法模式切换 tab 或 pane 后无法把焦点移动到新的活动终端。

### 7.3 打开、切换与收起

- 点击终端或键盘悬浮按钮时，在原始用户手势中同步 focus 活动 xterm textarea。
- 切换 pane 时，系统输入法模式把焦点移动到新的活动 xterm textarea；快捷工具栏始终向当前活动 pane 发送。
- 点击快捷工具栏不能 blur xterm textarea，按钮使用 `pointerdown.prevent` 或等价的 touch 处理。
- 聚焦搜索、设置、文件编辑器或预览地址栏时，应隐藏终端快捷工具栏，但不能干扰新输入框自己的系统键盘。
- 点击收起按钮时 blur 活动 xterm textarea、隐藏工具栏、清理虚拟修饰键并重新 fit 终端。
- 滚动导致键盘收起时，不能只隐藏工具栏；还需要 blur xterm textarea，否则系统键盘可能继续留在屏幕上。

## 8. 快捷键盘行为

### 8.1 必须保留的能力

系统输入法打开时，固定快捷栏按以下顺序显示：

- `Esc`、`Tab`、`Ctrl`、`Alt`；
- `/`、`|`、`~`、`-`；
- `^C`、`^I`、`^S`、`^Z`；
- `toolbar_quick_keys`；
- 历史、收藏、Termius 风格扩展键盘入口；
- 切换到用户可配置的快捷键盘；
- 收起系统输入法。

方向键、功能键和其他终端动作继续由完整操作键盘提供，不重复放入固定快捷栏。

完整 `#mkb-action-panel` 继续使用现有配置。切换输入模式不能清空、迁移或复制用户的快捷键盘布局。

### 8.2 Ctrl 与 Alt

当前内置键盘的粘滞 `Ctrl`/`Alt` 状态只会处理随后点击的内置字符键，无法自动修改手机输入法产生的文字。

固定栏直接提供 `^C`、`^I`、`^S`、`^Z` 控制组合键。Termius 风格的粘滞修饰键应在 `TerminalInstance._handleXtermData()` 收到 xterm 最终输入后处理下一次兼容的 ASCII 字符：

- Ctrl + 单个兼容 ASCII 字符转换为控制字符；
- Alt + 文本添加 `ESC` 前缀；
- 完成一次有效转换、切换 pane、blur 或收起键盘时释放状态；
- 非 ASCII composition 结果不应被错误转换。

不能只在工具栏组件中切换 `modState`，否则手机键盘输入不会经过该状态。

### 8.3 粘贴和文件路径

- 系统输入法模式优先调用 `xterm.paste()`，保留 bracketed paste 语义；
- 粘贴默认不自动回车；
- 文件路径使用 `shellEscapePath()` 后通过终端粘贴链路插入；
- 当前依赖独立 textarea 选区的“删除路径/段落”在系统输入法模式下应替换为明确的终端动作，例如发送 `Ctrl+U`，不能假设网页知道 shell 的真实编辑缓冲区。

## 9. 视口和工具栏定位

网页版不能像原生 Termius 一样注册真正的 iOS `inputAccessoryView`。Dinotty 的实现是固定在可视视口中、位于系统输入法上沿的 HTML 工具栏。

继续使用 `VisualViewport` 计算：

- 系统键盘是否打开；
- 系统键盘遮挡高度；
- Dinotty 工具栏的 bottom 偏移；
- 终端可用高度和重新 fit 时机。

当前 `MobileKeyboard` 和 `useViewportResize` 各自维护了一套系统键盘检测并写入相关 CSS 变量。实现新模式前建议收敛为单一状态来源，统一输出：

```ts
systemKeyboardOpen;
systemKeyboardHeight;
terminalImeFocused;
toolbarBottom;
```

横竖屏、iPad 分屏或 Stage Manager、PWA 前后台切换时需要重新建立未遮挡视口基线，不能只依赖固定高度阈值判断键盘开关。

第一版不依赖支持范围有限的 `navigator.virtualKeyboard` API。

## 10. 建议代码改动

| 文件或组件                                                   | 主要改动                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `frontend/src/composables/useSettings.ts`                    | 增加全局 `mobile_input_mode` 类型、默认未选择状态和 API 持久化 |
| `src/settings/types.rs`                                      | 增加可选的 `MobileInputMode` 枚举字段，兼容旧配置              |
| `frontend/src/composables/useDeviceKeyboardSettings.ts`      | 只保留设备级遮挡高度，并清理旧版本地模式数据                   |
| `frontend/src/components/settings/KeyboardTab.vue`           | 增加“移动端输入方式”分段选择                                   |
| `frontend/src/composables/useI18n.ts`                        | 增加中英文设置和向导文本                                       |
| `frontend/src/composables/useTerminal.ts`                    | 模式化配置 xterm textarea，处理系统输入焦点和可选虚拟修饰键    |
| `frontend/src/App.vue`                                       | 首次向导、活动 pane 路由、打开与收起流程                       |
| `frontend/src/composables/useTabLifecycle.ts`                | 仅在内置输入 typing lock 时阻止终端 focus                      |
| `frontend/src/components/keyboard/MobileKeyboard.vue`        | 拆分字符区与快捷区，保留现有操作键盘                           |
| `frontend/src/components/keyboard/SystemKeyboardToolbar.vue` | 系统输入法工具栏、Termius 扩展面板和用户快捷键盘入口           |
| `frontend/src/composables/useViewportResize.ts`              | 统一系统键盘开关、遮挡高度和 refit 状态                        |
| `frontend/src/styles/mobile-keyboard.css`                    | 增加系统输入法工具栏布局和安全区适配                           |

## 11. 验收标准

- 全局设置未选择输入方式时，第一次点击终端或键盘悬浮按钮会出现选择向导。
- 用户明确选择后，所有设备加载并使用同一个输入方式，不再重复显示向导。
- “设置 -> 键盘”可以随时切换内置键盘和系统输入法模式。
- 系统输入法模式只替换字符输入区，Dinotty 快捷键盘、操作键盘、历史和自定义配置继续可用。
- 系统输入法可以输入英文、中文、日文、韩文、数字、符号和 emoji，最终 composition 文本只发送一次。
- 固定快捷栏严格按 `Esc`、`Tab`、`Ctrl`、`Alt`、`/`、`|`、`~`、`-`、`^C`、`^I`、`^S`、`^Z` 排列并发送正确字节。
- 内置键盘模式的现有布局和行为不回归。
- 切换 tab、pane、横竖屏和 PWA 前后台后，输入发送到正确的活动 pane。
- 系统输入法输入和快捷键盘输入都遵循现有广播模式语义。
- 粘贴遵循 bracketed paste，默认不附加回车。
- iOS Safari、iOS PWA、Android Chrome 和 HarmonyOS 浏览器至少各完成一次真机验证。

## 12. 测试计划

### 自动化测试

- 全局设置缺少模式时保持未选择，`builtin`/`system` 能通过 `/api/settings` 往返；
- 设备设置 `v1 -> v2` 迁移和旧版 `v2` 清理都保留 `ime_keyboard_overlap_px`，且不再保留本地模式；
- 未设置模式时只在终端键盘请求路径显示向导；
- 明确选择后正确持久化，普通输入框不触发向导；
- 两种模式正确设置 xterm textarea 的 `inputMode` 和 `virtualkeyboardpolicy`；
- 内置输入 typing lock 不影响系统输入法模式的 xterm textarea；
- 切换 pane 后工具栏和系统输入发送到新的活动 pane；
- 工具栏 pointer/touch 操作不夺走输入焦点；
- 粘贴、广播、收起和滚动路径行为正确；
- composition 期间不切换模式、不重复发送最终文本。

### 真机测试

- iOS 拼音、日文、emoji、语音输入；
- Gboard、三星输入法、第三方中文输入法；
- 连续退格、长按候选、Enter、自动纠正关闭行为；
- bash/zsh、PowerShell、cmd、SSH、tmux、vim、nano 和交互式 TUI；
- 分屏切换、广播模式、横竖屏、PWA 前后台恢复；
- 文件选择、手机剪贴板、主机剪贴板和多行 bracketed paste。

## 13. 分阶段实施

### 阶段一：真机验证原型

- 临时允许 xterm textarea 使用 `inputMode = 'text'`；
- 提供 Termius 风格固定快捷栏、粘贴和收起工具栏；
- 在 iOS Safari/PWA、Android Chrome 上验证 composition、Enter、退格和视口定位。

### 阶段二：完整模式

- 增加设置入口和首次选择向导；
- 完成全局设置持久化和旧版设备数据清理；
- 保留完整操作键盘、自定义快捷键、历史和文件工具；
- 完成 pane、广播、滚动、旋转和前后台状态管理。

### 阶段三：增强体验

- 增加粘滞 Ctrl/Alt；
- 优化横屏和小屏工具栏布局；
- 根据真机结果决定是否允许用户在固定快捷栏之外追加自定义键位。

## 14. 非目标

- 不替换、删除或重新设计现有快捷键盘。
- 不让手机输入法负责 `Esc`、功能键、方向键等终端专用输入。
- 不在第一版修改后端 PTY 或 WebSocket 协议。
- 不跨设备同步 `ime_keyboard_overlap_px` 等设备视口校准数据。
- 不自行实现一套替代 xterm composition 的输入法状态机。

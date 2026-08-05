# 系统输入法模式代码审查记录

## 1. 页面恢复或旋转后键盘高度可能丢失

`frontend/src/composables/useViewportResize.ts` 的 `reset()` 会清空 `naturalVH`。如果旋转屏幕、切换前后台或发生 `blur/focus` 时输入法仍然打开，后续重采样无法重新建立未遮挡视口基线，页面会误判系统键盘已经关闭，导致 toolbar 落到系统键盘后面。

**建议修复：** 将“清理当前显示状态”和“丢弃自然视口基线”分开处理。短暂的 `blur/pagehide` 不应直接清空有效基线；旋转后若仍有遮挡，可根据 layout viewport 重新计算基线，或者保留键盘打开状态，直到取得一次确认未遮挡的采样。

## 2. iOS 原生收起键盘后 toolbar 状态残留

系统 toolbar 只依赖 `kbVisible` 显示。iOS 的 Done 或键盘收起按钮可能在 textarea 仍保持焦点时关闭输入法，此时 VisualViewport 已恢复，但 `kbVisible` 不会同步变为 `false`。toolbar 会继续显示，而且再次对已聚焦 textarea 调用 `focus()` 通常无法重新唤起输入法。

**建议修复：** 监听系统键盘从打开到关闭的 VisualViewport 边沿；如果 xterm textarea 仍是活动元素，则调用统一的键盘 dismiss 流程，同步清理 `kbVisible`、`terminalImeFocused`、虚拟修饰键并 blur textarea。

## 3. 完整操作面板执行 Paste 后会重新聚焦终端

打开完整操作面板时终端会被 blur，但 `TerminalPane.pasteFromClipboard()` 会无条件调用 `terminal.focus()`。因此 Paste 等操作可能重新弹出系统输入法，而 `systemActionKeyboardOpen` 仍为 `true`，造成完整面板和系统输入法同时占据屏幕。

**建议修复：** 为粘贴操作增加“不获取焦点”的调用方式；完整操作面板打开期间只写入终端，不重新 focus。仅在用户明确返回字符输入模式时关闭操作面板并聚焦 xterm textarea。

## 4. 非终端 leaf 上仍会显示系统 toolbar

一个 terminal tab 内可以包含 `plugin`、`files` 或 `web` leaf。当前代码只检查外层 tab 类型，没有检查活动 leaf 的 `kind`。切换到非终端 leaf 后，`kbVisible` 可能继续为 `true`，toolbar 会覆盖内容，但 `termRefs` 中没有对应实例，因此发送按键全部无效。

**建议修复：** 显示 toolbar、请求键盘和生成 `getSendFn()` 前统一检查活动 leaf 是否为 `terminal`。切换到非终端 leaf 时，应立即执行 dismiss、清除虚拟修饰键并关闭完整操作面板。

## 建议补充测试

- IME 打开时旋转屏幕，以及 `pagehide/pageshow`、`blur/focus` 后恢复。
- iOS 原生 Done/收起键盘且 textarea 未失焦的场景。
- 完整操作面板中执行 Paste 后的焦点和面板状态。
- 在 terminal、plugin、files、web leaf 之间切换时的 toolbar 状态。

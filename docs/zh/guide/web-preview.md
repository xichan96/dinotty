# 网页预览

Dinotty 内建反向代理，可以在 pane 中预览本地开发服务器或外部 URL，无需切到浏览器。

## 打开网页预览 pane

| 方式 | 操作 |
|------|------|
| 工具栏 | 点击 Monitor 图标按钮，自动创建或聚焦网页预览/文件预览 leaf |
| Command Palette | 输入 `webpreview.open` |
| 拖拽 URL | 把地址栏 URL 拖到 Dinotty 窗口 |
| 终端链接 | 在终端输出中 `Cmd` / `Ctrl` + 点击 URL，自动在新 leaf 中打开 |

网页预览 pane 与终端、文件编辑器、插件 pane 共享同一套分屏/拖拽规则，详见 [Tab 与分屏管理](tabs-and-panes)。

## 预览工具栏

每个网页预览 leaf 顶部都有工具栏：

- **后退 / 前进**：浏览历史导航，与浏览器一致
- **刷新**：强制重新加载（绕过 iframe 缓存）
- **地址栏**：输入 URL 后回车跳转；下拉显示最近访问的 URL
- **Open in browser**：在系统默认浏览器中打开当前 URL
- **书签（Star）**：收藏当前 URL，下次可从地址栏下拉快速访问
- **DevTools**：内建开发者工具面板，支持 Console / Network / Eval
- **关闭**：`Cmd + W`（焦点在 pane 上时）或点击 pane 头部的 X

## 本地开发服务器反代

预览 `http://localhost:<port>` 时，Dinotty 通过内建反向代理转发请求：

- **同源访问**：避免浏览器跨域限制
- **WebSocket 支持**：HMR / 实时刷新正常工作
- **路径保留**：`/preview/<port>/<path>` 透传到 `http://localhost:<port>/<path>`
- **自动重连**：开发服务器重启后预览自动恢复

::: tip 路径前缀
预览 URL 形如 `/preview/3000/foo/bar`，对应本地 `http://localhost:3000/foo/bar`。Dinotty 自动改写页面内的绝对路径，确保资源加载正常。
:::

## 外部 URL 代理

也可以预览任意外部 URL（如 `https://example.com`）：

- **GET 请求代理**：HTML / JSON / 图片等
- **响应改写**：注入 iframe 兼容脚本，处理 `X-Frame-Options` 拒绝
- **Cookie 隔离**：每次预览独立 session，避免污染主登录态

::: warning 外部 URL 限制
- 部分站点通过 CSP / `X-Frame-Options` 拒绝被嵌入，预览会显示空白
- 登录后的私人内容（如 Gmail）无法预览
- 仅用于查看公开页面或本地服务
:::

## 典型用法

### Coding Agent 网页验证

让 Claude Code / opencode 生成一个 Web 应用，agent 启动 dev server 后，你可以直接在 Dinotty 里预览效果，无需切到外部浏览器。

### 多端口同时预览

分屏 4 个网页预览 pane，分别指向 `:3000` / `:3001` / `:8080` / `:8888`，对比不同端口的输出。

### 移动端真机测试

桌面端跑 dev server，手机连同一服务端的 Dinotty，在手机上打开网页预览 pane，相当于在移动端真机测试。

## 关闭预览

- 关闭 pane：`Cmd + W`（焦点在 pane 上时）或点击 pane 头部的 X
- 后退 / 前进：预览工具栏内的导航按钮

## 下一步

- [Tab 与分屏管理](tabs-and-panes) - pane 布局
- [多端同步与 Mission Control](multi-device-sync) - 移动端真机测试
- [插件](../plugins/plugins) - 在 pane 中运行 Vue 插件

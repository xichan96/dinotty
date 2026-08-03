# Dinotty 插件开发指南

本文档介绍如何为 Dinotty 开发插件。

## 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [插件清单 plugin.json](#插件清单-pluginjson)
- [插件入口与生命周期](#插件入口与生命周期)
- [API 参考](#api-参考)
- [渲染 UI](#渲染-ui)
- [CSS 样式](#css-样式)
- [命令面板集成](#命令面板集成)
- [持久化存储](#持久化存储)
- [调用 CLI 工具](#调用-cli-工具)
- [事件订阅](#事件订阅)
- [TypeScript 支持](#typescript-支持)
- [开发工作流](#开发工作流)
- [打包与分发](#打包与分发)

---

## 概述

插件是一个目录，包含：

- `plugin.json` — 插件清单（必须）
- `main.js` — ESM 格式的 JavaScript 入口（必须）
- `styles.css` — 可选样式表
- `bin/` — 可选 CLI 二进制或脚本，供 `exec.run` / `exec.spawn` 调用

Dinotty 会扫描用户插件目录，在浏览器中动态 `import()` 加载 JS 入口，调用其导出的 `activate(context)` 函数。

| 平台 | 插件目录 |
|------|----------|
| Linux / macOS | `~/.dinotty/plugins/<plugin-id>/` |
| Windows | `%USERPROFILE%\.dinotty\plugins\<plugin-id>` |

插件可以：

- 在独立标签页中渲染自定义 UI（Vue 3 render function）
- 向命令面板注册命令
- 向终端面板发送输入
- 读写持久化键值存储
- 调用插件附带的 CLI 二进制

---

## 快速开始

下面以一个最小插件"Hello World"演示完整结构。

### 目录结构

```
~/.dinotty/plugins/hello-world/
├── plugin.json
├── main.js
└── styles.css
```

### plugin.json

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "最小示例插件",
  "icon": "terminal",
  "entry": "./main.js",
  "styles": "./styles.css",
  "commands": [
    { "id": "hello-world.open", "title": "打开 Hello World" }
  ]
}
```

### main.js

```js
export function activate(ctx) {
  const h = ctx.h
  const count = ctx.ref(0)

  ctx.commands.register('hello-world.open', () => {
    ctx.ui.notify('Hello from plugin!')
  })

  return {
    component: {
      render() {
        return h('div', { class: 'hw-root' }, [
          h('h1', null, 'Hello World'),
          h('p', null, `点击次数: ${count.value}`),
          h('button', { onClick: () => count.value++ }, '点击我'),
        ])
      },
    },
  }
}
```

### styles.css

```css
.hw-root {
  padding: 24px;
  font-family: sans-serif;
}
```

### 安装（开发模式）

```bash
# 直接放置目录即可，文件监听器会自动检测
mkdir -p ~/.dinotty/plugins/hello-world
# 将上面三个文件复制进去

# 或者通过 dev-link API（适合在项目目录中开发）
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/your/hello-world"}'
```

Windows PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dinotty\plugins\hello-world"
# 将上面三个文件复制进去

curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d '{"path":"C:\\Users\\you\\plugins\\hello-world"}'
```

`dev-link` 会创建目录符号链接；Windows 上如果失败，请开启 Developer Mode 或使用管理员权限。

---

## 插件清单 plugin.json

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识。只允许小写字母、数字、连字符（`[a-z0-9-]+`）。**必须与目录名相同**。 |
| `name` | string | ✅ | 插件显示名称 |
| `version` | string | ✅ | 语义化版本号（如 `1.0.0`） |
| `description` | string | ❌ | 简短描述，显示在插件列表中 |
| `icon` | string | ❌ | 图标标识符（如 `braces`、`repeat`、`terminal`） |
| `entry` | string | ❌ | JS 入口文件路径，相对于插件根目录。默认 `./main.js` |
| `styles` | string | ❌ | CSS 文件路径，相对于插件根目录 |
| `bin` | object | ❌ | CLI 二进制配置，详见[调用 CLI 工具](#调用-cli-工具) |
| `commands` | array | ❌ | 注册到命令面板的命令，格式见下方 |
| `minAppVersion` | string | ❌ | 最低所需 Dinotty 版本 |

**commands 格式：**

```json
"commands": [
  { "id": "myplugin.doSomething", "title": "执行某操作" }
]
```

`id` 建议以插件 id 为前缀以避免冲突。

---

## 插件入口与生命周期

`main.js` 必须导出一个 `activate` 函数：

```js
export function activate(ctx) {
  // 初始化逻辑...

  return {
    component: { /* Vue 组件，在插件标签页中渲染 */ },
    dispose() {
      // 插件卸载时的清理逻辑（移除事件监听、定时器等）
    },
  }
}

// 可选，插件卸载时调用（在 dispose 之前）
export function deactivate() {}
```

- `activate` 可以是 `async` 函数
- 返回值的 `component` 和 `dispose` 均为可选
- 如果插件只需注册命令而不需要 UI，可以不返回 `component`
- `activate` 有 10 秒超时限制；超时后插件加载失败

---

## API 参考

`activate(ctx)` 接收的 `ctx` 对象包含以下 API：

### Vue 响应式

```js
const count = ctx.ref(0)           // 响应式引用
const state = ctx.reactive({ ... }) // 响应式对象
const doubled = ctx.computed(() => count.value * 2)
ctx.watch(() => count.value, (val) => console.log(val))
ctx.onMounted(() => { /* 组件挂载后 */ })
ctx.onUnmounted(() => { /* 组件卸载前 */ })
const h = ctx.h                     // Vue h() 函数
```

### 终端

```js
// 向指定面板发送文本
ctx.terminal.send(paneId, 'echo hello\n')

// 获取当前活跃面板 ID
const id = ctx.terminal.activePaneId()

// 创建新终端标签页，返回 pane ID
const paneId = await ctx.terminal.createTab('bash')

// 监听终端输出（返回 Disposable）
const d = ctx.terminal.onOutput((paneId, data) => {
  console.log(paneId, data)
})
d.dispose() // 取消监听
```

### 持久化存储

数据存储在用户目录下的 `.dinotty/plugin-data/<plugin-id>/`，每个 key 对应一个 JSON 文件。Windows 上路径为 `%USERPROFILE%\.dinotty\plugin-data\<plugin-id>`。

```js
await ctx.storage.set('config', { theme: 'dark' })
const config = await ctx.storage.get('config')  // { theme: 'dark' }
const keys = await ctx.storage.list()            // ['config']
await ctx.storage.delete('config')
```

### 命令面板

```js
const disposable = ctx.commands.register('myplugin.greet', () => {
  ctx.ui.notify('Hello!')
})

// 卸载时注销命令
disposable.dispose()
```

`plugin.json` 中 `commands` 数组声明的命令 ID 必须与 `ctx.commands.register` 调用的 ID 对应。

### UI

```js
ctx.ui.notify('操作成功', 'info')   // 'info' | 'warn' | 'error'
const ok = await ctx.ui.confirm('确定删除？')  // 返回 boolean
```

### 语言

`ctx.i18n` 只暴露 Dinotty 当前界面语言，不会向插件泄露完整应用设置。插件应自行维护翻译文案，并在卸载时释放监听器。

```js
const locale = ctx.i18n.getLocale() // 'zh' | 'en'

const d = ctx.i18n.onDidChangeLocale((nextLocale) => {
  console.log('界面语言已切换为', nextLocale)
})
d.dispose()
```

### 设置

```js
const settings = ctx.settings.get()  // 当前应用设置的快照

const d = ctx.settings.onDidChange((s) => {
  console.log('主题变更为', s.theme)
})
d.dispose()
```

### 事件订阅

`ctx.events` 提供跨 pane / 跨插件 / 跨客户端的事件订阅能力。事件通过 `/ws/sync` 下行，emit 走 HTTP POST 到 `/api/events/emit`。

```js
// 订阅事件，返回 Disposable
const d = ctx.events.subscribe('terminal:cwd-changed', (data, e) => {
  console.log('cwd 变更:', data.path)
  console.log('来源 plugin_id:', e.plugin_id)
})
d.dispose()  // 取消订阅

// 发射事件（自动带本插件的 plugin_id）
ctx.events.emit('my-plugin:action', { type: 'refresh' })

// 定向发给某个插件（其他插件不收到）
ctx.events.emit('my-plugin:query', { q: 'hello' }, { target_plugin_id: 'target-plugin' })
```

**事件信封字段**（handler 第二个参数 `e`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `event_name` | string | 事件名 |
| `data` | unknown | 事件数据 |
| `plugin_id` | string? | 发送方插件 id（ctx.events.emit 自动填充） |
| `source_pane_id` | string? | 发送方 pane id（Step 0 暂不自动填充，可放进 `data`） |
| `target_plugin_id` | string? | 目标插件 id。存在时，只有 `target_plugin_id` 匹配的插件的 handler 会被触发 |

**语义要点**：

- **回声抑制**：emit 方不会收到自己发出的事件（后端按 client_id 排除发送方）。
- **跨客户端广播**：事件会广播给所有浏览器窗口的 sync client，非仅"同 tab 内"。需要限制同 tab 内时，由 plugin 自行在 `data` 中携带 tab 标识并在 handler 中过滤。
- **target_plugin_id 过滤在前端**：后端将事件（含 `target_plugin_id`）广播给所有客户端，前端 EventBridge 只触发 `target_plugin_id` 匹配的插件的 handler。未带 `target_plugin_id` 的事件触发所有订阅者。
- **命名约定**：插件事件用 `plugin:{id}:{name}` 前缀（如 `plugin:cc-switch:provider-changed`），终端事件用 `terminal:{name}` 前缀，避免命名冲突。

**示例：两个插件通信**

```js
// provider-plugin/main.js
export function activate(ctx) {
  ctx.events.emit('plugin:provider:changed', { provider: 'anthropic' })
}

// consumer-plugin/main.js
export function activate(ctx) {
  ctx.events.subscribe('plugin:provider:changed', (data) => {
    ctx.ui.notify(`切换到 ${data.provider}`, 'info')
  })
}
```

---

## 渲染 UI

插件 UI 通过 Vue 3 的 render function（`ctx.h`）构建，无需模板编译。

### 基本结构

```js
return {
  component: {
    render() {
      return ctx.h('div', { class: 'my-root' }, [
        ctx.h('h2', null, '标题'),
        ctx.h('button', { onClick: handleClick }, '点击'),
      ])
    },
  },
}
```

### 响应式绑定

```js
const text = ctx.ref('')

// 输入框双向绑定
ctx.h('input', {
  value: text.value,
  onInput: (e) => { text.value = e.target.value },
})

// 条件渲染
text.value ? ctx.h('span', null, text.value) : null
```

渲染函数在响应式数据变化时自动重新执行（Vue 3 的追踪机制）。

### 列表渲染

```js
const items = ctx.ref(['a', 'b', 'c'])

ctx.h('ul', null,
  items.value.map((item, i) =>
    ctx.h('li', { key: i }, item)
  )
)
```

### setup + render 分离（推荐用于复杂组件）

```js
return {
  component: {
    setup() {
      const count = ctx.ref(0)
      ctx.onMounted(() => console.log('mounted'))
      return { count }
    },
    render() {
      // this.count 是 setup 返回值
      return ctx.h('div', null, String(this.count))
    },
  },
}
```

> **注意**：`ctx.onMounted` / `ctx.onUnmounted` 必须在组件的 `setup()` 内或 `activate()` 顶层调用（激活时即为 setup 期间），不能在异步回调中调用。

---

## CSS 样式

在 `plugin.json` 中声明 `styles` 字段，Dinotty 会在加载插件时自动将样式注入到 `<head>` 中：

```json
"styles": "./styles.css"
```

**建议为所有选择器加上插件 id 前缀**，以避免与主应用或其他插件的样式冲突：

```css
/* ✅ 推荐 */
.json-formatter .jf-root { ... }

/* ❌ 避免 */
.root { ... }
button { ... }
```

CSS 变量可用于读取主题色（主应用已定义）：

```css
.my-card {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}
```

---

## 命令面板集成

命令面板中的命令有两种注册方式：

**方式一：在 `plugin.json` 中声明 + `ctx.commands.register` 绑定处理器**

```json
// plugin.json
"commands": [
  { "id": "myplugin.open",    "title": "打开 My Plugin" },
  { "id": "myplugin.refresh", "title": "刷新数据" }
]
```

```js
// main.js
export function activate(ctx) {
  ctx.commands.register('myplugin.open', () => {
    // 打开插件标签页的逻辑由宿主处理，这里可以做额外初始化
  })
  ctx.commands.register('myplugin.refresh', () => {
    doRefresh()
  })
}
```

**方式二：仅通过 `ctx.commands.register` 动态注册**（不在 `plugin.json` 声明）

动态注册的命令同样会出现在命令面板中。

---

## 持久化存储

`ctx.storage` 提供简单的键值存储，数据在插件更新或 Dinotty 重启后依然存在。

```js
// 存储复杂对象
await ctx.storage.set('providers', [
  { id: 'anthropic', url: 'https://api.anthropic.com' }
])

// 读取（类型自动推断）
const providers = await ctx.storage.get('providers') ?? []

// 列举所有 key
const keys = await ctx.storage.list()

// 删除
await ctx.storage.delete('providers')
```

存储路径：Linux/macOS 为 `~/.dinotty/plugin-data/<plugin-id>/<key>.json`，Windows 为 `%USERPROFILE%\.dinotty\plugin-data\<plugin-id>\<key>.json`。

---

## 调用 CLI 工具

如果插件需要执行本地命令，可以将可执行文件放在 `bin/` 目录，并在 `plugin.json` 中声明：

```json
{
  "bin": {
    "mode": "cli",
    "entry": "./bin/my-tool"
  }
}
```

`bin.entry` 是相对于插件根目录的路径。Dinotty 在安装时会自动为其添加可执行权限（Unix）；Windows 不使用 executable bit，请优先提供 `.exe` 或可直接由 Windows 启动的 `.cmd` 包装脚本。

如果插件需要跨平台分发，建议按目标平台打包不同的 CLI 入口，或在 JS 中检测运行结果并给出清晰错误提示。

Native 插件可以让宿主按服务端平台精确选择入口：

```json
{
  "permissions": ["native.execute", "process.long-running"],
  "bin": {
    "mode": "cli",
    "entry": "./bin/legacy-tool",
    "entries": {
      "windows-x86_64": "bin/windows-x86_64/tool.exe",
      "linux-x86_64": "bin/linux-x86_64/tool",
      "linux-aarch64": "bin/linux-aarch64/tool",
      "macos-x86_64": "bin/macos-x86_64/tool",
      "macos-aarch64": "bin/macos-aarch64/tool"
    },
    "lifecycle": {
      "scope": "host",
      "stdinLease": true,
      "shutdownDeadlineMs": 10000,
      "forceKillAfterMs": 15000
    }
  }
}
```

当前目标存在 `entries[target]` 时优先使用它，否则才回退到 legacy `entry`。入口必须是插件目录内的普通文件；绝对路径、`..`、目录外 symlink 和未知平台会 fail closed。`minAppVersion` 会在扫描、安装和运行前实际校验。

`lifecycle.scope` 控制 managed process 与插件 UI 的关系：默认 `ui` 保持兼容行为，UI 热重载时只请求后端停止真实的 UI-scoped 进程；`host` 让进程跨 UI 热重载和浏览器断开继续运行，只在显式停止、插件更新/卸载或 Dinotty 退出时停止。scope 由后端进程记录并执行，不依赖浏览器缓存的 manifest。`stdinLease` 只定义停止协议，不隐含进程作用域。`shutdownDeadlineMs` 不能超过 30000，`forceKillAfterMs` 不能超过 60000，且前者不能大于后者。

宿主运行 Native 命令时默认把工作目录设为插件目录，并注入以下不可由插件请求覆盖的环境变量：

```text
DINOTTY_PLUGIN_ID
DINOTTY_PLUGIN_DIR
DINOTTY_PLUGIN_DATA_DIR
DINOTTY_HOST_TARGET
DINOTTY_ORIGIN
DINOTTY_HOST_VERSION
DINOTTY_HOST_MODE
DINOTTY_PARENT_PID
```

`DINOTTY_ORIGIN` 使用 Dinotty 当前实际监听端口和 IPv4 loopback URL。长运行进程若启用 `stdinLease`，正常停止时会收到一行 `{"type":"shutdown","deadlineMs":...}`；宿主异常退出时 stdin EOF 也必须视为停止信号。stdout/stderr 会被宿主持续消费并只保留有界诊断缓冲，避免 pipe 写满卡死。

使用按平台 `entries` 或 `lifecycle` 的插件必须分别声明 `native.execute` 和 `process.long-running`；缺失或未知的 Native 权限会被拒绝。安装和更新时，管理界面会明确展示并要求确认这些能力。权限确认不是操作系统级 sandbox：Native 二进制仍可能以当前用户权限访问其他网络或文件，插件 UI 不得声称宿主已经在 OS 层阻止这些访问。仅使用 legacy `bin.entry` 且未启用新生命周期字段的旧插件继续按兼容模式运行。

### exec.run — 同步调用

```js
const res = await ctx.exec.run(['list', '--json'])
if (res.code !== 0) {
  ctx.ui.notify('命令失败: ' + res.stderr, 'error')
  return
}
const data = JSON.parse(res.stdout)
```

`exec.run` 参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `args` | `string[]` | 传给二进制的参数列表 |
| `options.cwd` | string | 工作目录 |
| `options.env` | object | 额外环境变量 |
| `options.timeout` | number | 超时（毫秒） |

返回 `{ code: number, stdout: string, stderr: string }`。

### exec.spawn — 流式输出

适合长时间运行的命令（如 `watch`、持续日志）：

```js
const handle = ctx.exec.spawn(['watch', '--interval', '1'], {
  cwd: '/path/to/workspace',
  env: { MODE: 'watch' }
})

const reader = handle.stdout.getReader()
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  // 处理每一行输出
  appendLog(value)
}

// 需要时终止进程
handle.kill()
```

### CLI 脚本示例

`bin/my-tool` 可以是任意可执行文件（Rust 二进制、shell 脚本、Python 脚本等）。只需确保输出 JSON（方便 JS 侧解析）并通过 exit code 表示成功（0）或失败（非 0）。

Unix shell 脚本示例：

```bash
#!/bin/bash
# bin/my-tool
case "$1" in
  list)
    echo '{"items": ["a", "b"]}'
    ;;
  *)
    echo "unknown command" >&2
    exit 1
    ;;
esac
```

Windows `.cmd` 包装脚本示例：

```bat
@echo off
rem bin\my-tool.cmd
if "%~1"=="list" (
  echo {"items":["a","b"]}
  exit /b 0
)
echo unknown command 1>&2
exit /b 1
```

在 `plugin.json` 中将 Windows 包的 `bin.entry` 指向 `./bin/my-tool.exe` 或 `./bin/my-tool.cmd`。

---

## TypeScript 支持

`plugin-api/index.d.ts` 提供了完整的类型定义。推荐使用 [esbuild](https://esbuild.github.io/) 将 TypeScript 编译为单文件 ESM bundle。

### 目录结构

```
my-plugin/
├── plugin.json
├── src/
│   └── main.ts
├── dist/
│   └── main.js      ← esbuild 产物
├── styles.css
└── package.json     ← 可选
```

### plugin.json 指向编译产物

```json
{
  "entry": "./dist/main.js"
}
```

### main.ts 导入类型

```ts
import type { PluginContext, PluginExports } from '../../plugin-api/index'

export function activate(ctx: PluginContext): PluginExports {
  const count = ctx.ref(0)

  return {
    component: {
      render() {
        return ctx.h('div', null, String(count.value))
      },
    },
  }
}
```

### 编译命令

```bash
# 使用 Dinotty 前端目录中已有的 esbuild（无需单独安装）
../../frontend/node_modules/.bin/esbuild src/main.ts \
  --bundle \
  --format=esm \
  --outfile=dist/main.js

# 或安装到本地
npm install --save-dev esbuild
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js
```

Windows PowerShell：

```powershell
..\..\frontend\node_modules\.bin\esbuild.cmd src/main.ts --bundle --format=esm --outfile=dist/main.js
```

**注意**：esbuild 的 `--bundle` 会把所有依赖打包进单个文件。不要 `import vue` —— 所有 Vue API 都通过 `ctx` 传入，无需额外依赖。

### 监听模式（开发时）

```bash
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js --watch
```

配合 dev-link 和 Dinotty 的热重载，修改 TS 源码 → esbuild 自动重编译 → Dinotty 自动重载插件，无需手动刷新。

---

## 开发工作流

### 1. 创建插件目录

```bash
mkdir my-plugin && cd my-plugin
# 创建 plugin.json、main.js（或 src/main.ts）
```

### 2. Dev-link 链接到 Dinotty

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"$(pwd)\"}"
```

Windows PowerShell：

```powershell
$body = @{ path = (Get-Location).Path } | ConvertTo-Json -Compress
curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d $body
```

链接成功后插件立即出现在标签栏的插件列表中。

### 3. 开发循环

- 修改 `main.js` 或编译后的 `dist/main.js`
- Dinotty 的文件监听器（基于 `notify` crate，防抖 500ms）检测到变化后，自动向所有连接的浏览器广播 `plugin_changed` 消息
- 前端收到消息后（防抖 300ms）自动卸载并重载插件，无需刷新页面

### 4. 调试

浏览器开发者工具中可以看到插件的 `console.log` 输出。插件 JS 以 Blob URL 形式加载，Source Map（如有）同样生效。

插件加载/卸载日志：

```
[plugin] loaded hello-world
[plugin] unloaded hello-world  
[plugin] hot-reloaded hello-world
```

### 5. 查看已安装插件

通过 API 查看：

```bash
curl http://127.0.0.1:8999/api/plugins
```

或在 Dinotty 的 设置 → 插件 中查看。

---

## 打包与分发

### 打包为 .tar.gz

```bash
# 在插件目录的父目录执行
tar -czf my-plugin.tar.gz my-plugin/
```

Windows 10/11 PowerShell 通常也自带 `tar.exe`：

```powershell
tar -czf my-plugin.tar.gz my-plugin
```

压缩包根目录**必须包含 `plugin.json`**（即压缩包结构为 `my-plugin/plugin.json`，而非 `plugin.json` 直接在根部）。

如果使用 TypeScript，打包前先编译：

```bash
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js
tar -czf my-plugin.tar.gz my-plugin/
```

### 通过 API 安装

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/install \
  -F "file=@my-plugin.tar.gz"
```

### 更新已安装插件

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/my-plugin/update \
  -F "file=@my-plugin.tar.gz"
```

### 卸载

```bash
curl -X DELETE http://127.0.0.1:8999/api/plugins/my-plugin
```

---

## 参考示例

| 插件 | 特点 | 路径 |
|------|------|------|
| **JSON Formatter** | 纯 JS，无构建步骤，复杂树形 UI | `plugins/json-formatter/` |
| **CC Switch** | TypeScript + esbuild，`exec.run` 调用 CLI，多命令注册 | `plugins/cc-switch/` |

阅读这两个插件的源码是理解插件 API 最快的方式。

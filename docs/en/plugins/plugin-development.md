# Dinotty Plugin Development Guide

This document explains how to develop plugins for Dinotty.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Plugin Manifest (plugin.json)](#plugin-manifest-pluginjson)
- [Entry Point & Lifecycle](#entry-point-lifecycle)
- [API Reference](#api-reference)
- [Rendering UI](#rendering-ui)
- [CSS Styles](#css-styles)
- [Command Palette Integration](#command-palette-integration)
- [Persistent Storage](#persistent-storage)
- [File System Access](#file-system-access)
- [Invoking CLI Tools](#invoking-cli-tools)
- [Event Subscription](#event-subscription)
- [TypeScript Support](#typescript-support)
- [Development Workflow](#development-workflow)
- [Packaging & Distribution](#packaging-distribution)

---

## Overview

A plugin is a directory containing:

- `plugin.json` — the plugin manifest (required)
- `main.js` — a JavaScript entry point in ESM format (required)
- `styles.css` — an optional stylesheet
- `bin/` — optional CLI binaries or scripts invoked via `exec.run` / `exec.spawn`

Dinotty scans the user's plugin directory and dynamically loads the JS entry with a browser-side `import()`, calling its exported `activate(context)` function.

| Platform | Plugin Directory |
|----------|------------------|
| Linux / macOS | `~/.dinotty/plugins/<plugin-id>/` |
| Windows | `%USERPROFILE%\.dinotty\plugins\<plugin-id>` |

Plugins can:

- Render custom UIs in dedicated tabs (Vue 3 render functions)
- Register commands in the command palette
- Send input to terminal panes
- Read/write persistent key-value storage
- Invoke CLI binaries bundled with the plugin

---

## Quick Start

The following minimal "Hello World" plugin demonstrates the complete structure.

### Directory Structure

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
  "description": "A minimal example plugin",
  "icon": "terminal",
  "entry": "./main.js",
  "styles": "./styles.css",
  "commands": [
    { "id": "hello-world.open", "title": "Open Hello World" }
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
          h('p', null, `Clicks: ${count.value}`),
          h('button', { onClick: () => count.value++ }, 'Click me'),
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

### Installation (dev mode)

```bash
# Just place the directory; the file watcher picks it up automatically
mkdir -p ~/.dinotty/plugins/hello-world
# Copy the three files above into it

# Or use the dev-link API (handy when developing inside a project directory)
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/your/hello-world"}'
```

Windows PowerShell example:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dinotty\plugins\hello-world"
# Copy the three files above into it

curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d '{"path":"C:\\Users\\you\\plugins\\hello-world"}'
```

`dev-link` creates a symbolic link to the directory; on Windows, enable Developer Mode or run as administrator if it fails.

---

## Plugin Manifest (plugin.json)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier. Only lowercase letters, digits and hyphens (`[a-z0-9-]+`). **Must match the directory name**. |
| `name` | string | ✅ | Display name |
| `version` | string | ✅ | Semantic version (e.g. `1.0.0`) |
| `description` | string | ❌ | Short description shown in the plugin list |
| `icon` | string | ❌ | Icon identifier (e.g. `braces`, `repeat`, `terminal`) |
| `entry` | string | ❌ | JS entry file path relative to the plugin root. Defaults to `./main.js` |
| `styles` | string | ❌ | CSS file path relative to the plugin root |
| `bin` | object | ❌ | CLI binary config, see [Invoking CLI Tools](#invoking-cli-tools) |
| `commands` | array | ❌ | Commands registered in the command palette, see below |
| `minAppVersion` | string | ❌ | Minimum required Dinotty version |

**commands format:**

```json
"commands": [
  { "id": "myplugin.doSomething", "title": "Do Something" }
]
```

Prefix command IDs with the plugin id to avoid conflicts.

---

## Entry Point & Lifecycle

`main.js` must export an `activate` function:

```js
export function activate(ctx) {
  // initialization logic...

  return {
    component: { /* Vue component rendered in the plugin tab */ },
    dispose() {
      // cleanup on unload (event listeners, timers, etc.)
    },
  }
}

// Optional, called on unload (before dispose)
export function deactivate() {}
```

- `activate` can be an `async` function
- Both `component` and `dispose` in the return value are optional
- A plugin that only registers commands can omit `component`
- `activate` has a 10-second timeout; exceeding it fails the load

---

## API Reference

The `ctx` object passed to `activate(ctx)` exposes the following APIs:

### Vue Reactivity

```js
const count = ctx.ref(0)           // reactive ref
const state = ctx.reactive({ ... }) // reactive object
const doubled = ctx.computed(() => count.value * 2)
ctx.watch(() => count.value, (val) => console.log(val))
ctx.onMounted(() => { /* after mount */ })
ctx.onUnmounted(() => { /* before unmount */ })
const h = ctx.h                     // Vue h() function
```

### Terminal

```js
// Send text to a specific pane
ctx.terminal.send(paneId, 'echo hello\n')

// Get the active pane ID
const id = ctx.terminal.activePaneId()

// Create a new terminal tab, returns the pane ID
const paneId = await ctx.terminal.createTab('bash')

// Listen for terminal output (returns a Disposable)
const d = ctx.terminal.onOutput((paneId, data) => {
  console.log(paneId, data)
})
d.dispose() // unsubscribe
```

### Persistent Storage

Data is stored under `.dinotty/plugin-data/<plugin-id>/` in the user's home directory, one JSON file per key. On Windows: `%USERPROFILE%\.dinotty\plugin-data\<plugin-id>`.

```js
await ctx.storage.set('config', { theme: 'dark' })
const config = await ctx.storage.get('config')  // { theme: 'dark' }
const keys = await ctx.storage.list()            // ['config']
await ctx.storage.delete('config')
```

### Command Palette

```js
const disposable = ctx.commands.register('myplugin.greet', () => {
  ctx.ui.notify('Hello!')
})

// Unregister on unload
disposable.dispose()
```

Command IDs declared in the `commands` array of `plugin.json` must match those registered via `ctx.commands.register`.

### UI

```js
ctx.ui.notify('Done', 'info')   // 'info' | 'warn' | 'error'
const ok = await ctx.ui.confirm('Delete?')  // returns boolean
```

### Locale

`ctx.i18n` only exposes Dinotty's current UI language; it does not leak full app settings to plugins. Plugins should maintain their own translations and release listeners on unload.

```js
const locale = ctx.i18n.getLocale() // 'zh' | 'en'

const d = ctx.i18n.onDidChangeLocale((nextLocale) => {
  console.log('locale changed to', nextLocale)
})
d.dispose()
```

### Settings

```js
const settings = ctx.settings.get()  // snapshot of current app settings

const d = ctx.settings.onDidChange((s) => {
  console.log('theme changed to', s.theme)
})
d.dispose()
```

### Event Subscription

`ctx.events` provides cross-pane / cross-plugin / cross-client event subscription. Events are delivered over `/ws/sync`; emitting goes through HTTP POST to `/api/events/emit`.

```js
// Subscribe, returns a Disposable
const d = ctx.events.subscribe('terminal:cwd-changed', (data, e) => {
  console.log('cwd changed:', data.path)
  console.log('from plugin_id:', e.plugin_id)
})
d.dispose()  // unsubscribe

// Emit (the local plugin_id is attached automatically)
ctx.events.emit('my-plugin:action', { type: 'refresh' })

// Targeted emit to a specific plugin (other plugins don't receive it)
ctx.events.emit('my-plugin:query', { q: 'hello' }, { target_plugin_id: 'target-plugin' })
```

**Event envelope fields** (second handler argument `e`):

| Field | Type | Description |
|-------|------|-------------|
| `event_name` | string | Event name |
| `data` | unknown | Event payload |
| `plugin_id` | string? | Sender plugin id (filled automatically by ctx.events.emit) |
| `source_pane_id` | string? | Sender pane id (not auto-filled at Step 0; put it in `data` instead) |
| `target_plugin_id` | string? | Target plugin id. When present, only handlers of plugins matching `target_plugin_id` fire |

**Semantics:**

- **Echo suppression**: emitters never receive their own events (the backend excludes the sender by client_id).
- **Cross-client broadcast**: events are broadcast to sync clients of all browser windows, not just "within the same tab". To scope to a tab, carry a tab identifier in `data` and filter in the handler.
- **target_plugin_id is filtered client-side**: the backend broadcasts events (including `target_plugin_id`) to all clients; the frontend EventBridge only triggers handlers of plugins whose id matches. Events without `target_plugin_id` trigger all subscribers.
- **Naming convention**: prefix plugin events with `plugin:{id}:{name}` (e.g. `plugin:cc-switch:provider-changed`), terminal events with `terminal:{name}`, to avoid collisions.

**Example: two plugins communicating**

```js
// provider-plugin/main.js
export function activate(ctx) {
  ctx.events.emit('plugin:provider:changed', { provider: 'anthropic' })
}

// consumer-plugin/main.js
export function activate(ctx) {
  ctx.events.subscribe('plugin:provider:changed', (data) => {
    ctx.ui.notify(`Switched to ${data.provider}`, 'info')
  })
}
```

---

## Rendering UI

Plugin UIs are built with Vue 3 render functions (`ctx.h`); no template compilation required.

### Basic Structure

```js
return {
  component: {
    render() {
      return ctx.h('div', { class: 'my-root' }, [
        ctx.h('h2', null, 'Title'),
        ctx.h('button', { onClick: handleClick }, 'Click'),
      ])
    },
  },
}
```

### Reactive Bindings

```js
const text = ctx.ref('')

// Two-way input binding
ctx.h('input', {
  value: text.value,
  onInput: (e) => { text.value = e.target.value },
})

// Conditional rendering
text.value ? ctx.h('span', null, text.value) : null
```

Render functions re-run automatically when reactive data changes (Vue 3's tracking mechanism).

### List Rendering

```js
const items = ctx.ref(['a', 'b', 'c'])

ctx.h('ul', null,
  items.value.map((item, i) =>
    ctx.h('li', { key: i }, item)
  )
)
```

### setup + render split (recommended for complex components)

```js
return {
  component: {
    setup() {
      const count = ctx.ref(0)
      ctx.onMounted(() => console.log('mounted'))
      return { count }
    },
    render() {
      // this.count comes from setup()
      return ctx.h('div', null, String(this.count))
    },
  },
}
```

> **Note**: `ctx.onMounted` / `ctx.onUnmounted` must be called inside the component's `setup()` or at the top level of `activate()` (activation counts as setup time). Do not call them from async callbacks.

---

## CSS Styles

Declare a `styles` field in `plugin.json` and Dinotty injects the stylesheet into `<head>` when loading the plugin:

```json
"styles": "./styles.css"
```

**You must prefix all selectors with your plugin id**, or scope them under the host-provided `.plugin-host-{id}` container class, to avoid clashing with the main app or other plugins. Dinotty adds `.plugin-host-{plugin-id}` to the container automatically:

```css
/* ✅ Recommended: plugin id prefix */
.json-formatter .jf-root { ... }

/* ✅ Recommended: .plugin-host-{id} container */
.plugin-host-json-formatter .root { ... }

/* ❌ Avoid: pollutes the main UI */
.root { ... }
button { ... }
```

Avoid global selectors like `:root` / `body` / `html` / `*` — they trigger console warnings at load time and pollute the main app.

### Available CSS Variables (Design Tokens)

The main app defines the following tokens on `:root`. Plugins can reference them directly with `var()` — **no fallback needed**:

| Category | Tokens |
|----------|--------|
| Background | `--bg` / `--bg-surface` / `--bg-overlay` / `--bg-input` / `--bg-hover` / `--bg-elevated` / `--bg-surface-hover` / `--bg-main` |
| Foreground | `--fg` / `--fg-bright` / `--fg-muted` |
| Border | `--border` / `--border-focus` / `--border-hover` / `--divider` |
| Accent | `--accent` / `--accent-hover` |
| Semantic | `--success` / `--danger` / `--warning` |
| Fonts | `--font-ui` / `--font-mono` |
| Misc | `--radius` / `--scrollbar-thumb` / `--scrollbar-thumb-hover` |

Example:

```css
.my-card {
  background: var(--bg-surface);
  color: var(--fg);
  border: 1px solid var(--border);
}

.my-error {
  color: var(--danger);
}
```

---

## Command Palette Integration

There are two ways to register commands in the palette:

**Option 1: declare in `plugin.json` + bind handlers via `ctx.commands.register`**

```json
// plugin.json
"commands": [
  { "id": "myplugin.open",    "title": "Open My Plugin" },
  { "id": "myplugin.refresh", "title": "Refresh Data" }
]
```

```js
// main.js
export function activate(ctx) {
  ctx.commands.register('myplugin.open', () => {
    // Opening the plugin tab is handled by the host; extra init goes here
  })
  ctx.commands.register('myplugin.refresh', () => {
    doRefresh()
  })
}
```

**Option 2: dynamic registration via `ctx.commands.register` only** (not declared in `plugin.json`)

Dynamically registered commands also appear in the command palette.

---

## Persistent Storage

`ctx.storage` provides a simple key-value store that survives plugin updates and Dinotty restarts.

```js
// Store a complex object
await ctx.storage.set('providers', [
  { id: 'anthropic', url: 'https://api.anthropic.com' }
])

// Read (type inferred automatically)
const providers = await ctx.storage.get('providers') ?? []

// List all keys
const keys = await ctx.storage.list()

// Delete
await ctx.storage.delete('providers')
```

Storage path: `~/.dinotty/plugin-data/<plugin-id>/<key>.json` on Linux/macOS; `%USERPROFILE%\.dinotty\plugin-data\<plugin-id>\<key>.json` on Windows.

---

## File System Access

`ctx.workspace` provides file system read/write without shipping your own CLI wrapper. Paths must be absolute (`~/` expands to the user's home directory).

**Permission declarations**: declare them in `permissions` in `plugin.json`:

```json
{
  "permissions": ["workspace.read", "workspace.write"]
}
```

- `workspace.read` - read files / directories
- `workspace.write` - write files / create directories / delete / rename / move

### API

```js
// List a directory
const { entries } = await ctx.workspace.readDir('~/.claude/projects')
// entries: [{ name: 'proj-1', is_dir: true, size: 0 }, ...]

// Read a file (language auto-detected; truncated beyond 512KB)
const { content, truncated, language } = await ctx.workspace.readFile('~/notes.md')
// language: 'markdown' | 'javascript' | 'json' | ...

// Write a file
await ctx.workspace.writeFile('~/foo.txt', 'hello world')

// File info
const { size, is_dir, modified } = await ctx.workspace.stat('~/foo.txt')
// modified: Unix epoch seconds

// Create directories (recursive)
await ctx.workspace.mkdir('~/foo/bar/baz')

// Delete (file or directory)
await ctx.workspace.delete('~/foo.txt')

// Rename
await ctx.workspace.rename('~/foo.txt', 'bar.txt')

// Move
await ctx.workspace.move('~/foo.txt', '~/bar/')

// Watch for changes
const watcher = ctx.workspace.watch('~/notes.md', (event) => {
  console.log(event.type, event.path, event.kind)
  // type: 'file_event' | 'error'
  // kind: 'changed' | 'created' | 'deleted'
})
watcher.dispose()  // stop watching
```

### Path Safety

- Sensitive system directories (`/etc`, `~/.ssh`, `/var`, etc.) are rejected with 403
- On macOS, symlinks such as `/etc` -> `/private/etc` are also blocked by double validation
- Watches not disposed before plugin unload are closed automatically

---

## Invoking CLI Tools

If a plugin needs to run local commands, place executables in `bin/` and declare them in `plugin.json`:

```json
{
  "bin": {
    "mode": "cli",
    "entry": "./bin/my-tool"
  }
}
```

`bin.entry` is a path relative to the plugin root. Dinotty grants execute permission automatically on install (Unix); Windows has no executable bit, so prefer providing an `.exe` or a `.cmd` wrapper script that Windows can launch directly.

For cross-platform distribution, package per-platform CLI entry points, or inspect the run result in JS and surface a clear error message.

Native plugins let the host pick the entry precisely by server platform:

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

When `entries[target]` exists for the current platform it takes priority, otherwise the host falls back to the legacy `entry`. Entry points must be regular files inside the plugin directory; absolute paths, `..`, symlinks outside the directory, and unknown platforms fail closed. `minAppVersion` is genuinely validated at scan, install and pre-run time.

`lifecycle.scope` controls how managed processes relate to plugin UI: the default `ui` keeps compatible behavior — on UI hot reload the host asks the backend to stop only real UI-scoped processes; `host` keeps processes running across UI hot reloads and browser disconnects, stopping only on explicit stop, plugin update/uninstall, or Dinotty exit. Scope is recorded and enforced by the backend process record, not by browser-cached manifests. `stdinLease` only defines the stop protocol and implies no process scope. `shutdownDeadlineMs` must not exceed 30000, `forceKillAfterMs` must not exceed 60000, and the former must not exceed the latter.

When running native commands the host sets the working directory to the plugin directory by default and injects the following environment variables, which plugins cannot request to override:

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

`DINOTTY_ORIGIN` uses Dinotty's actual listening port with an IPv4 loopback URL. Long-running processes with `stdinLease` receive one line `{"type":"shutdown","deadlineMs":...}` during graceful stop; stdin EOF on abnormal host exit must also be treated as a stop signal. stdout/stderr are continuously drained by the host with a bounded diagnostic buffer to avoid pipe-full deadlocks.

Plugins using per-platform `entries` or `lifecycle` must declare `native.execute` and `process.long-running` respectively; missing or unknown native permissions are denied. At install/update the management UI explicitly lists these capabilities and requires confirmation. Permission confirmation is not an OS-level sandbox: native binaries can still access other networks or files as the current user, and plugin UIs must not claim otherwise. Legacy plugins using only legacy `bin.entry` without the new lifecycle fields keep running in compatibility mode.

### exec.run — synchronous call

```js
const res = await ctx.exec.run(['list', '--json'])
if (res.code !== 0) {
  ctx.ui.notify('Command failed: ' + res.stderr, 'error')
  return
}
const data = JSON.parse(res.stdout)
```

`exec.run` parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `string[]` | Arguments passed to the binary |
| `options.cwd` | string | Working directory |
| `options.env` | object | Extra environment variables |
| `options.timeout` | number | Timeout (ms) |

Returns `{ code: number, stdout: string, stderr: string }`.

### exec.spawn — streaming output

Suitable for long-running commands (`watch`, continuous logs, etc.):

```js
const handle = ctx.exec.spawn(['watch', '--interval', '1'], {
  cwd: '/path/to/workspace',
  env: { MODE: 'watch' }
})

const reader = handle.stdout.getReader()
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  // handle each chunk of output
  appendLog(value)
}

// Kill the process when needed
handle.kill()
```

### CLI Script Example

`bin/my-tool` can be any executable (Rust binary, shell script, Python script, etc.). Just make sure it outputs JSON (easy to parse from JS) and signals success (0) or failure (non-zero) via exit code.

Unix shell script example:

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

Windows `.cmd` wrapper script example:

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

Point the Windows build's `bin.entry` in `plugin.json` at `./bin/my-tool.exe` or `./bin/my-tool.cmd`.

---

## TypeScript Support

`plugin-api/index.d.ts` ships complete type definitions. We recommend compiling TypeScript to a single ESM bundle with [esbuild](https://esbuild.github.io/).

### Directory Structure

```
my-plugin/
├── plugin.json
├── src/
│   └── main.ts
├── dist/
│   └── main.js      <- esbuild output
├── styles.css
└── package.json     <- optional
```

### plugin.json pointing at the compiled output

```json
{
  "entry": "./dist/main.js"
}
```

### Importing types in main.ts

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

### Build commands

```bash
# Use esbuild already present in the Dinotty frontend directory (no extra install)
../../frontend/node_modules/.bin/esbuild src/main.ts \
  --bundle \
  --format=esm \
  --outfile=dist/main.js

# Or install locally
npm install --save-dev esbuild
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js
```

Windows PowerShell:

```powershell
..\..\frontend\node_modules\.bin\esbuild.cmd src/main.ts --bundle --format=esm --outfile=dist/main.js
```

**Note**: esbuild's `--bundle` inlines all dependencies into one file. Do not `import vue` — every Vue API arrives through `ctx`, so no dependency is needed.

### Watch mode (development)

```bash
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js --watch
```

Combined with dev-link and Dinotty's hot reload, editing TS source triggers esbuild recompiles and Dinotty reloads the plugin automatically — no manual refresh needed.

---

## Development Workflow

### 1. Create the plugin directory

```bash
mkdir my-plugin && cd my-plugin
# Create plugin.json, main.js (or src/main.ts)
```

### 2. Dev-link it to Dinotty

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"$(pwd)\"}"
```

Windows PowerShell:

```powershell
$body = @{ path = (Get-Location).Path } | ConvertTo-Json -Compress
curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d $body
```

Once linked, the plugin appears immediately in the tab bar's plugin list.

### 3. Development loop

- Edit `main.js` or the compiled `dist/main.js`
- Dinotty's file watcher (based on the `notify` crate, 500ms debounce) detects the change and broadcasts a `plugin_changed` message to all connected browsers
- The frontend debounces 300ms, then unloads and reloads the plugin automatically — no page refresh

### 4. Debugging

Plugin `console.log` output appears in browser devtools. Plugin JS loads as a Blob URL; Source Maps (if any) work too.

Plugin load/unload logs:

```
[plugin] loaded hello-world
[plugin] unloaded hello-world  
[plugin] hot-reloaded hello-world
```

### 5. View installed plugins

Via the API:

```bash
curl http://127.0.0.1:8999/api/plugins
```

Or browse Settings -> Plugins in Dinotty.

---

## Packaging & Distribution

### Package as .tar.gz

```bash
# Run from the parent directory of the plugin
tar -czf my-plugin.tar.gz my-plugin/
```

Windows 10/11 PowerShell usually bundles `tar.exe` too:

```powershell
tar -czf my-plugin.tar.gz my-plugin
```

The archive root **must contain `plugin.json`** (i.e. the archive structure should be `my-plugin/plugin.json`, not bare `plugin.json` at the root).

For TypeScript, compile before packaging:

```bash
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/main.js
tar -czf my-plugin.tar.gz my-plugin/
```

### Install via API

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/install \
  -F "file=@my-plugin.tar.gz"
```

### Update an installed plugin

```bash
curl -X POST http://127.0.0.1:8999/api/plugins/my-plugin/update \
  -F "file=@my-plugin.tar.gz"
```

### Uninstall

```bash
curl -X DELETE http://127.0.0.1:8999/api/plugins/my-plugin
```

---

## Reference Examples

| Plugin | Highlights | Path |
|--------|------------|------|
| **JSON Formatter** | Pure JS, no build step, complex tree UI | `plugins/json-formatter/` |
| **CC Switch** | TypeScript + esbuild, `exec.run` CLI calls, multiple commands | `plugins/cc-switch/` |

Reading these two plugins' source code is the fastest way to understand the plugin API.

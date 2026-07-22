# Plugin System

Dinotty supports extending functionality through plugins. Plugins run in dedicated tabs, render UI with Vue 3, and have access to built-in APIs for the terminal, notifications, persistent storage, and more.

## Installing Plugins

**Option 1: Upload an archive**

Go to Settings → Plugins and upload a `.tar.gz` package containing a `plugin.json`.

**Option 2: Dev-link a local directory**

```bash
# Link a local directory as a plugin (development)
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/your/plugin/dir"}'
```

Windows PowerShell example (escape backslashes inside JSON):

```powershell
curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d '{"path":"C:\\Users\\you\\plugins\\my-plugin"}'
```

`dev-link` creates a directory symlink. On Windows, enable Developer Mode or run as Administrator if symlink creation fails. Uploading an archive or manual placement are alternatives.

**Option 3: Manual placement**

Drop a plugin directory into the plugin directory. The file watcher detects it automatically:

| Platform | Plugin directory |
|----------|------------------|
| Linux / macOS | `~/.dinotty/plugins/<plugin-id>/` |
| Windows | `%USERPROFILE%\.dinotty\plugins\<plugin-id>` |

Plugins support **hot-reload** — edit plugin files and the browser picks up changes instantly without restarting the server.

## Plugin Manifest (plugin.json)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier, lowercase letters + hyphens; must match the directory name |
| `name` | ✅ | Display name |
| `version` | ✅ | Semantic version string |
| `entry` | ❌ | JS entry file, defaults to `./main.js` |
| `styles` | ❌ | CSS file path |
| `icon` | ❌ | Icon identifier (e.g., `braces`, `repeat`) |
| `bin` | ❌ | Native CLI config with a legacy `entry` or host-targeted `entries` |
| `commands` | ❌ | Commands to register in the command palette `[{ "id": "...", "title": "..." }]` |
| `permissions` | ❌ | Permissions the plugin requires (e.g., `["terminal.output"]`) |
| `description` | ❌ | Plugin description, shown in the dropdown menu |

## Plugin API

A plugin's JS entry exports an `activate(context)` function. The `context` object provides:

| Category | API | Description |
|----------|-----|-------------|
| **Vue** | `ref`, `reactive`, `computed`, `watch`, `h`, `onMounted` | Full Vue 3 reactivity and render API |
| **Terminal** | `terminal.send(paneId, data)` | Send input to a terminal pane |
| | `terminal.activePaneId()` | Get the currently active pane ID |
| | `terminal.createTab(command?)` | Create a new terminal tab |
| | `terminal.listPanes()` | Query all terminal panes |
| | `terminal.onOutput(paneId, cb)` | Subscribe to terminal output broadcast |
| **Storage** | `storage.get(key)` | Read a persisted value |
| | `storage.set(key, value)` | Write a persisted value |
| | `storage.list()` | List all stored keys |
| **Commands** | `commands.register(id, handler)` | Register a command palette command, returns `Disposable` |
| **CLI exec** | `exec.run(args, options?)` | Run the plugin's CLI binary synchronously (`{code, stdout, stderr}`) |
| | `exec.spawn(args, options?)` | Stream CLI output with optional `cwd` / `env` (returns `ReadableStream`) |
| **UI** | `ui.notify(message, level?, title?)` | Show a notification (info / warn / error) with optional custom title |
| | `ui.confirm(message)` | Show a confirm dialog, returns `Promise<boolean>` |
| **Settings** | `settings.get()` | Read app settings |
| | `settings.onDidChange(cb)` | Subscribe to settings changes |
| **Events** | `events.subscribe(name, handler)` | Subscribe to a named event, returns `Disposable` |
| | `events.emit(name, data, opts?)` | Emit an event (auto-stamps `plugin_id`; `opts.target_plugin_id` restricts to a specific plugin) |

The return value of `activate(context)` may include:
- `component`: A Vue component rendered in the plugin tab
- `dispose()`: Cleanup called when the plugin is unloaded

## Built-in Plugins

| Plugin | Description |
|--------|-------------|
| **CC Switch** | Manage multiple Claude Code API providers and switch between them with one click. Requires the [cc-switch CLI](https://github.com/SaladDay/cc-switch-cli) |
| **JSON Formatter** | Format, minify, and validate JSON |
| **Command Bookmarks** | Command bookmarks with batch execution to multiple terminals |
| **Text Diff** | Text diff comparison tool with line-by-line highlighting |

For the full plugin development guide, see [plugin-development.md](plugin-development.md).

Dinotty selects a native plugin target on the backend; it never trusts the remote browser platform. Supported keys are `windows-x86_64`, `linux-x86_64`, `linux-aarch64`, `macos-x86_64`, and `macos-aarch64`. `entries[current-target]` takes precedence over legacy `entry`. Unknown targets, missing entries, paths outside the plugin directory, escaping symlinks, and non-regular files are rejected.

Long-running processes may declare `bin.lifecycle.stdinLease`. On stop, the host writes a JSON shutdown frame to stdin and force-terminates the process after `forceKillAfterMs`. `bin.lifecycle.scope` defaults to `ui`; on UI hot reload the backend stops only processes whose recorded scope is `ui`. Set it to `host` to keep processes alive across browser disconnects and UI hot reloads; host-scoped processes stop on explicit stop, plugin update/uninstall, or Dinotty shutdown. Deadlines must satisfy `shutdownDeadlineMs <= 30000`, `forceKillAfterMs <= 60000`, and the shutdown deadline must not exceed the force-kill deadline. Host-targeted `entries` and new lifecycle fields require explicit native capability declarations and an install/update confirmation; this confirmation is not an OS sandbox.

## Plugin Repository

Community plugins are hosted in the [dinotty-plugins](https://github.com/xichan96/dinotty-plugins) repository. Browse and install with one click from Settings → Plugins → Plugin Marketplace. PRs are welcome.

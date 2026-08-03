# 插件系统

Dinotty 支持通过插件扩展功能。插件在独立标签页中运行，使用 Vue 3 渲染 UI，可调用终端、通知、持久化存储等内建 API。

## 安装插件

**方式一：上传安装包**

在 设置 → 插件 中上传 `.tar.gz` 压缩包（包含 `plugin.json`）。

**方式二：开发模式链接**

```bash
# 将本地目录链接为插件（开发时使用）
curl -X POST http://127.0.0.1:8999/api/plugins/dev-link \
  -H "Content-Type: application/json" \
  -d '{"path": "/your/plugin/dir"}'
```

Windows PowerShell 示例（JSON 中的反斜杠需要转义）：

```powershell
curl.exe -X POST http://127.0.0.1:8999/api/plugins/dev-link `
  -H "Content-Type: application/json" `
  -d '{"path":"C:\\Users\\you\\plugins\\my-plugin"}'
```

`dev-link` 会创建目录符号链接；Windows 上如果失败，请开启 Developer Mode 或使用管理员权限。也可以改用上传安装包或手动放置。

**方式三：手动放置**

将插件目录直接放入插件目录，文件监听器会自动检测：

| 平台 | 插件目录 |
|------|----------|
| Linux / macOS | `~/.dinotty/plugins/<plugin-id>/` |
| Windows | `%USERPROFILE%\.dinotty\plugins\<plugin-id>` |

插件支持**热重载**——修改插件文件后无需重启服务器，浏览器自动加载最新版本。

## 插件清单（plugin.json）

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一标识，小写字母 + 连字符，须与目录名一致 |
| `name` | ✅ | 显示名称 |
| `version` | ✅ | 语义化版本 |
| `entry` | ❌ | JS 入口文件，默认 `./main.js` |
| `styles` | ❌ | CSS 文件路径 |
| `icon` | ❌ | 图标标识符（如 `braces`、`repeat`） |
| `bin` | ❌ | Native CLI 配置；支持 legacy `entry` 或按宿主目标选择的 `entries` |
| `commands` | ❌ | 注册到命令面板的命令列表 `[{ "id": "...", "title": "..." }]` |
| `permissions` | ❌ | 声明插件所需权限（如 `["terminal.output"]`） |
| `description` | ❌ | 插件描述，显示在下拉菜单中 |

## 插件 API

插件 JS 入口导出 `activate(context)` 函数，`context` 提供以下 API：

| 类别 | API | 说明 |
|------|-----|------|
| **Vue** | `ref`, `reactive`, `computed`, `watch`, `h`, `onMounted` | 完整 Vue 3 响应式与渲染 API |
| **终端** | `terminal.send(paneId, data)` | 向指定终端面板发送输入 |
| | `terminal.activePaneId()` | 获取当前活跃面板 ID |
| | `terminal.createTab(command?)` | 创建新终端标签页 |
| | `terminal.listPanes()` | 查询所有终端面板列表 |
| | `terminal.onOutput(paneId, cb)` | 监听终端输出广播 |
| **存储** | `storage.get(key)` | 读取持久化值 |
| | `storage.set(key, value)` | 写入持久化值 |
| | `storage.list()` | 列举所有已存储的 key |
| **命令** | `commands.register(id, handler)` | 注册命令面板命令，返回 `Disposable` |
| **CLI 执行** | `exec.run(args, options?)` | 调用插件附带的 CLI 二进制（同步，返回 `{code, stdout, stderr}`） |
| | `exec.spawn(args, options?)` | 流式调用 CLI，支持 `cwd` / `env`（WebSocket，返回 `ReadableStream`） |
| **UI** | `ui.notify(message, level?, title?)` | 显示通知（info / warn / error），可选自定义标题 |
| | `ui.confirm(message)` | 显示确认对话框，返回 `Promise<boolean>` |
| **设置** | `settings.get()` | 读取应用设置 |
| | `settings.onDidChange(cb)` | 监听设置变更 |

`activate(context)` 返回值可包含：
- `component`：一个 Vue 组件，将在插件标签页中渲染
- `dispose()`：插件卸载时的清理函数

## 内置插件

| 插件 | 功能 |
|------|------|
| **CC Switch** | 管理多个 Claude Code API Provider，一键切换；依赖 [cc-switch CLI](https://github.com/SaladDay/cc-switch-cli) |
| **JSON Formatter** | JSON 格式化、压缩与验证工具 |
| **Command Bookmarks** | 命令收藏夹，支持批量发送到多个终端 |
| **Text Diff** | 文本差异对比工具，支持逐行对比与高亮显示 |

完整的插件开发文档见 [plugin-development.md](plugin-development.md)。

Native 插件的平台由 Dinotty 后端判断，不使用远程浏览器的平台信息。支持的目标键为 `windows-x86_64`、`linux-x86_64`、`linux-aarch64`、`macos-x86_64` 和 `macos-aarch64`。`entries[当前目标]` 优先于 legacy `entry`；未知目标、缺失入口、目录外路径、symlink 逃逸和非普通文件都会被拒绝。

长运行进程可以声明 `bin.lifecycle.stdinLease`。宿主停止进程时会向 stdin 写入 JSON shutdown frame，等待 `forceKillAfterMs` 后再强制终止。`bin.lifecycle.scope` 默认为 `ui`，UI 热重载时由后端只停止 UI-scoped 进程；设为 `host` 后，进程会跨浏览器断开和 UI 热重载继续运行，只在显式停止、插件更新/卸载以及 Dinotty 退出时停止。停止期限必须满足 `shutdownDeadlineMs <= 30000`、`forceKillAfterMs <= 60000` 且前者不大于后者。使用按平台 `entries` 或新生命周期字段时必须声明相应 Native 权限，安装和更新会显示确认提示；这不代表 Native 程序受到操作系统级沙箱限制。

## 插件仓库

社区插件托管在 [dinotty-plugins](https://github.com/xichan96/dinotty-plugins) 仓库。可在 设置 → 插件 → 插件市场 中浏览和一键安装。欢迎提交 PR 贡献你的插件。

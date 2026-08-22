# 插件静态资源加载设计方案

## 问题背景

插件代码中无法获取自身静态资源的 URL，导致无法加载大型第三方库（如 Three.js + ENCOM Globe）。

## 现状分析

### 后端路由已存在

`src-tauri/src/embedded_server/router.rs:175` 与 `src/main.rs:875` 都注册了同一路由（两端同步，无 desktop router drift）：
```rust
.route("/api/plugins/:id/*path", get(plugin::plugin_asset))
```

`plugin/crud.rs:37-68` 的 `plugin_asset` 函数已实现：
- 路径遍历防护：先 `subpath.contains("..")` 早退 400，再 `canonicalize` + `starts_with` 双重校验
- MIME 类型自动检测：`mime_guess::from_path`
- 错误处理：400（含 `..`）/ 404（文件不存在）/ 403（路径逃逸）

### 插件加载器已使用此路由

`usePluginLoader.ts` 第 486-493 行：
```typescript
const jsUrl = apiUrl(`/api/plugins/${id}/${entry.replace('./', '')}`)
const jsRes = await authFetch(jsUrl)
```

### 认证机制

`auth/mod.rs:193` 的 `auth_middleware` 对 `/api/plugins/:id/*path` 生效，支持三种放行路径：
1. Cookie session（浏览器模式）
2. Bearer token（Tauri 模式，通过 `tauri_fetch` Rust 侧请求携带）
3. IP 白名单旁路（loopback 默认在白名单内）

`default_ip_whitelist`（`src/settings/types.rs:441-450`）按 feature 门控：
- Desktop 模式（Tauri）：默认 `["127.0.0.1", "::1"]`，loopback 旁路开启
- Server 模式：默认 `[]`，loopback 旁路关闭，所有请求必须认证

### 缺失部分

两个 `PluginContext` 接口（`usePluginLoader.ts:84` 与 `plugin-api/index.d.ts:45`）都**没有** `assetUrl` 声明，`createPluginContext`（`usePluginLoader.ts:250`，context 对象在 `:424` 处组装）也没有对应实现。

## 实现计划

### 改动文件（共 2 个前端文件 + 1 个后端小补强）

#### 1. `frontend/src/composables/usePluginLoader.ts`

**接口定义**（在 `PluginContext` 接口内，当前 `:84` 起的接口块中新增两个方法）：

```typescript
/** 获取插件资源的 HTTP URL
 *  @param relativePath 相对于插件目录的路径，如 './vendor/lib.js'
 *  @returns 完整 HTTP URL
 */
assetUrl(relativePath: string): string

/** 以当前认证身份请求插件资源，返回 Response。
 *  浏览器模式自动带 cookie；Tauri 模式走 tauri_fetch 带 Bearer。
 *  用于 vendor JS 等需要 header 认证的场景；JSON/图片可直接用 fetch(ctx.assetUrl(path))。
 */
fetchAsset(relativePath: string, init?: RequestInit): Promise<Response>
```

**实现**（在 `createPluginContext` 返回的 context 对象内，约 `:424` 处新增字段）：

```typescript
assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\.\//, '')
  const segments = clean.split('/').map(encodeURIComponent)
  return apiUrl(`/api/plugins/${pluginId}/${segments.join('/')}`)
},

async fetchAsset(relativePath: string, init?: RequestInit): Promise<Response> {
  return authFetch(this.assetUrl(relativePath), init)
},
```

按路径段 `encodeURIComponent`，避免非 ASCII 文件名（如 `我的文件.json`）或含空格/`+` 的路径产生畸形 URL。`fetchAsset` 内部复用 `authFetch`（`apiBase.ts:155-179`），在 Tauri 模式下走 `tauri_fetch` 携带 Bearer header。

#### 2. `plugin-api/index.d.ts`

在 `PluginContext` 接口（`:45` 起）中添加同样的 `assetUrl` 和 `fetchAsset` 声明，保持类型定义与运行时实现同步。

### 后端改动

`plugin_asset`（`src/plugin/crud.rs:37-68`）需要三处调整：

**1. 动态 Cache-Control**：dev-link 插件用 `no-cache`（开发时能立即看到文件修改），正常安装用 `private, max-age=3600`。需要从 `pm.registry.get(&id)` 查 `is_dev_link`。

**2. 补 `nosniff` header**：阻止浏览器对非 JS 响应做 MIME 嗅探后当 JS 执行。

**3. （可选）流式传输**：当前 `tokio::fs::read` 一次性读整个文件到内存，对 1MB 尚可，对几十 MB 的视频/数据集会有内存压力。如需支持大文件，改为 `tokio::fs::File` + `tokio_util::io::ReaderStream` + `Body::from_stream`，并显式设 `Content-Length`。当前版本暂不实现，作为 follow-up。

调整后的响应构建：

```rust
let cache_control = match pm.registry.get(&id) {
    Some(info) if info.is_dev_link => "no-cache",
    _ => "private, max-age=3600",
};

Response::builder()
    .header("Content-Type", mime.as_ref())
    .header("Cache-Control", cache_control)
    .header("X-Content-Type-Options", "nosniff")
    .body(Body::from(content))
    .unwrap()
```

- `private`：资源在 Server 模式或用户主动关闭 loopback 旁路时是认证后响应，`public` 会被共享代理/CDN 缓存并复用给其他请求，`private` 限制只允许浏览器本地缓存。
- `nosniff`：阻止浏览器对非 JS 响应做 MIME 嗅探后当 JS 执行。

## 关键细节

### 认证兼容性

`authFetch`（`apiBase.ts:155-179`）在 Tauri 模式下走 `tauri_fetch` 命令（`src-tauri/src/main.rs:380-404`），这是 Rust 侧 `reqwest` 请求，**不受浏览器 `<script>` 标签无法携带 header 的限制**。Bearer token 会被自动注入 `Authorization` header。

| 场景 | `<script>`/`<img>` 标签 | `authFetch` |
|------|--------------------------|-------------|
| 浏览器模式（cookie） | ✅ 自动携带 cookie | ✅ 同源自动携带 cookie |
| Tauri 默认配置（loopback 旁路开启） | ✅ IP 旁路放行 | ✅ IP 旁路放行 |
| Tauri + 主动关闭 loopback 旁路 | ⚠️ 无法携带 Bearer | ✅ 通过 `tauri_fetch` 携带 |
| 未配置 token | ✅ 全部放行 | ✅ 全部放行 |

**结论**：`assetUrl` 返回原始 URL 即可。对于 `<script>` 标签加载受限的 edge case（Tauri + 关闭 loopback 旁路），插件应复用 `main.js` loader 已有的 `authFetch` + Blob URL 模式（见下文示例），而不是让 `assetUrl` 做特殊处理。

> 注意：`wsUrlWithToken`（`apiBase.ts:183`）的注释已经表明代码库的设计假设是"Tauri 模式下 loopback 旁路始终可用"。用户主动从白名单删除 `127.0.0.1` 是破坏默认配置的行为，不为该场景叠加额外防御。

### `assetUrl` 与认证的关系

`assetUrl` 只负责生成 URL，不带认证信息。认证由调用方处理：

| 调用方式 | 浏览器模式 | Tauri 默认 | Tauri + 关闭 loopback |
|----------|-----------|------------|----------------------|
| `fetch(ctx.assetUrl(path))` | ✅ 同源带 cookie | ✅ IP 旁路 | ❌ 401 |
| `ctx.fetchAsset(path)` | ✅ 同源带 cookie | ✅ IP 旁路 | ✅ Bearer |
| `<script src={ctx.assetUrl(path)}>` | ✅ 同源带 cookie | ✅ IP 旁路 | ❌ 401 |

**为什么需要 `ctx.fetchAsset`**：插件以 Blob URL 动态 `import()` 加载（`usePluginLoader.ts:491-494`），没有模块解析上下文，**无法 import 项目内部模块**（如 `@/composables/apiBase` 里的 `authFetch`）。所以要让插件在所有认证模式下都能加载 vendor JS，必须通过 `PluginContext` 暴露这个能力，而不是让插件自己 import。

**对插件作者的建议**：
- JSON / 图片等可直接用 `fetch(ctx.assetUrl(path))`，浏览器模式和 Tauri 默认配置下都能工作
- 大型 vendor JS 用 `ctx.fetchAsset(path)` + Blob URL 模式（见下文示例），兼容所有认证模式

### 路径处理

```typescript
assetUrl('./vendor/encom-globe.js')
// → /api/plugins/jiahao-globe/vendor/encom-globe.js

assetUrl('vendor/encom-globe.js')
// → /api/plugins/jiahao-globe/vendor/encom-globe.js

assetUrl('./data/grid.json')
// → /api/plugins/jiahao-globe/data/grid.json

assetUrl('./data/我的文件.json')
// → /api/plugins/jiahao-globe/data/%E6%88%91%E7%9A%84%E6%96%87%E4%BB%B6.json
```

`./` 前缀会被自动移除；路径段做 `encodeURIComponent`。`../` 会被后端 `subpath.contains("..")` 拒绝（返回 400）。

### 缓存策略

当前 `plugin_asset` 返回 `Cache-Control: no-cache`（语义是"使用前必须 revalidate"，不是"不缓存"）。建议按插件类型分策略：

| 插件类型 | Cache-Control | 理由 |
|----------|---------------|------|
| 正常安装 | `private, max-age=3600` | 资源内容稳定，1 小时内免重新验证 |
| dev-link | `no-cache` | 开发时改文件能立即看到更新 |

- `private`：仅允许浏览器本地缓存，避免共享代理缓存认证后响应（Server 模式或关闭 loopback 旁路时资源是认证后的）

**插件更新后的缓存失效**：正常安装的插件更新后路径不变（`/api/plugins/{id}/...`），但 `max-age=3600` 会让浏览器在 1 小时内继续用旧缓存。两个解决方向：
- **ETag + If-None-Match**（后端侧）：用文件 mtime 生成 ETag，处理 304 响应。语义正确但需要改 handler 逻辑。
- **URL 版本号**（插件侧）：`assetUrl` 自动从 manifest 拼版本号到 query string（如 `?v=1.2.0`）。需要 `createPluginContext` 能拿到 manifest，目前只传了 `pluginId`，需要扩展签名。

当前版本暂不实现这两个，作为 follow-up。如果插件需要强制刷新，可以用 `fetch(url, { cache: 'no-cache' })` 或在 URL 后手动加 `?v={Date.now()}`。

**大文件流式传输**：当前 `tokio::fs::read` 一次性读整个文件到内存。对 1MB 的 vendor JS 尚可，但若插件有几十 MB 的视频/数据集，并发请求会线性占用内存。流式传输（`ReaderStream` + `Body::from_stream`）是 future enhancement，不影响当前设计。

## 插件使用示例

### JSON / 图片等可直接 fetch 的资源

```javascript
export function activate(ctx) {
  async function init() {
    // JSON 数据 - fetch 在所有认证模式下都能工作
    // 浏览器模式自动带 cookie；Tauri 模式走 tauri_fetch 带 Bearer
    const resp = await fetch(ctx.assetUrl('./data/grid.json'))
    const data = await resp.json()
  }
}
```

### 大型 vendor JS（需要 `<script>` 标签语义）

Tauri 默认配置下 loopback 旁路开启，`<script src={ctx.assetUrl(path)}>` 可直接使用。若需兼容"Tauri + 关闭 loopback 旁路"的 edge case，用 `ctx.fetchAsset` + Blob URL 模式（插件无法直接 import `authFetch`，所以必须走 `ctx.fetchAsset`）：

```javascript
export function activate(ctx) {
  async function loadVendorScript(relativePath) {
    const res = await ctx.fetchAsset(relativePath)
    if (!res.ok) throw new Error(`load ${relativePath} failed: ${res.status}`)
    const code = await res.text()
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = blobUrl
      script.onload = () => { URL.revokeObjectURL(blobUrl); resolve() }
      script.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error(`load ${relativePath} failed`)) }
      document.head.appendChild(script)
    })
  }

  async function init() {
    await loadVendorScript('./vendor/encom-globe.js')
  }
}
```

## 插件目录结构

```
jiahao-globe/
├── plugin.json
├── main.js
├── styles.css
├── vendor/
│   └── encom-globe.js   # ~1MB, 含 Three.js
└── data/
    └── grid.json         # ~960KB
```

## 测试计划

### 前端单元测试（`assetUrl` + `fetchAsset` 实现）

- `./` 前缀移除：`assetUrl('./a.js')` 与 `assetUrl('a.js')` 结果一致
- 路径段编码：`assetUrl('./data/我的文件.json')` 产出 `%E6%88%91%E7%9A%84%E6%96%87%E4%BB%B6`
- 空路径：`assetUrl('')` 不崩溃，产出 `/api/plugins/{id}/`
- 多段路径：`assetUrl('./a/b/c.js')` 每段独立编码
- `fetchAsset('./a.js')` 内部调用 `authFetch(ctx.assetUrl('./a.js'))`，可 mock `authFetch` 验证

### 后端集成测试（`plugin_asset`）

- 各 MIME 类型返回正确 `Content-Type`（`.js` / `.json` / `.css` / `.wasm` / `.png`）
- `subpath` 含 `..` 返回 400
- symlink 逃逸（dev-link 目录里有 symlink 指向外部）返回 403
- 不存在的文件返回 404
- dev-link 插件返回 `Cache-Control: no-cache`
- 正常安装插件返回 `Cache-Control: private, max-age=3600`
- 响应包含 `X-Content-Type-Options: nosniff`

### E2E 验证

最小插件加载 vendor JS + JSON 的完整流程：
1. 插件 `activate(ctx)` 调用 `ctx.assetUrl('./data/grid.json')` 拿到 URL，用 `fetch` 加载 JSON
2. 插件调用 `ctx.fetchAsset('./vendor/lib.js')` + Blob URL 加载 vendor JS 并执行
3. 在浏览器模式和 Tauri 模式下分别验证

## 安全性

已由 `plugin_asset` 保障：
- 路径遍历防护：`subpath.contains("..")` 早退 + `canonicalize` + `starts_with` 双重校验
- MIME 类型自动检测（`mime_guess`），建议补充 `X-Content-Type-Options: nosniff`
- 插件隔离（只能访问自己的 `/api/plugins/{id}/`）

### 已知限制

- **插件禁用后资源仍可访问**：`plugin_asset` 只做路径校验，不检查 `PluginInfo.state`。插件被禁用（非 `Active`）后，其资源仍能通过 URL 访问。如果这是期望行为（方便调试），需在文档说明；如果不是，需要加 state 检查。当前版本暂不处理，作为 follow-up。
- **无资源大小限制**：当前不限制单个资源文件大小。恶意插件理论上可上传超大文件导致内存压力（配合流式传输可缓解）。
- **无 Range 请求支持**：浏览器对视频/音频 seeking 会发 `Range` 请求，当前 handler 返回整个文件。插件若需加载视频会有问题。

## 总结

| 项目 | 状态 |
|------|------|
| 后端路由 | ✅ 已存在（`embedded_server/router.rs:175` + `main.rs:875`，两端同步） |
| 路径安全 | ✅ 已实现 |
| MIME 类型 | ✅ 已实现（建议补 `nosniff`） |
| 认证兼容 | ✅ `authFetch` 走 `tauri_fetch` 可携带 Bearer，`<script>` 标签在默认 loopback 旁路下可用 |
| 前端接口定义 | ❌ 需添加 `assetUrl` + `fetchAsset`（`usePluginLoader.ts` + `plugin-api/index.d.ts`） |
| 前端实现 | ❌ 需添加（含路径段 URL 编码 + `fetchAsset` 封装 `authFetch`） |
| 后端 header 补强 | ❌ 动态 Cache-Control（dev-link vs 正常）+ `nosniff` |
| dev-link 缓存 | ❌ 需查 `is_dev_link` 动态决定 |
| 插件更新缓存失效 | ⏸ follow-up（ETag 或 URL 版本号） |
| 大文件流式传输 | ⏸ follow-up（`ReaderStream` + `Body::from_stream`） |
| 插件禁用后资源访问 | ⏸ follow-up（加 state 检查，或文档说明为期望行为） |
| Range 请求支持 | ⏸ follow-up（视频 seeking 场景） |
| 测试计划 | ❌ 前端单元 + 后端集成 + E2E |

改动量：前端 2 个文件各加约 10 行（`assetUrl` + `fetchAsset` 的接口与实现）；后端 `plugin_asset` 响应 header 调整约 5 行（含 `is_dev_link` 查询）。

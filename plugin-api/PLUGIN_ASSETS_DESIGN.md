# Plugin Static Asset Loading — Design

## Background

Plugin code has no way to obtain the URL of its own static assets, which prevents loading large third-party libraries (e.g. Three.js + the ENCOM Globe).

## Current State

### The backend route already exists

`src-tauri/src/embedded_server/router.rs:175` and `src/main.rs:875` both register the same route (kept in sync across desktop/server, no router drift):

```rust
.route("/api/plugins/:id/*path", get(plugin::plugin_asset))
```

The `plugin_asset` function in `plugin/crud.rs:37-68` is already implemented:

- Path traversal protection: an early 400 on `subpath.contains("..")`, plus a double check via `canonicalize` + `starts_with`
- Automatic MIME detection: `mime_guess::from_path`
- Error handling: 400 (contains `..`) / 404 (file missing) / 403 (path escape)

### The plugin loader already uses this route

`usePluginLoader.ts` lines 486-493:

```typescript
const jsUrl = apiUrl(`/api/plugins/${id}/${entry.replace('./', '')}`)
const jsRes = await authFetch(jsUrl)
```

### Auth mechanism

The `auth_middleware` in `auth/mod.rs:193` applies to `/api/plugins/:id/*path` and supports three allow paths:

1. Cookie session (browser mode)
2. Bearer token (Tauri mode, carried by Rust-side requests via `tauri_fetch`)
3. IP whitelist bypass (loopback is whitelisted by default)

`default_ip_whitelist` (`src/settings/types.rs:441-450`) is feature-gated:

- Desktop mode (Tauri): defaults to `["127.0.0.1", "::1"]` with the loopback bypass enabled
- Server mode: defaults to `[]` with the loopback bypass disabled; every request must authenticate

### What's missing

Both `PluginContext` interfaces (`usePluginLoader.ts:84` and `plugin-api/index.d.ts:45`) lack `assetUrl` declarations, and `createPluginContext` (`usePluginLoader.ts:250`, context assembled at `:424`) has no implementation either.

## Implementation Plan

### Files to change (2 frontend files + 1 small backend tweak)

#### 1. `frontend/src/composables/usePluginLoader.ts`

**Interface** (inside the `PluginContext` interface block starting at `:84`, add two methods):

```typescript
/** Get the HTTP URL for a plugin asset
 *  @param relativePath path relative to the plugin directory, e.g. './vendor/lib.js'
 *  @returns full HTTP URL
 */
assetUrl(relativePath: string): string

/** Request a plugin asset with the current auth identity, returns a Response.
 *  Browser mode attaches cookies automatically; Tauri mode goes through tauri_fetch with a Bearer token.
 *  Use this for vendor JS and other header-authenticated scenarios; JSON/images can use fetch(ctx.assetUrl(path)) directly.
 */
fetchAsset(relativePath: string, init?: RequestInit): Promise<Response>
```

**Implementation** (inside the context object returned by `createPluginContext`, around `:424`):

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

Each path segment is passed through `encodeURIComponent` so non-ASCII filenames (e.g. `我的文件.json`) or paths containing spaces/`+` don't produce malformed URLs. `fetchAsset` reuses `authFetch` (`apiBase.ts:155-179`), which goes through `tauri_fetch` with the Bearer header in Tauri mode.

#### 2. `plugin-api/index.d.ts`

Add the same `assetUrl` and `fetchAsset` declarations to the `PluginContext` interface (starting at `:45`) so the type definitions stay in sync with the runtime implementation.

### Backend changes

`plugin_asset` (`src/plugin/crud.rs:37-68`) needs three adjustments:

**1. Dynamic Cache-Control**: dev-link plugins get `no-cache` (so file edits show up immediately during development); normal installs get `private, max-age=3600`. Requires checking `pm.registry.get(&id)` for `is_dev_link`.

**2. Add a `nosniff` header**: prevents the browser from MIME-sniffing non-JS responses and executing them as JS.

**3. (Optional) streaming**: currently `tokio::fs::read` loads the whole file into memory at once. That's fine for ~1MB but stressful for tens-of-MB videos/datasets. To support large files, switch to `tokio::fs::File` + `tokio_util::io::ReaderStream` + `Body::from_stream` with an explicit `Content-Length`. Not implemented in this version; left as a follow-up.

The adjusted response construction:

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

- `private`: assets are authenticated responses under Server mode or when the user disables the loopback bypass; `public` would let shared proxies/CDNs cache and reuse them for other requests, so `private` restricts caching to the local browser.
- `nosniff`: prevents the browser from MIME-sniffing non-JS responses into JS execution.

## Key Details

### Auth compatibility

`authFetch` (`apiBase.ts:155-179`) uses the `tauri_fetch` command in Tauri mode (`src-tauri/src/main.rs:380-404`) — a Rust-side `reqwest` request that **is not subject to the browser's inability to attach headers on `<script>` tags**. The Bearer token is injected into the `Authorization` header automatically.

| Scenario | `<script>`/`<img>` tag | `authFetch` |
|----------|------------------------|-------------|
| Browser mode (cookie) | ✅ cookie attached automatically | ✅ same-origin cookie attached automatically |
| Tauri default config (loopback bypass on) | ✅ allowed via IP bypass | ✅ allowed via IP bypass |
| Tauri + loopback bypass disabled | ⚠️ cannot carry Bearer | ✅ carries it via `tauri_fetch` |
| No token configured | ✅ everything allowed | ✅ everything allowed |

**Conclusion**: `assetUrl` can return the plain URL. For edge cases where `<script>` loading is restricted (Tauri + loopback bypass disabled), plugins should reuse the existing `authFetch` + Blob URL pattern from the `main.js` loader (see example below) rather than making `assetUrl` special-case it.

> Note: the comment on `wsUrlWithToken` (`apiBase.ts:183`) already states the codebase's design assumption that "the loopback bypass is always available in Tauri mode". A user manually removing `127.0.0.1` from the whitelist breaks the default config; we don't add extra defenses on top of that scenario.

### Relationship between `assetUrl` and auth

`assetUrl` only generates URLs and carries no auth info. Callers handle authentication:

| Call style | Browser mode | Tauri default | Tauri + loopback off |
|------------|--------------|---------------|----------------------|
| `fetch(ctx.assetUrl(path))` | ✅ same-origin cookie | ✅ IP bypass | ❌ 401 |
| `ctx.fetchAsset(path)` | ✅ same-origin cookie | ✅ IP bypass | ✅ Bearer |
| `<script src={ctx.assetUrl(path)}>` | ✅ same-origin cookie | ✅ IP bypass | ❌ 401 |

**Why `ctx.fetchAsset` is needed**: plugins are dynamically loaded via `import()` of a Blob URL (`usePluginLoader.ts:491-494`) and have no module resolution context, so they **cannot import project-internal modules** (like `authFetch` from `@/composables/apiBase`). Exposing this capability through `PluginContext` — instead of expecting plugins to import it themselves — is what lets plugins load vendor JS under every auth mode.

**Advice for plugin authors**:
- JSON / images work directly with `fetch(ctx.assetUrl(path))` in both browser mode and default Tauri config
- Large vendor JS should use `ctx.fetchAsset(path)` + the Blob URL pattern (example below), which works under all auth modes

### Path handling

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

The `./` prefix is removed automatically; each segment is `encodeURIComponent`-ed. `../` is rejected by the backend's `subpath.contains("..")` check (400).

### Caching strategy

`plugin_asset` currently returns `Cache-Control: no-cache` (semantics: "must revalidate before use", not "do not cache"). Recommended per-plugin-type policies:

| Plugin type | Cache-Control | Rationale |
|-------------|---------------|-----------|
| Normal install | `private, max-age=3600` | Content is stable; skip revalidation within an hour |
| dev-link | `no-cache` | File edits show up immediately during development |

- `private`: only browser-local caching; avoids shared proxies caching authenticated responses (assets are authenticated under Server mode or when the loopback bypass is disabled)

**Cache invalidation after plugin updates**: after a normal plugin update the path stays the same (`/api/plugins/{id}/...`), but `max-age=3600` keeps browsers on stale cache for up to an hour. Two directions:

- **ETag + If-None-Match** (backend side): generate an ETag from file mtime and handle 304 responses. Semantically correct but requires handler changes.
- **URL version parameter** (plugin side): `assetUrl` appends the manifest version as a query param (e.g. `?v=1.2.0`). Requires `createPluginContext` to receive the manifest; today it only gets `pluginId`, so the signature needs extending.

Neither is implemented in this version; both are follow-ups. Plugins that need a hard refresh can use `fetch(url, { cache: 'no-cache' })` or append `?v={Date.now()}` manually.

**Large-file streaming**: `tokio::fs::read` currently reads the whole file into memory. Fine for ~1MB vendor JS, but if a plugin ships tens-of-MB videos/datasets, concurrent requests consume memory linearly. Streaming (`ReaderStream` + `Body::from_stream`) is a future enhancement and does not affect this design.

## Plugin Usage Examples

### JSON / images — direct fetch works

```javascript
export function activate(ctx) {
  async function init() {
    // JSON data - fetch works under every auth mode
    // Browser mode attaches cookies automatically; Tauri mode uses tauri_fetch with Bearer
    const resp = await fetch(ctx.assetUrl('./data/grid.json'))
    const data = await resp.json()
  }
}
```

### Large vendor JS (requires `<script>` semantics)

Under the default Tauri config the loopback bypass is enabled, so `<script src={ctx.assetUrl(path)}>` works directly. To also cover "Tauri + loopback bypass disabled", use `ctx.fetchAsset` + a Blob URL (plugins cannot import `authFetch` directly, hence `ctx.fetchAsset`):

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

## Plugin Directory Structure

```
jiahao-globe/
├── plugin.json
├── main.js
├── styles.css
├── vendor/
│   └── encom-globe.js   # ~1MB, includes Three.js
└── data/
    └── grid.json         # ~960KB
```

## Test Plan

### Frontend unit tests (`assetUrl` + `fetchAsset` implementations)

- `./` prefix removal: `assetUrl('./a.js')` equals `assetUrl('a.js')`
- Segment encoding: `assetUrl('./data/我的文件.json')` yields `%E6%88%91%E7%9A%84%E6%96%87%E4%BB%B6`
- Empty path: `assetUrl('')` doesn't crash and yields `/api/plugins/{id}/`
- Multi-segment paths: each segment of `assetUrl('./a/b/c.js')` is encoded independently
- `fetchAsset('./a.js')` calls `authFetch(ctx.assetUrl('./a.js'))` internally; mockable via `authFetch`

### Backend integration tests (`plugin_asset`)

- Correct `Content-Type` per MIME type (`.js` / `.json` / `.css` / `.wasm` / `.png`)
- `subpath` containing `..` returns 400
- Symlink escape (a dev-link directory containing a symlink pointing outside) returns 403
- Missing file returns 404
- dev-link plugins return `Cache-Control: no-cache`
- Normal installs return `Cache-Control: private, max-age=3600`
- Responses include `X-Content-Type-Options: nosniff`

### E2E verification

Minimal end-to-end flow loading vendor JS + JSON:
1. In `activate(ctx)`, call `ctx.assetUrl('./data/grid.json')` and load the JSON with `fetch`
2. Call `ctx.fetchAsset('./vendor/lib.js')` + Blob URL to load and execute vendor JS
3. Verify under both browser mode and Tauri mode

## Security

Already guaranteed by `plugin_asset`:

- Path traversal protection: early-exit on `subpath.contains("..")` plus double validation via `canonicalize` + `starts_with`
- Automatic MIME detection (`mime_guess`); recommend adding `X-Content-Type-Options: nosniff`
- Plugin isolation (each plugin can only access its own `/api/plugins/{id}/`)

### Known limitations

- **Assets remain accessible after a plugin is disabled**: `plugin_asset` only validates paths; it never checks `PluginInfo.state`. A disabled (non-`Active`) plugin's assets are still reachable by URL. If that's intended (handy for debugging), document it; otherwise add a state check. Not handled in this version; follow-up.
- **No asset size limit**: individual asset file sizes are unbounded. A malicious plugin could theoretically upload huge files causing memory pressure (mitigated by streaming).
- **No Range request support**: browsers send `Range` requests when seeking video/audio; the handler currently returns the whole file. Video-loading plugins will be affected.

## Summary

| Item | Status |
|------|--------|
| Backend route | ✅ exists (`embedded_server/router.rs:175` + `main.rs:875`, kept in sync) |
| Path safety | ✅ implemented |
| MIME types | ✅ implemented (`nosniff` recommended) |
| Auth compatibility | ✅ `authFetch` carries Bearer via `tauri_fetch`; `<script>` tags work under the default loopback bypass |
| Frontend interface definitions | ❌ add `assetUrl` + `fetchAsset` (`usePluginLoader.ts` + `plugin-api/index.d.ts`) |
| Frontend implementation | ❌ add (per-segment URL encoding + `fetchAsset` wrapping `authFetch`) |
| Backend header hardening | ❌ dynamic Cache-Control (dev-link vs normal) + `nosniff` |
| dev-link caching | ❌ query `is_dev_link` to decide dynamically |
| Post-update cache invalidation | ⏸ follow-up (ETag or URL version param) |
| Large-file streaming | ⏸ follow-up (`ReaderStream` + `Body::from_stream`) |
| Asset access after disable | ⏸ follow-up (state check, or document as intended) |
| Range request support | ⏸ follow-up (video seeking) |
| Test plan | ❌ frontend unit + backend integration + E2E |

Change size: two frontend files gain roughly 10 lines each (interface + implementation for `assetUrl` / `fetchAsset`); backend `plugin_asset` response headers change by about 5 lines (including the `is_dev_link` lookup).

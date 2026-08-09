# Web Preview

Dinotty has a built-in reverse proxy that lets you preview local dev servers or external URLs in a pane, no need to switch to a separate browser.

## Opening a Web Preview Pane

| Method | Action |
|--------|--------|
| Toolbar | Click the Monitor icon button to create or focus a web/files preview leaf |
| Command Palette | Type `webpreview.open` |
| Drag URL | Drag a URL from the address bar into the Dinotty window |
| Terminal link | `Cmd` / `Ctrl` + click a URL in terminal output to open it in a new leaf |

Web preview panes share the same split/drag rules as terminal, file editor, and plugin panes. See [Tabs & Panes](tabs-and-panes).

## Preview Toolbar

Each web preview leaf has a toolbar at the top:

- **Back / Forward**: navigate history, just like a browser
- **Refresh**: force reload (bypasses iframe cache)
- **Address bar**: type a URL and press Enter; dropdown shows recent URLs
- **Open in browser**: open the current URL in the system default browser
- **Bookmark (Star)**: save the current URL for quick access from the address bar dropdown
- **DevTools**: built-in developer tools panel with Console / Network / Eval
- **Close**: `Cmd + W` (when focused on the pane) or click X in the pane header

## Local Dev Server Proxy

When previewing `http://localhost:<port>`, Dinotty proxies requests through its built-in reverse proxy:

- **Same-origin access**: avoids browser CORS restrictions
- **WebSocket support**: HMR / live reload works
- **Path preservation**: `/preview/<port>/<path>` proxies to `http://localhost:<port>/<path>`
- **Auto-reconnect**: preview recovers automatically when the dev server restarts

::: tip Path prefix
Preview URLs look like `/preview/3000/foo/bar`, mapping to `http://localhost:3000/foo/bar`. Dinotty rewrites absolute paths inside the page so resources load correctly.
:::

## External URL Proxy

You can also preview any external URL (e.g., `https://example.com`):

- **GET proxy**: HTML / JSON / images, etc.
- **Response rewrite**: injects iframe-compatible scripts, handles `X-Frame-Options` rejections
- **Cookie isolation**: each preview has its own session, no pollution of the main login state

::: warning External URL limits
- Some sites refuse embedding via CSP / `X-Frame-Options`, the preview will be blank
- Logged-in private content (e.g., Gmail) cannot be previewed
- Use only for public pages or local services
:::

## Typical Use Cases

### Coding agent web verification

Let Claude Code / opencode generate a web app; after the agent starts the dev server, you can preview it directly in Dinotty without an external browser.

### Multi-port preview

Split 4 web preview panes pointing at `:3000` / `:3001` / `:8080` / `:8888`, compare outputs.

### Mobile real-device test

Run the dev server on desktop, connect from mobile to the same Dinotty server, open a web preview pane on mobile -- equivalent to mobile real-device testing.

## Closing the Preview

- Close pane: `Cmd + W` (when focused on the pane) or click X in the pane header
- Back / forward: navigation buttons in the preview toolbar

## Next Steps

- [Tabs & Panes](tabs-and-panes) - Pane layout
- [Multi-device Sync & Mission Control](multi-device-sync) - Mobile real-device testing
- [Plugins](../plugins/plugins) - Run Vue plugins in panes

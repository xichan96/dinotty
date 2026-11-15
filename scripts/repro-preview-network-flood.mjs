#!/usr/bin/env node
/**
 * Repro: the preview DevTools Network panel can freeze the app on a phone.
 *
 * Boots an isolated dinotty-server (throwaway port + isolated app-data), serves
 * a preview page on a second port, drives a mobile-emulated Chrome over CDP:
 *
 *   terminal tab -> split in a web preview -> DevTools -> Network tab
 *   -> open the Dinotty keyboard and focus its text box
 *   -> click the previewed page's text box
 *   -> send 3000 preview-network messages at once (what a busy or retrying page
 *      does naturally) and measure how long the main thread stays blocked.
 *
 * Before the fix this burst pushed every message through reactivity: one array
 * rebuild, one 500-row render and one forced layout per entry. 3000 messages
 * blocked the app for ~21s. After batching the same burst settles inside the
 * 2s measurement window. Also worth reproducing with the real device keyboard
 * open, which is when users notice it as a hard freeze.
 *
 * Requires a built frontend (cd frontend && pnpm build) and
 * target/debug/dinotty-server(.exe).
 *
 * Usage (repo root):
 *   node scripts/repro-preview-network-flood.mjs
 *   node scripts/repro-preview-network-flood.mjs --headful --keep
 *   BURST=5000 node scripts/repro-preview-network-flood.mjs
 *
 * Exit code: 0 when the burst stays responsive, 1 otherwise.
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverBin = join(repoRoot, 'target', 'debug', `dinotty-server${process.platform === 'win32' ? '.exe' : ''}`)
const SERVER_PORT = Number(process.env.REPRO_PORT ?? 58931)
const TOKEN = 'repro-token'
const BASE = `http://127.0.0.1:${SERVER_PORT}`
const BURST = Number(process.env.BURST ?? 3000)
const headful = process.argv.includes('--headful')
const keepOpen = process.argv.includes('--keep')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const PREVIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin: 0; font: 14px system-ui; background: #fff; color: #222; }
  header { padding: 12px; border-bottom: 1px solid #ddd; }
  input { width: 100%; box-sizing: border-box; padding: 10px; font-size: 16px; }
  main { padding: 8px 12px; }
  .row { padding: 4px 0; border-bottom: 1px solid #eee; }
</style></head>
<body>
  <header><input id="q" placeholder="search here" /></header>
  <main id="list"></main>
  <script>
    const list = document.getElementById('list')
    for (let i = 0; i < 80; i++) {
      const row = document.createElement('div')
      row.className = 'row'
      row.textContent = 'row ' + i + ' — lorem ipsum dolor sit amet'
      list.appendChild(row)
    }
    setInterval(() => { fetch('/ping?i=' + Math.random()).catch(() => {}) }, 400)
    // Deterministic burst of preview-network messages, as a busy/failing app
    // would emit through the proxy's injected fetch wrapper.
    window.__flood = (n) => {
      for (let i = 0; i < n; i++) {
        window.parent.postMessage({
          type: 'preview-network',
          method: 'GET',
          url: '/burst/' + i,
          status: 200,
          duration: 1,
          ts: Date.now(),
        }, '*')
      }
    }
  </script>
</body></html>`

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (event) => this.onMessage(event.data))
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP closed'))
      this.pending.clear()
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((done, fail) => {
      ws.addEventListener('open', done, { once: true })
      ws.addEventListener('error', () => fail(new Error(`cannot connect to ${url}`)), { once: true })
    })
    return new Cdp(ws)
  }
  onMessage(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params)
    }
  }
  on(method, handler) {
    const list = this.handlers.get(method) ?? []
    list.push(handler)
    this.handlers.set(method, list)
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

async function waitForDevTools(userDataDir) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 150; attempt++) {
    if (existsSync(portFile)) {
      const [port, path] = (await readFile(portFile, 'utf8')).trim().split('\n')
      if (port && path) return `ws://127.0.0.1:${port}${path}`
    }
    await sleep(100)
  }
  throw new Error('browser did not expose a DevTools endpoint')
}

async function waitForServer() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/info`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  throw new Error('server did not become ready')
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function main() {
  if (!existsSync(serverBin)) throw new Error(`missing ${serverBin}; build the server first`)
  const browserPath = findBrowser()
  if (!browserPath) throw new Error('no Chrome/Edge found; set CHROME_PATH')

  // Isolated app-data; the server's relative artifacts stay in this directory.
  const appdata = await mkdtemp(join(tmpdir(), 'dinotty-repro-appdata-'))
  await mkdir(join(appdata, 'local'), { recursive: true })
  await mkdir(join(appdata, 'profile'), { recursive: true })
  const userDataDir = await mkdtemp(join(tmpdir(), 'dinotty-repro-chrome-'))

  const previewServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/ping')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('pong')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PREVIEW_HTML)
  })
  await new Promise((done) => previewServer.listen(0, '127.0.0.1', done))
  const previewUrl = `http://127.0.0.1:${previewServer.address().port}/`

  const server = spawn(serverBin, ['--port', String(SERVER_PORT)], {
    cwd: appdata,
    env: {
      ...process.env,
      APPDATA: appdata,
      LOCALAPPDATA: join(appdata, 'local'),
      USERPROFILE: join(appdata, 'profile'),
      HOME: join(appdata, 'profile'),
      XDG_CONFIG_HOME: join(appdata, 'xdg-config'),
      XDG_DATA_HOME: join(appdata, 'xdg-data'),
      DINOTTY_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let serverErr = ''
  server.stderr.on('data', (chunk) => {
    serverErr += chunk.toString()
    if (serverErr.length > 8000) serverErr = serverErr.slice(-8000)
  })

  const browser = spawn(
    browserPath,
    [
      ...(headful ? [] : ['--headless=new']),
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=420,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let browserErr = ''
  browser.stderr.on('data', (chunk) => {
    browserErr += chunk.toString()
    if (browserErr.length > 8000) browserErr = browserErr.slice(-8000)
  })

  let cdp = null
  try {
    await waitForServer()
    cdp = await Cdp.connect(await waitForDevTools(userDataDir))
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const send = (method, params) => cdp.send(method, params, sessionId)
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      }
      return result.result?.value
    }
    const errors = []
    cdp.on('Runtime.exceptionThrown', (event) => {
      errors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text)
    })

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 412,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 412,
      screenHeight: 844,
    })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'hover', value: 'none' },
        { name: 'pointer', value: 'coarse' },
      ],
    })
    await send('Page.navigate', { url: `${BASE}/` })
    await sleep(1200)
    await evaluate(
      `fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: '${TOKEN}' }) }).then(r => r.status)`
    )
    await send('Page.reload')
    await sleep(2000)

    // Builtin keyboard + visible toggle on a touch device.
    const settings = await api('/api/settings')
    settings.show_virtual_keyboard = true
    settings.mobile_input_mode = 'builtin'
    settings.keyboard_guard_mode = 'off'
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    await send('Page.reload')
    await sleep(2000)

    // Split a web preview next to the terminal.
    const tabs = await api('/api/tabs')
    const tab = tabs.tabs?.[0]
    if (!tab) throw new Error(`no tabs from /api/tabs: ${JSON.stringify(tabs).slice(0, 300)}`)
    const paneId = tab.active_pane_id ?? tab.layout?.paneId
    await api(`/api/tabs/${tab.tab_id}/pane/web`, {
      method: 'POST',
      body: JSON.stringify({ url: previewUrl, target_pane_id: paneId, direction: 'vertical' }),
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(`!!document.querySelector('.web-preview')`)) break
      await sleep(200)
    }
    await sleep(1500)

    // DevTools -> Network.
    await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.web-preview-toolbar button')]
      buttons.find((b) => b.querySelector('svg.lucide-bug'))?.click()
    })()`)
    await sleep(300)
    await evaluate(`(() => {
      const tabs = [...document.querySelectorAll('.devtools-tab')]
      tabs.find((b) => /network|网络/i.test(b.textContent || ''))?.click()
    })()`)
    await sleep(500)

    // Make the terminal the active pane, then open the keyboard.
    await api(`/api/tabs/${tab.tab_id}/pane/${paneId}/activate`, { method: 'PUT' })
    await sleep(300)
    await evaluate(`(() => {
      const leaf = document.querySelector('.terminal-pane-container')?.closest('.split-leaf')
      leaf?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })()`)
    await sleep(300)
    await evaluate(`document.querySelector('#kb-toggle-btn')?.click()`)
    await sleep(600)
    await evaluate(`document.querySelector('.mkb-text-input')?.focus()`)
    await sleep(600)

    // Click the previewed page's text box, like the reported sequence.
    const iframeRect = await evaluate(`(() => {
      const el = document.querySelector('.web-preview-content iframe')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + 28 }
    })()`)
    if (iframeRect) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
          type,
          x: iframeRect.x,
          y: iframeRect.y,
          button: 'left',
          clickCount: 1,
        })
      }
    }
    await sleep(500)

    const state = await evaluate(`(() => {
      const kb = document.querySelector('#mobile-kb')
      const panel = document.querySelector('.devtools-panel')
      return {
        keyboard: kb ? getComputedStyle(kb).display !== 'none' : false,
        networkPanel: !!panel,
        networkRowsBefore: document.querySelectorAll('.devtools-net').length,
      }
    })()`)
    console.log('[repro] state:', JSON.stringify(state))

    // Phone-class CPU so the measurement matches the reported device class.
    await send('Emulation.setCPUThrottlingRate', { rate: 6 })
    const burst = await evaluate(`(async () => {
      const frame = document.querySelector('.web-preview-content iframe')
      if (!frame?.contentWindow?.__flood) return { error: 'no flood hook' }
      const rows = () => document.querySelectorAll('.devtools-net').length
      const beforeRows = rows()
      const stats = { frames: 0, longTasks: 0, longTaskMs: 0 }
      let observer = null
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            stats.longTasks += 1
            stats.longTaskMs += entry.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {}
      const start = performance.now()
      const tick = () => { stats.frames += 1; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      frame.contentWindow.__flood(${BURST})
      await new Promise((resolve) => setTimeout(resolve, 2000))
      observer?.disconnect()
      const elapsed = performance.now() - start
      return {
        beforeRows,
        afterRows: rows(),
        elapsedMs: Math.round(elapsed),
        fps: +(stats.frames / (elapsed / 1000)).toFixed(1),
        longTasks: stats.longTasks,
        longTaskMs: Math.round(stats.longTaskMs),
      }
    })()`)
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })

    console.log(`[repro] ${BURST}-message burst:`, JSON.stringify(burst))
    if (errors.length) console.log('[repro] page errors:', JSON.stringify(errors.slice(-5), null, 2))

    const responsive = burst && !burst.error && burst.elapsedMs < 4000 && burst.fps > 30
    console.log(
      responsive
        ? '[repro] PASS: the burst settles inside the measurement window'
        : '[repro] FAIL: the main thread is blocked by the network flood'
    )
    if (!responsive) process.exitCode = 1

    if (keepOpen) {
      console.log('[repro] --keep: browser left open; press Ctrl+C to exit')
      await sleep(600000)
    }
  } catch (error) {
    console.error('[repro] failed:', error instanceof Error ? error.message : error)
    if (serverErr.trim()) console.error('[server stderr]\n' + serverErr.trim().split('\n').slice(-10).join('\n'))
    if (browserErr.trim()) console.error('[browser stderr]\n' + browserErr.trim().split('\n').slice(-10).join('\n'))
    process.exitCode = 1
  } finally {
    try {
      if (cdp) await cdp.send('Browser.close')
    } catch {
      /* ignore */
    }
    cdp?.close()
    browser.kill()
    server.kill()
    previewServer.close()
    await sleep(300)
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
    await rm(appdata, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  }
}

main()

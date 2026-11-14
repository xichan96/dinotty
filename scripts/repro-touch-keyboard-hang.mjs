#!/usr/bin/env node
/**
 * Repro: tapping a TUI option (opencode) hangs the app when the tap also opens
 * the Dinotty keyboard.
 *
 * Boots an isolated dinotty-server, serves the built frontend, drives a
 * mobile-emulated Chrome over CDP:
 *
 *   start `opencode --standalone` in the terminal -> tap inside it (the tap
 *   sends the click AND opens the builtin keyboard) -> tap the option rows
 *   -> sample rAF: a stalled renderer is a frozen page.
 *
 * Root cause (fixed in readLogicalTerminalLine): xterm asks its link providers
 * for the hovered row on every mouse move, and the provider joined the entire
 * soft-wrap chain. opencode repaints full-width rows, so the chain covered the
 * whole buffer and each touch-generated hover scanned it - the main thread
 * never came back. The join is now bounded to a few rows.
 *
 * On a stall the script pauses the debugger, prints the stuck stack and reads
 * localStorage from a second same-origin target, which works while the app's
 * renderer is blocked.
 *
 * Requires a built frontend (cd frontend && pnpm build) and the debug server.
 *
 * Usage (repo root):
 *   node scripts/repro-touch-keyboard-hang.mjs
 *   node scripts/repro-touch-keyboard-hang.mjs --headful --keep
 *   CMD=opencode TAPS=12 node scripts/repro-touch-keyboard-hang.mjs
 *
 * Exit code: 0 if the page stayed responsive, 1 on a stall.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverBin = join(
  repoRoot,
  'target',
  'debug',
  `dinotty-server${process.platform === 'win32' ? '.exe' : ''}`
)
const SERVER_PORT = Number(process.env.REPRO_PORT ?? 58933)
const TOKEN = 'repro-token'
const BASE = `http://127.0.0.1:${SERVER_PORT}`
const CMD = process.env.CMD ?? 'opencode --standalone'
const TAPS = Number(process.env.TAPS ?? 12)
const headful = process.argv.includes('--headful')
const keepOpen = process.argv.includes('--keep')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

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

  const appdata = await mkdtemp(join(tmpdir(), 'dinotty-repro-appdata-'))
  await mkdir(join(appdata, 'local'), { recursive: true })
  await mkdir(join(appdata, 'profile'), { recursive: true })
  const userDataDir = await mkdtemp(join(tmpdir(), 'dinotty-repro-chrome-'))
  const menuLog = join(appdata, 'menu-input.log')

  const server = spawn(serverBin, ['--port', String(SERVER_PORT)], {
    cwd: appdata,
    env: {
      ...process.env,
      // Isolated profile/config: the debug binary is compiled with a fixed
      // config suffix, and USERPROFILE is what keeps dirs::config_dir() from
      // resolving to the user's live dinottydbg config.
      APPDATA: appdata,
      LOCALAPPDATA: join(appdata, 'local'),
      USERPROFILE: join(appdata, 'profile'),
      HOME: join(appdata, 'profile'),
      XDG_CONFIG_HOME: join(appdata, 'xdg-config'),
      XDG_DATA_HOME: join(appdata, 'xdg-data'),
      DINOTTY_TOKEN: TOKEN,
      DINOTTY_MENU_LOG: menuLog,
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
    const withTimeout = (promise, ms, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
      ])
    const send = (method, params) => withTimeout(cdp.send(method, params, sessionId), 8000, method)
    const evaluate = async (expression) => {
      const result = await withTimeout(
        send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
        6000,
        'Runtime.evaluate'
      )
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      }
      return result.result?.value
    }
    // Read localStorage from a fresh same-origin target: works while the app's
    // renderer is blocked, because it gets its own renderer process.
    const probeLocalStorage = async () => {
      try {
        const { targetId: probeId } = await cdp.send('Target.createTarget', {
          url: `${BASE}/manifest.json`,
        })
        const { sessionId: probeSession } = await cdp.send('Target.attachToTarget', {
          targetId: probeId,
          flatten: true,
        })
        await cdp.send('Runtime.enable', {}, probeSession)
        await sleep(600)
        const result = await withTimeout(
          cdp.send(
            'Runtime.evaluate',
            {
              expression: `(() => {
                const out = {}
                for (const key of Object.keys(localStorage)) {
                  if (key.startsWith('dinotty')) out[key] = (localStorage.getItem(key) || '').slice(0, 4000)
                }
                return out
              })()`,
              returnByValue: true,
            },
            probeSession
          ),
          5000,
          'probe evaluate'
        )
        await cdp.send('Target.closeTarget', { targetId: probeId }).catch(() => {})
        return result.result?.value ?? null
      } catch (error) {
        return { probeError: error.message }
      }
    }
    const errors = []
    cdp.on('Runtime.exceptionThrown', (event) => {
      errors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text)
    })
    let pausedFrames = null
    let pausedDetail = null
    cdp.on('Debugger.paused', (event) => {
      pausedDetail = event.callFrames ?? []
      pausedFrames = (event.callFrames ?? []).map(
        (frame) =>
          `${frame.functionName || '(anonymous)'} @ ${(frame.url || '').split('/').pop()}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`
      )
    })
    await send('Debugger.enable')

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

    // Builtin keyboard, visible toggle, no guard, Open API for screen reads.
    const settings = await api('/api/settings')
    settings.show_virtual_keyboard = true
    settings.mobile_input_mode = 'builtin'
    settings.keyboard_guard_mode = 'off'
    settings.open_api = { ...(settings.open_api ?? {}), enabled: true }
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    const afterSettings = await api('/api/settings')
    console.log('[repro] open_api:', JSON.stringify(afterSettings.open_api))
    await send('Page.reload')
    await sleep(2000)

    // Start the TUI in the active terminal by sending the command through the
    // app's own bridge (same bytes the user's keyboard would type).
    const sessions = await api('/api/sessions')
    const paneId = sessions.active_pane_id ?? sessions.sessions?.[0]?.pane_id
    if (!paneId) throw new Error('no active pane')
    const readScreen = async () => {
      const screen = await api(`/api/sessions/${paneId}/screen?format=plain`)
      return screen.content ?? ''
    }
    const readMenuInputLog = async () => {
      try {
        const text = await readFile(menuLog, 'utf8')
        return text.trim().split('\n').slice(-6)
      } catch (error) {
        return `(no log: ${error.message})`
      }
    }
    await evaluate(
      `window.__dinotty_terminal_api.send(${JSON.stringify(paneId)}, "echo REPRO-OK\\r")`
    )
    await sleep(700)
    console.log(
      '[repro] echo check:',
      JSON.stringify(
        (await readScreen())
          .split('\n')
          .filter((line) => line.trim())
          .slice(-6)
      )
    )
    await evaluate(
      `window.__dinotty_terminal_api.send(${JSON.stringify(paneId)}, ${JSON.stringify(CMD + '\r')})`
    )
    await sleep(2500)

    let menuMode = false
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(2000)
      const lines = (await readScreen()).split('\n').filter((line) => line.trim())
      const text = lines.join('\n')
      if (text.includes('DINOTTY-MENU')) {
        menuMode = true
        console.log('[repro] menu TUI ready')
        break
      }
      if (/OpenCode|opencode/.test(text) && /[▀╹┃│]/.test(text)) {
        console.log('[repro] opencode TUI ready')
        break
      }
      if (attempt === 9) console.log('[repro] TUI did not render:', JSON.stringify(lines.slice(-4)))
    }
    console.log(
      '[repro] xterm mouse mode:',
      await evaluate(`document.querySelector('.xterm')?.classList.contains('enable-mouse-events') ?? null`)
    )

    // Responsiveness probe: rAF counter + max gap.
    await evaluate(`(() => {
      window.__perf = { frames: 0, gap: 0, last: performance.now() }
      const tick = () => {
        const now = performance.now()
        window.__perf.gap = Math.max(window.__perf.gap, now - window.__perf.last)
        window.__perf.last = now
        window.__perf.frames += 1
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })()`)

    const rect = await evaluate(`(() => {
      const el = document.querySelector('.terminal-pane-container') || document.querySelector('.terminal-pane')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })()`)
    console.log('[repro] terminal rect:', JSON.stringify(rect))
    if (!rect) throw new Error('no terminal pane')

    if (menuMode) {
      // Direct PTY probe (bypasses the browser): confirms the fixture reads
      // stdin and that our log path matches.
      await api(`/api/sessions/${paneId}/input`, {
        method: 'POST',
        body: JSON.stringify({ data: 'a' }),
      })
      await sleep(400)
      console.log('[repro] after API input:', JSON.stringify(await readMenuInputLog()))
      await evaluate(`(() => {
        document.querySelector('.xterm-helper-textarea')?.focus()
      })()`)
      await evaluate(`(() => {
        window.__mouseProbe = { downs: 0, ups: 0 }
        const el = document.querySelector('.xterm')
        el?.addEventListener('mousedown', () => { window.__mouseProbe.downs += 1 }, true)
        el?.addEventListener('mouseup', () => { window.__mouseProbe.ups += 1 }, true)
      })()`)
      // Mouse-only click before any touch: validates that the fixture receives
      // reports at all (no keyboard, no hover fix involved).
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
          type,
          x: cx,
          y: cy,
          button: 'left',
          buttons: type === 'mousePressed' ? 1 : 0,
          clickCount: 1,
        })
      }
      await sleep(600)
      const screen = await readScreen()
      console.log('[repro] mouse-only pre-click selections:', (screen.match(/SELECTED \d+/g) ?? []).length)
      console.log(
        '[repro] mouse events reaching xterm:',
        JSON.stringify(await evaluate('window.__mouseProbe'))
      )
      // Key probe: confirms stdin reaches the fixture at all.
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        text: 'a',
        unmodifiedText: 'a',
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a' })
      await sleep(400)
      console.log('[repro] fixture input log:', JSON.stringify(await readMenuInputLog()))
    }

    const tap = async (x, y) => {
      // A real phone tap produces touch events followed by compatibility mouse
      // events; CDP's touch dispatch does not synthesize the mouse pair, so
      // send both. The fixture's mouse report depends on the second half.
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })
    }

    // First tap opens the keyboard; later taps must stay inside the shrunken
    // terminal (the keyboard overlays the bottom of the viewport).
    const tapFractions = [
      0.5, 0.88, 0.35, 0.8, 0.55, 0.92, 0.25, 0.75, 0.6, 0.45, 0.85, 0.3,
    ]
    const samples = []
    let selected = 0
    let stalled = false
    for (let i = 0; i < TAPS; i += 1) {
      try {
        const current = await evaluate(`(() => {
          const el = document.querySelector('.terminal-pane-container') || document.querySelector('.terminal-pane')
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height }
        })()`)
        if (!current) break
        const x = current.left + current.width / 2
        const y = current.top + current.height * tapFractions[i % tapFractions.length]
        await tap(x, y)
        await sleep(400)
        const sample = await evaluate(`(() => {
          const kb = document.querySelector('#mobile-kb')
          return {
            frames: window.__perf.frames,
            gap: Math.round(window.__perf.gap),
            keyboard: kb ? getComputedStyle(kb).display !== 'none' : false,
            paneH: Math.round(
              document.querySelector('.terminal-pane-container')?.getBoundingClientRect().height ?? 0
            ),
          }
        })()`)
        samples.push(sample)
        if (menuMode) {
          const screen = await readScreen()
          const match = screen.match(/DINOTTY-MENU[^\n]*selections=(\d+)/)
          selected = match ? Number(match[1]) : (screen.match(/SELECTED \d+/g) ?? []).length
          sample.selected = selected
        }
        console.log(`[repro] tap ${i + 1}:`, JSON.stringify(sample))
        if (sample.gap > 3000) {
          stalled = true
          break
        }
      } catch (error) {
        console.log(`[repro] tap ${i + 1}: renderer did not respond (${error.message})`)
        stalled = true
        break
      }
    }

    const final = samples.at(-1)
    if (!stalled) stalled = !final || final.gap > 3000

    if (stalled) {
      console.log('[repro] STALLED. Paused stack:')
      try {
        await withTimeout(send('Debugger.pause'), 4000, 'Debugger.pause').catch(() => {})
        await sleep(600)
      } catch {
        /* ignore */
      }
      console.log(pausedFrames ? pausedFrames.slice(0, 20).join('\n') : '(no pause event)')
      if (pausedDetail) {
        for (const frame of pausedDetail.slice(0, 6)) {
          const values = {}
          for (const expression of [
            'bufferLineNumber',
            'typeof line !== "undefined" && line ? line.text.length : null',
            'typeof line !== "undefined" && line ? JSON.stringify(line.text.slice(0, 60)) : null',
            'typeof line !== "undefined" && line && line.cells ? line.cells.length : null',
            'typeof text !== "undefined" && text ? text.length : null',
            'typeof cols !== "undefined" ? cols : null',
            'typeof first !== "undefined" ? first : null',
            'typeof last !== "undefined" ? last : null',
            'typeof row !== "undefined" ? row : null',
          ]) {
            try {
              const result = await withTimeout(
                cdp.send(
                  'Debugger.evaluateOnCallFrame',
                  {
                    callFrameId: frame.callFrameId,
                    expression,
                    returnByValue: true,
                    silent: true,
                  },
                  sessionId
                ),
                2000,
                'evaluateOnCallFrame'
              )
              if (!result.exceptionDetails) values[expression] = result.result?.value
            } catch {
              /* frame may be gone */
            }
          }
          console.log(
            `[repro] frame ${frame.functionName || '(anon)'}:`,
            JSON.stringify(values)
          )
        }
      }
      console.log('[repro] Local storage + last screen:')
      const stored = await probeLocalStorage()
      for (const [key, value] of Object.entries(stored ?? {})) {
        console.log(`--- ${key}\n${value}`)
      }
      try {
        const screen = await api(`/api/sessions/${paneId}/screen?format=plain`)
        const text = screen.content ?? ''
        console.log('[repro] last screen:\n' + text.split('\n').slice(-20).join('\n'))
      } catch {
        /* ignore */
      }
      process.exitCode = 1
    } else {
      console.log('[repro] PASS: no stall across the taps')
      if (menuMode && selected < 1) {
        console.log('[repro] FAIL: taps reached the terminal but no option was selected')
        process.exitCode = 1
      } else if (menuMode) {
        console.log(`[repro] PASS: ${selected} option selection(s) registered`)
      }
    }
    if (menuMode) {
      const screen = await readScreen()
      const line = screen.split('\n').find((entry) => entry.includes('DINOTTY-MENU'))
      console.log('[repro] menu line:', line ?? '(not visible)')
    }
    if (errors.length) console.log('[repro] page errors:', JSON.stringify(errors.slice(-5), null, 2))

    if (keepOpen) {
      console.log('[repro] --keep: browser left open; press Ctrl+C to exit')
      await sleep(600000)
    }
  } catch (error) {
    console.error('[repro] failed:', error instanceof Error ? error.message : error)
    if (serverErr.trim())
      console.error('[server stderr]\n' + serverErr.trim().split('\n').slice(-10).join('\n'))
    if (browserErr.trim())
      console.error('[browser stderr]\n' + browserErr.trim().split('\n').slice(-10).join('\n'))
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
    await sleep(300)
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
    await rm(appdata, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  }
}

main()

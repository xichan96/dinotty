import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../composables/apiBase', () => ({
  authFetch: vi.fn(),
  apiUrl: (path: string) => path,
}))

import { authFetch } from '../composables/apiBase'
import {
  installFromRegistry,
  installThemePack,
  loadThemePacks,
  loadThemeRegistry,
  removeThemePack,
  themePacks,
} from '../composables/useThemePacks'

const mockFetch = vi.mocked(authFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** A complete 16-colour palette. */
function palette(): string[] {
  return Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(6, '0')}`)
}

/** A theme document in the canonical shape the server writes. */
function themeJson(name: string): string {
  return JSON.stringify({
    name,
    colors: {
      foreground: '#ffffff',
      background: '#000000',
      cursor: '#ff00ff',
      ansi: palette(),
    },
  })
}

/** The same theme as a Ghostty `.conf`, which is what "Export theme" writes. */
function themeConf(name: string): string {
  const paletteLines = palette().map((color, index) => `palette = ${index}=${color}`)
  return [
    `# name = ${name}`,
    'foreground = #ffffff',
    'background = #000000',
    'cursor-color = #ff00ff',
    ...paletteLines,
  ].join('\n')
}

function stub(routes: Record<string, () => Response>): void {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [prefix, make] of Object.entries(routes)) {
      if (url.includes(prefix)) return make()
    }
    throw new Error(`unexpected url ${url}`)
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  themePacks.loaded = false
  themePacks.loading = false
  themePacks.importing = false
  themePacks.removing = null
  themePacks.lastError = null
  themePacks.installed = []
  themePacks.rejected = []
  themePacks.registry = null
  themePacks.registryConfigured = false
  themePacks.registryUrl = null
  themePacks.registryLoading = false
  themePacks.registryError = null
  themePacks.installing = null
})

describe('loadThemePacks', () => {
  it('parses the installed theme files into the store', async () => {
    stub({
      '/api/themes': () =>
        jsonResponse([
          { file: 'nord', body: themeJson('Nord') },
          { file: 'dracula-soft', body: themeJson('Dracula Soft') },
        ]),
    })

    await loadThemePacks()

    // Sorted by id, so the grid does not reshuffle on a transport change.
    expect(themePacks.installed.map((t) => t.id)).toEqual(['dracula-soft', 'nord'])
    expect(themePacks.installed[0].name).toBe('Dracula Soft')
    expect(themePacks.installed[0].colors.ansi).toHaveLength(16)
    expect(themePacks.lastError).toBeNull()
    expect(themePacks.loaded).toBe(true)
  })

  it('reads a Ghostty .conf served from the theme directory', async () => {
    stub({ '/api/themes': () => jsonResponse([{ file: 'nord', body: themeConf('Nord') }]) })

    await loadThemePacks()

    expect(themePacks.installed).toHaveLength(1)
    expect(themePacks.installed[0].name).toBe('Nord')
    expect(themePacks.rejected).toHaveLength(0)
  })

  it('reports an unreadable file without hiding the readable ones', async () => {
    stub({
      '/api/themes': () =>
        jsonResponse([
          { file: 'broken', body: '{ this is not a theme' },
          { file: 'nord', body: themeJson('Nord') },
        ]),
    })

    await loadThemePacks()

    expect(themePacks.installed.map((t) => t.id)).toEqual(['nord'])
    expect(themePacks.rejected.map((r) => r.file)).toEqual(['broken'])
    expect(themePacks.rejected[0].errors.length).toBeGreaterThan(0)
  })

  // A server predating this route simply has no theme files; that is not a
  // failure worth putting in front of the user.
  it('treats a 404 as "no themes", not as an error', async () => {
    stub({ '/api/themes': () => jsonResponse({}, 404) })

    await loadThemePacks()

    expect(themePacks.installed).toEqual([])
    expect(themePacks.lastError).toBeNull()
  })

  it('keeps the previous list when the fetch fails', async () => {
    stub({ '/api/themes': () => jsonResponse([{ file: 'nord', body: themeJson('Nord') }]) })
    await loadThemePacks()
    expect(themePacks.installed).toHaveLength(1)

    mockFetch.mockRejectedValue(new Error('network down'))
    await loadThemePacks()

    // Blanking would also drop this device's selection back to the server
    // default, which is a visible flicker caused by a network blip.
    expect(themePacks.installed).toHaveLength(1)
    expect(themePacks.lastError).toBeTruthy()
  })
})

describe('installThemePack', () => {
  it('posts JSON even when handed a Ghostty .conf', async () => {
    let posted: { url: string; body: unknown } | null = null
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted = { url, body: JSON.parse(String(init.body)) }
        return jsonResponse({ id: 'nord', name: 'Nord' })
      }
      return jsonResponse([])
    })

    const result = await installThemePack(themeConf('Nord'), 'nord.conf')

    expect(result.ok).toBe(true)
    // Translated on the way out: the server parses what it stores in order to
    // revalidate it, and carries no second .conf parser.
    expect(posted).not.toBeNull()
    expect(posted!.url).toContain('file=nord')
    const body = posted!.body as { id: string; name: string; colors: { ansi: string[] } }
    expect(body.id).toBe('nord')
    expect(body.name).toBe('Nord')
    expect(body.colors.ansi).toHaveLength(16)
  })

  it('refuses a filename that cannot be an id, without calling the server', async () => {
    const result = await installThemePack(themeJson('Nord'), 'my theme.json')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('my theme')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses a file that does not parse, without calling the server', async () => {
    const result = await installThemePack('not a theme at all', 'nord.json')

    expect(result.ok).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('surfaces the server reason when it refuses', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ error: 'invalid palette 3: nope' }, 400)
    )

    const result = await installThemePack(themeJson('Nord'), 'nord.json')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('invalid palette 3: nope')
  })

  it('clears the in-flight flag even when the request throws', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))

    const result = await installThemePack(themeJson('Nord'), 'nord.json')

    expect(result.ok).toBe(false)
    expect(themePacks.importing).toBe(false)
  })
})

describe('removeThemePack', () => {
  it('deletes by id and reloads the list', async () => {
    const calls: string[] = []
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'DELETE') return jsonResponse({ id: 'nord' })
      return jsonResponse([])
    })

    const result = await removeThemePack('nord')

    expect(result.ok).toBe(true)
    expect(calls).toContain('DELETE /api/themes/nord')
    expect(calls.filter((c) => c === 'GET /api/themes')).toHaveLength(1)
    expect(themePacks.removing).toBeNull()
  })

  it('surfaces the server reason when it refuses', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ error: 'invalid theme id' }, 400))

    const result = await removeThemePack('..')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('invalid theme id')
  })
})

describe('the registry', () => {
  it('reads "not configured" as a normal answer', async () => {
    stub({ '/api/themes/registry': () => jsonResponse({ configured: false, themes: [] }) })

    await loadThemeRegistry()

    expect(themePacks.registryConfigured).toBe(false)
    expect(themePacks.registry).toEqual([])
    expect(themePacks.registryError).toBeNull()
  })

  it('lists what the registry offers', async () => {
    stub({
      '/api/themes/registry': () =>
        jsonResponse({
          configured: true,
          url: 'https://example.com/registry.json',
          themes: [
            { id: 'nord', name: 'Nord', version: '1.0.0', minAppVersion: '0.28.0' },
            { id: 'dracula-soft', name: 'Dracula Soft' },
          ],
        }),
    })

    await loadThemeRegistry()

    expect(themePacks.registryConfigured).toBe(true)
    expect(themePacks.registryUrl).toBe('https://example.com/registry.json')
    expect(themePacks.registry?.map((e) => e.id)).toEqual(['nord', 'dracula-soft'])
  })

  it('drops entries that are not shaped like themes', async () => {
    stub({
      '/api/themes/registry': () =>
        jsonResponse({ configured: true, themes: [{ id: 'nord', name: 'Nord' }, null, { id: 5 }] }),
    })

    await loadThemeRegistry()

    expect(themePacks.registry?.map((e) => e.id)).toEqual(['nord'])
  })

  it('reports an unreachable registry without throwing', async () => {
    stub({ '/api/themes/registry': () => jsonResponse({ error: 'could not reach it' }, 502) })

    await loadThemeRegistry()

    expect(themePacks.registryError).toBe('could not reach it')
    expect(themePacks.registry).toBeNull()
  })
})

describe('installFromRegistry', () => {
  it('installs by id, never by url', async () => {
    const calls: string[] = []
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') return jsonResponse({ id: 'nord', name: 'Nord' })
      return jsonResponse([])
    })

    const result = await installFromRegistry('nord')

    expect(result.ok).toBe(true)
    expect(calls).toContain('POST /api/themes/install/nord')
    // The server resolves the URL from its own registry, so a client cannot
    // ask the instance to fetch an arbitrary address.
    expect(calls.some((c) => c.includes('http://') || c.includes('https://'))).toBe(false)
    expect(themePacks.installing).toBeNull()
  })

  it('surfaces the server reason, including a digest mismatch', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ error: 'sha256 mismatch for `nord`: expected aa, got bb' }, 400)
    )

    const result = await installFromRegistry('nord')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('sha256 mismatch')
  })
})

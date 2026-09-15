import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../composables/apiBase', () => ({
  authFetch: vi.fn(),
  apiUrl: (path: string) => path,
}))

import { authFetch } from '../composables/apiBase'
import {
  installFromRegistry,
  installLocalePack,
  loadLocalePacks,
  loadRegistry,
  localePacks,
  removeLocalePack,
  type RegistryEntry,
} from '../composables/useLocalePacks'
import { settings } from '../composables/useSettings'
import { referenceKeys, setInstalledPacks, tables } from '../composables/i18n/tables'
import { t } from '../composables/useI18n'

const mockFetch = vi.mocked(authFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

interface StubOptions {
  locales?: unknown
  /** Status for `/api/locales`; 404 stands in for a server without the route. */
  localesStatus?: number
  version?: string
  infoStatus?: number
  /** Throw instead of answering, to model a network failure. */
  throwOn?: 'locales' | 'info'
}

function stub({ locales = [], localesStatus, version, infoStatus, throwOn }: StubOptions = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/locales')) {
      if (throwOn === 'locales') throw new Error('network down')
      return jsonResponse(locales, localesStatus ?? 200)
    }
    if (url.includes('/api/info')) {
      if (throwOn === 'info') throw new Error('network down')
      return jsonResponse({ version }, infoStatus ?? 200)
    }
    throw new Error(`unexpected url ${url}`)
  })
}

function packBody(tag: string, messages: Record<string, string>, extra = {}): string {
  return JSON.stringify({ tag, name: tag, messages, ...extra })
}

beforeEach(() => {
  mockFetch.mockReset()
  setInstalledPacks({})
  settings.locale = 'en'
  localePacks.covers = []
  localePacks.rejected = []
  localePacks.lastError = null
  localePacks.registryEntries = []
  localePacks.registryError = null
  localePacks.registryLoaded = false
  localePacks.installingTag = null
})

afterEach(() => {
  setInstalledPacks({})
  settings.locale = 'en'
})

describe('loadLocalePacks', () => {
  it('installs packs and reports their coverage', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': '設定', 'app.reload': '再読' }) },
      ],
      version: '0.28.0',
    })

    await loadLocalePacks()

    expect(mockFetch).toHaveBeenCalledWith('/api/locales')
    expect(tables.ja).toBeDefined()
    expect(localePacks.lastError).toBeNull()

    const cover = localePacks.covers[0]!
    expect(cover.tag).toBe('ja')
    // The denominator is the en table, not a scan of t() call sites.
    expect(cover.total).toBe(referenceKeys().length)
    expect(cover.translated).toBe(2)
    expect(cover.unknownKeys).toBe(0)
    expect(cover.outdated).toBe(false)

    settings.locale = 'ja'
    expect(t('app.settings')).toBe('設定')
  })

  it('counts keys the app no longer has as unknown rather than translated', async () => {
    stub({
      locales: [
        {
          file: 'ja',
          body: packBody('ja', { 'app.settings': '設定', 'ancient.removed.key': 'x' }),
        },
      ],
    })

    await loadLocalePacks()

    const cover = localePacks.covers[0]!
    expect(cover.translated).toBe(1)
    expect(cover.unknownKeys).toBe(1)
    // One real key out of 1043 rounds to 0%.
    expect(cover.percent).toBe(0)
  })

  it('resolves the pack through t() and falls back to en for untranslated keys', async () => {
    stub({ locales: [{ file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) }] })

    await loadLocalePacks()
    settings.locale = 'ja'

    expect(t('app.settings')).toBe('設定')
    // Not in the pack -> from the en base, never a raw key.
    expect(t('cancel')).toBe('Cancel')
  })
})

describe('minAppVersion', () => {
  it('flags a pack whose floor is above the running app', async () => {
    stub({
      locales: [
        {
          file: 'ja',
          body: packBody('ja', { 'app.settings': '設定' }, { minAppVersion: '9.0.0' }),
        },
      ],
      version: '0.28.0',
    })

    await loadLocalePacks()
    expect(localePacks.covers[0]!.outdated).toBe(true)
  })

  it('does not flag a pack at or below the running app', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': 'x' }, { minAppVersion: '0.28.0' }) },
        { file: 'ko', body: packBody('ko', { 'app.settings': 'y' }, { minAppVersion: '0.1.0' }) },
      ],
      version: '0.28.0',
    })

    await loadLocalePacks()
    expect(localePacks.covers.map((c) => c.outdated)).toEqual([false, false])
  })

  it('compares multi-segment versions numerically, not as strings', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': 'x' }, { minAppVersion: '0.9.0' }) },
      ],
      // As a string, '0.9.0' > '0.28.0'; numerically it is lower.
      version: '0.28.0',
    })

    await loadLocalePacks()
    expect(localePacks.covers[0]!.outdated).toBe(false)
  })

  // "Cannot tell" must never render as "out of date".
  it('does not flag anything when the app version is unavailable', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': 'x' }, { minAppVersion: '9.0.0' }) },
      ],
      throwOn: 'info',
    })

    await loadLocalePacks()
    expect(localePacks.covers[0]!.outdated).toBe(false)
  })

  it('does not flag anything when the floor is unparseable', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': 'x' }, { minAppVersion: 'soon' }) },
      ],
      version: '0.28.0',
    })

    await loadLocalePacks()
    expect(localePacks.covers[0]!.outdated).toBe(false)
  })
})

describe('bad input', () => {
  it('reports an invalid pack without losing the valid ones', async () => {
    stub({
      locales: [
        { file: 'broken', body: '{ not json' },
        { file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) },
      ],
    })

    await loadLocalePacks()

    expect(localePacks.rejected.map((r) => r.file)).toEqual(['broken'])
    expect(localePacks.rejected[0]!.errors.join(' ')).toContain('invalid JSON')
    expect(localePacks.covers.map((c) => c.tag)).toEqual(['ja'])
    expect(tables.ja).toBeDefined()
  })

  it('surfaces per-entry warnings without rejecting the pack', async () => {
    stub({
      locales: [
        {
          file: 'ja',
          body: packBody('ja', { 'app.settings': '設定', 'app.reload': 42 as unknown as string }),
        },
      ],
    })

    await loadLocalePacks()

    expect(localePacks.rejected).toEqual([])
    expect(localePacks.covers[0]!.dropped).toBe(1)
  })

  it('takes the last pack when two files claim the same tag, deterministically', async () => {
    stub({
      locales: [
        { file: 'ja', body: packBody('ja', { 'app.settings': 'first' }) },
        { file: 'ja-alt', body: packBody('ja', { 'app.settings': 'second' }) },
      ],
    })

    await loadLocalePacks()
    settings.locale = 'ja'
    expect(t('app.settings')).toBe('second')
  })
})

describe('a server without the route', () => {
  it('treats a 404 as "no packs installed", not as an error', async () => {
    stub({ localesStatus: 404 })

    await loadLocalePacks()

    expect(localePacks.covers).toEqual([])
    expect(localePacks.lastError).toBeNull()
    expect(localePacks.loaded).toBe(true)
  })
})

describe('a failed load', () => {
  it('surfaces the error and keeps the already-installed packs', async () => {
    stub({ locales: [{ file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) }] })
    await loadLocalePacks()
    expect(tables.ja).toBeDefined()

    stub({ throwOn: 'locales' })
    await loadLocalePacks()

    expect(localePacks.lastError).toContain('could not read locale packs')
    // Blanking the UI on a transient failure would be worse than serving stale
    // packs, and the packs are additive data with no staleness hazard.
    expect(tables.ja).toBeDefined()
    settings.locale = 'ja'
    expect(t('app.settings')).toBe('設定')
  })

  it('clears a previous error once a load succeeds', async () => {
    stub({ throwOn: 'locales' })
    await loadLocalePacks()
    expect(localePacks.lastError).not.toBeNull()

    stub({ locales: [{ file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) }] })
    await loadLocalePacks()
    expect(localePacks.lastError).toBeNull()
  })
})

describe('installLocalePack', () => {
  /** Stub a POST that accepts, then a refresh that lists the new pack. */
  function stubInstall({ status = 200, body = {} as Record<string, unknown> } = {}) {
    const calls: { url: string; init?: RequestInit }[] = []
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url, init })
        if (status !== 200) return jsonResponse(body, status)
        return jsonResponse({ tag: 'ja', name: '日本語', count: 2, ...body })
      }
      // The refresh that follows a successful install.
      return jsonResponse([{ file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) }])
    })
    return calls
  }

  it('posts the raw file body and reloads the registry', async () => {
    const calls = stubInstall()

    const result = await installLocalePack(packBody('ja', { 'app.settings': '設定' }), 'ja.json')

    expect(result.ok).toBe(true)
    // The body is the file itself — no FormData, matching the server's shape.
    expect(calls[0]!.init!.body).toContain('app.settings')
    expect(calls[0]!.url).toContain('/api/locales?file=ja.json')
    expect(tables.ja).toBeDefined()
  })

  it('rejects an invalid pack locally, without a round trip', async () => {
    const calls = stubInstall()

    const result = await installLocalePack('{ not json', 'ja.json')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('invalid JSON')
    // No point asking the server about a pack that cannot be parsed.
    expect(calls).toEqual([])
  })

  it('surfaces the server reason when it refuses', async () => {
    stubInstall({ status: 400, body: { error: 'invalid locale tag `..`' } })

    const result = await installLocalePack(packBody('ja', { 'a.b': 'x' }), 'ja.json')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('invalid locale tag `..`')
  })

  it('falls back to a readable message when the server sends no error field', async () => {
    stubInstall({ status: 500 })

    const result = await installLocalePack(packBody('ja', { 'a.b': 'x' }), 'ja.json')

    expect(result.ok === false && result.error).toContain('HTTP 500')
  })

  it('clears the in-flight flag even when the request throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))

    const result = await installLocalePack(packBody('ja', { 'a.b': 'x' }), 'ja.json')

    expect(result.ok).toBe(false)
    expect(localePacks.importing).toBe(false)
  })

  // A pack may omit `tag`; the filename is the documented fallback.
  it('passes the filename so the server can fall back to it', async () => {
    const calls = stubInstall()

    await installLocalePack(JSON.stringify({ messages: { 'a.b': 'x' } }), 'ja.json')

    expect(calls[0]!.url).toContain('file=ja.json')
  })
})

describe('loadRegistry', () => {
  function registryStub(body: unknown, status = 200) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/locales/registry')) return jsonResponse(body, status)
      throw new Error(`unexpected url ${url}`)
    })
  }

  const ENTRY: RegistryEntry = {
    tag: 'ja',
    name: '日本語',
    version: '1.0.0',
    minAppVersion: '0.28.0',
    url: 'https://packs.example/ja.json',
    sha256: 'a'.repeat(64),
  }

  it('lists what the server says its registry offers', async () => {
    registryStub({ schema: 1, packs: [ENTRY] })

    await loadRegistry()

    expect(mockFetch).toHaveBeenCalledWith('/api/locales/registry')
    expect(localePacks.registryEntries).toEqual([ENTRY])
    expect(localePacks.registryError).toBeNull()
    expect(localePacks.registryLoaded).toBe(true)
  })

  // A server with no registry configured answers 503 naming the variable. That
  // is a normal state, so the reason is shown rather than swallowed into an
  // empty list.
  it('surfaces the reason when no registry is configured', async () => {
    registryStub({ error: 'no language pack registry is configured; set X' }, 503)

    await loadRegistry()

    expect(localePacks.registryError).toContain('no language pack registry is configured')
    expect(localePacks.registryEntries).toEqual([])
    expect(localePacks.registryLoaded).toBe(true)
  })

  it('keeps the previous list when a refresh fails', async () => {
    registryStub({ schema: 1, packs: [ENTRY] })
    await loadRegistry()

    mockFetch.mockRejectedValue(new Error('network down'))
    await loadRegistry()

    // Blanking the list would claim the registry is empty, which is a
    // different (and wrong) statement from "we could not reach it".
    expect(localePacks.registryEntries).toEqual([ENTRY])
    expect(localePacks.registryError).toContain('network down')
  })

  // The server filters already; this is the client refusing to render a row it
  // cannot install, rather than a second copy of the server's rules.
  it('drops entries missing the fields an install needs', async () => {
    registryStub({
      schema: 1,
      packs: [ENTRY, { tag: 'ko', name: '한국어' }, { name: 'x', url: 'https://x' }, null],
    })

    await loadRegistry()

    expect(localePacks.registryEntries.map((e) => e.tag)).toEqual(['ja'])
  })

  it('treats a missing packs array as an empty registry', async () => {
    registryStub({ schema: 1 })

    await loadRegistry()

    expect(localePacks.registryEntries).toEqual([])
    expect(localePacks.registryError).toBeNull()
  })

  it('clears the in-flight flag even when the request throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))

    await loadRegistry()

    expect(localePacks.registryLoading).toBe(false)
  })
})

describe('installFromRegistry', () => {
  const ENTRY: RegistryEntry = {
    tag: 'ja',
    name: '日本語',
    url: 'https://packs.example/ja.json',
    sha256: 'a'.repeat(64),
  }

  /** Stub the POST, then the refresh that a successful install triggers. */
  function stubFetch({ status = 200, body = {} as Record<string, unknown> } = {}) {
    const calls: { url: string; init?: RequestInit }[] = []
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url, init })
        if (status !== 200) return jsonResponse(body, status)
        return jsonResponse({ tag: 'ja', name: '日本語', count: 2, ...body })
      }
      return jsonResponse([{ file: 'ja', body: packBody('ja', { 'app.settings': '設定' }) }])
    })
    return calls
  }

  it('hands the entry back to the server and reloads the installed list', async () => {
    const calls = stubFetch()

    const result = await installFromRegistry(ENTRY)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.count).toBe(2)
    // The route takes the registry entry itself, so this is the whole request:
    // the server, not the browser, decides what that URL resolves to.
    expect(calls[0]!.url).toBe('/api/locales/fetch')
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual(ENTRY)
    expect(tables.ja).toBeDefined()
  })

  it('surfaces the server reason when it refuses', async () => {
    stubFetch({ status: 502, body: { error: 'sha256 mismatch: registry says a, the file is b' } })

    const result = await installFromRegistry(ENTRY)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('sha256 mismatch')
    // A refusal must not leave the list stale-looking.
    expect(localePacks.installingTag).toBeNull()
  })

  it('falls back to a readable message when the server sends no error field', async () => {
    stubFetch({ status: 500 })

    const result = await installFromRegistry(ENTRY)

    expect(result.ok === false && result.error).toContain('HTTP 500')
  })

  it('clears the in-flight tag even when the request throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))

    const result = await installFromRegistry(ENTRY)

    expect(result.ok).toBe(false)
    expect(localePacks.installingTag).toBeNull()
  })

  // Nothing local decides whether a pack is acceptable: a second validator here
  // would be a third set of rules to keep in step with the server's.
  it('does not pre-validate, so the server stays the only judge', async () => {
    const calls = stubFetch({ status: 400, body: { error: 'invalid locale tag' } })

    const result = await installFromRegistry({ tag: '../evil', name: 'x', url: 'file:///etc' })

    expect(calls).toHaveLength(1)
    expect(result.ok === false && result.error).toBe('invalid locale tag')
  })
})

describe('removeLocalePack', () => {
  it('deletes by tag and reloads', async () => {
    let deleted = false
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted = true
        expect(url).toBe('/api/locales/ja')
        return jsonResponse({ tag: 'ja' })
      }
      return jsonResponse(deleted ? [] : [{ file: 'ja', body: packBody('ja', { 'a.b': 'x' }) }])
    })

    const result = await removeLocalePack('ja')

    expect(result.ok).toBe(true)
    expect(localePacks.covers).toEqual([])
    expect(localePacks.removing).toBeNull()
  })

  // The tag is path-encoded, so a tag that somehow carries a separator cannot
  // turn into a different request.
  it('encodes the tag into the path', async () => {
    let seen = ''
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        seen = url
        return jsonResponse({})
      }
      return jsonResponse([])
    })

    await removeLocalePack('a/b')

    expect(seen).toBe('/api/locales/a%2Fb')
  })

  it('surfaces the server reason and clears the in-flight tag', async () => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? jsonResponse({ error: 'invalid locale tag' }, 400)
        : jsonResponse([])
    )

    const result = await removeLocalePack('ja')

    expect(result.ok === false && result.error).toBe('invalid locale tag')
    expect(localePacks.removing).toBeNull()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  tauriInvoke: vi.fn(),
  isTauri: false,
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: mocks.authFetch,
  getAuthToken: () => '',
  setAuthToken: () => {},
  getApiBase: async () => 'http://127.0.0.1:7681',
  fetchServerToken: async () => '',
  hasAuthToken: () => true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.isTauri,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() }, toCanvas: vi.fn() }))
vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))
vi.mock('../composables/useConfirm', () => ({
  uiConfirm: (message: string) => window.confirm(message),
  confirmState: { visible: false },
}))

import { flushPromises, mount } from '@vue/test-utils'
import GeneralTab from '../components/settings/GeneralTab.vue'
import { localePacks } from '../composables/useLocalePacks'
import { settings } from '../composables/useSettings'
import { setInstalledPacks } from '../composables/i18n/tables'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const JA_PACK = JSON.stringify({
  tag: 'ja',
  name: '日本語',
  messages: { 'app.settings': '設定' },
})

function stubServer(packs: { file: string; body: string }[], version = '0.27.0') {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/locales')) return jsonResponse(packs)
    if (url.includes('/api/info')) return jsonResponse({ version })
    return jsonResponse({})
  })
}

/** Seed the reactive store the way a completed `loadLocalePacks()` would. */
function seedCovers() {
  localePacks.loaded = true
  localePacks.loading = false
  localePacks.lastError = null
  localePacks.covers = [
    {
      file: 'ja',
      tag: 'ja',
      name: '日本語',
      version: '1.0.0',
      outdated: false,
      translated: 1,
      total: 1043,
      percent: 0,
      unknownKeys: 0,
      dropped: 0,
      warnings: [],
    },
  ]
  localePacks.rejected = []
}

beforeEach(() => {
  mocks.authFetch.mockReset()
  // Default the mount-time fetches (settings, uploads, QR) to empty answers so
  // a test that does not care about them still gets a quiet mount.
  mocks.authFetch.mockImplementation(async () => jsonResponse({}))
  setInstalledPacks({})
  settings.locale = 'en'
  localePacks.covers = []
  localePacks.rejected = []
  localePacks.lastError = null
  localePacks.loading = false
  localePacks.loaded = false
})

function localeOptions(wrapper: ReturnType<typeof mount>): (string | undefined)[] {
  // Index access rather than `.at(0)`: that is ES2022, above this project's lib.
  return wrapper
    .findAll('select')[0]!
    .findAll('option')
    .map((option) => option.attributes('value'))
}

describe('GeneralTab language list', () => {
  it('offers only the builtins when no packs are installed', () => {
    const wrapper = mount(GeneralTab)
    expect(localeOptions(wrapper)).toEqual(['auto', 'zh', 'en'])
  })

  it('appends an installed pack by its endonym', () => {
    seedCovers()
    const wrapper = mount(GeneralTab)
    expect(localeOptions(wrapper)).toEqual(['auto', 'zh', 'en', 'ja'])
    expect(wrapper.text()).toContain('日本語')
  })

  // A pack can be deleted while it is the selected locale. The value must stay
  // addressable or the <select> silently snaps to another language.
  it('keeps the current locale selectable when its pack is gone', () => {
    seedCovers()
    settings.locale = 'de'
    const wrapper = mount(GeneralTab)
    expect(localeOptions(wrapper)).toEqual(['auto', 'zh', 'en', 'ja', 'de'])
  })

  it('does not duplicate a builtin that a pack patches', () => {
    seedCovers()
    localePacks.covers.push({ ...localePacks.covers[0]!, file: 'en-override', tag: 'en' })
    const wrapper = mount(GeneralTab)
    expect(localeOptions(wrapper)).toEqual(['auto', 'zh', 'en', 'ja'])
  })

  it('does not offer a dangling locale while the stored one is auto', () => {
    seedCovers()
    settings.locale = 'auto'
    const wrapper = mount(GeneralTab)
    expect(localeOptions(wrapper)).toEqual(['auto', 'zh', 'en', 'ja'])
  })
})

describe('GeneralTab language pack section', () => {
  it('says so when nothing is installed', () => {
    const wrapper = mount(GeneralTab)
    expect(wrapper.text()).toContain('No language packs installed.')
  })

  it('reports coverage against the en table', () => {
    seedCovers()
    const wrapper = mount(GeneralTab)
    expect(wrapper.text()).toContain('1 of 1043 strings')
  })

  it('flags an out-of-date pack with the version it targets', () => {
    seedCovers()
    localePacks.covers[0]!.outdated = true
    localePacks.covers[0]!.minAppVersion = '9.0.0'
    const wrapper = mount(GeneralTab)
    expect(wrapper.text()).toContain('Made for 9.0.0')
  })

  it('reports a pack that was skipped', () => {
    seedCovers()
    localePacks.rejected = [{ file: 'broken', errors: ['invalid JSON: oops'], warnings: [] }]
    const wrapper = mount(GeneralTab)
    expect(wrapper.text()).toContain('broken')
    expect(wrapper.text()).toContain('invalid JSON')
  })

  it('reports a failed read without claiming nothing is installed', () => {
    localePacks.lastError = 'could not read locale packs from this server'
    const wrapper = mount(GeneralTab)
    expect(wrapper.text()).toContain('Could not read language packs from this server')
  })

  it('loads packs when the reload button is pressed', async () => {
    stubServer([{ file: 'ja', body: JA_PACK }])
    const wrapper = mount(GeneralTab)

    const reload = wrapper.findAll('button').find((b) => b.text().includes('Reload packs'))!
    expect(reload).toBeDefined()
    await reload.trigger('click')
    await flushPromises()

    expect(localePacks.covers.map((c) => c.tag)).toEqual(['ja'])
    expect(localePacks.loaded).toBe(true)
  })
})

describe('GeneralTab importing a pack', () => {
  it('offers an import button and a hidden file input', () => {
    const wrapper = mount(GeneralTab)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Import pack'))).toBe(true)

    const input = wrapper.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('accept')).toContain('.json')
  })

  it('posts the picked file and reports what was added', async () => {
    const posted: string[] = []
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(String(init.body))
        return jsonResponse({ tag: 'ja', name: '日本語', count: 2 })
      }
      if (url.includes('/api/locales')) return jsonResponse([])
      return jsonResponse({})
    })

    const wrapper = mount(GeneralTab)
    const input = wrapper.find('input[type="file"]')
    const file = new File([JA_PACK], 'ja.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain('app.settings')
  })

  // The reason a pack was refused is long enough to need reading, and a toast
  // times out — so it is also rendered under the list.
  it('shows the failure reason on the page, not only in a toast', async () => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ error: 'invalid locale tag `..`' }, 400)
      }
      return jsonResponse({})
    })

    const wrapper = mount(GeneralTab)
    const input = wrapper.find('input[type="file"]')
    const file = new File([JA_PACK], 'ja.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('invalid locale tag')
  })

  it('does nothing when the picker is dismissed', async () => {
    const wrapper = mount(GeneralTab)
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(mocks.authFetch.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST')).toBe(
      false
    )
  })
})

describe('GeneralTab removing a pack', () => {
  it('asks before removing, then deletes by tag', async () => {
    seedCovers()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleted: string[] = []
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted.push(url)
        return jsonResponse({})
      }
      return jsonResponse([])
    })

    const wrapper = mount(GeneralTab)
    const remove = wrapper.findAll('button').find((b) => b.text().includes('Remove'))!
    await remove.trigger('click')
    await flushPromises()

    expect(deleted).toEqual(['/api/locales/ja'])
    confirmSpy.mockRestore()
  })

  it('leaves the pack alone when the confirmation is declined', async () => {
    seedCovers()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mount(GeneralTab)

    const remove = wrapper.findAll('button').find((b) => b.text().includes('Remove'))!
    await remove.trigger('click')
    await flushPromises()

    expect(mocks.authFetch.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'DELETE')).toBe(
      false
    )
    confirmSpy.mockRestore()
  })
})

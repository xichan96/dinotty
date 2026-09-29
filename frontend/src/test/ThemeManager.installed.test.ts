import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: mocks.authFetch,
  getApiBase: vi.fn(async () => ''),
  hasAuthToken: () => true,
}))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  tauriInvoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { flushPromises, mount } from '@vue/test-utils'
import ThemeManager from '../components/settings/ThemeManager.vue'
import { settings } from '../composables/useSettings'
import { clearThemeSelection, getThemeSelection } from '../composables/useDeviceThemeSelection'
import { themePacks, type InstalledTheme } from '../composables/useThemePacks'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function palette(): string[] {
  return Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(6, '0')}`)
}

function installedTheme(id: string, name: string): InstalledTheme {
  return {
    id,
    name,
    colors: {
      foreground: '#ffffff',
      background: '#101010',
      cursor: '#ff00ff',
      ansi: palette(),
    },
  }
}

function themeFile(name: string): string {
  return JSON.stringify({
    name,
    colors: {
      foreground: '#ffffff',
      background: '#202020',
      cursor: '#00ffff',
      ansi: palette(),
    },
  })
}

/** The cap counter, e.g. `9/15`. */
function counter(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.theme-manager-count span').text()
}

/**
 * The installed cards only.
 *
 * Selecting by name would be wrong: an installed theme may legitimately share a
 * name with a builtin (`nord` is both), and the builtin comes first.
 */
function installedCards(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('.theme-card')
    .filter((card) => card.attributes('data-kind') === 'installed')
}

beforeEach(() => {
  mocks.authFetch.mockReset()
  mocks.authFetch.mockImplementation(async () => jsonResponse([]))
  settings.custom_themes = []
  settings.hidden_builtins = []
  clearThemeSelection()
  themePacks.installed = []
  themePacks.rejected = []
  themePacks.lastError = null
  themePacks.loading = false
  themePacks.importing = false
  themePacks.removing = null
  themePacks.registry = null
  themePacks.registryConfigured = false
  themePacks.registryError = null
  themePacks.registryLoading = false
  themePacks.installing = null
})

describe('installed themes in the theme manager', () => {
  it('renders one card per installed theme, removable but not editable', async () => {
    themePacks.installed = [
      installedTheme('nord', 'Nord'),
      installedTheme('dracula-soft', 'Dracula Soft'),
    ]

    const wrapper = mount(ThemeManager)

    const cards = installedCards(wrapper)
    expect(cards.map((card) => card.find('.theme-name').text())).toEqual(['Nord', 'Dracula Soft'])

    // An installed theme is a file on the server: editing it here would fork it
    // into a custom theme instead, so the action is not offered.
    const actions = cards[0].findAll('.theme-card-actions button').map((b) => b.text())
    expect(actions).toEqual(['Remove'])
  })

  // A builtin and an installed theme can share a name, so the card has to be
  // distinguishable or the user cannot tell which one they are picking.
  it('marks an installed card when it shares a builtin name', async () => {
    themePacks.installed = [installedTheme('nord', 'Nord')]

    const wrapper = mount(ThemeManager)
    const builtin = wrapper
      .findAll('.theme-card')
      .filter((card) => card.attributes('data-kind') === 'builtin')
      .find((card) => card.find('.theme-name').text() === 'Nord')!

    expect(builtin.find('.theme-card-badge').exists()).toBe(false)
    expect(installedCards(wrapper)[0].find('.theme-card-badge').text()).toBe('Installed')
  })

  it('selects an installed theme by its id, not the builtin of the same name', async () => {
    themePacks.installed = [installedTheme('nord', 'Nord')]

    const wrapper = mount(ThemeManager)
    await installedCards(wrapper)[0].trigger('click')

    expect(getThemeSelection()).toEqual({ kind: 'installed', id: 'nord' })
  })

  // The cap bounds `custom_themes`, so installed themes must not consume it —
  // otherwise installing a few would disable "New theme" for no reason.
  it('does not count installed themes toward the library cap', async () => {
    const empty = mount(ThemeManager)
    const baseline = counter(empty)
    empty.unmount()

    themePacks.installed = Array.from({ length: 8 }, (_, i) =>
      installedTheme(`theme-${i}`, `Theme ${i}`)
    )
    const loaded = mount(ThemeManager)

    expect(counter(loaded)).toBe(baseline)
    expect(loaded.findAll('.theme-card').length).toBeGreaterThan(8)
  })

  it('removes an installed theme through the delete route, after a confirm click', async () => {
    themePacks.installed = [installedTheme('nord', 'Nord')]
    const calls: string[] = []
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'DELETE') return jsonResponse({ id: 'nord' })
      return jsonResponse([])
    })

    const wrapper = mount(ThemeManager)
    const button = installedCards(wrapper)[0].findAll('.theme-card-actions button')[0]

    // Two clicks: the first arms the button, the second commits.
    await button.trigger('click')
    expect(calls).toEqual([])
    await button.trigger('click')
    await flushPromises()

    expect(calls).toContain('DELETE /api/themes/nord')
  })

  it('installs a picked file to the server rather than into the library', async () => {
    const posts: unknown[] = []
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return jsonResponse({ id: 'nord', name: 'Nord' })
      }
      return jsonResponse([])
    })

    const wrapper = mount(ThemeManager)
    const input = wrapper.findAll('input[type="file"]')[1]
    const file = new File([themeFile('Nord')], 'nord.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ id: 'nord', name: 'Nord' })
    // Nothing was added to the user's own library by an install.
    expect(settings.custom_themes).toEqual([])
  })

  it('surfaces an install failure without touching the library', async () => {
    mocks.authFetch.mockImplementation(async () =>
      jsonResponse({ error: 'invalid palette 3' }, 400)
    )

    const wrapper = mount(ThemeManager)
    const input = wrapper.findAll('input[type="file"]')[1]
    const file = new File([themeFile('Nord')], 'nord.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('.theme-manager-error').text()).toContain('invalid palette 3')
    expect(settings.custom_themes).toEqual([])
  })

  it('reports an unreadable installed file without hiding the rest', async () => {
    themePacks.installed = [installedTheme('nord', 'Nord')]
    themePacks.rejected = [{ file: 'broken', errors: ['Invalid JSON'] }]

    const wrapper = mount(ThemeManager)

    expect(wrapper.text()).toContain('broken')
    expect(wrapper.text()).toContain('Nord')
  })
})

describe('the theme store', () => {
  it('says the store is unconfigured rather than failing', async () => {
    mocks.authFetch.mockImplementation(async () => jsonResponse({ configured: false, themes: [] }))

    const wrapper = mount(ThemeManager)
    await wrapper.find('.theme-store-head button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.theme-store').text()).toContain('No theme registry is configured')
  })

  it('lists the registry and installs an entry by id', async () => {
    const calls: string[] = []
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') return jsonResponse({ id: 'nord', name: 'Nord' })
      if (url.includes('/api/themes/registry')) {
        return jsonResponse({
          configured: true,
          url: 'https://example.com/registry.json',
          themes: [{ id: 'nord', name: 'Nord', version: '1.0.0' }],
        })
      }
      return jsonResponse([])
    })

    const wrapper = mount(ThemeManager)
    await wrapper.find('.theme-store-head button').trigger('click')
    await flushPromises()

    const row = wrapper.find('.theme-store-row')
    expect(row.text()).toContain('Nord')
    expect(row.text()).toContain('1.0.0')

    await row.find('button').trigger('click')
    await flushPromises()

    expect(calls).toContain('POST /api/themes/install/nord')
  })
})

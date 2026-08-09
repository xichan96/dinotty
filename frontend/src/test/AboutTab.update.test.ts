import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
const aboutMocks = vi.hoisted(() => ({
  foreground: true,
  foregroundCallback: null as (() => void) | null,
  initialAutoCheckUpdates: true,
  initialSettingsLoaded: true,
  openExternalUrl: vi.fn(async () => true),
  saveSettings: vi.fn(async () => {}),
  settings: null as { locale: string; auto_check_updates: boolean } | null,
  settingsLoaded: null as { value: boolean } | null,
  stopForeground: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  getApiBase: async () => '',
  authFetch: apiMocks.authFetch,
}))

vi.mock('../composables/useSettings', async () => {
  const { reactive, ref } = await vi.importActual<typeof import('vue')>('vue')
  const settings = reactive({
    locale: 'zh',
    auto_check_updates: aboutMocks.initialAutoCheckUpdates,
  })
  const settingsLoaded = ref(aboutMocks.initialSettingsLoaded)
  aboutMocks.settings = settings
  aboutMocks.settingsLoaded = settingsLoaded
  return {
    settings,
    settingsLoaded,
    useSettings: () => ({ settings, settingsLoaded, saveSettings: aboutMocks.saveSettings }),
  }
})

vi.mock('../composables/useAppForeground', () => ({
  getIsAppForeground: () => aboutMocks.foreground,
  onAppForegroundGain: (callback: () => void) => {
    aboutMocks.foregroundCallback = callback
    return aboutMocks.stopForeground
  },
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: aboutMocks.toastInfo }),
}))

vi.mock('../utils/openExternalUrl', () => ({
  isOfficialDinottyReleaseUrl: (url: string) =>
    url.startsWith('https://github.com/xichan96/dinotty/releases/tag/'),
  openExternalUrl: aboutMocks.openExternalUrl,
}))

const availableResponse = {
  status: 'update_available',
  current_version: '0.20.0',
  latest_version: '0.21.0',
  published_at: '2026-08-01T08:00:00Z',
  release_url: 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0',
}

let resolveUpdate!: (response: Response) => void

function respondWithAvailableUpdate() {
  resolveUpdate(
    new Response(JSON.stringify(availableResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

async function mountAboutTab() {
  const { default: AboutTab } = await import('../components/settings/AboutTab.vue')
  if (aboutMocks.settings) {
    aboutMocks.settings.locale = 'zh'
    aboutMocks.settings.auto_check_updates = aboutMocks.initialAutoCheckUpdates
  }
  if (aboutMocks.settingsLoaded) {
    aboutMocks.settingsLoaded.value = aboutMocks.initialSettingsLoaded
  }
  return mount(AboutTab)
}

describe('AboutTab update card and automatic check preference', () => {
  beforeEach(() => {
    vi.resetModules()
    aboutMocks.foreground = true
    aboutMocks.foregroundCallback = null
    aboutMocks.initialAutoCheckUpdates = true
    aboutMocks.initialSettingsLoaded = true
    aboutMocks.openExternalUrl.mockReset()
    aboutMocks.openExternalUrl.mockResolvedValue(true)
    aboutMocks.saveSettings.mockClear()
    aboutMocks.stopForeground.mockClear()
    aboutMocks.toastInfo.mockClear()
    apiMocks.authFetch.mockReset()
    const updateResponse = new Promise<Response>((resolve) => {
      resolveUpdate = resolve
    })
    apiMocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/update-check') return updateResponse
      const body = { version: '0.20.0', repo_url: 'https://github.com/xichan96/dinotty' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('checks after settings load, shows one toast, and preserves the card across remounts', async () => {
    const first = await mountAboutTab()
    await flushPromises()

    expect(first.get('#auto-check-updates').element).toHaveProperty('checked', true)
    expect(first.text()).toContain('0.20.0')
    expect(first.find('.update-card').exists()).toBe(false)
    respondWithAvailableUpdate()
    await flushPromises()

    expect(first.text()).toContain('发现新版本 v0.21.0')
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()
    expect(aboutMocks.toastInfo).toHaveBeenCalledWith(
      '发现新版本 v0.21.0，点击查看详情',
      expect.objectContaining({
        timeout: 8000,
        closeOnClick: true,
        toastClassName: 'update-available-toast',
        onClick: expect.any(Function),
      })
    )
    const toastOptions = aboutMocks.toastInfo.mock.calls[0]?.[1]
    toastOptions.onClick()
    expect(first.emitted('open-about')).toHaveLength(1)
    aboutMocks.foregroundCallback?.()
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()

    await first.get('.update-release-button').trigger('click')
    await flushPromises()
    expect(aboutMocks.openExternalUrl).toHaveBeenCalledOnce()
    first.unmount()

    const second = await mountAboutTab()
    await flushPromises()
    expect(second.find('.update-card').exists()).toBe(true)
    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(1)
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()

    aboutMocks.openExternalUrl.mockResolvedValueOnce(false)
    await second.get('.update-release-button').trigger('click')
    await flushPromises()
    expect(second.text()).toContain('无法打开 Release 页面，请重试。')

    second.unmount()
    expect(aboutMocks.stopForeground).toHaveBeenCalledTimes(2)
  })

  it('does not request an update while automatic checks are disabled and starts when enabled', async () => {
    aboutMocks.initialAutoCheckUpdates = false
    const wrapper = await mountAboutTab()
    await flushPromises()

    expect(wrapper.get('#auto-check-updates').element).toHaveProperty('checked', false)
    expect(apiMocks.authFetch).not.toHaveBeenCalledWith('/api/update-check', expect.any(Object))
    expect(aboutMocks.toastInfo).not.toHaveBeenCalled()

    await wrapper.get('#auto-check-updates').setValue(true)
    await flushPromises()
    expect(aboutMocks.saveSettings).toHaveBeenCalledOnce()
    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(1)

    respondWithAvailableUpdate()
    await flushPromises()
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('checks again when an already-used automatic check is disabled and re-enabled', async () => {
    apiMocks.authFetch.mockImplementation(async (url: string) => {
      const body =
        url === '/api/update-check'
          ? { status: 'up_to_date', current_version: '0.20.0', latest_version: '0.20.0' }
          : { version: '0.20.0', repo_url: 'https://github.com/xichan96/dinotty' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const wrapper = await mountAboutTab()
    await flushPromises()
    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(1)

    await wrapper.get('#auto-check-updates').setValue(false)
    await wrapper.get('#auto-check-updates').setValue(true)
    await flushPromises()

    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(2)
    wrapper.unmount()
  })

  it('waits for persisted settings before deciding whether to check', async () => {
    aboutMocks.initialSettingsLoaded = false
    const wrapper = await mountAboutTab()
    await flushPromises()

    expect(wrapper.get('#auto-check-updates').attributes('disabled')).toBeDefined()
    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(0)

    if (!aboutMocks.settingsLoaded) throw new Error('settings mock was not initialized')
    aboutMocks.settingsLoaded.value = true
    await flushPromises()
    expect(wrapper.get('#auto-check-updates').attributes('disabled')).toBeUndefined()
    expect(
      apiMocks.authFetch.mock.calls.filter(([url]) => url === '/api/update-check')
    ).toHaveLength(1)

    wrapper.unmount()
  })

  it('defers the toast until the app returns to the foreground', async () => {
    aboutMocks.foreground = false
    const wrapper = await mountAboutTab()
    await flushPromises()
    respondWithAvailableUpdate()
    await flushPromises()

    expect(wrapper.find('.update-card').exists()).toBe(true)
    expect(aboutMocks.toastInfo).not.toHaveBeenCalled()

    aboutMocks.foreground = true
    aboutMocks.foregroundCallback?.()
    aboutMocks.foregroundCallback?.()
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})

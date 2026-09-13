import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
const aboutMocks = vi.hoisted(() => ({
  foreground: true,
  foregroundCallback: null as (() => void) | null,
  initialAutoCheckUpdates: true,
  initialSettingsLoaded: true,
  isTauri: false,
  openExternalUrl: vi.fn(async () => true),
  openReleaseAssetUrl: vi.fn(async () => true),
  progressHandler: null as ((event: { payload: unknown }) => void) | null,
  saveSettings: vi.fn(async () => {}),
  settings: null as { locale: string; auto_check_updates: boolean } | null,
  settingsLoaded: null as { value: boolean } | null,
  stopForeground: vi.fn(),
  // Explicitly typed so tests can vary both the command name and the result.
  tauriInvoke: vi.fn(
    async (_command: string, _args?: unknown): Promise<unknown> => ({
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })
  ),
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
  isTauri: () => aboutMocks.isTauri,
  tauriInvoke: aboutMocks.tauriInvoke,
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: aboutMocks.toastInfo }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (event === 'update-download-progress') aboutMocks.progressHandler = handler
    return () => {}
  },
}))

vi.mock('../utils/openExternalUrl', () => ({
  isOfficialDinottyReleaseUrl: (url: string) =>
    url.startsWith('https://github.com/xichan96/dinotty/releases/tag/'),
  isOfficialDinottyAssetUrl: (url: string) =>
    url.startsWith('https://github.com/xichan96/dinotty/releases/download/'),
  openExternalUrl: aboutMocks.openExternalUrl,
  openReleaseAssetUrl: aboutMocks.openReleaseAssetUrl,
}))

const assetUrl =
  'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg'

const availableResponse = {
  status: 'update_available',
  current_version: '0.20.0',
  latest_version: '0.21.0',
  published_at: '2026-08-01T08:00:00Z',
  release_url: 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0',
  download: { name: 'Dinotty_0.21.0_aarch64.dmg', url: assetUrl, size: 30_083_385, kind: 'dmg' },
  alternates: [
    {
      name: 'Dinotty_0.21.0_amd64.deb',
      url: 'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_amd64.deb',
      size: 30_083_822,
      kind: 'deb',
    },
  ],
}

function emitProgress(payload: unknown) {
  aboutMocks.progressHandler?.({ payload })
}

let resolveUpdate!: (response: Response) => void

/** Update-check requests, in both the automatic and the forced manual form. */
function checkCallCount(): number {
  return apiMocks.authFetch.mock.calls.filter(([url]) =>
    String(url).startsWith('/api/update-check')
  ).length
}

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
    aboutMocks.isTauri = false
    aboutMocks.openExternalUrl.mockReset()
    aboutMocks.openExternalUrl.mockResolvedValue(true)
    aboutMocks.openReleaseAssetUrl.mockReset()
    aboutMocks.openReleaseAssetUrl.mockResolvedValue(true)
    aboutMocks.progressHandler = null
    aboutMocks.tauriInvoke.mockReset()
    aboutMocks.tauriInvoke.mockResolvedValue({ path: '/tmp/Dinotty_0.21.0_aarch64.dmg' })
    aboutMocks.saveSettings.mockClear()
    aboutMocks.stopForeground.mockClear()
    aboutMocks.toastInfo.mockClear()
    apiMocks.authFetch.mockReset()
    const updateResponse = new Promise<Response>((resolve) => {
      resolveUpdate = resolve
    })
    apiMocks.authFetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/update-check')) return updateResponse
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
    expect(checkCallCount()).toBe(1)
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
    // Re-enabling is a user action, so it goes through the forced path that
    // bypasses the server's success cache.
    expect(checkCallCount()).toBe(1)
    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/update-check?force=1', expect.any(Object))

    respondWithAvailableUpdate()
    await flushPromises()
    expect(aboutMocks.toastInfo).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('checks again when an already-used automatic check is disabled and re-enabled', async () => {
    apiMocks.authFetch.mockImplementation(async (url: string) => {
      const body = String(url).startsWith('/api/update-check')
        ? { status: 'up_to_date', current_version: '0.20.0', latest_version: '0.20.0' }
        : { version: '0.20.0', repo_url: 'https://github.com/xichan96/dinotty' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const wrapper = await mountAboutTab()
    await flushPromises()
    expect(checkCallCount()).toBe(1)

    await wrapper.get('#auto-check-updates').setValue(false)
    await wrapper.get('#auto-check-updates').setValue(true)
    await flushPromises()

    expect(checkCallCount()).toBe(2)
    wrapper.unmount()
  })

  it('waits for persisted settings before deciding whether to check', async () => {
    aboutMocks.initialSettingsLoaded = false
    const wrapper = await mountAboutTab()
    await flushPromises()

    expect(wrapper.get('#auto-check-updates').attributes('disabled')).toBeDefined()
    expect(checkCallCount()).toBe(0)

    if (!aboutMocks.settingsLoaded) throw new Error('settings mock was not initialized')
    aboutMocks.settingsLoaded.value = true
    await flushPromises()
    expect(wrapper.get('#auto-check-updates').attributes('disabled')).toBeUndefined()
    expect(checkCallCount()).toBe(1)

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

  it('offers a manual check in every state and forces past the server cache', async () => {
    apiMocks.authFetch.mockImplementation(async (url: string) => {
      const body = String(url).startsWith('/api/update-check')
        ? { status: 'up_to_date', current_version: '0.21.0', latest_version: '0.21.0' }
        : { version: '0.21.0', repo_url: 'https://github.com/xichan96/dinotty' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const wrapper = await mountAboutTab()
    await flushPromises()

    // The card only appears for an available update, so the check button has to
    // be the persistent affordance.
    expect(wrapper.find('.update-card').exists()).toBe(false)
    expect(wrapper.text()).toContain('已是最新版本（v0.21.0）')

    const button = wrapper.get('.update-check-button')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()

    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/update-check?force=1', expect.any(Object))
    expect(checkCallCount()).toBe(2)
    wrapper.unmount()
  })

  it('disables the manual check while a check is in flight', async () => {
    const wrapper = await mountAboutTab()
    await flushPromises()
    // `beforeEach` holds the update response open, so the first check is still
    // running here.
    expect(wrapper.get('.update-check-button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('正在检查')

    respondWithAvailableUpdate()
    await flushPromises()
    expect(wrapper.get('.update-check-button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders download progress from the emitted events', async () => {
    aboutMocks.isTauri = true
    let resolveDownload!: (value: { path: string }) => void
    aboutMocks.tauriInvoke.mockImplementation(async (command: string): Promise<unknown> => {
      if (command !== 'download_update_asset') return null
      return new Promise<{ path: string }>((resolve) => {
        resolveDownload = resolve
      })
    })
    const wrapper = await mountAboutTab()
    await flushPromises()
    respondWithAvailableUpdate()
    await flushPromises()

    await wrapper.get('.update-release-button').trigger('click')
    await vi.waitFor(() => expect(aboutMocks.tauriInvoke).toHaveBeenCalled())

    emitProgress({ downloaded: 512, total: 1024, percent: 50 })
    await flushPromises()
    expect(wrapper.text()).toContain('正在下载… 50%')
    expect(wrapper.get('.update-progress-bar').attributes('style')).toContain('width: 50%')

    await wrapper.get('.update-link-button').trigger('click')
    await flushPromises()
    expect(aboutMocks.tauriInvoke).toHaveBeenCalledWith('cancel_update_download')

    resolveDownload({ path: '/tmp/Dinotty_0.21.0_aarch64.dmg' })
    await flushPromises()
    expect(wrapper.text()).toContain('已下载到 /tmp/Dinotty_0.21.0_aarch64.dmg')
    wrapper.unmount()
  })

  it('offers the alternate bundles as links and hides the in-app download without a matched asset', async () => {
    const wrapper = await mountAboutTab()
    await flushPromises()
    resolveUpdate(
      new Response(JSON.stringify({ ...availableResponse, download: undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await flushPromises()

    // No asset for this platform: the release page is the only route out.
    expect(wrapper.find('.update-asset-line').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('应用内下载仅在桌面程序可用')

    const alternate = wrapper
      .findAll('.update-link-button')
      .find((node) => node.text().includes('或下载'))
    expect(alternate).toBeDefined()
    await alternate!.trigger('click')
    await flushPromises()
    expect(aboutMocks.openReleaseAssetUrl).toHaveBeenCalledWith(
      'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_amd64.deb'
    )
    wrapper.unmount()
  })

  it('does not offer an in-app download outside the desktop app', async () => {
    const wrapper = await mountAboutTab()
    await flushPromises()
    respondWithAvailableUpdate()
    await flushPromises()

    expect(wrapper.find('.update-asset-line').exists()).toBe(true)
    expect(wrapper.text()).toContain('应用内下载仅在桌面程序可用')
    expect(wrapper.text()).not.toContain('下载更新')
    expect(aboutMocks.tauriInvoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('downloads the matched installer and reveals it on the desktop', async () => {
    aboutMocks.isTauri = true
    const wrapper = await mountAboutTab()
    await flushPromises()
    respondWithAvailableUpdate()
    await flushPromises()

    await wrapper.get('.update-release-button').trigger('click')
    await flushPromises()

    expect(aboutMocks.tauriInvoke).toHaveBeenCalledWith('download_update_asset', {
      url: assetUrl,
      tag: 'v0.21.0',
      filename: 'Dinotty_0.21.0_aarch64.dmg',
    })
    expect(wrapper.text()).toContain('已下载到 /tmp/Dinotty_0.21.0_aarch64.dmg')

    const buttons = wrapper.findAll('.update-release-button')
    await buttons[buttons.length - 2]!.trigger('click')
    await flushPromises()
    expect(aboutMocks.tauriInvoke).toHaveBeenCalledWith('reveal_downloaded_file', {
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })

    await buttons[buttons.length - 1]!.trigger('click')
    await flushPromises()
    expect(aboutMocks.tauriInvoke).toHaveBeenCalledWith('open_downloaded_file', {
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })
    wrapper.unmount()
  })

  it('treats a dismissed save dialog as cancelled rather than failed', async () => {
    aboutMocks.isTauri = true
    aboutMocks.tauriInvoke.mockRejectedValue('cancelled')
    const wrapper = await mountAboutTab()
    await flushPromises()
    respondWithAvailableUpdate()
    await flushPromises()

    await wrapper.get('.update-release-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已取消下载。')
    expect(wrapper.text()).not.toContain('下载失败，请重试。')
    wrapper.unmount()
  })
})

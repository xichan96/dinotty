import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSettingsWithClientPlatform(isWindowsClient: boolean) {
  vi.resetModules()
  vi.doMock('../utils/clientPlatform', () => ({ isWindowsClient, isMacClient: false }))
  return import('../composables/useSettings')
}

describe('useSettings - Windows Alt-as-Cmd defaults', () => {
  afterEach(() => {
    vi.doUnmock('../utils/clientPlatform')
    vi.resetModules()
  })

  // 验证 Windows 客户端默认开启 windowsAltAsCmd。
  it('defaults windowsAltAsCmd to true on Windows clients', async () => {
    const { settings } = await loadSettingsWithClientPlatform(true)

    expect(settings.windowsAltAsCmd).toBe(true)
  })

  // 验证非 Windows 客户端默认关闭 windowsAltAsCmd。
  it('defaults windowsAltAsCmd to false on non-Windows clients', async () => {
    const { settings } = await loadSettingsWithClientPlatform(false)

    expect(settings.windowsAltAsCmd).toBe(false)
  })
})

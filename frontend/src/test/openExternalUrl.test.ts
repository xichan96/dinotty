import { beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({ isTauri: vi.fn() }))
const shellMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('../composables/useTransport', () => ({
  isTauri: transportMocks.isTauri,
}))
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: shellMocks.open,
}))

import { isOfficialDinottyReleaseUrl, openExternalUrl } from '../utils/openExternalUrl'

const releaseUrl = 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0'

describe('openExternalUrl', () => {
  beforeEach(() => {
    transportMocks.isTauri.mockReset()
    shellMocks.open.mockReset()
  })

  it('treats an isolated browser open as successful even when no window handle is returned', async () => {
    transportMocks.isTauri.mockReturnValue(false)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    await expect(openExternalUrl(releaseUrl)).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith(releaseUrl, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('uses the Tauri shell plugin for desktop', async () => {
    transportMocks.isTauri.mockReturnValue(true)
    shellMocks.open.mockResolvedValue(undefined)

    await expect(openExternalUrl(releaseUrl)).resolves.toBe(true)
    expect(shellMocks.open).toHaveBeenCalledWith(releaseUrl)
  })

  it.each([
    'http://github.com/xichan96/dinotty/releases/tag/v0.21.0',
    'https://example.com/xichan96/dinotty/releases/tag/v0.21.0',
    'https://github.com:444/xichan96/dinotty/releases/tag/v0.21.0',
    'https://github.com/xichan96/dinotty/releases/tag/',
    'https://github.com/xichan96/dinotty/releases/tag/v0.21.0/extra',
  ])('rejects an untrusted URL: %s', async (url) => {
    transportMocks.isTauri.mockReturnValue(false)
    const open = vi.spyOn(window, 'open')

    expect(isOfficialDinottyReleaseUrl(url)).toBe(false)
    await expect(openExternalUrl(url)).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('reports an opener failure to the caller', async () => {
    transportMocks.isTauri.mockReturnValue(true)
    shellMocks.open.mockRejectedValue(new Error('blocked'))
    await expect(openExternalUrl(releaseUrl)).resolves.toBe(false)
  })
})

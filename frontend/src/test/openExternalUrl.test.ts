import { beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({ isTauri: vi.fn() }))
const shellMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('../composables/useTransport', () => ({
  isTauri: transportMocks.isTauri,
}))
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: shellMocks.open,
}))

import {
  isOfficialDinottyAssetUrl,
  isOfficialDinottyReleaseUrl,
  openExternalUrl,
  openReleaseAssetUrl,
  openUrlInSystemBrowser,
} from '../utils/openExternalUrl'

const releaseUrl = 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0'
const assetUrl =
  'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg'

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

  it('opens any HTTP(S) terminal URL through the desktop system browser', async () => {
    transportMocks.isTauri.mockReturnValue(true)
    shellMocks.open.mockResolvedValue(undefined)

    await expect(
      openUrlInSystemBrowser('http://localhost:3000/docs?source=terminal')
    ).resolves.toBe(true)
    expect(shellMocks.open).toHaveBeenCalledWith('http://localhost:3000/docs?source=terminal')
  })

  it('does not expose system-browser opening to a remote web client', async () => {
    transportMocks.isTauri.mockReturnValue(false)

    await expect(openUrlInSystemBrowser('https://example.com')).resolves.toBe(false)
    expect(shellMocks.open).not.toHaveBeenCalled()
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'mailto:hello@example.com', 'not a url'])(
    'rejects a non-HTTP(S) system-browser URL: %s',
    async (url) => {
      transportMocks.isTauri.mockReturnValue(true)

      await expect(openUrlInSystemBrowser(url)).resolves.toBe(false)
      expect(shellMocks.open).not.toHaveBeenCalled()
    }
  )

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

  it('accepts a release asset URL and opens it in the system browser', async () => {
    transportMocks.isTauri.mockReturnValue(true)
    shellMocks.open.mockResolvedValue(undefined)

    expect(isOfficialDinottyAssetUrl(assetUrl)).toBe(true)
    await expect(openReleaseAssetUrl(assetUrl)).resolves.toBe(true)
    expect(shellMocks.open).toHaveBeenCalledWith(assetUrl)
  })

  it.each([
    'http://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg',
    'https://example.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg',
    'https://github.com:444/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg',
    'https://github.com/xichan96/dinotty/releases/download/v0.21.0/',
    'https://github.com/xichan96/dinotty/releases/download/v0.21.0/sub/Dinotty_0.21.0_aarch64.dmg',
    'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg?x=1',
    'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg#x',
    'https://github.com/xichan96/dinotty/releases/tag/v0.21.0',
  ])('rejects an untrusted asset URL: %s', async (url) => {
    transportMocks.isTauri.mockReturnValue(false)

    expect(isOfficialDinottyAssetUrl(url)).toBe(false)
    await expect(openReleaseAssetUrl(url)).resolves.toBe(false)
  })

  it('keeps the release-page and asset allowlists mutually exclusive', async () => {
    transportMocks.isTauri.mockReturnValue(false)

    expect(isOfficialDinottyReleaseUrl(assetUrl)).toBe(false)
    expect(isOfficialDinottyAssetUrl(releaseUrl)).toBe(false)
  })
})

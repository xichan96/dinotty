import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../useTransport')
  vi.doUnmock('@tauri-apps/api/window')
  vi.resetModules()
})

describe('useAppForeground', () => {
  it('requires web visibility and focus for each foreground event source', async () => {
    vi.resetModules()
    vi.doMock('../useTransport', () => ({ isTauri: () => false }))
    let visibility: DocumentVisibilityState = 'hidden'
    let focused = false
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)

    const foreground = await import('../useAppForeground')
    const gained = vi.fn()
    foreground.onAppForegroundGain(gained)
    expect(foreground.getIsAppForeground()).toBe(false)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(foreground.getIsAppForeground()).toBe(false)

    focused = true
    window.dispatchEvent(new Event('focus'))
    expect(foreground.getIsAppForeground()).toBe(true)
    expect(gained).toHaveBeenCalledTimes(1)

    focused = false
    window.dispatchEvent(new Event('blur'))
    expect(foreground.getIsAppForeground()).toBe(false)

    visibility = 'hidden'
    focused = true
    window.dispatchEvent(new Event('focus'))
    expect(foreground.getIsAppForeground()).toBe(false)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(foreground.getIsAppForeground()).toBe(true)
    expect(gained).toHaveBeenCalledTimes(2)
  })

  it('registers the Tauri listener before querying and lets an early event win', async () => {
    vi.resetModules()
    vi.doMock('../useTransport', () => ({ isTauri: () => true }))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    let resolveInitialFocus!: (value: boolean) => void
    const initialFocus = new Promise<boolean>((resolve) => {
      resolveInitialFocus = resolve
    })
    let focusListener: ((event: { payload: boolean }) => void) | undefined
    const callOrder: string[] = []
    const appWindow = {
      onFocusChanged: vi.fn(async (listener: (event: { payload: boolean }) => void) => {
        callOrder.push('listener')
        focusListener = listener
        return () => {}
      }),
      isFocused: vi.fn(() => {
        callOrder.push('query')
        return initialFocus
      }),
    }
    vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => appWindow }))

    const foreground = await import('../useAppForeground')
    await vi.waitFor(() => expect(appWindow.isFocused).toHaveBeenCalledTimes(1))
    expect(callOrder).toEqual(['listener', 'query'])

    const gained = vi.fn()
    foreground.onAppForegroundGain(gained)
    focusListener?.({ payload: true })
    expect(foreground.getIsAppForeground()).toBe(true)
    expect(gained).toHaveBeenCalledTimes(1)

    resolveInitialFocus(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(foreground.getIsAppForeground()).toBe(true)
    expect(gained).toHaveBeenCalledTimes(1)
  })

  it('uses the focused visible WebView when the initial Tauri query reports false', async () => {
    vi.resetModules()
    vi.doMock('../useTransport', () => ({ isTauri: () => true }))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const appWindow = {
      onFocusChanged: vi.fn(async () => () => {}),
      isFocused: vi.fn(async () => false),
    }
    vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => appWindow }))

    const foreground = await import('../useAppForeground')
    await vi.waitFor(() => expect(appWindow.isFocused).toHaveBeenCalledTimes(1))

    expect(foreground.getIsAppForeground()).toBe(true)
  })
})

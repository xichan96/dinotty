import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.desktop,
  tauriInvoke: mocks.invoke,
}))

import { useAutostart, type AutostartStatus } from '../composables/useAutostart'

function status(overrides: Partial<AutostartStatus> = {}): AutostartStatus {
  return {
    packageKind: 'windowsDesktop',
    canEnable: true,
    canDisable: false,
    state: 'off',
    warnings: [],
    ...overrides,
  }
}

describe('useAutostart', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.desktop = true
    mocks.invoke.mockReset()
  })

  it('does not invoke desktop commands in a browser', async () => {
    mocks.desktop = false
    const autostart = useAutostart()

    await autostart.refresh()

    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(autostart.visible.value).toBe(false)
  })

  it('does not invoke desktop commands in a mobile Tauri shell', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Dinotty Android')
    const autostart = useAutostart()

    await autostart.refresh()

    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(autostart.visible.value).toBe(false)
  })

  it('hides unknown packages with no managed registration', async () => {
    mocks.invoke.mockResolvedValue(
      status({ packageKind: 'unknown', canEnable: false, state: 'off' })
    )
    const autostart = useAutostart()

    await autostart.refresh()

    expect(autostart.visible.value).toBe(false)
  })

  it('shows an unknown package when an old managed registration can be removed', async () => {
    mocks.invoke.mockResolvedValue(
      status({
        packageKind: 'unknown',
        canEnable: false,
        canDisable: true,
        state: 'onDifferentPath',
      })
    )
    const autostart = useAutostart()

    await autostart.refresh()

    expect(autostart.visible.value).toBe(true)
  })

  it('cancels portable autostart enable without writing', async () => {
    mocks.invoke.mockResolvedValue(status({ warnings: ['pathMoveBreaksRegistration'] }))
    const autostart = useAutostart()
    await autostart.refresh()
    const confirm = vi.fn(() => false)

    await expect(autostart.setEnabled(true, confirm)).resolves.toBe(false)

    expect(confirm).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps the reread status and operation error from a failed modification', async () => {
    mocks.invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce({
      status: status({ canEnable: false, canDisable: true, state: 'onCurrent' }),
      operationError: 'writeFailed',
    })
    const autostart = useAutostart()
    await autostart.refresh()

    await expect(autostart.setEnabled(true)).resolves.toBe(false)

    expect(autostart.status.value?.state).toBe('onCurrent')
    expect(autostart.operationError.value).toBe('writeFailed')
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_autostart', { enabled: true })
  })

  it('deduplicates concurrent modification requests', async () => {
    let finish: ((value: unknown) => void) | undefined
    mocks.invoke
      .mockResolvedValueOnce(status())
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const autostart = useAutostart()
    await autostart.refresh()

    const first = autostart.setEnabled(true)
    await expect(autostart.setEnabled(true)).resolves.toBe(false)
    expect(mocks.invoke).toHaveBeenCalledTimes(2)

    finish?.({ status: status({ state: 'onCurrent', canDisable: true }) })
    await expect(first).resolves.toBe(true)
  })
})

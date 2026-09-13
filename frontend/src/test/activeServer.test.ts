import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'dinotty_device_active_server_v1'

/** Fresh module graph — `activeServer` memoises the id in module state. */
async function load() {
  vi.resetModules()
  return import('../composables/activeServer')
}

describe('activeServer', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('falls back to the local server when nothing is stored', async () => {
    const { activeServerId, isLocalActive, LOCAL_SERVER_ID } = await load()
    expect(activeServerId()).toBe(LOCAL_SERVER_ID)
    expect(isLocalActive()).toBe(true)
  })

  it('persists a switch under the device-level key', async () => {
    const { setActiveServerId } = await load()
    setActiveServerId('srv-a')
    expect(localStorage.getItem(KEY)).toBe('srv-a')
  })

  it('reads a previously stored server back', async () => {
    localStorage.setItem(KEY, 'srv-b')
    const { activeServerId, isLocalActive } = await load()
    expect(activeServerId()).toBe('srv-b')
    expect(isLocalActive()).toBe(false)
  })

  it('treats an empty id as the local server', async () => {
    const { setActiveServerId, activeServerId, LOCAL_SERVER_ID } = await load()
    setActiveServerId('srv-a')
    setActiveServerId('')
    expect(activeServerId()).toBe(LOCAL_SERVER_ID)
  })

  it('prefixes only remote servers', async () => {
    const { setActiveServerId, relayPrefix } = await load()
    expect(relayPrefix()).toBe('')
    setActiveServerId('srv-a')
    expect(relayPrefix()).toBe('/__srv/srv-a')
  })

  it('runs registered teardowns in order and survives a failing one', async () => {
    const { registerSwitchTeardown, runSwitchTeardown } = await load()
    const order: string[] = []
    registerSwitchTeardown(() => {
      order.push('first')
    })
    registerSwitchTeardown(async () => {
      order.push('second')
      throw new Error('boom')
    })
    registerSwitchTeardown(() => {
      order.push('third')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runSwitchTeardown()

    expect(order).toEqual(['first', 'second', 'third'])
  })
})

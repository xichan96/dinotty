import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `activeServer` memoises the active id in module state, so each test needs a
 * fresh module graph rather than data shared across tests.
 */
async function load() {
  vi.resetModules()
  const activeServer = await import('../composables/activeServer')
  const { scopedKey } = await import('../composables/serverScope')
  return { ...activeServer, scopedKey }
}

describe('serverScope.scopedKey', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('namespaces by the local server by default', async () => {
    const { scopedKey } = await load()
    expect(scopedKey('dinotty_tabs')).toBe('dinotty_tabs@__local__')
  })

  it('namespaces by the active remote server', async () => {
    const { scopedKey, setActiveServerId } = await load()
    setActiveServerId('srv-a')
    expect(scopedKey('dinotty_tabs')).toBe('dinotty_tabs@srv-a')
  })

  it('follows a later switch', async () => {
    const { scopedKey, setActiveServerId } = await load()
    setActiveServerId('srv-a')
    setActiveServerId('srv-b')
    expect(scopedKey('dinotty_tabs')).toBe('dinotty_tabs@srv-b')
  })

  it('keeps two servers in disjoint namespaces', async () => {
    const first = await load()
    first.setActiveServerId('srv-a')
    const localKey = first.scopedKey('dinotty_tabs')

    const second = await load()
    second.setActiveServerId('srv-b')
    const remoteKey = second.scopedKey('dinotty_tabs')

    expect(localKey).not.toBe(remoteKey)
  })
})

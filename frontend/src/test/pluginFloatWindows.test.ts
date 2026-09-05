import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginFloatWindowsStore } from '../stores/pluginFloatWindows'

describe('pluginFloatWindows store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('open adds a single entry per plugin', () => {
    const store = usePluginFloatWindowsStore()
    store.open('json-formatter')
    expect(store.isOpen('json-formatter')).toBe(true)
    expect(store.openIds).toEqual(['json-formatter'])
  })

  it('open is idempotent and brings the existing window to front', () => {
    const store = usePluginFloatWindowsStore()
    store.open('a')
    store.open('b')
    const rankA = store.zOf('a')
    store.open('a')
    const ids = store.openIds
    expect(ids).toHaveLength(2)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(store.zOf('a')).toBeGreaterThan(rankA)
    expect(store.zOf('a')).toBeGreaterThan(store.zOf('b'))
  })

  it('close removes the entry; toggle flips it', () => {
    const store = usePluginFloatWindowsStore()
    store.open('a')
    store.close('a')
    expect(store.isOpen('a')).toBe(false)
    store.toggle('a')
    expect(store.isOpen('a')).toBe(true)
    store.toggle('a')
    expect(store.isOpen('a')).toBe(false)
  })

  it('focus bumps the rank without duplicating; unknown id is a no-op', () => {
    const store = usePluginFloatWindowsStore()
    store.open('a')
    store.open('b')
    const rankA = store.zOf('a')
    store.focus('a')
    expect(store.zOf('a')).toBeGreaterThan(rankA)
    expect(store.openIds).toHaveLength(2)

    store.focus('ghost')
    expect(store.isOpen('ghost')).toBe(false)
    expect(store.openIds).toHaveLength(2)
  })

  it('zOf returns 0 for an unknown id', () => {
    const store = usePluginFloatWindowsStore()
    expect(store.zOf('nope')).toBe(0)
  })
})

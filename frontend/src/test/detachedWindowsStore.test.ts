import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, watchEffect } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: mocks.invoke,
}))

import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'

describe('detachedWindowsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.tauri = true
    mocks.invoke.mockReset()
  })

  it('unmounts the main-window pane before creating the window', async () => {
    const store = useDetachedWindowsStore()
    const order: string[] = []

    // Mirrors the production filter: a computed drops the tab from the render
    // list as soon as the store marks it detached.
    const visible = computed(() => store.withoutDetached([{ paneId: 'a' }, { paneId: 'b' }]))
    watchEffect(() => {
      if (!visible.value.some((tab) => tab.paneId === 'a')) order.push('unmount')
    })

    mocks.invoke.mockImplementation(async (command: string) => {
      order.push(`invoke:${command}`)
    })

    expect(await store.openDetached('a', 'Alpha')).toBe(true)
    expect(order).toEqual(['unmount', 'invoke:open_tab_window'])
    expect(mocks.invoke).toHaveBeenCalledWith('open_tab_window', { tabId: 'a', title: 'Alpha' })
    expect(store.isDetached('a')).toBe(true)
  })

  it('rolls the detached mark back when the window cannot be created', async () => {
    const store = useDetachedWindowsStore()
    mocks.invoke.mockRejectedValue(new Error('create failed'))

    expect(await store.openDetached('a', 'Alpha')).toBe(false)
    expect(store.isDetached('a')).toBe(false)
    expect(store.withoutDetached([{ paneId: 'a' }])).toEqual([{ paneId: 'a' }])
  })

  it('rebuilds the set from the Rust registry', async () => {
    const store = useDetachedWindowsStore()
    mocks.invoke.mockResolvedValue([
      { tab_id: 'a', label: 'tab-a', title: null },
      { tab_id: 'c', label: 'tab-c', title: 'C' },
    ])

    await store.refreshFromRust()

    expect(mocks.invoke).toHaveBeenCalledWith('list_detached_tab_windows')
    expect([...store.detachedTabIds].sort()).toEqual(['a', 'c'])
  })

  it('handleClosed remounts a tab and leaves others detached', async () => {
    const store = useDetachedWindowsStore()
    mocks.invoke.mockResolvedValue([
      { tab_id: 'a', label: 'tab-a', title: null },
      { tab_id: 'c', label: 'tab-c', title: null },
    ])
    await store.refreshFromRust()

    store.handleClosed('a')

    expect(store.isDetached('a')).toBe(false)
    expect(store.isDetached('c')).toBe(true)
    expect(store.withoutDetached([{ paneId: 'a' }, { paneId: 'c' }])).toEqual([{ paneId: 'a' }])
  })

  it('focuses an already-detached tab instead of opening it twice', async () => {
    const store = useDetachedWindowsStore()
    mocks.invoke.mockResolvedValue(undefined)
    await store.openDetached('a', 'Alpha')

    mocks.invoke.mockClear()
    expect(await store.openDetached('a', 'Alpha')).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('focus_tab_window', { tabId: 'a' })
    expect(mocks.invoke).not.toHaveBeenCalledWith('open_tab_window', expect.anything())
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false
    const store = useDetachedWindowsStore()

    expect(await store.openDetached('a', 'Alpha')).toBe(false)
    expect(await store.focusDetached('a')).toBe(false)
    expect(await store.closeDetached('a')).toBe(false)
    await store.refreshFromRust()

    expect(store.isDetached('a')).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

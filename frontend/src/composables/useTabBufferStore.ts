import { inject, provide, reactive, type InjectionKey } from 'vue'
import type { EditorTab } from '../types/editorTabs'

/** Everything an editor group keeps for a tab that is not currently visible. */
export interface TabBuffer {
  path: string
  /** At least one meta load has completed for this path. */
  loaded: boolean
  loading: boolean
  meta: any | null
  err: string
  text: string
  baseline: string
  diskChanged: boolean
  rawBust: number
  mdShowPreview: boolean
  htmlShowPreview: boolean
}

export interface TabBufferStore {
  buffers: Map<string, TabBuffer>
  get(tabId: string, path: string): TabBuffer | undefined
  ensure(tabId: string, path: string): TabBuffer
  drop(tabId: string): void
  reset(tabId: string): void
  isDirty(tab: EditorTab): boolean
  markDiskChanged(tabId: string): void
  /** Keep the cached buffer but point it at a renamed/moved path. */
  remapPath(tabId: string, newPath: string): void
  /** Throw away cached content so the next activation re-reads from disk. */
  invalidate(tabId: string): void
}

export function createTabBuffer(): TabBuffer {
  return {
    path: '',
    loaded: false,
    loading: false,
    meta: null,
    err: '',
    text: '',
    baseline: '',
    diskChanged: false,
    rawBust: 0,
    mdShowPreview: false,
    htmlShowPreview: false,
  }
}

export function createTabBufferStore(): TabBufferStore {
  const buffers = reactive(new Map<string, TabBuffer>())

  function get(tabId: string, path: string): TabBuffer | undefined {
    const buffer = buffers.get(tabId)
    return buffer && buffer.path === path ? buffer : undefined
  }

  function ensure(tabId: string, path: string): TabBuffer {
    const existing = buffers.get(tabId)
    if (existing && existing.path === path) return existing
    const fresh = createTabBuffer()
    fresh.path = path
    buffers.set(tabId, fresh)
    return fresh
  }

  return {
    buffers,
    get,
    ensure,
    drop(tabId) {
      buffers.delete(tabId)
    },
    reset(tabId) {
      buffers.delete(tabId)
    },
    isDirty(tab: EditorTab) {
      const buffer = get(tab.id, tab.filePath)
      return !!buffer && buffer.text !== buffer.baseline
    },
    markDiskChanged(tabId) {
      const buffer = buffers.get(tabId)
      if (buffer) buffer.diskChanged = true
    },
    remapPath(tabId, newPath) {
      const buffer = buffers.get(tabId)
      if (buffer) buffer.path = newPath
    },
    invalidate(tabId) {
      buffers.delete(tabId)
    },
  }
}

export const TAB_BUFFER_STORE_KEY: InjectionKey<TabBufferStore> = Symbol('tab-buffer-store')

const fallbackStore = createTabBufferStore()

export function provideTabBufferStore(): TabBufferStore {
  const store = createTabBufferStore()
  provide(TAB_BUFFER_STORE_KEY, store)
  return store
}

export function useTabBufferStore(): TabBufferStore {
  return inject(TAB_BUFFER_STORE_KEY, fallbackStore)
}

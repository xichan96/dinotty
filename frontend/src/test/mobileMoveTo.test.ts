import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn(async () => ''),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: apiMocks.getApiBase,
}))

import MoveToDialog, {
  canMoveInto,
  isWithinSource,
  movableChildDirs,
  sourceParentDir,
} from '../components/workspace/MoveToDialog.vue'
import { useTreeContextMenu } from '../composables/useTreeContextMenu'
import type { DirEntry } from '../components/workspace/TreeRows'

function entry(name: string, isDir = false): DirEntry {
  return { name, is_dir: isDir, size: 0 }
}

describe('move destination filter', () => {
  it('lists only directories', () => {
    const entries = [entry('docs', true), entry('src', true), entry('a.txt')]
    expect(movableChildDirs(entries, '', 'a.txt')).toEqual([
      { rel: 'docs', name: 'docs' },
      { rel: 'src', name: 'src' },
    ])
  })

  it('excludes the moved directory and everything under it', () => {
    const entries = [entry('docs', true), entry('src', true), entry('lib', true)]
    expect(movableChildDirs(entries, '', 'src')).toEqual([
      { rel: 'docs', name: 'docs' },
      { rel: 'lib', name: 'lib' },
    ])

    // Inside the source subtree every child is a descendant, so none are shown.
    expect(movableChildDirs([entry('inner', true)], 'src', 'src')).toEqual([])
    expect(movableChildDirs([entry('deep', true)], 'src/inner', 'src')).toEqual([])
    expect(isWithinSource('src/inner', 'src')).toBe(true)
    expect(isWithinSource('src2', 'src')).toBe(false)
  })

  it('disables the entry’s current parent as a destination', () => {
    expect(sourceParentDir('src/a.txt')).toBe('src')
    expect(sourceParentDir('a.txt')).toBe('')
    expect(canMoveInto('src', 'src/a.txt')).toBe(false)
    expect(canMoveInto('', 'a.txt')).toBe(false)
    expect(canMoveInto('docs', 'src/a.txt')).toBe(true)
    expect(canMoveInto('src', 'src')).toBe(false)
    expect(canMoveInto('src/inner', 'src')).toBe(false)
  })
})

function createContextMenu() {
  const selectedRel = ref<string | null>(null)
  const selectedIsDir = ref(false)
  const meta = ref<{ kind: string } | null>(null)
  const editorDirty = ref(false)
  const editorText = ref('')
  const editorBaseline = ref('')
  const childCache = ref<Record<string, DirEntry[]>>({})
  const expanded = ref(new Set<string>())
  const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
  const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
  const ensureChildren = vi.fn(async (rel: string) => {
    childCache.value = { ...childCache.value, [rel]: [entry(`fresh-${rel || 'root'}`, true)] }
  })

  const contextMenu = useTreeContextMenu({
    selectedRel,
    selectedIsDir,
    meta,
    editorDirty,
    editorText,
    editorBaseline,
    childCache,
    expanded,
    inlineCreate,
    inlineRename,
    narrow: ref(false),
    absolutePath: (rel) => `/workspace/${rel}`,
    parentRelPath: (rel) => sourceParentDir(rel),
    ensureChildren,
    deleteSelected: async () => true,
    onSelectFile: async () => {},
    onSelectDir: () => {},
    triggerUpload: () => {},
    downloadFile: async () => {},
    paneId: () => 'test-pane',
    t: (key) => key,
  })

  return { contextMenu, childCache, ensureChildren, selectedRel }
}

function menuEvent(): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: 10, clientY: 20 })
}

describe('moveTo', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getApiBase.mockClear()
  })

  it('posts the move with the pane id and invalidates both listings', async () => {
    apiMocks.authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, rel: 'docs/a.txt' }),
    })
    const { contextMenu, childCache, ensureChildren } = createContextMenu()
    childCache.value = {
      '': [entry('src', true)],
      docs: [],
      src: [entry('nested', true)],
      'src/nested': [entry('a.txt')],
      'src/nested/deeper': [entry('b.txt')],
    }

    const moved = await contextMenu.moveTo('src/nested', 'docs')

    expect(moved).toBe(true)
    const [url, init] = apiMocks.authFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('pane_id=test-pane')
    expect(url).toContain('path=src%2Fnested')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ dest: 'docs' })
    // The two visible listings are reloaded; caches under the moved directory
    // are dropped rather than refreshed.
    expect(ensureChildren).toHaveBeenCalledWith('src')
    expect(ensureChildren).toHaveBeenCalledWith('docs')
    expect(childCache.value.docs).toEqual([entry('fresh-docs', true)])
    expect(childCache.value.src).toEqual([entry('fresh-src', true)])
    expect(childCache.value).toHaveProperty('')
    expect(childCache.value).not.toHaveProperty('src/nested')
    expect(childCache.value).not.toHaveProperty('src/nested/deeper')
  })

  it('does nothing when the destination is already the parent', async () => {
    const { contextMenu, ensureChildren } = createContextMenu()

    expect(await contextMenu.moveTo('docs/a.txt', 'docs')).toBe(false)
    expect(apiMocks.authFetch).not.toHaveBeenCalled()
    expect(ensureChildren).not.toHaveBeenCalled()
  })

  it('throws a workspace error so the dialog can show the reason', async () => {
    apiMocks.authFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'already exists in destination' }),
    })
    const { contextMenu, childCache } = createContextMenu()
    childCache.value = { docs: [] }

    await expect(contextMenu.moveTo('src/a.txt', 'docs')).rejects.toMatchObject({
      status: 409,
    })
    expect(childCache.value).toEqual({ docs: [] })
  })
})

describe('ctxMove', () => {
  it('closes the menu and hands the target to the picker', () => {
    const { contextMenu } = createContextMenu()
    contextMenu.onTreeContextMenu({ ev: menuEvent(), rel: 'src', isDir: true })

    contextMenu.ctxMove()

    expect(contextMenu.contextMenu.value).toBeNull()
    expect(contextMenu.moveSource.value).toEqual({ rel: 'src', isDir: true })
    contextMenu.closeMoveTo()
    expect(contextMenu.moveSource.value).toBeNull()
  })

  it('falls back to the selected entry for the background menu', () => {
    const { contextMenu, selectedRel } = createContextMenu()
    selectedRel.value = 'README.md'
    contextMenu.onTreeBgContextMenu(menuEvent())

    contextMenu.ctxMove()

    expect(contextMenu.moveSource.value).toEqual({ rel: 'README.md', isDir: false })
  })
})

describe('MoveToDialog picker', () => {
  const fetchDirs = vi.fn(async (rel: string) => {
    if (rel === '') {
      return [entry('docs', true), entry('src', true), entry('a.txt')]
    }
    if (rel === 'docs') return [entry('nested', true)]
    return []
  })
  const move = vi.fn(async () => {})

  beforeEach(() => {
    fetchDirs.mockClear()
    move.mockReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountDialog(sourceRel: string, isDir: boolean) {
    return mount(MoveToDialog, {
      props: { visible: true, sourceRel, isDir, paneId: 'pane-1', fetchDirs, move },
      attachTo: document.body,
    })
  }

  it('starts at the root, hides the source dir, and disables the same parent', async () => {
    mountDialog('src', true)
    await flushPromises()

    const names = Array.from(document.querySelectorAll('.move-to-item-name')).map(
      (el) => el.textContent
    )
    expect(names).toEqual(['docs'])

    const confirm = document.querySelector('.dialog-footer .dialog-btn--primary') as HTMLButtonElement
    // 'src' lives in the root, so root is its current parent — no-op.
    expect(confirm.disabled).toBe(true)

    const docs = document.querySelector('.move-to-item') as HTMLButtonElement
    docs.click()
    await flushPromises()
    expect(fetchDirs).toHaveBeenLastCalledWith('docs')
    expect(confirm.disabled).toBe(false)

    confirm.click()
    await flushPromises()
    expect(move).toHaveBeenCalledWith('src', 'docs')
  })

  it('keeps the current parent disabled even after navigating', async () => {
    mountDialog('docs/a.txt', false)
    await flushPromises()

    const first = document.querySelector('.move-to-item') as HTMLButtonElement
    first.click()
    await flushPromises()

    const confirm = document.querySelector('.dialog-footer .dialog-btn--primary') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(document.body.textContent).toContain('Already in this folder')
  })
})

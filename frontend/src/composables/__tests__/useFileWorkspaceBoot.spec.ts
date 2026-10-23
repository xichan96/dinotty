import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { makeWorkspaceError, useFileWorkspaceBoot } from '../useFileWorkspaceBoot'
import type { DirEntry } from '../../components/workspace/TreeRows'

const entry = (name: string): DirEntry => ({ name, is_dir: false, size: 0 })

function setup(fetchList: (rel: string) => Promise<DirEntry[]>) {
  const childCache = ref<Record<string, DirEntry[]>>({
    '': [entry('a')],
    a: [entry('old-a')],
    b: [entry('old-b')],
  })
  const expanded = ref(new Set(['a', 'b']))
  const selectedRel = ref<string | null>('a/old-a.ts')
  const previewErr = ref<ReturnType<typeof makeWorkspaceError> | null>(null)
  const meta = ref({ kind: 'text', content: 'keep me' })
  const fetchGitStatus = vi.fn(async () => {})
  // Mirrors FileWorkspacePreview: the injected loader fetches and caches.
  const ensureChildren = vi.fn(async (rel: string) => {
    // Read before spreading: spreading inside the literal happens before the
    // await resolves, so concurrent calls would overwrite each other.
    const entries = await fetchList(rel)
    childCache.value = { ...childCache.value, [rel]: entries }
  })
  const boot = useFileWorkspaceBoot({
    paneId: ref('pane'),
    sourcePaneId: ref(undefined),
    visible: ref(true),
    shellType: ref(undefined),
    initialPath: ref(undefined),
    childCache,
    expanded,
    cwdLabel: ref('/root'),
    previewErr,
    meta,
    selectedRel,
    selectedIsDir: ref(false),
    inlineCreate: ref(null),
    contextMenu: ref(null),
    editorLayout: ref(null),
    activeEditorLeafId: ref(null),
    activeLeaf: ref(null),
    ensureChildren,
    onSelectFile: vi.fn(async () => {}),
    onSelectDir: vi.fn(),
    connectTreeWatchSocket: vi.fn(),
    disconnectTreeWatchSocket: vi.fn(),
    fetchGitStatus,
  })
  return { boot, childCache, expanded, selectedRel, previewErr, meta, fetchGitStatus }
}

describe('useFileWorkspaceBoot.reloadAll', () => {
  it('refetches root and expanded dirs without collapsing or clearing selection', async () => {
    const fetchList = vi.fn(async (rel: string) => [entry(`new-${rel || 'root'}`)])
    const { boot, childCache, expanded, selectedRel, previewErr, meta, fetchGitStatus } =
      setup(fetchList)

    await boot.reloadAll()

    expect(fetchList.mock.calls.map((c) => c[0]).sort()).toEqual(['', 'a', 'b'])
    expect(expanded.value).toEqual(new Set(['a', 'b']))
    expect(selectedRel.value).toBe('a/old-a.ts')
    expect(meta.value).toEqual({ kind: 'text', content: 'keep me' })
    expect(childCache.value['']).toEqual([entry('new-root')])
    expect(childCache.value.a).toEqual([entry('new-a')])
    expect(childCache.value.b).toEqual([entry('new-b')])
    expect(previewErr.value).toBeNull()
    expect(fetchGitStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous listing for a failed dir and reports the first failure', async () => {
    const fetchList = vi.fn(async (rel: string) => {
      if (rel === 'b') throw makeWorkspaceError(403, 'denied')
      return [entry(`new-${rel || 'root'}`)]
    })
    const { boot, childCache, previewErr, expanded } = setup(fetchList)

    await boot.reloadAll()

    expect(childCache.value['']).toEqual([entry('new-root')])
    expect(childCache.value.a).toEqual([entry('new-a')])
    // Failure keeps the last known listing rather than a permanent spinner.
    expect(childCache.value.b).toEqual([entry('old-b')])
    expect(expanded.value).toEqual(new Set(['a', 'b']))
    expect(previewErr.value).toMatchObject({ status: 403, rel: 'b' })
  })
})

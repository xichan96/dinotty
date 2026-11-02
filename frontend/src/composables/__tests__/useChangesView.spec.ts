import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useChangesView } from '../useChangesView'
import { useEditorSplit } from '../useEditorSplit'
import { clearDiffTarget, useDiffTarget } from '../useDiffView'
import { saveFileWorkspaceState } from '../useFileWorkspaceState'
import type { WorkspaceChangeFile, WorkspaceChangesResponse } from '../../types/workspaceChanges'

const change = (path: string, over: Partial<WorkspaceChangeFile> = {}): WorkspaceChangeFile => ({
  path,
  orig_path: null,
  index_status: '',
  worktree_status: 'M',
  status: 'modified',
  additions: 3,
  deletions: null,
  binary: false,
  conflicted: false,
  submodule: false,
  ...over,
})

const body: WorkspaceChangesResponse = {
  is_git_repo: true,
  repo_root: '/repo',
  head: 'abc',
  summary: { files: 2, additions: 3, deletions: 0, counts_complete: true, truncated: false },
  files: [change('src/a.ts'), change('src/b.ts', { status: 'deleted', additions: null })],
}

function setup(cwd = '/repo') {
  const split = useEditorSplit({ paneId: () => 'pane-1' })
  const searchOpen = ref(false)
  const gitStatusMap = ref<Record<string, string>>({ 'src/a.ts': 'modified' })
  const openFromChanges = vi.fn((rel: string) => {
    split.openFileInActivePane(rel, false, { pin: false })
  })
  const view = useChangesView({
    paneId: () => 'pane-1',
    editorSplit: split,
    cwdLabel: ref(cwd),
    t: (key) => key,
    openFromChanges,
    searchOpen,
    closeSearch: () => {
      searchOpen.value = false
    },
    gitStatusMap,
    reloadTree: () => {},
  })
  return { split, view, searchOpen }
}

describe('useChangesView', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the tree and restores a persisted changes view', () => {
    const { view } = setup()
    expect(view.leftView.value).toBe('tree')

    const split = useEditorSplit({ paneId: () => 'pane-2' })
    saveFileWorkspaceState('pane-2', {
      editorLayout: split.editorLayout.value,
      activeEditorLeafId: null,
      childCache: {},
      expanded: new Set(),
      cwdLabel: '/repo',
      leftView: 'changes',
    })
    const other = useChangesView({
      paneId: () => 'pane-2',
      editorSplit: split,
      cwdLabel: ref('/repo'),
      t: (key) => key,
      openFromChanges: () => {},
      searchOpen: ref(false),
      closeSearch: () => {},
      gitStatusMap: ref({}),
      reloadTree: () => {},
    })

    other.restore()
    expect(other.leftView.value).toBe('changes')
  })

  it('returns to Files when search opens', async () => {
    const { view, searchOpen } = setup()
    view.setView('changes')
    expect(view.leftView.value).toBe('changes')

    searchOpen.value = true
    await nextTick()
    expect(view.leftView.value).toBe('tree')
  })

  it('opens the row as a preview tab and attaches a diff target', async () => {
    const { split, view } = setup()
    await view.load()

    await view.openChange(change('src/b.ts', { status: 'deleted', additions: null }))

    const leaf = split.activeLeaf.value!
    expect(leaf.tabs[0]).toMatchObject({ filePath: 'src/b.ts', preview: true })
    const target = useDiffTarget(() => leaf.id).value
    expect(target).toMatchObject({
      path: 'src/b.ts',
      status: 'deleted',
      conflicted: false,
      additions: null,
      deletions: null,
    })
    clearDiffTarget(leaf.id)
  })

  it('moves the selection with the arrow keys and clamps at the ends', async () => {
    const { view } = setup()
    await view.load()
    expect(view.flatFiles.value.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts'])

    view.moveSelection(1)
    expect(view.selectedPath.value).toBe('src/a.ts')
    view.moveSelection(1)
    expect(view.selectedPath.value).toBe('src/b.ts')
    view.moveSelection(1)
    expect(view.selectedPath.value).toBe('src/b.ts')
    view.moveSelection(-1)
    expect(view.selectedPath.value).toBe('src/a.ts')
  })

  it('shows a root hint only when git reports a different repository root', async () => {
    const nested = setup('/repo/src')
    await nested.view.load()
    expect(nested.view.rootHint.value).toBe('workspaceChanges.rootHint')

    const root = setup('/repo/')
    await root.view.load()
    expect(root.view.rootHint.value).toBeNull()
  })

  it('closes search when switching modes and can return to Files', async () => {
    const { view, searchOpen } = setup()
    searchOpen.value = true
    await nextTick()

    view.switchToChanges()
    expect(view.leftView.value).toBe('changes')
    expect(searchOpen.value).toBe(false)

    view.switchToFiles()
    expect(view.leftView.value).toBe('tree')
  })
})

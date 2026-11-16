import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const authFetch = vi.fn()

vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn(async () => ''),
  apiUrl: (path: string) => path,
  authFetch: (...args: unknown[]) => authFetch(...args),
}))

vi.mock('../types/editorPane', () => ({
  normalizeEditorLayout: (layout: unknown) => layout,
  findEditorLeaf: () => null,
  findFirstEditorLeaf: () => ({ id: 'leaf-1' }),
}))

import {
  useFileWorkspaceBoot,
  type FileWorkspaceBootOptions,
} from '../composables/useFileWorkspaceBoot'
import {
  clearFileWorkspaceState,
  loadFileWorkspaceState,
  saveFileWorkspaceState,
} from '../composables/useFileWorkspaceState'

const layout = {
  type: 'editor-leaf' as const,
  id: 'leaf-1',
  ratio: 1,
  filePath: null,
  isDir: false,
  zoomed: false,
  tabs: [],
  activeTabId: null,
}

function makeOptions(
  overrides: Partial<FileWorkspaceBootOptions> = {}
): FileWorkspaceBootOptions {
  return {
    paneId: ref('files-1'),
    sourcePaneId: ref('term-1'),
    visible: ref(true),
    shellType: ref('powershell'),
    initialPath: ref(undefined),
    childCache: ref({}),
    expanded: ref(new Set<string>()),
    cwdLabel: ref(''),
    previewErr: ref(null),
    meta: ref(null),
    selectedRel: ref(null),
    selectedIsDir: ref(false),
    inlineCreate: ref(null),
    contextMenu: ref(null),
    editorLayout: ref(layout),
    activeEditorLeafId: ref(null),
    activeLeaf: ref(null),
    ensureChildren: vi.fn(async () => {}),
    onSelectFile: vi.fn(),
    onSelectDir: vi.fn(),
    connectTreeWatchSocket: vi.fn(),
    disconnectTreeWatchSocket: vi.fn(),
    fetchGitStatus: vi.fn(async () => {}),
    ...overrides,
  }
}

function cwdResponse(cwd: string) {
  return new Response(JSON.stringify({ cwd }), { status: 200 })
}

describe('file workspace boot cwd reconciliation', () => {
  beforeEach(() => {
    clearFileWorkspaceState('files-1')
    authFetch.mockReset()
  })

  it('drops a saved tree rooted in a different cwd and rebuilds at the live cwd', async () => {
    saveFileWorkspaceState('files-1', {
      editorLayout: layout,
      activeEditorLeafId: 'leaf-1',
      childCache: { '': [{ name: 'old.txt', is_dir: false, size: 1 }] },
      expanded: new Set(['old']),
      cwdLabel: 'C:\\Users\\Wiley LAU',
    })
    authFetch.mockResolvedValue(cwdResponse('C:\\Users\\Wiley LAU\\Documents\\Project'))

    const opts = makeOptions()
    const boot = useFileWorkspaceBoot(opts)
    await boot.boot()

    expect(authFetch).toHaveBeenCalledWith('/api/workspace/cwd?pane_id=term-1')
    expect(opts.childCache.value).toEqual({})
    expect(opts.expanded.value.size).toBe(0)
    expect(opts.selectedRel.value).toBeNull()
    expect(loadFileWorkspaceState('files-1')).toBeUndefined()
    expect(opts.ensureChildren).toHaveBeenCalledWith('')
  })

  it('restores the tree when the live cwd differs only by Windows casing', async () => {
    saveFileWorkspaceState('files-1', {
      editorLayout: layout,
      activeEditorLeafId: 'leaf-1',
      childCache: { '': [{ name: 'src', is_dir: true, size: 0 }] },
      expanded: new Set(['src']),
      cwdLabel: 'C:\\Users\\Wiley LAU\\Project',
    })
    authFetch.mockResolvedValue(cwdResponse('c:\\users\\wiley lau\\project'))

    const opts = makeOptions()
    const boot = useFileWorkspaceBoot(opts)
    await boot.boot()

    expect(opts.cwdLabel.value).toBe('C:\\Users\\Wiley LAU\\Project')
    expect(opts.childCache.value['']).toEqual([{ name: 'src', is_dir: true, size: 0 }])
    expect(opts.expanded.value.has('src')).toBe(true)
    expect(loadFileWorkspaceState('files-1')).toBeDefined()
  })

  it('keeps the saved tree when the live cwd cannot be determined', async () => {
    saveFileWorkspaceState('files-1', {
      editorLayout: layout,
      activeEditorLeafId: 'leaf-1',
      childCache: { '': [{ name: 'src', is_dir: true, size: 0 }] },
      expanded: new Set(),
      cwdLabel: '/workspace/project',
    })
    authFetch.mockResolvedValue(new Response('{}', { status: 404 }))

    const opts = makeOptions()
    const boot = useFileWorkspaceBoot(opts)
    await boot.boot()

    expect(opts.cwdLabel.value).toBe('/workspace/project')
    expect(opts.childCache.value['']).toEqual([{ name: 'src', is_dir: true, size: 0 }])
  })
})

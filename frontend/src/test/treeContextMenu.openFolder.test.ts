import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({ tauriInvoke: vi.fn() }))

vi.mock('../composables/useTransport', () => ({ tauriInvoke: transportMocks.tauriInvoke }))

import { useTreeContextMenu } from '../composables/useTreeContextMenu'

function createContextMenu(isSsh = ref(false)) {
  // 步骤1：创建文件树右键菜单所需的最小状态。
  const selectedRel = ref<string | null>(null)
  const selectedIsDir = ref(false)
  const meta = ref<{ kind: string } | null>(null)
  const editorDirty = ref(false)
  const editorText = ref('')
  const editorBaseline = ref('')
  const childCache = ref({})
  const expanded = ref(new Set<string>())
  const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
  const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
  const narrow = ref(false)

  function absolutePath(relativePath: string): string {
    return `/workspace/${relativePath}`
  }
  function parentRelPath(): string {
    return ''
  }
  async function ensureChildren(): Promise<void> {}
  async function deleteSelected(): Promise<boolean> {
    return true
  }
  async function onSelectFile(): Promise<void> {}
  function onSelectDir(): void {}
  function triggerUpload(): void {}
  async function downloadFile(): Promise<void> {}
  function translate(key: string): string {
    return key
  }

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
    narrow,
    isSsh,
    absolutePath,
    parentRelPath,
    ensureChildren,
    deleteSelected,
    onSelectFile,
    onSelectDir,
    triggerUpload,
    downloadFile,
    paneId: () => 'test-pane',
    t: translate,
  })
  return { contextMenu, selectedRel }
}

function contextMenuEvent(): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: 20, clientY: 30 })
}

describe('tree context menu open folder', () => {
  beforeEach(() => {
    transportMocks.tauriInvoke.mockReset()
  })

  it('opens the folder itself when right-clicking a directory', async () => {
    // 步骤1：右键目录并执行“打开文件夹”。
    const { contextMenu } = createContextMenu()
    contextMenu.onTreeContextMenu({ ev: contextMenuEvent(), rel: 'src', isDir: true })
    await contextMenu.ctxOpenFolder()

    // 步骤2：reveal_path 收到目录绝对路径，菜单已关闭。
    expect(transportMocks.tauriInvoke).toHaveBeenCalledOnce()
    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('reveal_path', {
      path: '/workspace/src',
    })
    expect(contextMenu.contextMenu.value).toBeNull()
  })

  it('reveals a file in its containing folder', async () => {
    const { contextMenu } = createContextMenu()
    contextMenu.onTreeContextMenu({ ev: contextMenuEvent(), rel: 'src/main.ts', isDir: false })
    await contextMenu.ctxOpenFolder()

    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('reveal_path', {
      path: '/workspace/src/main.ts',
    })
  })

  it('falls back to the selected entry for the background menu', async () => {
    const { contextMenu, selectedRel } = createContextMenu()
    selectedRel.value = 'README.md'
    contextMenu.onTreeBgContextMenu(contextMenuEvent())
    await contextMenu.ctxOpenFolder()

    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('reveal_path', {
      path: '/workspace/README.md',
    })
  })

  it('is unavailable on SSH panes, where there is no local folder to open', async () => {
    const { contextMenu } = createContextMenu(ref(true))
    contextMenu.onTreeContextMenu({ ev: contextMenuEvent(), rel: 'src', isDir: true })

    expect(contextMenu.isRemote.value).toBe(true)
    await contextMenu.ctxOpenFolder()
    await contextMenu.ctxReveal()

    expect(transportMocks.tauriInvoke).not.toHaveBeenCalled()
  })

  it('does nothing when the background menu has no selection', async () => {
    const { contextMenu } = createContextMenu()
    contextMenu.onTreeBgContextMenu(contextMenuEvent())
    await contextMenu.ctxOpenFolder()

    expect(transportMocks.tauriInvoke).not.toHaveBeenCalled()
  })
})

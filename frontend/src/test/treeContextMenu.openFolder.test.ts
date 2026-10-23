import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('tree context menu placement and keyboard', () => {
  const menus: HTMLElement[] = []

  function installMenu(items: number, disabledFirst = false): HTMLElement {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    for (let i = 0; i < items; i++) {
      const item = document.createElement('button')
      item.setAttribute('role', 'menuitem')
      item.textContent = `item ${i}`
      if (disabledFirst && i === 0) item.disabled = true
      menu.appendChild(item)
    }
    document.body.appendChild(menu)
    menus.push(menu)
    return menu
  }

  function setViewport(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  }

  function key(name: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: name, cancelable: true })
  }

  afterEach(() => {
    for (const menu of menus.splice(0)) menu.remove()
  })

  it('clamps the menu into the viewport using its measured size', async () => {
    // 步骤1：菜单实际 220×300，指针在右下角 (1000, 700)。
    setViewport(1024, 768)
    const { contextMenu } = createContextMenu()
    const menu = installMenu(3)
    menu.getBoundingClientRect = () =>
      ({ width: 220, height: 300, left: 0, top: 0, right: 220, bottom: 300 }) as DOMRect
    contextMenu.setMenuEl(menu)

    contextMenu.onTreeContextMenu({
      ev: new MouseEvent('contextmenu', { clientX: 1000, clientY: 700 }),
      rel: 'src',
      isDir: true,
    })
    await nextTick()

    // 步骤2：8px 边距内贴住右下边缘，而不是按固定 400px 估算。
    expect(contextMenu.contextMenuStyle.value).toEqual({ left: '796px', top: '460px' })
  })

  it('focuses the first enabled item and cycles with the arrow keys', async () => {
    const { contextMenu } = createContextMenu()
    const menu = installMenu(3, true)
    contextMenu.setMenuEl(menu)
    contextMenu.onTreeContextMenu({ ev: contextMenuEvent(), rel: 'src', isDir: true })
    await nextTick()

    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    // 步骤1：跳过禁用的第一项。
    expect(document.activeElement).toBe(items[1])

    // 步骤2：上下循环，Home/End 到两端。
    contextMenu.onMenuKeydown(key('ArrowDown'))
    expect(document.activeElement).toBe(items[2])
    contextMenu.onMenuKeydown(key('ArrowDown'))
    expect(document.activeElement).toBe(items[1])
    contextMenu.onMenuKeydown(key('ArrowUp'))
    expect(document.activeElement).toBe(items[2])
    contextMenu.onMenuKeydown(key('Home'))
    expect(document.activeElement).toBe(items[1])
    contextMenu.onMenuKeydown(key('End'))
    expect(document.activeElement).toBe(items[2])
  })

  it('closes on Escape', async () => {
    const { contextMenu } = createContextMenu()
    contextMenu.setMenuEl(installMenu(2))
    contextMenu.onTreeContextMenu({ ev: contextMenuEvent(), rel: 'src', isDir: true })
    await nextTick()

    const ev = key('Escape')
    contextMenu.onMenuKeydown(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(contextMenu.contextMenu.value).toBeNull()
    expect(contextMenu.contextMenuStyle.value).toEqual({})
  })
})

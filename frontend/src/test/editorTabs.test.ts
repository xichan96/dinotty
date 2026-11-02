import { describe, expect, it } from 'vitest'
import {
  activateTab,
  closeTab,
  closeTabs,
  createEditorTab,
  findTabByPath,
  getActiveTab,
  insertTab,
  moveTab,
  openTab,
  reorderTab,
  takeTab,
  tabsRightOf,
  type EditorTab,
  type TabHost,
} from '../types/editorTabs'
import {
  createEditorLeaf,
  normalizeEditorLayout,
  type EditorLeafPane,
} from '../types/editorPane'

function host(paths: string[]): TabHost {
  const tabs = paths.map((path) => createEditorTab(path))
  return {
    tabs,
    activeTabId: tabs[tabs.length - 1]?.id ?? null,
    filePath: paths[paths.length - 1] ?? null,
    isDir: false,
  }
}

function pathsOf(h: TabHost): string[] {
  return h.tabs.map((tab) => tab.filePath)
}

describe('editor tab model', () => {
  it('creates a leaf with one tab and the active mirror set', () => {
    const leaf = createEditorLeaf('src/main.ts')
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.activeTabId).toBe(leaf.tabs[0].id)
    expect(leaf.filePath).toBe('src/main.ts')
    expect(getActiveTab(leaf)?.filePath).toBe('src/main.ts')
  })

  it('activates an existing path instead of duplicating it', () => {
    const h = host(['a.ts', 'b.ts'])
    const result = openTab(h, 'a.ts')
    expect(result.created).toBe(false)
    expect(pathsOf(h)).toEqual(['a.ts', 'b.ts'])
    expect(getActiveTab(h)?.filePath).toBe('a.ts')
  })

  it('reuses a clean preview tab and pins it on double click', () => {
    const h = host(['a.ts'])
    h.tabs = []
    const first = openTab(h, 'preview.ts', false, { preview: true })
    expect(first.created).toBe(true)
    expect(first.tab.preview).toBe(true)

    const second = openTab(h, 'next.ts', false, { preview: true })
    expect(second.replaced).toBe(true)
    expect(pathsOf(h)).toEqual(['next.ts'])

    const pinned = openTab(h, 'pinned.ts', false, { pin: true })
    expect(pinned.tab.preview).toBe(false)
    expect(pathsOf(h)).toEqual(['next.ts', 'pinned.ts'])
  })

  it('does not replace a preview tab whose buffer is dirty', () => {
    const h = host([])
    const first = openTab(h, 'dirty.ts', false, { preview: true })
    const result = openTab(h, 'other.ts', false, {
      preview: true,
      isDirty: (tab: EditorTab) => tab.id === first.tab.id,
    })
    expect(result.created).toBe(true)
    expect(pathsOf(h)).toEqual(['dirty.ts', 'other.ts'])
  })

  it('inserts a new tab after the active one', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts'])
    activateTab(h, h.tabs[1].id)
    openTab(h, 'd.ts', false, { pin: true })
    expect(pathsOf(h)).toEqual(['a.ts', 'b.ts', 'd.ts', 'c.ts'])
  })

  it('closes to the right neighbour, then the left one', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts'])
    const b = findTabByPath(h, 'b.ts')!
    activateTab(h, b.id)
    closeTab(h, b.id)
    expect(getActiveTab(h)?.filePath).toBe('c.ts')
    closeTab(h, findTabByPath(h, 'c.ts')!.id)
    expect(getActiveTab(h)?.filePath).toBe('a.ts')
  })

  it('closes a set of tabs but keeps a surviving active tab', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    const c = findTabByPath(h, 'c.ts')!
    activateTab(h, c.id)
    closeTabs(h, [h.tabs[0].id, h.tabs[3].id])
    expect(pathsOf(h)).toEqual(['b.ts', 'c.ts'])
    expect(getActiveTab(h)?.filePath).toBe('c.ts')
  })

  it('reorders tabs before and after a target', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts'])
    const a = findTabByPath(h, 'a.ts')!
    const c = findTabByPath(h, 'c.ts')!
    reorderTab(h, a.id, c.id, true)
    expect(pathsOf(h)).toEqual(['b.ts', 'c.ts', 'a.ts'])
    reorderTab(h, a.id, findTabByPath(h, 'b.ts')!.id, false)
    expect(pathsOf(h)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('moves a tab between groups and keeps its identity', () => {
    const source = host(['a.ts', 'b.ts'])
    const target = host(['c.ts'])
    const b = findTabByPath(source, 'b.ts')!
    expect(moveTab(source, target, b.id)).toBe(true)
    expect(pathsOf(source)).toEqual(['a.ts'])
    expect(pathsOf(target)).toEqual(['c.ts', 'b.ts'])
    expect(getActiveTab(target)?.id).toBe(b.id)
  })

  it('takes a tab out and activates its neighbour', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts'])
    const b = findTabByPath(h, 'b.ts')!
    activateTab(h, b.id)
    expect(takeTab(h, b.id)?.filePath).toBe('b.ts')
    expect(getActiveTab(h)?.filePath).toBe('c.ts')
    expect(h.filePath).toBe('c.ts')
  })

  it('lists tabs to the right and inserts at an index', () => {
    const h = host(['a.ts', 'b.ts', 'c.ts'])
    expect(tabsRightOf(h, h.tabs[0].id).map((tab) => tab.filePath)).toEqual(['b.ts', 'c.ts'])
    insertTab(h, createEditorTab('x.ts'), 0)
    expect(pathsOf(h)).toEqual(['x.ts', 'a.ts', 'b.ts', 'c.ts'])
    expect(getActiveTab(h)?.filePath).toBe('x.ts')
  })

  it('migrates a pre-tab leaf and repairs an invalid active id', () => {
    const legacy = {
      type: 'editor-leaf',
      id: 'el-legacy',
      filePath: 'old.ts',
      isDir: false,
      ratio: 1,
      zoomed: false,
    } as unknown as EditorLeafPane
    const migrated = normalizeEditorLayout(legacy)
    expect(migrated).toBe(legacy)
    expect(legacy.tabs).toHaveLength(1)
    expect(legacy.activeTabId).toBe(legacy.tabs[0].id)
    expect(legacy.filePath).toBe('old.ts')
  })
})

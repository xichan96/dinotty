import { describe, expect, it } from 'vitest'
import { useEditorSplit } from '../composables/useEditorSplit'
import { getAllEditorLeaves, type EditorPaneLayout } from '../types/editorPane'
import { getActiveTab } from '../types/editorTabs'

function setup() {
  const dirty = new Set<string>()
  const split = useEditorSplit({
    paneId: () => 'p1',
    isTabDirty: (tab) => dirty.has(tab.id),
  })
  return { split, dirty }
}

function paths(layout: EditorPaneLayout): string[] {
  return getAllEditorLeaves(layout).map((leaf) => getActiveTab(leaf)?.filePath ?? '')
}

describe('useEditorSplit with tabs', () => {
  it('opens files into the active group as preview tabs', () => {
    const { split } = setup()
    const first = split.openFileInActivePane('a.ts', false)
    expect(first?.filePath).toBe('a.ts')
    expect(first?.preview).toBe(true)

    const second = split.openFileInActivePane('b.ts', false)
    expect(second?.id).toBe(first?.id)
    expect(getActiveTab(split.activeLeaf.value!)?.filePath).toBe('b.ts')
    expect(split.editorLayout.value.type).toBe('editor-leaf')
  })

  it('pins a tab when opened with pin', () => {
    const { split } = setup()
    const tab = split.openFileInActivePane('a.ts', false, { pin: true })
    expect(tab?.preview).toBe(false)
  })

  it('splits a tab off the requested edge and nests further splits', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    split.openFileInActivePane('b.ts', false, { pin: true })
    const root = split.activeLeaf.value!
    const bTab = getActiveTab(root)!

    expect(split.splitTabToEdge(root.id, bTab.id, root.id, 'right')).toBe(true)
    expect(paths(split.editorLayout.value)).toEqual(['a.ts', 'b.ts'])

    const rightLeaf = getAllEditorLeaves(split.editorLayout.value)[1]
    expect(split.splitTabToEdge(rightLeaf.id, rightLeaf.tabs[0].id, rightLeaf.id, 'bottom')).toBe(
      true
    )
    const layout = split.editorLayout.value
    expect(layout.type).toBe('editor-split')
    if (layout.type === 'editor-split') {
      expect(layout.direction).toBe('horizontal')
      expect(layout.children[1].type).toBe('editor-split')
      if (layout.children[1].type === 'editor-split') {
        expect(layout.children[1].direction).toBe('vertical')
      }
    }
    expect(getAllEditorLeaves(layout)).toHaveLength(3)
    // The source group was the right leaf itself, so splitting its only tab
    // leaves that group empty — the same behaviour as VS Code.
    expect(paths(layout)).toEqual(['a.ts', '', 'b.ts'])
  })

  it('moves a tab between groups and closes the emptied source', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    split.openFileInActivePane('b.ts', false, { pin: true })
    const source = split.activeLeaf.value!
    const b = getActiveTab(source)!
    split.openFileInNewPane('c.ts', false, 'horizontal')
    const target = split.activeLeaf.value!
    expect(getAllEditorLeaves(split.editorLayout.value)).toHaveLength(2)

    expect(split.moveTabToPane(source.id, b.id, target.id)).toBe(true)
    expect(paths(split.editorLayout.value)).toEqual(['a.ts', 'b.ts'])
    // Source still has a.ts, so both groups remain.
    expect(getAllEditorLeaves(split.editorLayout.value)).toHaveLength(2)
  })

  it('does not duplicate a path when dropping a tab onto a group that has it', () => {
    const { split } = setup()
    split.openFileInActivePane('x.ts', false, { pin: true })
    const source = split.activeLeaf.value!
    const sourceTab = getActiveTab(source)!
    // Open the same file in a second group.
    split.openFileInNewPane('x.ts', false, 'horizontal')
    const target = split.activeLeaf.value!
    expect(source.id).not.toBe(target.id)

    // Clean source: the drop activates the existing target tab and drops the
    // source group once it is empty.
    expect(split.moveTabToPane(source.id, sourceTab.id, target.id)).toBe(true)
    expect(target.tabs.map((tab) => tab.filePath)).toEqual(['x.ts'])
    expect(getAllEditorLeaves(split.editorLayout.value)).toHaveLength(1)
  })

  it('refuses to drop a dirty tab onto a group already showing the same path', () => {
    const { split, dirty } = setup()
    split.openFileInActivePane('x.ts', false, { pin: true })
    const source = split.activeLeaf.value!
    const sourceTab = getActiveTab(source)!
    split.openFileInNewPane('x.ts', false, 'horizontal')
    const target = split.activeLeaf.value!
    dirty.add(sourceTab.id)

    expect(split.moveTabToPane(source.id, sourceTab.id, target.id)).toBe(false)
    expect(source.tabs.some((tab) => tab.id === sourceTab.id)).toBe(true)
    expect(target.tabs.map((tab) => tab.filePath)).toEqual(['x.ts'])
  })

  it('removes a group when its last tab is closed', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    split.openFileInNewPane('b.ts', false, 'horizontal')
    const right = split.activeLeaf.value!
    expect(split.closeTab(right.id, right.tabs[0].id)).toBe(true)
    expect(getAllEditorLeaves(split.editorLayout.value)).toHaveLength(1)
    expect(paths(split.editorLayout.value)).toEqual(['a.ts'])
  })

  it('resets the surviving pane to full width when a split collapses', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    split.openFileInNewPane('b.ts', false, 'horizontal')
    const right = split.activeLeaf.value!
    split.closeTab(right.id, right.tabs[0].id)

    // flex-grow < 1 on a lone flex item only claims that fraction of the row,
    // leaving the rest blank. The survivor must go back to a full ratio.
    const layout = split.editorLayout.value
    expect(layout.type).toBe('editor-leaf')
    if (layout.type === 'editor-leaf') expect(layout.ratio).toBe(1)
  })

  it('keeps the last group when its only tab closes', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false)
    const leaf = split.activeLeaf.value!
    split.closeTab(leaf.id, leaf.tabs[0].id)
    expect(split.editorLayout.value.type).toBe('editor-leaf')
    expect(paths(split.editorLayout.value)).toEqual([''])
    expect(split.activeTab.value).toBeNull()
  })

  it('reorders tabs in place', () => {
    const { split } = setup()
    split.openFileInActivePane('a.ts', false, { pin: true })
    split.openFileInActivePane('b.ts', false, { pin: true })
    split.openFileInActivePane('c.ts', false, { pin: true })
    const leaf = split.activeLeaf.value!
    const [a, , c] = leaf.tabs
    expect(split.reorderTabInLeaf(leaf.id, c.id, a.id, false)).toBe(true)
    expect(leaf.tabs.map((tab) => tab.filePath)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  })
})

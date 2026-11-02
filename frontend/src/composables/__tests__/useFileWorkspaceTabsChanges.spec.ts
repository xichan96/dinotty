import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useEditorSplit } from '../useEditorSplit'
import { useFileNavigation } from '../useFileNavigation'
import { createTabBufferStore } from '../useTabBufferStore'
import { useFileWorkspaceTabs } from '../useFileWorkspaceTabs'

function setup(isNarrow = false) {
  const split = useEditorSplit({ paneId: () => 'p1' })
  const buffers = createTabBufferStore()
  const nav = useFileNavigation()
  const selectedRel = ref<string | null>(null)
  const selectedIsDir = ref(false)
  const globalSelectedPath = ref<string | null>(null)
  const recordRecent = vi.fn()
  const closeDrawer = vi.fn()
  const tabs = useFileWorkspaceTabs({
    split,
    buffers,
    nav,
    selectedRel,
    selectedIsDir,
    globalSelectedPath,
    absolutePath: (rel) => `/root/${rel}`,
    emitNavigate: () => {},
    recordRecent,
    closeDrawer,
    isNarrow: () => isNarrow,
    t: (key) => key,
    onGitChange: () => {},
  })
  return { split, nav, tabs, selectedRel, globalSelectedPath, recordRecent, closeDrawer }
}

describe('useFileWorkspaceTabs.openFromChanges', () => {
  it('opens a preview tab without history or recent files', () => {
    const { split, nav, tabs, selectedRel, recordRecent, globalSelectedPath } = setup()

    tabs.openFromChanges('src/a.ts')

    const leaf = split.activeLeaf.value!
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.tabs[0]).toMatchObject({ filePath: 'src/a.ts', preview: true })
    expect(nav.canGoBack.value).toBe(false)
    expect(recordRecent).not.toHaveBeenCalled()
    expect(selectedRel.value).toBe('src/a.ts')
    expect(globalSelectedPath.value).toBe('/root/src/a.ts')
  })

  it('reuses the preview slot while arrowing through rows', () => {
    const { split, tabs } = setup()

    tabs.openFromChanges('a.ts')
    tabs.openFromChanges('b.ts')
    tabs.openFromChanges('c.ts')

    const leaf = split.activeLeaf.value!
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.tabs[0]).toMatchObject({ filePath: 'c.ts', preview: true })
  })

  it('closes the narrow drawer before revealing the diff', () => {
    const { tabs, closeDrawer } = setup(true)

    tabs.openFromChanges('a.ts')

    expect(closeDrawer).toHaveBeenCalledTimes(1)
  })
})

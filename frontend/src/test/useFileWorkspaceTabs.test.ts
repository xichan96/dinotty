import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useEditorSplit } from '../composables/useEditorSplit'
import { useFileNavigation } from '../composables/useFileNavigation'
import { createTabBufferStore } from '../composables/useTabBufferStore'
import { useFileWorkspaceTabs } from '../composables/useFileWorkspaceTabs'

function setup() {
  const split = useEditorSplit({ paneId: () => 'p1' })
  const buffers = createTabBufferStore()
  const nav = useFileNavigation()
  const selectedRel = ref<string | null>(null)
  const selectedIsDir = ref(false)
  const globalSelectedPath = ref<string | null>(null)
  const tabs = useFileWorkspaceTabs({
    split,
    buffers,
    nav,
    selectedRel,
    selectedIsDir,
    globalSelectedPath,
    absolutePath: (rel) => `/root/${rel}`,
    emitNavigate: () => {},
    recordRecent: () => {},
    closeDrawer: () => {},
    isNarrow: () => false,
    t: (key) => key,
    onGitChange: () => {},
  })
  return { split, tabs }
}

describe('useFileWorkspaceTabs selection', () => {
  it('opens each explorer click as a persistent tab', async () => {
    const { split, tabs } = setup()
    await tabs.selectFile('a.ts')
    await tabs.selectFile('b.ts')
    await tabs.selectFile('c.ts')

    const leaf = split.activeLeaf.value!
    expect(leaf.tabs.map((tab) => tab.filePath)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(leaf.tabs.every((tab) => !tab.preview)).toBe(true)
  })

  it('still reuses a preview tab when asked explicitly', async () => {
    const { split, tabs } = setup()
    await tabs.selectFile('a.ts', { pin: false })
    const first = split.activeLeaf.value!.activeTabId
    await tabs.selectFile('b.ts', { pin: false })

    const leaf = split.activeLeaf.value!
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.activeTabId).toBe(first)
    expect(leaf.tabs[0]).toMatchObject({ filePath: 'b.ts', preview: true })
  })

  it('reuses a tab the user deliberately marked as a preview', async () => {
    const { split, tabs } = setup()
    await tabs.selectFile('a.ts')
    const leaf = split.activeLeaf.value!
    leaf.tabs[0].preview = true
    const first = leaf.tabs[0].id

    await tabs.selectFile('b.ts')

    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.activeTabId).toBe(first)
    expect(leaf.tabs[0]).toMatchObject({ filePath: 'b.ts', preview: true })
  })
})

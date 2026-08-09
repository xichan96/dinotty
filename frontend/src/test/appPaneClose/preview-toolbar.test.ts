import { describe, expect, it } from 'vitest'
import { mountWithTabs, mocks } from './_setup'
import { useSessionStore } from '../../stores/sessionStore'
import { getAllLeaves } from '../../types/pane'

describe('App.vue - preview toolbar toggle', () => {
  it('creates a files leaf when the file browser menu item is clicked', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const previewButton = wrapper.find('button[title="app.preview"]')
    const tab = session.tabs[0]
    if (tab.type !== 'terminal') throw new Error('expected terminal tab')

    expect(getAllLeaves(tab.layout).some((l) => l.kind === 'files' || l.kind === 'web')).toBe(false)

    await previewButton.trigger('click')
    const items = wrapper.findAll('.preview-menu-item')
    expect(items.length).toBe(2)
    await items[0].trigger('click')
    expect(mocks.insertNonTerminalPane).toHaveBeenCalledWith('files', expect.anything())
  })

  it('creates a web leaf when the web preview menu item is clicked', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const tab = session.tabs[0]
    if (tab.type !== 'terminal') throw new Error('expected terminal tab')

    const existingFilesLeaf = {
      type: 'leaf' as const,
      kind: 'files' as const,
      paneId: 'existing-files-leaf',
      title: 'Files',
      ratio: 1,
      zoomed: false,
      path: '/tmp',
    }
    tab.layout = {
      type: 'split',
      id: 's-root',
      direction: 'horizontal',
      children: [tab.layout, existingFilesLeaf],
      ratios: [0.7, 0.3],
    }

    mocks.insertNonTerminalPane.mockClear()
    mocks.focusPane.mockClear()

    const previewButton = wrapper.find('button[title="app.preview"]')
    await previewButton.trigger('click')
    const items = wrapper.findAll('.preview-menu-item')
    expect(items.length).toBe(2)
    await items[1].trigger('click')

    expect(mocks.insertNonTerminalPane).toHaveBeenCalledWith('web', expect.anything())
  })

  it('focuses the existing leaf of the selected kind when both files and web exist', async () => {
    const wrapper = await mountWithTabs()
    const session = useSessionStore()
    const tab = session.tabs[0]
    if (tab.type !== 'terminal') throw new Error('expected terminal tab')

    const filesLeaf = {
      type: 'leaf' as const,
      kind: 'files' as const,
      paneId: 'files-leaf-1',
      title: 'Files',
      ratio: 1,
      zoomed: false,
      path: '/tmp',
    }
    const webLeaf = {
      type: 'leaf' as const,
      kind: 'web' as const,
      paneId: 'web-leaf-1',
      title: 'Web',
      ratio: 1,
      zoomed: false,
      url: 'https://example.com',
    }
    tab.layout = {
      type: 'split',
      id: 's-root',
      direction: 'horizontal',
      children: [tab.layout, filesLeaf, webLeaf],
      ratios: [0.4, 0.3, 0.3],
    }

    mocks.insertNonTerminalPane.mockClear()
    mocks.focusPane.mockClear()

    const previewButton = wrapper.find('button[title="app.preview"]')
    await previewButton.trigger('click')
    const items = wrapper.findAll('.preview-menu-item')
    expect(items.length).toBe(2)
    // Click "Web preview" (second item) -> should focus existing web leaf
    await items[1].trigger('click')

    expect(mocks.focusPane).toHaveBeenCalledWith('web-leaf-1')
    expect(mocks.insertNonTerminalPane).not.toHaveBeenCalled()
  })
})

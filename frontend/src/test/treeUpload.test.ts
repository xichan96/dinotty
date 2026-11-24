import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TreeRows, type DirEntry } from '../components/workspace/TreeRows'

function dir(name: string, overrides: Partial<DirEntry> = {}): DirEntry {
  return { name, is_dir: true, size: 0, ...overrides }
}

function file(name: string): DirEntry {
  return { name, is_dir: false, size: 1 }
}

function filesDrop() {
  return {
    types: ['Files'],
    getData: () => '',
  }
}

describe('TreeRows background file drop', () => {
  function mountNested() {
    return mount(TreeRows, {
      props: {
        paneId: 'p1',
        depth: 0,
        relPath: '',
        cache: {
          '': [dir('src'), file('readme.md')],
          src: [dir('inner')],
        },
        expanded: new Set(['src']),
        selectedRel: undefined,
      },
    })
  }

  it('uploads once when a file is dropped on a nested background', async () => {
    const wrapper = mountNested()
    const levels = wrapper.findAll('.tree-rows')
    expect(levels.length).toBe(2)

    await levels[1].trigger('drop', { dataTransfer: filesDrop() })

    const emitted = wrapper.emitted('upload-to-dir') ?? []
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBe('')
  })

  it('uploads to the hovered directory once when dropped on a row', async () => {
    const wrapper = mountNested()

    await wrapper.find('[data-rel="src"]').trigger('drop', { dataTransfer: filesDrop() })

    const emitted = wrapper.emitted('upload-to-dir') ?? []
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBe('src')
  })
})

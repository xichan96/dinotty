import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TreeRows, canExpandEntry, type DirEntry } from '../components/workspace/TreeRows'

function dir(overrides: Partial<DirEntry> = {}): DirEntry {
  return { name: 'd', is_dir: true, size: 0, ...overrides }
}

function mountTree(entries: DirEntry[], cacheExtra: Record<string, DirEntry[]> = {}) {
  return mount(TreeRows, {
    props: {
      paneId: 'p1',
      depth: 0,
      relPath: '',
      cache: { '': entries, ...cacheExtra },
      expanded: new Set<string>(),
      selectedRel: undefined,
    },
  })
}

describe('canExpandEntry', () => {
  it('allows a plain directory', () => {
    expect(canExpandEntry(dir())).toBe(true)
  })

  it('blocks a directory symlink that points back at an ancestor', () => {
    expect(canExpandEntry(dir({ is_symlink: true, is_cycle: true }))).toBe(false)
  })

  it('blocks files even when they are symlinks', () => {
    const entry: DirEntry = { name: 'link.txt', is_dir: false, size: 0, is_symlink: true }
    expect(canExpandEntry(entry)).toBe(false)
  })
})

describe('TreeRows symlinks', () => {
  it('disables the twistie and row expansion for a cycle directory', async () => {
    const entries = [dir({ name: 'loop', is_symlink: true, is_cycle: true })]
    const wrapper = mountTree(entries)

    expect(wrapper.find('.tree-row-cycle').exists()).toBe(true)
    const twistie = wrapper.find('.tree-twistie')
    expect((twistie.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('.tree-folder-hit').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
    // Selecting the row is still allowed; only expansion is blocked.
    expect(wrapper.emitted('select-dir')).toEqual([['loop']])
  })

  it('does not render children of a cycle that is somehow in the expanded set', () => {
    const entries = [dir({ name: 'loop', is_symlink: true, is_cycle: true })]
    const wrapper = mount(TreeRows, {
      props: {
        paneId: 'p1',
        depth: 0,
        relPath: '',
        cache: {
          '': entries,
          loop: [dir({ name: 'child' })],
        },
        expanded: new Set(['loop']),
        selectedRel: undefined,
      },
    })

    expect(wrapper.find('[data-rel="loop/child"]').exists()).toBe(false)
  })

  it('still expands a normal directory', async () => {
    const wrapper = mountTree([dir({ name: 'src' })])

    await wrapper.find('[data-rel="src"] .tree-folder-hit').trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['src']])
  })

  it('marks symlink entries with a small link badge', () => {
    const wrapper = mountTree([
      dir({ name: 'linked-dir', is_symlink: true, is_cycle: true }),
      { name: 'linked.txt', is_dir: false, size: 0, is_symlink: true },
      { name: 'plain.txt', is_dir: false, size: 0 },
    ])

    const badges = wrapper.findAll('.tree-symlink-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].find('svg.tree-symlink-icon').exists()).toBe(true)
  })
})

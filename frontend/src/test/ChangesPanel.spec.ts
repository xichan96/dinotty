import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChangesPanel from '../components/workspace/ChangesPanel.vue'
import { groupChangesByDirectory } from '../utils/changeGroups'
import type { WorkspaceChangeFile, WorkspaceChangesResponse } from '../types/workspaceChanges'

const change = (path: string, over: Partial<WorkspaceChangeFile> = {}): WorkspaceChangeFile => ({
  path,
  orig_path: null,
  index_status: '',
  worktree_status: 'M',
  status: 'modified',
  additions: 4,
  deletions: 1,
  binary: false,
  conflicted: false,
  submodule: false,
  ...over,
})

const files = [
  change('src/a.ts'),
  change('src/b.ts', {
    status: 'deleted',
    additions: null,
    deletions: null,
    index_status: 'D',
  }),
  change('src/ui/c.vue', { status: 'untracked', additions: 7, deletions: 0 }),
]

const data: WorkspaceChangesResponse = {
  is_git_repo: true,
  repo_root: '/repo',
  head: 'abc',
  summary: { files: 3, additions: 11, deletions: 1, counts_complete: true, truncated: false },
  files,
}

function mountPanel(over: Record<string, unknown> = {}) {
  return mount(ChangesPanel, {
    props: {
      state: 'ready',
      data,
      groups: groupChangesByDirectory(files),
      selectedPath: null,
      error: null,
      rootHint: null,
      stagedCount: 1,
      ...over,
    },
  })
}

describe('ChangesPanel', () => {
  it('renders the summary, staged count, groups and rows', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.changes-summary-text').text()).toContain('3 files')
    expect(wrapper.find('.changes-staged-count').text()).toContain('1')
    expect(wrapper.findAll('.changes-group-head').map((el) => el.text())).toEqual([
      expect.stringContaining('src'),
      expect.stringContaining('src/ui'),
    ])
    const rows = wrapper.findAll('.changes-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('a.ts')
    expect(rows[0].text()).toContain('M')
    expect(rows[1].text()).toContain('—')
  })

  it('emits open with the clicked file', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.changes-row')[0].trigger('click')

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ path: 'src/a.ts' })
  })

  it('supports arrow/enter keyboard navigation', async () => {
    const wrapper = mountPanel()
    const panel = wrapper.find('.changes-panel')
    await panel.trigger('keydown', { key: 'ArrowDown' })
    await panel.trigger('keydown', { key: 'ArrowUp' })
    await panel.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('move')).toEqual([[1], [-1]])
    expect(wrapper.emitted('open-selected')).toHaveLength(1)
  })

  it('shows the root hint when git reports a different root', () => {
    const wrapper = mountPanel({ rootHint: 'root differs' })
    expect(wrapper.find('.changes-root-hint').text()).toBe('root differs')
  })

  it('renders empty, not-repo and unsupported states', () => {
    expect(mountPanel({ data: null, groups: [], state: 'notRepo' }).text()).toContain(
      'not a Git repository'
    )
    expect(mountPanel({ data: null, groups: [], state: 'loading' }).text()).toContain('Loading')
    expect(mountPanel({ data: null, groups: [], state: 'error' }).text()).toContain(
      'Failed to load changes'
    )
    expect(
      mountPanel({ data: { ...data, files: [] }, groups: [], state: 'ready' }).text()
    ).toContain('No uncommitted changes')
  })

  it('offers Back to files when the endpoint is unsupported', async () => {
    const wrapper = mountPanel({ data: null, groups: [], state: 'unsupported' })
    expect(wrapper.text()).toContain('unavailable')

    await wrapper.find('.changes-state .changes-link-btn').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('keeps the stale list and offers retry after a failed refresh', async () => {
    const wrapper = mountPanel({ error: { status: 500 } as never })
    expect(wrapper.findAll('.changes-row')).toHaveLength(3)
    expect(wrapper.find('.changes-error-bar').exists()).toBe(true)

    await wrapper.find('.changes-error-bar .changes-link-btn').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})

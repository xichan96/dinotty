import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitHistoryPanel from '../components/workspace/GitHistoryPanel.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

const historyPanelMocks = vi.hoisted(function createHistoryPanelMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: historyPanelMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const commits = [
  {
    hash: 'aaaaaaaaaaaaaaaa',
    short_hash: 'aaaaaaa',
    author_name: 'Alice',
    author_email: 'alice@example.com',
    authored_at: '2026-07-17T10:00:00+08:00',
    parents: ['bbbbbbbbbbbbbbbb'],
    decorations: ['HEAD -> feature/git-panel', 'tag: v1.0.0'],
    subject: 'Add history panel',
  },
  {
    hash: 'bbbbbbbbbbbbbbbb',
    short_hash: 'bbbbbbb',
    author_name: 'Bob',
    author_email: 'bob@example.com',
    authored_at: '2026-07-16T09:00:00+08:00',
    parents: [],
    decorations: ['main'],
    subject: 'Initial commit',
  },
]

describe('GitHistoryPanel', function gitHistoryPanelSuite() {
  beforeEach(function resetHistoryMocks() {
    // 步骤1：分别返回提交日志与分支列表。
    historyPanelMocks.authFetch.mockReset()
    historyPanelMocks.authFetch.mockImplementation(async function respondToHistoryRequest(
      url: string
    ) {
      if (url.startsWith('/api/workspace/git-branches?')) {
        return new Response(
          JSON.stringify({
            local: [
              { name: 'feature/git-panel', upstream: 'origin/feature/git-panel', current: true },
              { name: 'main', upstream: 'origin/main', current: false },
            ],
            remote: [],
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ commits, has_more: false }), { status: 200 })
    })
  })

  it('lists commits and opens commit details', async function opensCommit() {
    // 步骤1：加载历史并确认两条提交记录。
    const wrapper = mount(GitHistoryPanel, {
      props: { paneId: 'pane-1', currentBranch: 'feature/git-panel' },
    })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="git-history-row"]')).toHaveLength(2)

    // 步骤2：点击提交后向父级发送完整详情选择。
    await wrapper.findAll('[data-testid="git-history-row"]')[0].trigger('click')
    expect(wrapper.emitted('view-history')?.[0]?.[0]).toMatchObject({
      kind: 'commit',
      hash: 'aaaaaaaaaaaaaaaa',
      shortHash: 'aaaaaaa',
      subject: 'Add history panel',
    })
  })

  it('filters history by file path', async function filtersFileHistory() {
    // 步骤1：输入仓库相对路径并重新加载日志。
    const wrapper = mount(GitHistoryPanel, {
      props: { paneId: 'pane-1', currentBranch: 'feature/git-panel' },
    })
    await flushPromises()
    await wrapper.get('[data-testid="git-history-path-input"]').setValue('src/main.rs')
    await wrapper.get('[data-testid="git-history-path-input"]').trigger('keydown.enter')
    await flushPromises()

    // 步骤2：确认请求使用编码后的文件路径。
    const historyCalls = historyPanelMocks.authFetch.mock.calls.filter(
      function isHistoryCall(call) {
        return String(call[0]).startsWith('/api/workspace/git-log?')
      }
    )
    expect(String(historyCalls[historyCalls.length - 1][0])).toContain('path=src%2Fmain.rs')
  })

  it('searches history and displays graph references', async function searchesHistory() {
    // 步骤1：确认提交图谱和当前提交的分支、标签装饰已经显示。
    const wrapper = mount(GitHistoryPanel, {
      props: { paneId: 'pane-1', currentBranch: 'feature/git-panel' },
    })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="git-history-graph"]')).toHaveLength(2)
    const references = wrapper.findAll('[data-testid="git-history-ref"]')
    expect(references[0].text()).toContain('feature/git-panel')
    expect(references[1].text()).toContain('v1.0.0')

    // 步骤2：按提交说明搜索，确认后端收到编码后的关键词。
    await wrapper.get('[data-testid="git-history-search-input"]').setValue('history panel')
    await wrapper.get('[data-testid="git-history-search-input"]').trigger('keydown.enter')
    await flushPromises()
    const historyCalls = historyPanelMocks.authFetch.mock.calls.filter(
      function isHistoryCall(call) {
        return String(call[0]).startsWith('/api/workspace/git-log?')
      }
    )
    expect(String(historyCalls[historyCalls.length - 1][0])).toContain('search=history+panel')
  })

  it('opens a comparison between selected branches', async function comparesBranches() {
    // 步骤1：选择基准分支和目标分支并执行比较。
    const wrapper = mount(GitHistoryPanel, {
      props: { paneId: 'pane-1', currentBranch: 'feature/git-panel' },
    })
    await flushPromises()
    await wrapper.get('[data-testid="git-compare-base"]').setValue('main')
    await wrapper.get('[data-testid="git-compare-target"]').setValue('feature/git-panel')
    await wrapper.get('[data-testid="git-compare-button"]').trigger('click')

    // 步骤2：父级收到两个分支名称，由主区域加载比较 Patch。
    expect(wrapper.emitted('view-history')?.[0]?.[0]).toEqual({
      kind: 'compare',
      base: 'main',
      target: 'feature/git-panel',
    })
  })

  it('cherry-picks multiple selected commits in selection order', async function cherryPicksSelectedCommits() {
    // 步骤1：先选择较旧提交，再选择较新提交，明确记录用户希望的执行顺序。
    const wrapper = mount(GitHistoryPanel, {
      props: { paneId: 'pane-1', currentBranch: 'feature/git-panel', repository: 'apps/web' },
    })
    await flushPromises()
    const selectionInputs = wrapper.findAll('[data-testid="git-history-select-commit"]')
    await selectionInputs[1].setValue(true)
    await selectionInputs[0].setValue(true)
    expect(wrapper.get('[data-testid="git-history-cherry-pick-selected"]').text()).toContain('2')

    // 步骤2：确认后一次发送有序提交数组，后端按该顺序执行 Cherry-pick。
    await wrapper.get('[data-testid="git-history-cherry-pick-selected"]').trigger('click')
    const confirmationModals = wrapper.findAllComponents(ConfirmModal)
    let visibleConfirmationModal = null
    for (const confirmationModal of confirmationModals) {
      if (confirmationModal.props('visible')) {
        visibleConfirmationModal = confirmationModal
        break
      }
    }
    if (!visibleConfirmationModal) {
      throw new Error('Missing visible multi-commit confirmation modal')
    }
    visibleConfirmationModal.vm.$emit('confirm')
    await flushPromises()
    expect(historyPanelMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-cherry-pick?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commits: ['bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa'] }),
      })
    )
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitHistoryViewer from '../components/workspace/GitHistoryViewer.vue'

const historyViewerMocks = vi.hoisted(function createHistoryViewerMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: historyViewerMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitHistoryViewer', function gitHistoryViewerSuite() {
  beforeEach(function resetViewerMocks() {
    historyViewerMocks.authFetch.mockReset()
  })

  it('loads and renders a commit patch', async function rendersCommit() {
    // 步骤1：返回包含增删行的提交 Patch。
    historyViewerMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          patch: 'commit aaaaaaaa\n\ndiff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new',
        }),
        { status: 200 }
      )
    )
    const wrapper = mount(GitHistoryViewer, {
      props: {
        paneId: 'pane-1',
        selection: {
          kind: 'commit',
          hash: 'aaaaaaaaaaaaaaaa',
          shortHash: 'aaaaaaa',
          subject: 'Add history panel',
          authorName: 'Alice',
          authoredAt: '2026-07-17T10:00:00+08:00',
          path: null,
        },
      },
    })
    await flushPromises()

    // 步骤2：提交标题和增删行都应显示。
    expect(wrapper.get('[data-testid="git-history-viewer-title"]').text()).toBe('Add history panel')
    expect(wrapper.get('.git-diff-line-removed').text()).toContain('-old')
    expect(wrapper.get('.git-diff-line-added').text()).toContain('+new')
  })

  it('loads a branch comparison and displays counts', async function rendersComparison() {
    // 步骤1：返回两侧独有提交数量与比较 Patch。
    historyViewerMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          base_only: 1,
          target_only: 3,
          patch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new',
        }),
        { status: 200 }
      )
    )
    const wrapper = mount(GitHistoryViewer, {
      props: {
        paneId: 'pane-1',
        selection: { kind: 'compare', base: 'main', target: 'feature/git-panel' },
      },
    })
    await flushPromises()

    // 步骤2：标题和双方独有提交数量应与接口一致。
    expect(wrapper.get('[data-testid="git-history-viewer-title"]').text()).toContain(
      'main...feature/git-panel'
    )
    expect(wrapper.get('[data-testid="git-compare-counts"]').text()).toContain('1')
    expect(wrapper.get('[data-testid="git-compare-counts"]').text()).toContain('3')
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitRebasePlanner from '../components/workspace/GitRebasePlanner.vue'

const rebasePlannerMocks = vi.hoisted(function createRebasePlannerMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: rebasePlannerMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const candidates = [
  createCandidate('dddddddddddddddd', 'cccccccccccccccc', 'Fourth commit'),
  createCandidate('cccccccccccccccc', 'bbbbbbbbbbbbbbbb', 'Third commit'),
  createCandidate('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'Second commit'),
  createCandidate('aaaaaaaaaaaaaaaa', '0000000000000000', 'First commit'),
]

function createCandidate(hash: string, parent: string, subject: string) {
  // 步骤1：生成与后端候选接口一致的线性提交记录。
  return {
    hash,
    short_hash: hash.slice(0, 7),
    author_name: 'Alice',
    author_email: 'alice@example.com',
    authored_at: '2026-07-17T10:00:00+08:00',
    parents: [parent],
    decorations: [],
    subject,
  }
}

describe('GitRebasePlanner', function gitRebasePlannerSuite() {
  beforeEach(function resetRebasePlannerMocks() {
    // 步骤1：候选接口返回当前分支从 HEAD 开始的四条线性提交，写接口返回成功。
    rebasePlannerMocks.authFetch.mockReset()
    rebasePlannerMocks.authFetch.mockImplementation(async function respondToRebaseRequest(
      url: string
    ) {
      if (url.startsWith('/api/workspace/git-rebase-candidates?')) {
        return new Response(JSON.stringify({ commits: candidates }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, output: 'Rebase completed' }), {
        status: 200,
      })
    })
  })

  it('reorders commits and submits squash fixup and reword actions', async function submitsRebasePlan() {
    // 步骤1：打开规划器并把选择范围扩展到第四条提交。
    const wrapper = mount(GitRebasePlanner, {
      props: { visible: true, paneId: 'pane-1', repository: 'apps/web' },
    })
    await flushPromises()
    const candidateInputs = wrapper.findAll('[data-testid="git-rebase-candidate"]')
    await candidateInputs[3].setValue(true)
    expect(wrapper.findAll('[data-testid="git-rebase-plan-row"]')).toHaveLength(4)

    // 步骤2：调整提交顺序，并配置 Squash、Fixup 与 Reword。
    const initialRows = wrapper.findAll('[data-testid="git-rebase-plan-row"]')
    await initialRows[0].get('[data-testid="git-rebase-move-down"]').trigger('click')
    const reorderedRows = wrapper.findAll('[data-testid="git-rebase-plan-row"]')
    await reorderedRows[1].get('[data-testid="git-rebase-action"]').setValue('squash')
    await reorderedRows[2].get('[data-testid="git-rebase-action"]').setValue('fixup')
    await reorderedRows[3].get('[data-testid="git-rebase-action"]').setValue('reword')
    await reorderedRows[3]
      .get('[data-testid="git-rebase-message"]')
      .setValue('Renamed fourth commit')

    // 步骤3：执行后端历史重写，并确认上游与完整计划都按界面顺序发送。
    await wrapper.get('[data-testid="git-rebase-run"]').trigger('click')
    await flushPromises()
    expect(rebasePlannerMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-rebase-plan?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          upstream: '0000000000000000',
          entries: [
            { commit: 'bbbbbbbbbbbbbbbb', action: 'pick', message: '' },
            { commit: 'aaaaaaaaaaaaaaaa', action: 'squash', message: '' },
            { commit: 'cccccccccccccccc', action: 'fixup', message: '' },
            {
              commit: 'dddddddddddddddd',
              action: 'reword',
              message: 'Renamed fourth commit',
            },
          ],
          confirm_rewrite: true,
        }),
      })
    )
    expect(wrapper.emitted('completed')).toHaveLength(1)
  })
})

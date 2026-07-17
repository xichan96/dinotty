import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GitCommitActions from '../components/workspace/GitCommitActions.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

const commitActionMocks = vi.hoisted(function createCommitActionMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: commitActionMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const commit = {
  hash: 'aaaaaaaaaaaaaaaa',
  shortHash: 'aaaaaaa',
  authorName: 'Alice',
  authorEmail: 'alice@example.com',
  authoredAt: '2026-07-17T10:00:00+08:00',
  parents: ['bbbbbbbbbbbbbbbb'],
  decorations: [],
  subject: 'Add history panel',
}

function mountActions() {
  // 步骤1：挂载绑定到嵌套仓库和固定提交的操作菜单。
  return mount(GitCommitActions, {
    attachTo: document.body,
    props: { paneId: 'pane-1', repository: 'apps/web', commit },
  })
}

describe('GitCommitActions', function gitCommitActionsSuite() {
  beforeEach(function resetActionMocks() {
    commitActionMocks.authFetch.mockReset()
    commitActionMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  afterEach(function clearMountedActions() {
    document.body.innerHTML = ''
  })

  it('confirms before cherry-picking the selected commit', async function cherryPicksCommit() {
    // 步骤1：打开菜单并选择 Cherry-pick，此时还不能修改仓库。
    const wrapper = mountActions()
    await wrapper.get('[data-testid="git-commit-actions-button"]').trigger('click')
    await wrapper.get('[data-testid="git-history-cherry-pick"]').trigger('click')
    expect(commitActionMocks.authFetch).not.toHaveBeenCalled()

    // 步骤2：确认后发送当前提交 hash，并通知父级刷新仓库状态。
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()
    expect(commitActionMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-cherry-pick?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commit: 'aaaaaaaaaaaaaaaa' }),
      })
    )
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('creates a branch from the selected commit', async function createsBranch() {
    // 步骤1：切换到创建分支表单并填写分支名称。
    const wrapper = mountActions()
    await wrapper.get('[data-testid="git-commit-actions-button"]').trigger('click')
    await wrapper.get('[data-testid="git-history-create-branch"]').trigger('click')
    await wrapper.get('[data-testid="git-history-name-input"]').setValue('feature/from-history')
    await wrapper.get('[data-testid="git-history-create-confirm"]').trigger('click')
    await flushPromises()

    // 步骤2：确认分支以当前历史提交为起点，而不是以 HEAD 为起点。
    expect(commitActionMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-create?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'feature/from-history',
          start_point: 'aaaaaaaaaaaaaaaa',
        }),
      })
    )
  })

  it('checks out the selected commit in detached mode', async function checksOutCommit() {
    // 步骤1：选择检出提交并确认危险操作。
    const wrapper = mountActions()
    await wrapper.get('[data-testid="git-commit-actions-button"]').trigger('click')
    await wrapper.get('[data-testid="git-history-checkout"]').trigger('click')
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    // 步骤2：后端必须收到 detached 标记，不能把 hash 当成本地分支名称。
    expect(commitActionMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-switch?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'aaaaaaaaaaaaaaaa',
          remote: false,
          detached: true,
        }),
      })
    )
  })

  it('reports an already reverted commit as a completed no-op', async function reportsRevertNoop() {
    // 步骤1：后端确认提交改动早已不存在时，历史菜单执行还原并返回专用结果码。
    commitActionMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result_code: 'nothing_to_revert' }), { status: 200 })
    )
    const wrapper = mountActions()
    await wrapper.get('[data-testid="git-commit-actions-button"]').trigger('click')
    await wrapper.get('[data-testid="git-history-revert"]').trigger('click')
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    // 步骤2：界面显示明确提示并按成功结果刷新，不再显示“git command failed”。
    expect(wrapper.emitted('result')).toEqual([['该提交的改动已经还原，无需重复操作', false]])
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitAdvancedActions from '../components/workspace/GitAdvancedActions.vue'

const advancedMocks = vi.hoisted(function createAdvancedMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: advancedMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitAdvancedActions', function gitAdvancedActionsSuite() {
  beforeEach(function resetAdvancedMocks() {
    // 步骤1：按接口返回分支、标签和无进行中操作的状态。
    advancedMocks.authFetch.mockReset()
    advancedMocks.authFetch.mockImplementation(async function respondToAdvancedRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-branches?')) {
        return new Response(
          JSON.stringify({
            local: [
              { name: 'main', current: true },
              { name: 'feature/topic', current: false },
            ],
            remote: [],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-tags?')) {
        return new Response(
          JSON.stringify({
            tags: [
              {
                name: 'v1.0.0',
                target: 'aaaaaaaa',
                created_at: '2026-07-17 11:00:00 +0800',
                subject: 'Release 1.0.0',
              },
            ],
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ operation: null }), { status: 200 })
    })
  })

  it('merges a selected branch', async function mergesBranch() {
    // 步骤1：选择功能分支并执行合并。
    const wrapper = mount(GitAdvancedActions, { props: { paneId: 'pane-1' } })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')
    await wrapper.get('[data-testid="git-advanced-source"]').setValue('feature/topic')
    await wrapper.get('[data-testid="git-merge-button"]').trigger('click')
    await flushPromises()

    // 步骤2：确认合并来源作为独立 JSON 字段发送。
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-merge?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ source: 'feature/topic' }),
      })
    )
  })

  it('runs cherry-pick for a commit hash and lists tags', async function cherryPicksCommit() {
    // 步骤1：确认标签列表显示，再输入提交 ID 执行 Cherry-pick。
    const wrapper = mount(GitAdvancedActions, { props: { paneId: 'pane-1' } })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')
    expect(wrapper.get('[data-testid="git-tag-row"]').text()).toContain('v1.0.0')
    await wrapper.get('[data-testid="git-advanced-commit"]').setValue('abcdef12')
    await wrapper.get('[data-testid="git-cherry-pick-button"]').trigger('click')
    await flushPromises()

    // 步骤2：确认提交 ID 发送到 Cherry-pick 接口。
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-cherry-pick?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commit: 'abcdef12' }),
      })
    )
  })

  it('shows operation progress and creates a recovery branch from reflog', async function recoversFromReflog() {
    // 步骤1：让状态接口返回进行到一半的 Rebase，并返回一条可恢复的 Reflog。
    advancedMocks.authFetch.mockImplementation(async function respondToRecoveryRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-operation-state?')) {
        return new Response(
          JSON.stringify({
            operation: 'rebase',
            target: 'aaaaaaaaaaaaaaaa',
            progress_current: 2,
            progress_total: 4,
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-reflog?')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                selector: 'HEAD@{1}',
                hash: 'bbbbbbbbbbbbbbbb',
                short_hash: 'bbbbbbb',
                action: 'reset',
                message: 'moving to HEAD~1',
                authored_at: '2026-07-17T09:00:00+08:00',
              },
            ],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-tags?')) {
        return new Response(JSON.stringify({ tags: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ local: [], remote: [] }), { status: 200 })
    })
    const wrapper = mount(GitAdvancedActions, { props: { paneId: 'pane-1' } })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')
    expect(wrapper.get('[data-testid="git-operation-progress"]').text()).toContain('2/4')
    expect(wrapper.get('[data-testid="git-reflog-row"]').text()).toContain('moving to HEAD~1')

    // 步骤2：从 Reflog 准备恢复分支并提交，后端收到完整提交 ID。
    await wrapper.get('[data-testid="git-reflog-recover"]').trigger('click')
    await wrapper.get('[data-testid="git-recovery-branch-name"]').setValue('recovery/before-reset')
    await wrapper.get('[data-testid="git-recovery-branch-create"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-create?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'recovery/before-reset',
          start_point: 'bbbbbbbbbbbbbbbb',
        }),
      })
    )
  })

  it('shows persistent controls for a sequencer-only cherry-pick', async function controlsSequencer() {
    // 步骤1：模拟没有 CHERRY_PICK_HEAD、但后端从 sequencer/todo 识别出的 Cherry-pick。
    advancedMocks.authFetch.mockImplementation(async function respondToSequencerRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-operation-state?')) {
        return new Response(
          JSON.stringify({ operation: 'cherry-pick', target: 'abcdef1234567890' }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-tags?')) {
        return new Response(JSON.stringify({ tags: [] }), { status: 200 })
      }
      if (url.startsWith('/api/workspace/git-reflog?')) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ local: [], remote: [] }), { status: 200 })
    })
    const wrapper = mount(GitAdvancedActions, { props: { paneId: 'pane-1' } })
    await flushPromises()

    // 步骤2：操作栏无需展开高级区域即可看见，并提供跳过、退出和中止动作。
    expect(wrapper.get('[data-testid="git-operation-banner"]').text()).toContain('cherry-pick')
    expect(wrapper.find('[data-testid="git-operation-skip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="git-operation-abort"]').exists()).toBe(true)
    await wrapper.get('[data-testid="git-operation-quit"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-operation-action?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ operation: 'cherry-pick', action: 'quit' }),
      })
    )
  })
})

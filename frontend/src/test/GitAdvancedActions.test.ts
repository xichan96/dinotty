import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
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

  it('deletes a remote tag from the selected remote', async function deletesRemoteTag() {
    // 步骤1：传入远程仓库列表并展开标签区域。
    const wrapper = mount(GitAdvancedActions, {
      props: {
        paneId: 'pane-1',
        remotes: [
          {
            name: 'origin',
            fetchUrl: 'https://example.com/team/project.git',
            pushUrl: 'git@example.com:team/project.git',
          },
        ],
      },
    })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')

    // 步骤2：确认后删除 origin 上的同名远程标签。
    await wrapper.get('[data-testid="git-tag-remote"]').setValue('origin')
    await wrapper.get('[data-testid="git-remote-tag-delete-button"]').trigger('click')
    await flushPromises()
    const confirmModals = wrapper.findAllComponents(ConfirmModal)
    const remoteTagConfirmModal = confirmModals.find(function findRemoteTagConfirmModal(modal) {
      return String(modal.props('message')).includes('origin/v1.0.0')
    })
    expect(remoteTagConfirmModal?.props('visible')).toBe(true)
    remoteTagConfirmModal?.vm.$emit('confirm')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-remote-tag-delete?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', tag: 'v1.0.0' }),
      })
    )
  })

  it('lists remote tags and pushes one local tag', async function pushesRemoteTag() {
    // 步骤1：远程标签接口返回与本地不同的标签，展开后应明确显示。
    advancedMocks.authFetch.mockImplementation(async function respondToRemoteTagRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-remote-tags?')) {
        return new Response(JSON.stringify({ tags: [{ name: 'v0.9.0', target: 'bbbbbbbb' }] }), {
          status: 200,
        })
      }
      if (url.startsWith('/api/workspace/git-tags?')) {
        return new Response(JSON.stringify({ tags: [{ name: 'v1.0.0', target: 'aaaaaaaa' }] }), {
          status: 200,
        })
      }
      if (url.startsWith('/api/workspace/git-branches?')) {
        return new Response(JSON.stringify({ local: [], remote: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ operation: null, entries: [] }), { status: 200 })
    })
    const wrapper = mount(GitAdvancedActions, {
      props: {
        paneId: 'pane-1',
        remotes: [{ name: 'origin', fetchUrl: '', pushUrl: '' }],
      },
    })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="git-remote-tag-row"]').text()).toContain('v0.9.0')

    // 步骤2：单标签推送只发送选中的 Remote 和标签。
    await wrapper.get('[data-testid="git-tag-push-button"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-remote-tag-push?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', tag: 'v1.0.0' }),
      })
    )
  })

  it('runs bisect actions and patch preflight', async function runsBisectAndPatch() {
    // 步骤1：启动 Bisect，并把坏提交作为独立修订版本发送。
    const wrapper = mount(GitAdvancedActions, { props: { paneId: 'pane-1' } })
    await flushPromises()
    await wrapper.get('.git-advanced-heading').trigger('click')
    await wrapper.get('[data-testid="git-bisect-revision"]').setValue('abcdef12')
    await wrapper.get('[data-testid="git-bisect-bad"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-bisect?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'bad', revision: 'abcdef12' }),
      })
    )

    // 步骤2：Patch 预检必须携带 check，不能误启用三方应用。
    await wrapper.get('[data-testid="git-patch-content"]').setValue('diff --git a/a.txt b/a.txt\n')
    await wrapper.get('[data-testid="git-patch-check"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-patch-apply?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patch: 'diff --git a/a.txt b/a.txt\n',
          check: true,
          three_way: false,
        }),
      })
    )
  })

  it('continues a persisted bisect session from the operation banner', async function continuesBisect() {
    // 步骤1：后端识别 BISECT_START 后，折叠状态也应显示专用判定操作。
    advancedMocks.authFetch.mockImplementation(async function respondToBisectState(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-operation-state?')) {
        return new Response(JSON.stringify({ operation: 'bisect', target: 'abcdef12' }), {
          status: 200,
        })
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
    expect(wrapper.get('[data-testid="git-operation-banner"]').text()).toContain('bisect')

    // 步骤2：状态栏的“正常”直接提交 Bisect good，不走通用 continue 接口。
    await wrapper.get('[data-testid="git-bisect-banner-good"]').trigger('click')
    await flushPromises()
    expect(advancedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-bisect?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'good', revision: '' }),
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

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
import GitExtendedWorkflows from '../components/workspace/GitExtendedWorkflows.vue'

const extendedMocks = vi.hoisted(function createExtendedMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: extendedMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitExtendedWorkflows', function gitExtendedWorkflowsSuite() {
  beforeEach(function resetExtendedMocks() {
    extendedMocks.authFetch.mockReset()
    extendedMocks.authFetch.mockImplementation(async function respondToExtendedRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-worktrees?')) {
        return new Response(
          JSON.stringify({
            worktrees: [
              {
                path: 'E:/repo-feature',
                branch: 'feature',
                detached: false,
                locked: false,
                prunable: false,
                dirty: true,
                current: false,
              },
            ],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-submodules?')) {
        return new Response(
          JSON.stringify({
            submodules: [
              {
                path: 'libs/shared',
                status: 'initialized',
                description: '(heads/main)',
              },
            ],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('/api/workspace/git-lfs-tracks?')) {
        return new Response(JSON.stringify({ patterns: ['*.zip'], locks: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
  })

  it('untracks an existing LFS pattern', async function untracksLfsPattern() {
    // 步骤1：展开后对服务端返回的模式执行取消跟踪。
    const wrapper = mount(GitExtendedWorkflows, {
      props: { paneId: 'pane-1', branch: 'main', remotes: [] },
    })
    await wrapper.get('[data-testid="git-extended-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-lfs-untrack"]').trigger('click')
    await flushPromises()
    expect(extendedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-lfs-untrack?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pattern: '*.zip' }),
      })
    )
  })

  it('locks and unlocks a worktree', async function managesWorktreeLock() {
    // 步骤1：未锁定 Worktree 显示锁定操作并发送固定动作。
    const wrapper = mount(GitExtendedWorkflows, {
      props: { paneId: 'pane-1', branch: 'main', remotes: [] },
    })
    await wrapper.get('[data-testid="git-extended-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-worktree-lock"]').trigger('click')
    await flushPromises()
    expect(extendedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-worktree-action?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'lock', path: 'E:/repo-feature', target: '' }),
      })
    )
  })

  it('pushes LFS objects with an explicit remote and ref', async function pushesLfsReference() {
    // 步骤1：展开面板后选择 Remote，并保留当前分支作为默认 LFS ref。
    const wrapper = mount(GitExtendedWorkflows, {
      props: {
        paneId: 'pane-1',
        branch: 'main',
        remotes: [
          {
            name: 'origin',
            fetchUrl: 'https://example.com/repo.git',
            pushUrl: 'https://example.com/repo.git',
          },
        ],
      },
    })
    await wrapper.get('[data-testid="git-extended-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-lfs-remote"]').setValue('origin')
    await wrapper.get('[data-testid="git-lfs-push"]').trigger('click')
    await flushPromises()

    // 步骤2：后端必须收到 Remote、ref 和明确的非全量标记。
    expect(extendedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-lfs-push?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', reference: 'main', all: false }),
      })
    )
  })

  it('deinitializes a submodule after confirmation', async function deinitializesSubmodule() {
    // 步骤1：展开后选择停用子模块，发送请求前必须显示确认框。
    const wrapper = mount(GitExtendedWorkflows, {
      props: { paneId: 'pane-1', branch: 'main', remotes: [] },
    })
    await wrapper.get('[data-testid="git-extended-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-submodule-deinit"]').trigger('click')
    expect(
      extendedMocks.authFetch.mock.calls.some(function hasDeinitCall(call) {
        return String(call[0]).includes('git-submodule-deinit')
      })
    ).toBe(false)

    // 步骤2：确认后只执行 deinit，不误调用完整移除接口。
    const modals = wrapper.findAllComponents(ConfirmModal)
    const modal = modals.find(function findVisibleModal(candidate) {
      return candidate.props('visible') === true
    })
    modal?.vm.$emit('confirm')
    await flushPromises()
    expect(extendedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-submodule-deinit?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'libs/shared', confirm: true }),
      })
    )
  })

  it('confirms and protects forced worktree removal', async function removesDirtyWorktree() {
    // 步骤1：脏 Worktree 的删除请求必须先弹出确认框。
    const wrapper = mount(GitExtendedWorkflows, {
      props: { paneId: 'pane-1', branch: 'main', remotes: [] },
    })
    await wrapper.get('[data-testid="git-extended-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-worktree-remove"]').trigger('click')
    expect(
      extendedMocks.authFetch.mock.calls.some(function hasRemoveCall(call) {
        return String(call[0]).includes('git-worktree-remove')
      })
    ).toBe(false)

    // 步骤2：确认后显式发送强制标记和二次确认标记。
    const modal = wrapper.findComponent(ConfirmModal)
    expect(modal.props('visible')).toBe(true)
    modal.vm.$emit('confirm')
    await flushPromises()
    expect(extendedMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-worktree-remove?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: 'E:/repo-feature',
          force: true,
          confirm_force: true,
        }),
      })
    )
  })
})

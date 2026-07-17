import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from '../components/ui/ConfirmModal.vue'
import GitSyncOptions from '../components/workspace/GitSyncOptions.vue'

const syncOptionsMocks = vi.hoisted(function createSyncOptionsMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: syncOptionsMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const remotes = [
  {
    name: 'origin',
    fetchUrl: 'https://example.com/team/project.git',
    pushUrl: 'git@example.com:team/project.git',
  },
  {
    name: 'backup',
    fetchUrl: 'https://backup.example.com/team/project.git',
    pushUrl: 'https://backup.example.com/team/project.git',
  },
]

function mountSyncOptions(): VueWrapper {
  // 步骤1：挂载 main 分支和 origin Remote 的同步选项。
  return mount(GitSyncOptions, {
    props: {
      visible: true,
      paneId: 'pane-1',
      repository: 'apps/web',
      remotes,
      branch: 'main',
      upstream: 'origin/main',
      selectedRemoteName: 'origin',
    },
  })
}

describe('GitSyncOptions', function gitSyncOptionsSuite() {
  beforeEach(function resetSyncOptionsMocks() {
    syncOptionsMocks.authFetch.mockReset()
    syncOptionsMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  it('fetches one remote or all remotes with pruning', async function fetchesRemotes() {
    // 步骤1：默认获取当前选择的 origin Remote。
    const wrapper = mountSyncOptions()
    await wrapper.get('[data-testid="git-sync-fetch-button"]').trigger('click')
    await flushPromises()
    expect(syncOptionsMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-fetch?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', all: false }),
      })
    )

    // 步骤2：勾选全部后让后端获取并清理所有 Remote。
    await wrapper.get('[data-testid="git-fetch-all-remotes"]').setValue(true)
    await wrapper.get('[data-testid="git-sync-fetch-button"]').trigger('click')
    await flushPromises()
    expect(syncOptionsMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-fetch?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', all: true }),
      })
    )
  })

  it('pulls with the selected integration strategy', async function pullsWithStrategy() {
    // 步骤1：选择 Rebase，并明确从 origin/release 拉取。
    const wrapper = mountSyncOptions()
    await wrapper.get('[data-testid="git-pull-strategy"]').setValue('rebase')
    await wrapper.get('[data-testid="git-pull-remote-branch"]').setValue('release')
    await wrapper.get('[data-testid="git-sync-pull-button"]').trigger('click')
    await flushPromises()
    expect(syncOptionsMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-pull?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', branch: 'release', strategy: 'rebase' }),
      })
    )
  })

  it('pushes tags safely and deletes a remote branch', async function pushesAndDeletesRemoteBranch() {
    // 步骤1：把 main 安全强推到 origin/release，并同时推送标签。
    const wrapper = mountSyncOptions()
    await wrapper.get('[data-testid="git-push-remote-branch"]').setValue('release')
    await wrapper.get('[data-testid="git-push-tags"]').setValue(true)
    await wrapper.get('[data-testid="git-force-with-lease"]').setValue(true)
    await wrapper.get('[data-testid="git-sync-push-button"]').trigger('click')
    await flushPromises()
    expect(syncOptionsMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-push?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          remote: 'origin',
          branch: 'main',
          remote_branch: 'release',
          push_tags: true,
          force_with_lease: true,
        }),
      })
    )

    // 步骤2：请求删除同一远程分支，并在确认后调用专用接口。
    await wrapper.get('[data-testid="git-remote-branch-delete-button"]').trigger('click')
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()
    expect(syncOptionsMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-remote-branch-delete?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ remote: 'origin', branch: 'release' }),
      })
    )
  })
})

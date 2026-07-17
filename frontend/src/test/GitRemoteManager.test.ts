import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitRemoteManager from '../components/workspace/GitRemoteManager.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

const remoteManagerMocks = vi.hoisted(function createRemoteManagerMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: remoteManagerMocks.authFetch,
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

function mountRemoteManager(): VueWrapper {
  // 步骤1：挂载包含两个 Remote 和现有 Upstream 的管理器。
  return mount(GitRemoteManager, {
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

describe('GitRemoteManager', function gitRemoteManagerSuite() {
  beforeEach(function resetRemoteManagerMocks() {
    remoteManagerMocks.authFetch.mockReset()
    remoteManagerMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  it('selects and adds remotes', async function selectsAndAddsRemote() {
    // 步骤1：切换当前 Remote，并确认父级收到选择结果。
    const wrapper = mountRemoteManager()
    await wrapper.get('[data-testid="git-remote-select"]').setValue('backup')
    expect(wrapper.emitted('select-remote')).toEqual([['backup']])

    // 步骤2：填写名称和地址后调用 Remote 添加接口。
    await wrapper.get('[data-testid="git-remote-add-name"]').setValue('mirror')
    await wrapper
      .get('[data-testid="git-remote-add-url"]')
      .setValue('https://mirror.example.com/team/project.git')
    await wrapper.get('[data-testid="git-remote-add-button"]').trigger('click')
    await flushPromises()
    expect(remoteManagerMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-remote-add?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'mirror',
          url: 'https://mirror.example.com/team/project.git',
        }),
      })
    )
  })

  it('updates and deletes a remote', async function updatesAndDeletesRemote() {
    // 步骤1：编辑 origin 的名称、Fetch 地址和 Push 地址。
    const wrapper = mountRemoteManager()
    const originRow = wrapper.get('[data-remote="origin"]')
    await originRow.get('[data-testid="git-remote-edit-button"]').trigger('click')
    await originRow.get('[data-testid="git-remote-edit-name"]').setValue('upstream')
    await originRow
      .get('[data-testid="git-remote-edit-fetch-url"]')
      .setValue('https://example.com/upstream/project.git')
    await originRow
      .get('[data-testid="git-remote-edit-push-url"]')
      .setValue('git@example.com:upstream/project.git')
    await originRow.get('[data-testid="git-remote-edit-confirm"]').trigger('click')
    await flushPromises()
    expect(remoteManagerMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-remote-update?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'origin',
          new_name: 'upstream',
          fetch_url: 'https://example.com/upstream/project.git',
          push_url: 'git@example.com:upstream/project.git',
        }),
      })
    )

    // 步骤2：请求删除 backup，并在确认后调用删除接口。
    await wrapper
      .get('[data-remote="backup"]')
      .get('[data-testid="git-remote-delete-button"]')
      .trigger('click')
    wrapper.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()
    expect(remoteManagerMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-remote-delete?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'backup' }),
      })
    )
  })

  it('sets and unsets the current branch upstream', async function managesUpstream() {
    // 步骤1：把 main 的 Upstream 改为 backup/release。
    const wrapper = mountRemoteManager()
    await wrapper.get('[data-testid="git-remote-select"]').setValue('backup')
    await wrapper.get('[data-testid="git-upstream-remote-branch"]').setValue('release')
    await wrapper.get('[data-testid="git-upstream-set-button"]').trigger('click')
    await flushPromises()
    expect(remoteManagerMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-upstream-set?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          remote: 'backup',
          branch: 'main',
          remote_branch: 'release',
        }),
      })
    )

    // 步骤2：取消当前本地分支已有的 Upstream。
    await wrapper.get('[data-testid="git-upstream-unset-button"]').trigger('click')
    await flushPromises()
    expect(remoteManagerMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-upstream-unset?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ branch: 'main' }),
      })
    )
  })
})

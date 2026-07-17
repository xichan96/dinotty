import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitRepositorySetup from '../components/workspace/GitRepositorySetup.vue'

const repositorySetupMocks = vi.hoisted(function createRepositorySetupMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: repositorySetupMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitRepositorySetup', function gitRepositorySetupSuite() {
  beforeEach(function resetSetupMocks() {
    repositorySetupMocks.authFetch.mockReset()
    repositorySetupMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  it('initializes the current workspace with the selected branch', async function initializesRepo() {
    // 步骤1：输入初始分支并初始化当前工作区。
    const wrapper = mount(GitRepositorySetup, { props: { paneId: 'pane-1' } })
    await wrapper.get('[data-testid="git-init-branch"]').setValue('develop')
    await wrapper.get('[data-testid="git-init-button"]').trigger('click')
    await flushPromises()

    // 步骤2：确认接口参数和根仓库创建事件准确。
    expect(repositorySetupMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-init?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ initial_branch: 'develop' }),
      })
    )
    expect(wrapper.emitted('repository-created')).toEqual([['']])
  })

  it('clones a repository into a workspace subdirectory', async function clonesRepo() {
    // 步骤1：切换克隆模式并填写远程地址和目标目录。
    const wrapper = mount(GitRepositorySetup, { props: { paneId: 'pane-1' } })
    expect(wrapper.find('[data-testid="git-command-log-heading"]').exists()).toBe(true)
    await wrapper.get('[data-testid="git-setup-clone-tab"]').trigger('click')
    await wrapper.get('[data-testid="git-clone-url"]').setValue('https://example.com/team/app.git')
    await wrapper.get('[data-testid="git-clone-directory"]').setValue('app')
    await wrapper.get('[data-testid="git-clone-button"]').trigger('click')
    await flushPromises()

    // 步骤2：确认后端收到目标目录，导航层收到新仓库相对路径。
    expect(repositorySetupMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-clone?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          url: 'https://example.com/team/app.git',
          directory: 'app',
        }),
      })
    )
    expect(wrapper.emitted('repository-created')).toEqual([['app']])
  })
})

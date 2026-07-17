import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitBranchMenu from '../components/workspace/GitBranchMenu.vue'
import ConfirmModal from '../components/ui/ConfirmModal.vue'

const branchMenuMocks = vi.hoisted(function createBranchMenuMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: branchMenuMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const branchResponse = {
  local: [
    { name: 'feature/git-panel', upstream: 'origin/feature/git-panel', current: true },
    { name: 'main', upstream: 'origin/main', current: false },
  ],
  remote: [{ name: 'origin/release', upstream: null, current: false }],
}

function mountBranchMenu(): VueWrapper {
  // 步骤1：挂载一个包含本地与远程分支的可见分支菜单。
  return mount(GitBranchMenu, {
    props: {
      visible: true,
      paneId: 'pane-1',
      currentBranch: 'feature/git-panel',
    },
  })
}

function findBranchRow(wrapper: VueWrapper, testId: string, name: string): DOMWrapper<Element> {
  // 步骤1：按分组和完整分支名称查找指定分支行。
  const rows = wrapper.findAll(`[data-testid="${testId}"]`)
  const row = rows.find(function matchesBranch(candidate) {
    return candidate.attributes('data-branch') === name
  })
  if (!row) {
    throw new Error(`Missing branch row: ${name}`)
  }
  return row
}

describe('GitBranchMenu', function gitBranchMenuSuite() {
  beforeEach(function resetBranchMocks() {
    // 步骤1：列表请求返回固定分支，写操作返回成功。
    branchMenuMocks.authFetch.mockReset()
    branchMenuMocks.authFetch.mockImplementation(async function respondToBranchRequest(
      url: string
    ) {
      if (url.startsWith('/api/workspace/git-branches?')) {
        return new Response(JSON.stringify(branchResponse), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  })

  it('lists and switches local and remote branches', async function switchesBranches() {
    // 步骤1：加载并确认本地、远程分支分组。
    const wrapper = mountBranchMenu()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="git-local-branch-row"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="git-remote-branch-row"]')).toHaveLength(1)

    // 步骤2：切换本地分支，并从远程分支创建跟踪分支。
    await findBranchRow(wrapper, 'git-local-branch-row', 'main')
      .get('[data-testid="git-branch-switch-button"]')
      .trigger('click')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-switch?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'main', remote: false }),
      })
    )

    await findBranchRow(wrapper, 'git-remote-branch-row', 'origin/release')
      .get('[data-testid="git-branch-switch-button"]')
      .trigger('click')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-switch?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'origin/release', remote: true }),
      })
    )
  })

  it('creates and renames branches with inline inputs', async function editsBranches() {
    // 步骤1：输入新分支名并创建分支。
    const wrapper = mountBranchMenu()
    await flushPromises()
    await wrapper.get('[data-testid="git-branch-create-input"]').setValue('feature/history')
    await wrapper.get('[data-testid="git-branch-create-button"]').trigger('click')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-create?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'feature/history' }),
      })
    )

    // 步骤2：进入重命名状态，确认发送旧名称与新名称。
    const mainRow = findBranchRow(wrapper, 'git-local-branch-row', 'main')
    await mainRow.get('[data-testid="git-branch-rename-button"]').trigger('click')
    await mainRow.get('[data-testid="git-branch-rename-input"]').setValue('trunk')
    await mainRow.get('[data-testid="git-branch-rename-confirm"]').trigger('click')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-rename?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ old_name: 'main', new_name: 'trunk' }),
      })
    )
  })

  it('requires confirmation before deleting a local branch', async function deletesBranch() {
    // 步骤1：请求删除非当前分支，并确认弹出确认框。
    const wrapper = mountBranchMenu()
    await flushPromises()
    const mainRow = findBranchRow(wrapper, 'git-local-branch-row', 'main')
    await mainRow.get('[data-testid="git-branch-delete-button"]').trigger('click')
    const confirmModal = wrapper.findComponent(ConfirmModal)
    expect(confirmModal.props('visible')).toBe(true)

    // 步骤2：确认后才调用安全删除接口。
    confirmModal.vm.$emit('confirm')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-delete?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'main', force: false }),
      })
    )
  })

  it('requires a separate confirmation before force deleting a branch', async function forceDeletesBranch() {
    // 步骤1：点击强制删除入口后显示明确的危险操作确认框。
    const wrapper = mountBranchMenu()
    await flushPromises()
    const mainRow = findBranchRow(wrapper, 'git-local-branch-row', 'main')
    await mainRow.get('[data-testid="git-branch-force-delete-button"]').trigger('click')
    const confirmModal = wrapper.findComponent(ConfirmModal)
    expect(confirmModal.props('visible')).toBe(true)
    expect(confirmModal.props('message')).toContain('main')

    // 步骤2：确认后发送明确的 force 标记，避免普通删除隐式升级。
    confirmModal.vm.$emit('confirm')
    await flushPromises()
    expect(branchMenuMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-branch-delete?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'main', force: true }),
      })
    )
  })
})

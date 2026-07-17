import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GitRepositoryMaintenance from '../components/workspace/GitRepositoryMaintenance.vue'

const maintenanceMocks = vi.hoisted(function createMaintenanceMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: maintenanceMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitRepositoryMaintenance', function gitRepositoryMaintenanceSuite() {
  beforeEach(function resetMaintenanceMocks() {
    // 步骤1：提供现有忽略规则、两项清理预览和成功的写操作响应。
    maintenanceMocks.authFetch.mockReset()
    maintenanceMocks.authFetch.mockImplementation(async function respondToMaintenanceRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.includes('git-clean-preview')) {
        return new Response(JSON.stringify({ paths: ['build/', 'notes draft.txt'] }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ content: 'target/\n', exists: true }), { status: 200 })
    })
  })

  afterEach(function cleanMaintenanceDocument() {
    document.body.innerHTML = ''
  })

  it('saves ignore rules and cleans only confirmed preview paths', async function maintainsRepo() {
    // 步骤1：展开面板、修改并保存仓库根 .gitignore。
    const wrapper = mount(GitRepositoryMaintenance, {
      attachTo: document.body,
      props: { paneId: 'pane-1', repository: 'apps/web' },
    })
    await wrapper.get('[data-testid="git-maintenance-heading"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="git-ignore-editor"]').setValue('target/\n.env\n')
    await wrapper.get('[data-testid="git-ignore-save"]').trigger('click')
    await flushPromises()
    expect(maintenanceMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-ignore?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'target/\n.env\n' }),
      })
    )

    // 步骤2：预览默认勾选所有未跟踪项，确认后只提交预览路径。
    await wrapper.get('[data-testid="git-clean-preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="git-clean-row"]')).toHaveLength(2)
    await wrapper.get('[data-testid="git-clean-selected"]').trigger('click')
    const confirmButton = document.querySelector<HTMLButtonElement>('.confirm-btn.primary')
    expect(confirmButton).not.toBeNull()
    confirmButton?.click()
    await flushPromises()
    expect(maintenanceMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-clean?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['build/', 'notes draft.txt'] }),
      })
    )
  })
})

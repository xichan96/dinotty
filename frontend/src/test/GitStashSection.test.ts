import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitStashSection from '../components/workspace/GitStashSection.vue'

const stashMocks = vi.hoisted(function createStashMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: stashMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitStashSection', function gitStashSectionSuite() {
  beforeEach(function resetStashMocks() {
    // 步骤1：列表请求返回一条 stash，操作请求返回成功。
    stashMocks.authFetch.mockReset()
    stashMocks.authFetch.mockImplementation(async function respondToStashRequest(
      url: string,
      options?: RequestInit
    ) {
      if (!options) {
        return new Response(
          JSON.stringify({
            stashes: [
              {
                reference: 'stash@{0}',
                hash: 'aaaaaaaa',
                created_at: '2026-07-17T11:00:00+08:00',
                message: 'On main: work in progress',
              },
            ],
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  })

  it('lists stashes and applies a selected stash', async function appliesStash() {
    // 步骤1：挂载并确认 stash 行显示真实说明。
    const wrapper = mount(GitStashSection, { props: { paneId: 'pane-1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="git-stash-row"]').text()).toContain('work in progress')

    // 步骤2：应用该条 stash，并确认引用作为 JSON 请求发送。
    await wrapper.get('[data-testid="git-stash-apply"]').trigger('click')
    await flushPromises()
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-apply?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reference: 'stash@{0}' }),
      })
    )
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('saves a named stash including untracked files', async function savesStash() {
    // 步骤1：输入说明并勾选包含未跟踪文件。
    const wrapper = mount(GitStashSection, { props: { paneId: 'pane-1' } })
    await flushPromises()
    await wrapper.get('[data-testid="git-stash-message"]').setValue('before experiment')
    await wrapper.get('[data-testid="git-stash-untracked"]').setValue(true)
    await wrapper.get('[data-testid="git-stash-save"]').trigger('click')
    await flushPromises()

    // 步骤2：确认保存参数完整发送。
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-save?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'before experiment', include_untracked: true }),
      })
    )
  })
})

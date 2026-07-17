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

const files = [
  { path: 'src/working.ts', staged: false, unstaged: true },
  { path: 'src/staged.ts', staged: true, unstaged: false },
]

describe('GitStashSection', function gitStashSectionSuite() {
  beforeEach(function resetStashMocks() {
    // 步骤1：列表返回一条 Stash，差异和写操作返回成功。
    stashMocks.authFetch.mockReset()
    stashMocks.authFetch.mockImplementation(async function respondToStashRequest(
      url: string,
      options?: RequestInit
    ) {
      if (url.startsWith('/api/workspace/git-stash-diff?')) {
        return new Response(
          JSON.stringify({ patch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new' }),
          { status: 200 }
        )
      }
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

  it('lists, applies and previews a selected stash', async function appliesAndPreviewsStash() {
    // 步骤1：挂载并确认 Stash 行显示真实说明。
    const wrapper = mount(GitStashSection, { props: { paneId: 'pane-1', files } })
    await flushPromises()
    expect(wrapper.get('[data-testid="git-stash-row"]').text()).toContain('work in progress')

    // 步骤2：应用该 Stash，并确认引用作为 JSON 请求发送。
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

    // 步骤3：查看该 Stash 的补丁并确认差异内容渲染在列表下方。
    await wrapper.get('[data-testid="git-stash-view-diff"]').trigger('click')
    await flushPromises()
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-diff?pane_id=pane-1&reference=stash%40%7B0%7D'
    )
    expect(wrapper.text()).toContain('+new')
  })

  it('saves all changes with untracked files and keeps the index', async function savesAllChanges() {
    // 步骤1：输入说明，并选择包含未跟踪文件和保留暂存区。
    const wrapper = mount(GitStashSection, { props: { paneId: 'pane-1', files: [] } })
    await flushPromises()
    await wrapper.get('[data-testid="git-stash-message"]').setValue('before experiment')
    await wrapper.get('[data-testid="git-stash-untracked"]').setValue(true)
    await wrapper.get('[data-testid="git-stash-keep-index"]').setValue(true)
    await wrapper.get('[data-testid="git-stash-save"]').trigger('click')
    await flushPromises()

    // 步骤2：确认完整保存参数发送到后端。
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-save?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          message: 'before experiment',
          include_untracked: true,
          keep_index: true,
          staged_only: false,
          paths: [],
        }),
      })
    )
  })

  it('saves only selected files or staged changes', async function savesPartialStashes() {
    // 步骤1：切换到选中文件模式并只勾选 working.ts。
    const wrapper = mount(GitStashSection, { props: { paneId: 'pane-1', files } })
    await flushPromises()
    await wrapper.get('[data-testid="git-stash-mode"]').setValue('selected')
    await wrapper.get('[data-testid="git-stash-path"][data-path="src/working.ts"]').setValue(true)
    await wrapper.get('[data-testid="git-stash-save"]').trigger('click')
    await flushPromises()
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-save?pane_id=pane-1',
      expect.objectContaining({
        body: JSON.stringify({
          message: '',
          include_untracked: false,
          keep_index: false,
          staged_only: false,
          paths: ['src/working.ts'],
        }),
      })
    )

    // 步骤2：切换到仅暂存模式并确认不再发送文件路径。
    await wrapper.get('[data-testid="git-stash-mode"]').setValue('staged')
    await wrapper.get('[data-testid="git-stash-save"]').trigger('click')
    await flushPromises()
    expect(stashMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-stash-save?pane_id=pane-1',
      expect.objectContaining({
        body: JSON.stringify({
          message: '',
          include_untracked: false,
          keep_index: false,
          staged_only: true,
          paths: [],
        }),
      })
    )
  })
})

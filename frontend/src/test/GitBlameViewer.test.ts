import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitBlameViewer from '../components/workspace/GitBlameViewer.vue'

const blameMocks = vi.hoisted(function createBlameMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: blameMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitBlameViewer', function gitBlameViewerSuite() {
  beforeEach(function resetBlameMocks() {
    // 步骤1：返回两行可追溯到不同提交的源码。
    blameMocks.authFetch.mockReset()
    blameMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          path: 'src/main.rs',
          lines: [
            {
              line_number: 1,
              content: 'first line',
              hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              short_hash: 'aaaaaaaa',
              author_name: 'Alice Zhang',
              author_email: 'alice@example.com',
              authored_at: 1721181600,
              summary: 'Add first line',
            },
            {
              line_number: 2,
              content: 'second line',
              hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              short_hash: 'bbbbbbbb',
              author_name: 'Bob Li',
              author_email: 'bob@example.com',
              authored_at: 1721268000,
              summary: 'Update second line',
            },
          ],
        }),
        { status: 200 }
      )
    )
  })

  it('shows blame lines and opens the selected commit', async function opensBlameCommit() {
    // 步骤1：加载当前仓库文件并显示逐行追责信息。
    const wrapper = mount(GitBlameViewer, {
      props: { paneId: 'pane-1', repository: 'apps/web', filePath: 'src/main.rs' },
    })
    await flushPromises()
    expect(blameMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-blame?pane_id=pane-1&repository=apps%2Fweb&path=src%2Fmain.rs'
    )
    expect(wrapper.findAll('[data-testid="git-blame-row"]')).toHaveLength(2)

    // 步骤2：点击提交哈希时把完整提交信息交给现有历史查看器。
    await wrapper.get('[data-testid="git-blame-commit"]').trigger('click')
    expect(wrapper.emitted('view-history')?.[0]).toEqual([
      {
        kind: 'commit',
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        shortHash: 'aaaaaaaa',
        subject: 'Add first line',
        authorName: 'Alice Zhang',
        authoredAt: new Date(1721181600 * 1000).toISOString(),
        path: 'src/main.rs',
      },
    ])
  })
})

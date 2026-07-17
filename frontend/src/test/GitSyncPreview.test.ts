import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitSyncPreview from '../components/workspace/GitSyncPreview.vue'

const syncPreviewMocks = vi.hoisted(function createSyncPreviewMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: syncPreviewMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const incomingCommit = {
  hash: 'aaaaaaaaaaaaaaaa',
  short_hash: 'aaaaaaa',
  author_name: 'Alice',
  author_email: 'alice@example.com',
  authored_at: '2026-07-17T10:00:00+08:00',
  parents: [],
  decorations: ['origin/main'],
  subject: 'Remote update',
}

const outgoingCommit = {
  hash: 'bbbbbbbbbbbbbbbb',
  short_hash: 'bbbbbbb',
  author_name: 'Bob',
  author_email: 'bob@example.com',
  authored_at: '2026-07-17T11:00:00+08:00',
  parents: [],
  decorations: ['HEAD -> main'],
  subject: 'Local update',
}

describe('GitSyncPreview', function gitSyncPreviewSuite() {
  beforeEach(function resetSyncPreviewMocks() {
    // 步骤1：返回一条传入提交和一条传出提交。
    syncPreviewMocks.authFetch.mockReset()
    syncPreviewMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ incoming: [incomingCommit], outgoing: [outgoingCommit] }), {
        status: 200,
      })
    )
  })

  it('lists sync commits and opens commit details', async function opensSyncCommit() {
    // 步骤1：打开面板后读取当前仓库与 upstream 的差异提交。
    const wrapper = mount(GitSyncPreview, {
      props: { visible: true, paneId: 'pane-1', repository: 'apps/web' },
    })
    await flushPromises()
    expect(syncPreviewMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-sync-preview?pane_id=pane-1&repository=apps%2Fweb'
    )
    expect(wrapper.findAll('[data-testid="git-sync-incoming-row"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="git-sync-outgoing-row"]')).toHaveLength(1)

    // 步骤2：点击传出提交时复用现有提交详情结构。
    await wrapper.get('[data-testid="git-sync-outgoing-row"]').trigger('click')
    expect(wrapper.emitted('view-history')?.[0]?.[0]).toMatchObject({
      kind: 'commit',
      hash: 'bbbbbbbbbbbbbbbb',
      subject: 'Local update',
      path: null,
    })
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitConflictEditor from '../components/workspace/GitConflictEditor.vue'

const conflictEditorMocks = vi.hoisted(function createConflictEditorMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: conflictEditorMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitConflictEditor', function gitConflictEditorSuite() {
  beforeEach(function resetConflictMocks() {
    conflictEditorMocks.authFetch.mockReset()
    conflictEditorMocks.authFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            base: 'base value\n',
            current: 'current value\n',
            incoming: 'incoming value\n',
            result:
              'before\n<<<<<<< HEAD\ncurrent value\n=======\nincoming value\n>>>>>>> feature\nafter\n',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  it('resolves a block with the current side and saves the merged file', async function savesMerge() {
    // 步骤1：加载冲突并采用当前分支内容。
    const wrapper = mount(GitConflictEditor, {
      props: { paneId: 'pane-1', repository: 'apps/web', filePath: 'src/conflict.ts' },
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="git-conflict-unresolved-count"]').text()).toContain('1')
    await wrapper.get('[data-testid="git-conflict-accept-current"]').trigger('click')
    expect(wrapper.get('[data-testid="git-conflict-unresolved-count"]').text()).toContain('0')

    // 步骤2：保存后端收到不含冲突标记的完整结果，并通知父级刷新。
    await wrapper.get('[data-testid="git-conflict-save"]').trigger('click')
    await flushPromises()
    expect(conflictEditorMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-conflict-save?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: 'src/conflict.ts',
          content: 'before\ncurrent value\nafter\n',
        }),
      })
    )
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })
})

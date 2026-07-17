import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitCommandLog from '../components/workspace/GitCommandLog.vue'

const commandLogMocks = vi.hoisted(function createCommandLogMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: commandLogMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

describe('GitCommandLog', function gitCommandLogSuite() {
  beforeEach(function resetCommandLogMocks() {
    // 步骤1：返回一条运行中命令和一条已完成命令，取消接口返回成功。
    commandLogMocks.authFetch.mockReset()
    commandLogMocks.authFetch.mockImplementation(async function respondToCommandLogRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response(
        JSON.stringify({
          commands: [
            {
              id: 'command-running',
              command: 'git fetch --prune origin',
              status: 'running',
              started_at: 100,
              finished_at: null,
              output: '',
            },
            {
              id: 'command-success',
              command: 'git branch -d feature/done',
              status: 'success',
              started_at: 50,
              finished_at: 80,
              output: 'Deleted branch feature/done',
            },
          ],
        }),
        { status: 200 }
      )
    })
  })

  it('lists commands and cancels a running command', async function cancelsCommand() {
    // 步骤1：展开日志并确认运行中与已完成命令都可见。
    const wrapper = mount(GitCommandLog, {
      props: { paneId: 'pane-1', repository: 'apps/web' },
    })
    await wrapper.get('[data-testid="git-command-log-heading"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="git-command-log-row"]')).toHaveLength(2)

    // 步骤2：取消运行中命令，后端收到不可混淆的命令 ID。
    await wrapper.get('[data-testid="git-command-cancel"]').trigger('click')
    await flushPromises()
    expect(commandLogMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-command-cancel?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'command-running' }),
      })
    )
  })
})

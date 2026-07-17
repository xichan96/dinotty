import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitDiffViewer from '../components/workspace/GitDiffViewer.vue'
import GitPanel from '../components/workspace/GitPanel.vue'

const gitPanelMocks = vi.hoisted(function createGitPanelMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: gitPanelMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const files = [
  {
    path: 'src/working.ts',
    status: 'modified',
    indexStatus: ' ',
    worktreeStatus: 'M',
    staged: false,
    unstaged: true,
    conflict: false,
  },
  {
    path: 'src/staged.ts',
    status: 'staged_modified',
    indexStatus: 'M',
    worktreeStatus: ' ',
    staged: true,
    unstaged: false,
    conflict: false,
  },
  {
    path: 'src/both.ts',
    status: 'modified',
    indexStatus: 'M',
    worktreeStatus: 'M',
    staged: true,
    unstaged: true,
    conflict: false,
  },
  {
    path: 'notes/new file.md',
    status: 'untracked',
    indexStatus: '?',
    worktreeStatus: '?',
    staged: false,
    unstaged: true,
    conflict: false,
  },
  {
    path: 'src/added.ts',
    status: 'staged_new',
    indexStatus: 'A',
    worktreeStatus: ' ',
    staged: true,
    unstaged: false,
    conflict: false,
  },
]

function mountGitPanel(): VueWrapper {
  // 步骤1：使用同时包含暂存和未暂存状态的数据挂载 Git 面板。
  return mount(GitPanel, {
    props: {
      paneId: 'pane-1',
      branch: 'feature/git-panel',
      isGitRepo: true,
      loading: false,
      files,
    },
  })
}

function findRow(wrapper: VueWrapper, testId: string, path: string): DOMWrapper<Element> {
  // 步骤1：按分组和完整路径查找指定变更行。
  const rows = wrapper.findAll(`[data-testid="${testId}"]`)
  const row = rows.find(function matchesPath(candidate) {
    return candidate.attributes('data-path') === path
  })
  if (!row) {
    throw new Error(`Missing Git row: ${path}`)
  }
  return row
}

describe('GitPanel', function gitPanelSuite() {
  beforeEach(function resetGitPanelMocks() {
    // 步骤1：每个用例使用独立的成功接口响应。
    gitPanelMocks.authFetch.mockReset()
    gitPanelMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  it('groups staged and working tree changes without losing dual-state files', function groupsFiles() {
    // 步骤1：挂载面板并检查分支名称。
    const wrapper = mountGitPanel()
    expect(wrapper.get('[data-testid="git-branch-name"]').text()).toBe('feature/git-panel')

    // 步骤2：同时修改了暂存区和工作区的文件必须出现在两个分组中。
    expect(wrapper.findAll('[data-testid="git-staged-row"]')).toHaveLength(3)
    expect(wrapper.findAll('[data-testid="git-change-row"]')).toHaveLength(3)
    expect(findRow(wrapper, 'git-staged-row', 'src/both.ts').exists()).toBe(true)
    expect(findRow(wrapper, 'git-change-row', 'src/both.ts').exists()).toBe(true)

    // 步骤3：新增文件使用 Git 常见的 A 标记，与未跟踪文件的 U 区分。
    expect(findRow(wrapper, 'git-staged-row', 'src/added.ts').get('.git-status-mark').text()).toBe(
      'A'
    )
  })

  it('stages and unstages individual files through workspace Git APIs', async function changesStage() {
    // 步骤1：暂存一个工作区文件并核对请求内容。
    const wrapper = mountGitPanel()
    const workingRow = findRow(wrapper, 'git-change-row', 'src/working.ts')
    await workingRow.get('[data-testid="git-stage-button"]').trigger('click')
    await flushPromises()
    expect(gitPanelMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-stage?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['src/working.ts'] }),
      })
    )

    // 步骤2：取消暂存另一个文件并要求父级刷新状态。
    const stagedRow = findRow(wrapper, 'git-staged-row', 'src/staged.ts')
    await stagedRow.get('[data-testid="git-unstage-button"]').trigger('click')
    await flushPromises()
    expect(gitPanelMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-unstage?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['src/staged.ts'] }),
      })
    )
    expect(wrapper.emitted('refresh')).toHaveLength(2)
  })

  it('commits staged changes with the entered message', async function commitsChanges() {
    // 步骤1：输入提交说明并执行提交。
    const wrapper = mountGitPanel()
    await wrapper.get('[data-testid="git-commit-message"]').setValue('新增 Git 管理面板')
    await wrapper.get('[data-testid="git-commit-button"]').trigger('click')
    await flushPromises()

    // 步骤2：确认提交说明原样发送，成功后清空输入框。
    expect(gitPanelMocks.authFetch).toHaveBeenLastCalledWith(
      '/api/workspace/git-commit?pane_id=pane-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: '新增 Git 管理面板' }),
      })
    )
    expect(wrapper.get<HTMLInputElement>('[data-testid="git-commit-message"]').element.value).toBe(
      ''
    )
  })
})

describe('GitDiffViewer', function gitDiffViewerSuite() {
  beforeEach(function resetDiffMocks() {
    // 步骤1：返回一段包含上下文、删除和新增行的统一差异。
    gitPanelMocks.authFetch.mockReset()
    gitPanelMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          patch: 'diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-old value\n+new value\n context',
        }),
        { status: 200 }
      )
    )
  })

  it('renders added and removed lines and can open the source file', async function rendersPatch() {
    // 步骤1：挂载差异查看器并等待接口返回。
    const wrapper = mount(GitDiffViewer, {
      props: {
        paneId: 'pane-1',
        filePath: 'src/a.ts',
        staged: false,
        untracked: false,
      },
    })
    await flushPromises()

    // 步骤2：检查增删行样式和打开源码事件。
    expect(wrapper.get('.git-diff-line-removed').text()).toContain('-old value')
    expect(wrapper.get('.git-diff-line-added').text()).toContain('+new value')
    await wrapper.get('[data-testid="git-diff-open-source"]').trigger('click')
    expect(wrapper.emitted('open-source')).toEqual([['src/a.ts']])
  })
})

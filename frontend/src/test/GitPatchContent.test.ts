import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GitPatchContent from '../components/workspace/GitPatchContent.vue'

function mountPatch(patch: string) {
  // 步骤1：使用稳定的状态文字挂载共享 Patch 组件。
  return mount(GitPatchContent, {
    props: {
      loading: false,
      error: '',
      patch,
      loadingText: 'Loading',
      emptyText: 'Empty',
      diffLabel: 'Diff',
    },
  })
}

describe('GitPatchContent', function gitPatchContentSuite() {
  it('shows change counts and filters lines by text', async function filtersPatchLines() {
    // 步骤1：挂载包含两条新增和一条删除的 Patch。
    const wrapper = mountPatch(
      'diff --git a/a.ts b/a.ts\n@@ -1,2 +1,3 @@\n-old value\n+new value\n+extra value\n context'
    )
    expect(wrapper.get('[data-testid="git-diff-stats"]').text()).toContain('+2')
    expect(wrapper.get('[data-testid="git-diff-stats"]').text()).toContain('-1')

    // 步骤2：搜索 extra 后只保留匹配行。
    await wrapper.get('[data-testid="git-diff-search"]').setValue('extra')
    const renderedLines = wrapper.findAll('.git-diff-line')
    expect(renderedLines).toHaveLength(1)
    expect(renderedLines[0].text()).toContain('+extra value')
  })

  it('renders a large patch in batches', async function rendersPatchInBatches() {
    // 步骤1：构造超过首批渲染上限的新增行。
    const patchLines = ['@@ -0,0 +1,2100 @@']
    for (let index = 0; index < 2100; index += 1) {
      patchLines.push(`+line ${index}`)
    }
    const wrapper = mountPatch(patchLines.join('\n'))
    expect(wrapper.findAll('.git-diff-line')).toHaveLength(2000)

    // 步骤2：点击加载更多后显示剩余内容。
    await wrapper.get('[data-testid="git-diff-load-more"]').trigger('click')
    expect(wrapper.findAll('.git-diff-line')).toHaveLength(2101)
  })

  it('switches between inline and side by side layouts', async function switchesDiffLayout() {
    // 步骤1：挂载包含替换内容的 Patch，默认使用行内布局。
    const wrapper = mountPatch(
      'diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-old value\n+new value\n context'
    )
    expect(wrapper.get('[data-testid="git-diff-inline-view"]').attributes('aria-pressed')).toBe(
      'true'
    )

    // 步骤2：切换到双栏布局，确认旧内容和新内容分别位于左右两侧。
    await wrapper.get('[data-testid="git-diff-split-view"]').trigger('click')
    expect(wrapper.get('[data-testid="git-diff-split-view"]').attributes('aria-pressed')).toBe(
      'true'
    )
    expect(wrapper.get('.git-diff-split-old').text()).toContain('-old value')
    expect(wrapper.get('.git-diff-split-new').text()).toContain('+new value')
    expect(wrapper.get('.git-diff-split-side-removed').text()).toContain('-old value')
    expect(wrapper.get('.git-diff-split-side-added').text()).toContain('+new value')
    expect(wrapper.findAll('.git-diff-split-side-context')).toHaveLength(2)
  })

  it('emits an action for the selected hunk', async function emitsHunkAction() {
    // 步骤1：为工作区差异启用暂存和撤销操作。
    const wrapper = mount(GitPatchContent, {
      props: {
        loading: false,
        error: '',
        patch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old value\n+new value',
        loadingText: 'Loading',
        emptyText: 'Empty',
        diffLabel: 'Diff',
        stageHunkText: 'Stage hunk',
        discardHunkText: 'Discard hunk',
        canStageHunks: true,
        canDiscardHunks: true,
      },
    })

    // 步骤2：点击第一个 hunk 的暂存按钮，确认组件发出明确的序号和动作。
    await wrapper.get('[data-testid="git-diff-stage-hunk"]').trigger('click')
    expect(wrapper.emitted('hunk-action')).toEqual([[0, 'stage']])
  })
})

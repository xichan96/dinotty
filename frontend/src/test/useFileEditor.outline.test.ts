import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useFileEditor } from '../composables/useFileEditor'
import { flattenOutline } from '../utils/outlineTree'

vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
  getAuthToken: () => '',
}))

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for markdown outline')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()
  }
}

describe('useFileEditor markdown outline', () => {
  it('produces heading items from the same lexer pass as the preview HTML', async () => {
    const editor = useFileEditor({
      paneId: () => 'pane-1',
      selectedRel: ref<string | null>('docs/readme.md'),
      selectedIsDir: ref(false),
      meta: ref({ kind: 'markdown', content: '' }),
    })

    editor.editorText.value = '# One\n\n## Two\n'
    await waitFor(() => editor.markdownOutline.value !== null)

    expect(editor.markdownEditorHtml.value).toContain('<h1')
    expect(editor.markdownOutlineSource.value).toBe('# One\n\n## Two\n')
    expect(
      flattenOutline(editor.markdownOutline.value ?? []).map((entry) => [
        entry.item.label,
        entry.item.line,
      ])
    ).toEqual([
      ['One', 1],
      ['Two', 3],
    ])
  })
})

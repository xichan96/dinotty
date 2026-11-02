import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { authFetch } from '../composables/apiBase'
import { useFileEditor } from '../composables/useFileEditor'

vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
}))

const fetchMock = vi.mocked(authFetch)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function editorFor(filePath: string) {
  return useFileEditor({
    paneId: () => 'pane-1',
    selectedRel: ref<string | null>(filePath),
    selectedIsDir: ref(false),
    meta: ref({ kind: 'text', content: '' }),
  })
}

describe('useFileEditor.saveEditor', () => {
  it('returns the path and content captured before the request settles', async () => {
    const selectedRel = ref<string | null>('a.ts')
    const editor = useFileEditor({
      paneId: () => 'pane-1',
      selectedRel,
      selectedIsDir: ref(false),
      meta: ref({ kind: 'text', content: '' }),
    })
    editor.editorBaseline.value = ''
    editor.editorText.value = 'first buffer'

    const pending = deferred<Response>()
    fetchMock.mockReturnValue(pending.promise as never)
    const save = editor.saveEditor()

    // The user switches tabs while the PUT is in flight.
    selectedRel.value = 'b.ts'
    editor.editorText.value = 'second buffer'

    pending.resolve({ ok: true } as Response)
    const result = await save

    expect(result).toEqual({ filePath: 'a.ts', content: 'first buffer' })
    // The composable no longer commits baselines itself; the tab-aware caller
    // does, so a late response cannot clear the newly active tab's dirty flag.
    expect(editor.editorBaseline.value).toBe('')
    expect(editor.editorDirty.value).toBe(true)
  })

  it('does not issue a request when the buffer is clean', async () => {
    const editor = editorFor('a.ts')
    editor.editorBaseline.value = 'same'
    editor.editorText.value = 'same'
    fetchMock.mockClear()

    expect(await editor.saveEditor()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

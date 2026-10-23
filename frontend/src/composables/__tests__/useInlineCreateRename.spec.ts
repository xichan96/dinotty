import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useInlineCreateRename } from '../useInlineCreateRename'
import { authFetch } from '../apiBase'
import type { DirEntry } from '../../components/workspace/TreeRows'

vi.mock('../apiBase', () => ({
  getApiBase: vi.fn(async () => {}),
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function setup() {
  const selectedRel = ref<string | null>(null)
  const selectedIsDir = ref(false)
  const childCache = ref<Record<string, DirEntry[]>>({})
  const ensureChildren = vi.fn(async () => {})
  const onSelectFile = vi.fn(async () => {})
  const onSelectDir = vi.fn()
  const api = useInlineCreateRename({
    paneId: ref('pane'),
    cwdLabel: ref('/root'),
    selectedRel,
    selectedIsDir,
    childCache,
    expanded: ref(new Set<string>()),
    parentRelPath: (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''),
    ensureChildren,
    onSelectFile,
    onSelectDir,
    t: (key: string) => key,
  })
  return { api, childCache, ensureChildren, onSelectFile, onSelectDir }
}

describe('useInlineCreateRename', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset()
  })

  it('keeps the typed name and shows an inline error on 409', async () => {
    const { api } = setup()
    api.startNewFile()
    vi.mocked(authFetch).mockResolvedValueOnce(jsonResponse(409, { error: 'already exists' }))

    await api.onInlineCreateCommit('notes.txt')

    expect(api.inlineCreate.value).toMatchObject({
      parentRel: '',
      kind: 'file',
      value: 'notes.txt',
      error: 'filePreview.errFileExists',
    })
  })

  it('keeps the name on a network failure instead of closing the row', async () => {
    const { api } = setup()
    api.startNewFolder()
    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await api.onInlineCreateCommit('assets')

    expect(api.inlineCreate.value).toMatchObject({
      value: 'assets',
      error: 'filePreview.errNetwork',
    })
  })

  it('closes the row and selects the created file on success', async () => {
    const { api, onSelectFile } = setup()
    api.startNewFile()
    vi.mocked(authFetch).mockResolvedValueOnce(jsonResponse(200, { rel: 'notes.txt' }))

    await api.onInlineCreateCommit('notes.txt')

    expect(api.inlineCreate.value).toBeNull()
    expect(onSelectFile).toHaveBeenCalledWith('notes.txt')
  })

  it('keeps rename input and original relation open on conflict', async () => {
    const { api } = setup()
    api.inlineRename.value = { rel: 'src/a.ts', isDir: false, value: 'a.ts', error: '' }
    vi.mocked(authFetch).mockResolvedValueOnce(jsonResponse(409, { error: 'already exists' }))

    await api.onInlineRenameCommit('b.ts')

    expect(api.inlineRename.value).toMatchObject({
      rel: 'src/a.ts',
      value: 'b.ts',
      error: 'filePreview.errRenameExists',
    })
  })

  it('treats an unchanged rename as a no-op without a request', async () => {
    const { api } = setup()
    api.inlineRename.value = { rel: 'src/a.ts', isDir: false, value: 'a.ts', error: '' }

    await api.onInlineRenameCommit('a.ts')

    expect(authFetch).not.toHaveBeenCalled()
    expect(api.inlineRename.value).toBeNull()
  })

  it('does not resurrect a cancelled create when the response lands', async () => {
    const { api } = setup()
    api.startNewFile()
    let resolve!: (res: Response) => void
    vi.mocked(authFetch).mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))

    const pending = api.onInlineCreateCommit('late.txt')
    api.onInlineCreateCancel()
    resolve(jsonResponse(200, { rel: 'late.txt' }))
    await pending

    expect(api.inlineCreate.value).toBeNull()
  })
})

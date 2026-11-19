import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../components/workspace/TreeRows'

const mocks = vi.hoisted(() => ({
  postMultipart: vi.fn(),
  getApiBase: vi.fn(async () => 'http://127.0.0.1:7681'),
  apiUrl: vi.fn((p: string) => p),
  uiConfirm: vi.fn(async () => true),
  uiAlert: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  getApiBase: mocks.getApiBase,
  apiUrl: mocks.apiUrl,
  getAuthToken: () => 'token',
}))

vi.mock('../composables/useUpload', () => ({
  postMultipartWithProgress: mocks.postMultipart,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
  tauriInvoke: vi.fn(),
}))

vi.mock('../composables/useSettings', () => ({
  settings: { upload_file_cap_mb: 1 },
}))

vi.mock('../composables/useConfirm', () => ({
  uiConfirm: mocks.uiConfirm,
}))

vi.mock('../composables/useAlert', () => ({
  uiAlert: mocks.uiAlert,
}))

import { useFileOperations } from '../composables/useFileOperations'

const t = (key: string, params?: Record<string, string | number>) => {
  const table: Record<string, string> = {
    'fileOps.uploadTooLargeMany': '{count} files exceed {size}. Skip them and continue?',
    'fileOps.uploadTooLargeTitle': 'File too large',
    'fileOps.uploadSkip': 'Skip & Continue',
    'fileOps.uploadCancel': 'Cancel',
    'fileOps.uploadRejected': 'Upload rejected: {detail}',
    'fileOps.uploadTooLargeDetail': 'a file exceeds the size limit of {size}',
    'fileOps.uploadFailedTitle': 'Upload failed',
    'fileOps.downloadFailedTitle': 'Download failed',
  }
  let msg = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) msg = msg.replace(`{${k}}`, String(v))
  }
  return msg
}

function makeOps() {
  return {
    paneId: () => 'p1',
    selectedRel: ref<string | null>(null),
    selectedIsDir: ref(false),
    meta: ref<{ kind: string } | null>(null),
    childCache: ref<Record<string, DirEntry[]>>({}),
    expanded: ref<Set<string>>(new Set()),
    inlineCreate: ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null),
    cwdLabel: ref('/root'),
    ensureChildren: vi.fn(async () => {}),
    emit: vi.fn(),
    t,
  }
}

function makeFiles() {
  const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.bin')
  const small = new File(['a'], 'small.txt')
  return [
    { file: big, path: 'big.bin' },
    { file: small, path: 'small.txt' },
  ]
}

beforeEach(() => {
  mocks.postMultipart.mockReset()
  mocks.postMultipart.mockResolvedValue({
    status: 200,
    bodyText: JSON.stringify({ saved: ['small.txt'], errors: [] }),
  })
  mocks.uiConfirm.mockReset()
  mocks.uiConfirm.mockResolvedValue(true)
  mocks.uiAlert.mockReset()
})

describe('useFileOperations upload size limit', () => {
  it('aborts the upload when the user declines the oversize confirm', async () => {
    mocks.uiConfirm.mockResolvedValue(false)
    const ops = useFileOperations(makeOps())

    await ops.uploadFiles(makeFiles())

    expect(mocks.uiConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.postMultipart).not.toHaveBeenCalled()
  })

  it('filters oversized files and uploads the rest when the user confirms skip', async () => {
    const ops = useFileOperations(makeOps())

    await ops.uploadFiles(makeFiles())

    expect(mocks.uiConfirm).toHaveBeenCalledTimes(1)
    // One request per file: the oversized file was dropped, so only one call.
    expect(mocks.postMultipart).toHaveBeenCalledTimes(1)
    const fd = mocks.postMultipart.mock.calls[0][1] as FormData
    expect(fd.getAll('file')).toHaveLength(1)
    const names = fd.getAll('file').map((f) => (f as File).name)
    expect(names).toEqual(['small.txt'])
    expect(fd.get('path')).toBe('small.txt')
  })

  it('maps a 413 response to the localized rejected message', async () => {
    mocks.postMultipart.mockResolvedValue({
      status: 413,
      bodyText: JSON.stringify({ error: "file 'big.bin' exceeds upload size limit of 1 MB" }),
    })
    const ops = useFileOperations(makeOps())

    await ops.uploadFiles(makeFiles())

    expect(mocks.uiAlert).toHaveBeenCalledTimes(1)
    expect(mocks.uiAlert.mock.calls[0][0]).toBe(
      "Upload rejected: file 'big.bin' exceeds upload size limit of 1 MB"
    )
  })

  it('leaves per-field server errors unchanged', async () => {
    mocks.postMultipart.mockResolvedValue({
      status: 200,
      bodyText: JSON.stringify({ saved: [], errors: ['write small.txt: disk error'] }),
    })
    const ops = useFileOperations(makeOps())

    await ops.uploadFiles(makeFiles())

    expect(mocks.uiAlert.mock.calls[0][0]).toBe('Upload failed:\nwrite small.txt: disk error')
  })
})

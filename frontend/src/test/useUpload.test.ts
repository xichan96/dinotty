import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadMocks = vi.hoisted(() => ({
  tauri: false,
  authFetch: vi.fn(),
  authHeaders: vi.fn(() => ({})),
  relayCsrfHeaders: vi.fn((_method?: string): Record<string, string> => ({})),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => uploadMocks.tauri,
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: uploadMocks.authFetch,
  authHeaders: uploadMocks.authHeaders,
  relayCsrfHeaders: (method?: string) => uploadMocks.relayCsrfHeaders(method),
}))

import { formatMB, useUpload, uploadErrorStatus } from '../composables/useUpload'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}

describe('useUpload', () => {
  beforeEach(() => {
    uploadMocks.tauri = false
    uploadMocks.authFetch.mockReset()
    uploadMocks.authHeaders.mockReset()
    uploadMocks.authHeaders.mockReturnValue({})
    uploadMocks.relayCsrfHeaders.mockReset()
    uploadMocks.relayCsrfHeaders.mockReturnValue({})
    vi.unstubAllGlobals()
  })

  it('posts FormData with file0-style field names and returns the parsed response', async () => {
    uploadMocks.authFetch.mockResolvedValue(jsonResponse({ ok: true, saved: ['/u/a', '/u/b'] }))
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]

    const data = await useUpload().uploadFiles(files)

    expect(data.saved).toEqual(['/u/a', '/u/b'])
    expect(uploadMocks.authFetch).toHaveBeenCalledWith('/api/uploads', {
      method: 'POST',
      body: expect.any(FormData),
    })
    const body = uploadMocks.authFetch.mock.calls[0][1].body as FormData
    expect((body.get('file0') as File).name).toBe('a.txt')
    expect((body.get('file1') as File).name).toBe('b.txt')
  })

  it('throws status on non-OK upload responses', async () => {
    uploadMocks.authFetch.mockResolvedValue(jsonResponse({ ok: false }, 413))

    await expect(useUpload().uploadFiles([new File(['x'], 'x.bin')])).rejects.toEqual({
      status: 413,
    })
    await expect(
      useUpload().uploadFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])
    ).rejects.toEqual({ status: 413 })
    expect(uploadErrorStatus({ status: 413 })).toBe(413)
  })

  it('throws immediately under Tauri without posting FormData', async () => {
    uploadMocks.tauri = true

    await expect(useUpload().uploadFiles([new File(['x'], 'x.bin')])).rejects.toEqual({
      status: 400,
      reason: 'multipart-unsupported-in-tauri',
    })
    expect(uploadMocks.authFetch).not.toHaveBeenCalled()
  })

  it('synthesizes png names for nameless pasted image blobs', async () => {
    uploadMocks.authFetch.mockResolvedValue(jsonResponse({ ok: true, saved: [] }))
    const empty = new File(['a'], '', { type: 'image/png' })
    const blank = new File(['b'], '  ', { type: 'image/png' })

    await useUpload().uploadFiles([empty, blank], { synthesizeNames: true })

    const body = uploadMocks.authFetch.mock.calls[0][1].body as FormData
    expect((body.get('file0') as File).name).toMatch(/^pasted-image-\d+-0-[a-z0-9-]+\.png$/)
    expect((body.get('file1') as File).name).toMatch(/^pasted-image-\d+-1-[a-z0-9-]+\.png$/)
  })

  it('uses XMLHttpRequest progress when onProgress is supplied', async () => {
    const progress = vi.fn()
    const requests: MockXHR[] = []
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends MockXHR {
        constructor() {
          super()
          requests.push(this)
        }
      }
    )

    const data = await useUpload().uploadFiles([new File(['x'], 'x.bin')], {
      onProgress: progress,
    })

    expect(data.saved).toEqual(['/tmp/x.bin'])
    expect(uploadMocks.authFetch).not.toHaveBeenCalled()
    expect(progress).toHaveBeenCalledWith({ loaded: 50, total: 100 })
    expect(progress).toHaveBeenCalledWith({ loaded: 100, total: 100 })
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('/api/uploads')
    // Browser mode: uses withCredentials for cookie-based auth, no Bearer header.
    expect(requests[0].withCredentials).toBe(true)
    expect(requests[0].headers.Authorization).toBeUndefined()
  })

  it('carries the relay CSRF header on the XMLHttpRequest branch', async () => {
    uploadMocks.relayCsrfHeaders.mockReturnValue({ 'X-Dinotty-Relay': '1' })
    const requests: MockXHR[] = []
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends MockXHR {
        constructor() {
          super()
          requests.push(this)
        }
      }
    )

    await useUpload().uploadFiles([new File(['x'], 'x.bin')], { onProgress: vi.fn() })

    expect(uploadMocks.relayCsrfHeaders).toHaveBeenCalledWith('POST')
    expect(requests[0].headers['X-Dinotty-Relay']).toBe('1')
  })

  it('formats raw byte counts as one-decimal MB values', () => {
    expect(formatMB(1572864)).toBe('1.5')
  })

  it('throws status from the XMLHttpRequest branch on non-2xx responses', async () => {
    MockXHR.nextStatus = 507
    MockXHR.nextResponseText = JSON.stringify({ ok: false })
    vi.stubGlobal('XMLHttpRequest', MockXHR)

    await expect(
      useUpload().uploadFiles([new File(['x'], 'x.bin')], { onProgress: vi.fn() })
    ).rejects.toEqual({ status: 507 })
  })
})

class MockXHR {
  static nextStatus = 200
  static nextResponseText = JSON.stringify({ ok: true, saved: ['/tmp/x.bin'] })
  upload: { onprogress: ((ev: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = MockXHR.nextStatus
  responseText = MockXHR.nextResponseText
  withCredentials = false
  method = ''
  url = ''
  headers: Record<string, string> = {}

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }

  send() {
    this.status = MockXHR.nextStatus
    this.responseText = MockXHR.nextResponseText
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)
    this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 } as ProgressEvent)
    this.onload?.()
    MockXHR.nextStatus = 200
    MockXHR.nextResponseText = JSON.stringify({ ok: true, saved: ['/tmp/x.bin'] })
  }
}

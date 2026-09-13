import { apiUrl, authFetch, authHeaders, relayCsrfHeaders } from './apiBase'
import { isTauri } from './useTransport'

import type { UploadResponse } from '../types/uploads'

export interface UploadProgress {
  loaded: number
  total: number
}

interface UploadOptions {
  synthesizeNames?: boolean
  onProgress?: (p: UploadProgress) => void
}

export function formatMB(bytes: number) {
  return (bytes / 1048576).toFixed(1)
}

function extFromMime(mime: string) {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpeg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

function randomSuffix() {
  return crypto.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
}

function fileForUpload(file: File, index: number, opts?: UploadOptions) {
  if (!opts?.synthesizeNames || file.name.trim() !== '') return file
  const synthName = `pasted-image-${Date.now()}-${index}-${randomSuffix()}.${extFromMime(file.type)}`
  return new File([file], synthName, { type: file.type })
}

export function uploadErrorStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err && 'status' in err ? Number((err as any).status) : undefined
}

export function useUpload() {
  async function uploadFiles(files: File[], opts?: UploadOptions): Promise<UploadResponse> {
    if (isTauri()) throw { status: 400, reason: 'multipart-unsupported-in-tauri' }
    const fd = new FormData()
    files.forEach((file, i) => {
      const uploadFile = fileForUpload(file, i, opts)
      fd.append(`file${i}`, uploadFile, uploadFile.name)
    })
    if (opts?.onProgress) {
      return await uploadWithProgress(fd, opts.onProgress)
    }
    const res = await authFetch(apiUrl('/api/uploads'), { method: 'POST', body: fd })
    if (!res.ok) throw { status: res.status }
    return (await res.json()) as UploadResponse
  }

  return { uploadFiles, uploadErrorStatus }
}

function uploadWithProgress(
  fd: FormData,
  onProgress: (p: UploadProgress) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    // `XMLHttpRequest` is not defined when a caller passes `onProgress` in the
    // desktop app — `uploadFiles` rejects Tauri earlier. Guarded so the failure
    // is that rejection rather than a ReferenceError about a missing global.
    if (typeof XMLHttpRequest === 'undefined') {
      reject({ status: 400, reason: 'multipart-unsupported-in-tauri' })
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/api/uploads'))
    if (isTauri()) {
      Object.entries(authHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value))
    } else {
      xhr.withCredentials = true
    }
    // POST on the active server: the relay gates every mutating method, and
    // this path bypasses `authFetch` (XHR is what gives us upload progress).
    Object.entries(relayCsrfHeaders('POST')).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value)
    )
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || ev.total <= 0) return
      onProgress({ loaded: ev.loaded, total: ev.total })
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject({ status: xhr.status })
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText || '{}') as UploadResponse)
      } catch (err) {
        reject(err)
      }
    }
    xhr.onerror = () => reject({ status: xhr.status })
    xhr.send(fd)
  })
}

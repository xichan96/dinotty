import { apiUrl, authFetch, authHeaders, relayCsrfHeaders } from './apiBase'
import { isTauri } from './useTransport'
import {
  addTask as addUploadTask,
  finishTask as finishUploadTask,
  runWithConcurrency,
  setTaskStatus as setUploadTaskStatus,
  updateTaskProgress as updateUploadTaskProgress,
} from './useUploadTracker'

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

export interface MultipartResult {
  status: number
  bodyText: string
}

/**
 * POST a multipart body with upload progress. `fetch` has no upload-progress
 * event, so XHR is deliberate here. Shared by the managed upload endpoint and
 * the workspace upload endpoint so auth/CSRF handling lives in one place.
 */
export function postMultipartWithProgress(
  url: string,
  fd: FormData,
  onProgress?: (p: UploadProgress) => void
): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    // XHR is not defined in the desktop webview; callers reject Tauri earlier,
    // but guard anyway so the failure is that rejection, not a ReferenceError.
    if (typeof XMLHttpRequest === 'undefined') {
      reject({ status: 400, reason: 'multipart-unsupported-in-tauri' })
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
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
      onProgress?.({ loaded: ev.loaded, total: ev.total })
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject({ status: xhr.status })
        return
      }
      resolve({ status: xhr.status, bodyText: xhr.responseText || '' })
    }
    xhr.onerror = () => reject({ status: xhr.status })
    xhr.send(fd)
  })
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

  /**
   * Same endpoint, but one request per file so every dropped file gets its own
   * tracker row and its own progress bar. The returned shape matches
   * `uploadFiles`, so callers do not need to know how many requests were made.
   */
  async function uploadFilesOneByOne(
    files: File[],
    opts?: UploadOptions
  ): Promise<UploadResponse & { errors?: string[] }> {
    if (isTauri()) throw { status: 400, reason: 'multipart-unsupported-in-tauri' }
    const prepared = files.map((file, i) => fileForUpload(file, i, opts))
    const grandTotal = prepared.reduce((sum, file) => sum + file.size, 0)
    const taskIds = prepared.map((file) => addUploadTask(file.name, file.size))
    const loadedPerFile = new Array<number>(prepared.length).fill(0)
    let loadedSum = 0
    const saved: string[] = []
    const errors: string[] = []
    let firstError: unknown

    await runWithConcurrency(prepared, 3, async (file, i) => {
      setUploadTaskStatus(taskIds[i], 'uploading')
      const fd = new FormData()
      fd.append('file0', file, file.name)
      try {
        const res = await postMultipartWithProgress(apiUrl('/api/uploads'), fd, (p) => {
          loadedPerFile[i] = p.loaded
          loadedSum = loadedPerFile.reduce((a, b) => a + b, 0)
          updateUploadTaskProgress(taskIds[i], p.loaded, p.total)
          opts?.onProgress?.({ loaded: loadedSum, total: grandTotal })
        })
        if (res.status < 200 || res.status >= 300) throw { status: res.status }
        const data = JSON.parse(res.bodyText || '{}') as UploadResponse
        ;(data.saved ?? []).forEach((path) => saved.push(path))
        // An empty file produces no progress events; still show the phase.
        setUploadTaskStatus(taskIds[i], 'processing')
        finishUploadTask(taskIds[i], true)
      } catch (err) {
        firstError ??= err
        const status = uploadErrorStatus(err)
        const message = status ? `HTTP ${status}` : String(err)
        errors.push(message)
        finishUploadTask(taskIds[i], false, message)
      }
    })

    // Nothing succeeded: preserve the old all-or-nothing rejection so the
    // existing error toasts still fire. Partial failures come back in `errors`.
    if (errors.length && !saved.length) throw firstError
    return { saved, ...(errors.length ? { errors } : {}) }
  }

  return { uploadFiles, uploadFilesOneByOne, uploadErrorStatus }
}

function uploadWithProgress(fd: FormData, onProgress: (p: UploadProgress) => void) {
  return postMultipartWithProgress(apiUrl('/api/uploads'), fd, onProgress).then(
    ({ status, bodyText }) => {
      if (status < 200 || status >= 300) throw { status }
      return JSON.parse(bodyText || '{}') as UploadResponse
    }
  )
}

import { isTauri, tauriInvoke } from './useTransport'
import { escapeShellPath } from '../utils/tauriDragDrop'

export interface DropHost {
  sendData(data: string, force?: boolean): void
  onFileUpload?(files: File[]): void
}

/**
 * On macOS WKWebView, the HTML5 DataTransfer hides non-text drag types from
 * JS - so a VSCode file-tree drag (which exposes `public.file-url` on
 * NSDragPboard) shows up with empty `dt.files` and a `text/plain` that
 * `getData` refuses to return. Drop into Rust and read NSDragPboard
 * directly. Returns `[]` on non-Tauri or non-macOS.
 */
async function readDragPboard(): Promise<string[]> {
  if (!isTauri()) return []
  try {
    const result = await tauriInvoke('tauri_read_drag_pboard')
    return Array.isArray(result) ? result.filter((p) => typeof p === 'string' && p.length > 0) : []
  } catch {
    return []
  }
}

/**
 * Wires HTML5 drag/drop and clipboard-paste upload. Returns a single cleanup
 * function that tears all of it down.
 */
export function setupTerminalDrop(
  wrapper: HTMLElement,
  host: DropHost
): () => void {
  const cleanups: Array<() => void> = []

  const xtermEl = wrapper.querySelector('.xterm') as HTMLElement
  const target = xtermEl || wrapper

  const dragoverHandler = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e as DragEvent).dataTransfer!.dropEffect = 'copy'
  }
  target.addEventListener('dragover', dragoverHandler, true)
  cleanups.push(() => target.removeEventListener('dragover', dragoverHandler, true))

  const dropHandler = async (e: Event) => {
    const de = e as DragEvent
    const dt = de.dataTransfer!
    de.preventDefault()
    de.stopPropagation()
    const types = Array.from(dt.types)
    const files = Array.from(dt.files ?? []) as any[]
    const paths: string[] = []

    // Drop is a user-confirmed action aimed at THIS terminal - bypass the
    // active-pane input guard so the path lands here even if the drag started
    // from another pane (e.g. the file-workspace pane mousedown stole focus).
    const sendPath = (s: string) => host.sendData(s, true)

    // 0. Tauri (macOS WKWebView): read NSDragPboard directly. WKWebView's
    //    DataTransfer sanitizes non-text types, so VSCode's `public.file-url`
    //    drags show up with empty dt.files and unreachable text/plain. This
    //    must run BEFORE the text/plain fallback because WKWebView also hides
    //    text/plain for some drag sources.
    if (isTauri()) {
      const pboardPaths = await readDragPboard()
      if (pboardPaths.length > 0) {
        sendPath(pboardPaths.map(escapeShellPath).join(' '))
        return
      }
    }

    // 1. Tauri WKWebView 在 File 对象上暴露了非标准的 `path`（绝对路径）。
    //    优先取它，否则在桌面端只会拿到 File.name（仅文件名）。
    //    Web 浏览器里 File.path 不存在，会跳过这一步。
    for (const f of files) {
      if (typeof f.path === 'string' && f.path.length > 0) paths.push(f.path)
    }
    if (paths.length > 0) {
      sendPath(paths.map(escapeShellPath).join(' '))
      return
    }

    // 2. text/plain 绝对路径（Web 端 VSCode 等编辑器拖文件树时给出的是绝对路径）。
    if (types.includes('text/plain')) {
      const text = dt.getData('text/plain').trim()
      const absPlain =
        text &&
        (text.startsWith('/') ||
          /^[A-Za-z]:[\\/]/.test(text) ||
          text.startsWith('\\\\') ||
          text.startsWith('file://'))
      if (absPlain) {
        text.split('\n').forEach((l) => {
          const t = l.trim()
          if (!t) return
          if (t.startsWith('file://')) {
            try {
              paths.push(decodeURIComponent(new URL(t).pathname))
            } catch {}
          } else {
            paths.push(t)
          }
        })
      }
    }

    if (paths.length > 0) {
      sendPath(paths.map(escapeShellPath).join(' '))
      return
    }

    // 3. 没有可解析的路径，走文件上传（保留原行为：桌面拖文件上传到 workspace）。
    if (!isTauri() && (dt.files?.length ?? 0) > 0) {
      host.onFileUpload?.([...dt.files])
      return
    }

    // 4. text/uri-list 解析 file:// URI（如从某些应用拖文件链接但浏览器未填 dt.files）。
    if (types.includes('text/uri-list')) {
      const uriList = dt.getData('text/uri-list')
      uriList.split('\n').forEach((u) => {
        u = u.trim()
        if (!u || u.startsWith('#')) return
        try {
          paths.push(decodeURIComponent(new URL(u).pathname))
        } catch {}
      })
      if (paths.length > 0) {
        sendPath(paths.map(escapeShellPath).join(' '))
        return
      }
    }

    // 5. 最后 fallback：用 File.name（此时 path/abs path 都拿不到，只能贴文件名）。
    if (files.length > 0) {
      const fallback: string[] = []
      for (const f of files) {
        if (f.name) fallback.push(f.name)
      }
      if (fallback.length) sendPath(fallback.map(escapeShellPath).join(' '))
    }
  }
  target.addEventListener('drop', dropHandler, true)
  cleanups.push(() => target.removeEventListener('drop', dropHandler, true))

  // ── Paste upload ────────────────────────────────────────────
  let suppressPasteUpload = false
  let torn = false

  const pasteHandler = (e: ClipboardEvent) => {
    if (suppressPasteUpload) return
    if (isTauri()) return
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    host.onFileUpload?.(files)
  }
  target.addEventListener('paste', pasteHandler, true)

  const keydownHandler = (e: KeyboardEvent) => {
    if (isTauri()) return
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
    const readClipboard = navigator.clipboard?.read
    if (!readClipboard) return
    suppressPasteUpload = true
    setTimeout(() => {
      suppressPasteUpload = false
    }, 0)

    void readClipboard
      .call(navigator.clipboard)
      .then(async (items) => {
        const files = await Promise.all(
          items.flatMap((item) => {
            const type = item.types.find((itemType) => itemType.startsWith('image/'))
            if (!type) return []
            return [
              item.getType(type).then((blob) => {
                const ext = type.split('/')[1]?.split('+')[0] || 'png'
                return new File([blob], `pasted-image-${Date.now()}.${ext}`, { type })
              }),
            ]
          })
        )
        if (!torn && files.length) host.onFileUpload?.(files)
      })
      .catch(() => {
        // Clipboard image reads may be denied; keep normal text paste behavior intact.
      })
  }
  target.addEventListener('keydown', keydownHandler, true)

  cleanups.push(() => {
    torn = true
    target.removeEventListener('paste', pasteHandler, true)
    target.removeEventListener('keydown', keydownHandler, true)
  })

  return () => {
    for (const fn of cleanups) fn()
  }
}

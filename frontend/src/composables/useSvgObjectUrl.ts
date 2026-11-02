import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'

/** Edits are coalesced before a new preview URL is built. */
export const SVG_OBJECT_URL_DEBOUNCE_MS = 250

export interface UseSvgObjectUrlOptions {
  debounceMs?: number
}

/**
 * Turn SVG source text into a `blob:` URL the `<img>` preview can display.
 *
 * The URL is only swapped in after a throwaway `Image()` has decoded it, so the
 * current preview stays visible while an edit is being applied (no blank frame).
 * Superseded and replaced URLs are revoked; disposal revokes whatever is left.
 *
 * Returns `''` when the source is empty or the environment lacks
 * `URL.createObjectURL`, which lets callers fall back to the raw file URL.
 */
export function useSvgObjectUrl(
  source: Ref<string>,
  options: UseSvgObjectUrlOptions = {}
): Ref<string> {
  const debounceMs = options.debounceMs ?? SVG_OBJECT_URL_DEBOUNCE_MS
  const objectUrl = ref('')

  let currentUrl = ''
  const pendingUrls = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Invalidates preloads started before the latest build/clear/dispose. */
  let token = 0
  let disposed = false
  let initialized = false

  function canCreateObjectUrl(): boolean {
    return (
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    )
  }

  function revoke(url: string): void {
    if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
    try {
      URL.revokeObjectURL(url)
    } catch {
      // Revoking is best-effort; a URL may already have been revoked.
    }
  }

  function revokePending(): void {
    for (const url of pendingUrls) revoke(url)
    pendingUrls.clear()
  }

  function clear(): void {
    token += 1
    revokePending()
    const previous = currentUrl
    currentUrl = ''
    objectUrl.value = ''
    revoke(previous)
  }

  function commit(url: string): void {
    if (disposed) {
      revoke(url)
      return
    }
    const previous = currentUrl
    currentUrl = url
    objectUrl.value = url
    if (previous && previous !== url) revoke(previous)
  }

  function switchTo(url: string, owner: number): void {
    // True only when this preload was not already discarded by clear/dispose.
    const wasPending = pendingUrls.delete(url)
    if (disposed || owner !== token) {
      if (wasPending) revoke(url)
      return
    }
    commit(url)
  }

  function preload(url: string, owner: number): void {
    if (typeof Image === 'undefined') {
      switchTo(url, owner)
      return
    }
    const image = new Image()
    const done = (): void => {
      image.onload = null
      image.onerror = null
      // A parse failure still swaps the URL in: the preview then surfaces the
      // broken SVG instead of silently showing the previous drawing.
      switchTo(url, owner)
    }
    image.onload = done
    image.onerror = done
    image.src = url
  }

  function build(text: string): void {
    if (disposed) return
    if (!text || !canCreateObjectUrl()) {
      clear()
      return
    }
    token += 1
    const owner = token
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
    pendingUrls.add(url)
    preload(url, owner)
  }

  watch(
    source,
    (text) => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      // The first value is applied immediately so the initial preview does not
      // wait 250 ms; only subsequent edits are debounced.
      if (!initialized) {
        initialized = true
        build(text)
        return
      }
      timer = setTimeout(() => {
        timer = null
        build(text)
      }, debounceMs)
    },
    { immediate: true }
  )

  function dispose(): void {
    disposed = true
    token += 1
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    revokePending()
    const previous = currentUrl
    currentUrl = ''
    objectUrl.value = ''
    revoke(previous)
  }

  if (getCurrentScope()) onScopeDispose(dispose)

  return objectUrl
}

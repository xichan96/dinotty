/**
 * Pure helpers for tailing log files over HTTP range requests.
 *
 * The viewer keeps a bounded text buffer and tracks the absolute byte offset of
 * the next unread byte. These helpers are deliberately DOM-free (bar the
 * structural scroll check) so they are cheap to unit-test.
 */

/** Distance from the bottom, in pixels, that still counts as "at the bottom". */
export const AUTO_SCROLL_THRESHOLD = 24

export interface ContentRange {
  start: number
  end: number
  total: number
}

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Keep the newest `maxLines` lines, preserving order. */
export function trimLogBuffer(lines: string[], maxLines: number): string[] {
  if (!Number.isFinite(maxLines) || maxLines <= 0) return []
  const limit = Math.floor(maxLines)
  if (lines.length <= limit) return lines
  return lines.slice(lines.length - limit)
}

/**
 * Parse a `Content-Range: bytes START-END/TOTAL` header. Returns `null` for
 * anything else, including the `bytes * /TOTAL` form sent with 416 responses.
 */
export function parseContentRange(header: string | null | undefined): ContentRange | null {
  if (!header) return null
  const match = /^\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/i.exec(header)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    end < start ||
    total <= end
  ) {
    return null
  }
  return { start, end, total }
}

/** True when the scroll container is within the threshold of the bottom. */
export function shouldAutoScroll(element: ScrollMetrics | null | undefined): boolean {
  if (!element) return false
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_THRESHOLD
}

/** UTF-8 byte length of a JS string. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Keep the last `maxBytes` bytes of `text`, starting on a character boundary so
 * the result never begins with a dangling replacement character.
 */
export function truncateUtf8Tail(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  let start = bytes.length - maxBytes
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1
  return new TextDecoder().decode(bytes.subarray(start))
}

/**
 * Drop leading continuation bytes from a slice that started inside a multi-byte
 * UTF-8 character (a suffix range can land mid-character).
 */
export function alignUtf8Start(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length && start < 3 && (bytes[start] & 0xc0) === 0x80) start += 1
  return start === 0 ? bytes : bytes.subarray(start)
}

/** Decode a UTF-8 byte slice, skipping a partial leading character. */
export function decodeUtf8Slice(bytes: Uint8Array): string {
  return new TextDecoder().decode(alignUtf8Start(bytes))
}

/** Split normalized log text into lines, dropping a single trailing newline. */
export function splitLogLines(text: string): string[] {
  if (text === '') return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Keep the newest lines that fit both budgets, trimming whole lines first. */
export function capLogText(
  text: string,
  maxLines: number,
  maxBytes: number
): { text: string; trimmed: boolean } {
  let result = text
  let trimmed = false

  let lines = splitLogLines(result)
  if (lines.length > Math.max(0, Math.floor(maxLines))) {
    lines = trimLogBuffer(lines, maxLines)
    result = lines.join('\n')
    trimmed = true
  }

  if (maxBytes >= 0 && utf8ByteLength(result) > maxBytes) {
    let bytes = 0
    const kept: string[] = []
    const newest = splitLogLines(result)
    for (let index = newest.length - 1; index >= 0; index -= 1) {
      const cost = utf8ByteLength(newest[index]) + (kept.length > 0 ? 1 : 0)
      if (bytes + cost > maxBytes) break
      kept.push(newest[index])
      bytes += cost
    }
    kept.reverse()
    result = kept.length > 0 ? kept.join('\n') : truncateUtf8Tail(result, maxBytes)
    trimmed = true
  }

  return { text: result, trimmed }
}

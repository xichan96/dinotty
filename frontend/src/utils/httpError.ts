function responseDetail(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''

  try {
    const body = JSON.parse(trimmed)
    if (typeof body === 'string') return body
    if (body && typeof body.error === 'string') return body.error
    if (body && typeof body.message === 'string') return body.message
    if (Array.isArray(body) || (body && typeof body === 'object')) return ''
  } catch {
    // Fall through to a bounded plain-text representation.
  }

  return trimmed
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

export async function describeHttpError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '')
  const detail = responseDetail(text)
  const reason = response.statusText.trim()
  const status = `HTTP ${response.status}${reason ? ` ${reason}` : ''}`
  return detail ? `${fallback}: ${detail} (${status})` : `${fallback} (${status})`
}

export function describeRequestError(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail && detail !== '[object Object]' ? `${fallback}: ${detail}` : fallback
}

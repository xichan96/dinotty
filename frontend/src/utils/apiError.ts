export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function apiErrorFromResponse(
  response: Response,
  fallback: string
): Promise<ApiError> {
  const body = record(await response.json().catch(() => null))
  const error = body?.error
  const errorRecord = record(error)
  const code = typeof errorRecord?.code === 'string' ? errorRecord.code : undefined
  let detail = ''
  if (typeof error === 'string') {
    detail = error
  } else if (typeof errorRecord?.message === 'string') {
    detail = errorRecord.message
  } else if (typeof body?.message === 'string') {
    detail = body.message
  }
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  const message = detail ? `${fallback}: ${detail} (${status})` : `${fallback} (${status})`

  return new ApiError(message, response.status, code)
}

export function apiErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.code
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

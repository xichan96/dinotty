import { describe, expect, it } from 'vitest'
import { describeHttpError, describeRequestError } from '../utils/httpError'

describe('describeHttpError', () => {
  it('includes a structured backend error and HTTP status', async () => {
    const response = new Response(JSON.stringify({ error: 'binary entry is missing' }), {
      status: 400,
      statusText: 'Bad Request',
    })
    await expect(describeHttpError(response, 'Install failed')).resolves.toBe(
      'Install failed: binary entry is missing (HTTP 400 Bad Request)'
    )
  })

  it('keeps the status when the server returns an empty JSON collection', async () => {
    const response = new Response('[]', { status: 405, statusText: 'Method Not Allowed' })
    await expect(describeHttpError(response, 'Install failed')).resolves.toBe(
      'Install failed (HTTP 405 Method Not Allowed)'
    )
  })

  it('bounds and flattens non-JSON response text', async () => {
    const response = new Response('<h1>Proxy error</h1>\n<p>upstream unavailable</p>', {
      status: 502,
      statusText: 'Bad Gateway',
    })
    await expect(describeHttpError(response, 'Install failed')).resolves.toBe(
      'Install failed: Proxy error upstream unavailable (HTTP 502 Bad Gateway)'
    )
  })
})

describe('describeRequestError', () => {
  it('shows network failures', () => {
    expect(describeRequestError(new Error('Failed to fetch'), 'Install failed')).toBe(
      'Install failed: Failed to fetch'
    )
  })
})

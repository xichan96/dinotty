import { describe, it, expect } from 'vitest'
import {
  asWorkspaceError,
  makeWorkspaceError,
  withWorkspaceErrorRel,
  workspaceErrorFromResponse,
  workspaceErrorKind,
} from '../useFileWorkspaceBoot'

describe('workspace error helpers', () => {
  it('keeps status and the server error detail', async () => {
    const res = new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
    const err = await workspaceErrorFromResponse(res)
    expect(err.status).toBe(404)
    expect(err.detail).toBe('not found')
    expect(workspaceErrorKind(err)).toBe('notFound')
  })

  it('tolerates non-JSON error bodies', async () => {
    const res = new Response('<html>bad gateway</html>', { status: 502 })
    const err = await workspaceErrorFromResponse(res)
    expect(err.status).toBe(502)
    expect(err.detail).toBe('')
    expect(workspaceErrorKind(err)).toBe('unknown')
  })

  it('maps transport failures to network, not unknown', () => {
    expect(workspaceErrorKind(asWorkspaceError(new TypeError('Failed to fetch')))).toBe('network')
  })

  it('classifies the statuses the UI localizes', () => {
    expect(workspaceErrorKind(makeWorkspaceError(403))).toBe('forbidden')
    expect(workspaceErrorKind(makeWorkspaceError(404))).toBe('notFound')
    expect(workspaceErrorKind(makeWorkspaceError(409))).toBe('conflict')
    expect(workspaceErrorKind(makeWorkspaceError(500))).toBe('unknown')
  })

  it('attaches the directory to an error without replacing the original', () => {
    const err = withWorkspaceErrorRel(makeWorkspaceError(403, 'denied'), 'src/secret')
    expect(err.rel).toBe('src/secret')
    expect(err.detail).toBe('denied')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const authFetch = vi.hoisted(() => vi.fn())

vi.mock('../composables/apiBase', () => ({
  authFetch,
  apiUrl: (path: string) => path,
}))

import { apiCreateTab, apiSplitPane } from '../composables/useTabApi'
import { apiApplyTemplate } from '../composables/useTemplateApi'
import { ApiError } from '../utils/apiError'
import { canFixShellErrorInSettings, shellErrorMessage } from '../utils/shellError'

function shellErrorResponse() {
  return new Response(JSON.stringify({ error: { code: 'wsl_distro_missing' } }), {
    status: 409,
    statusText: 'Conflict',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('typed shell API errors', () => {
  beforeEach(() => {
    authFetch.mockReset()
  })

  it.each([
    ['create tab', () => apiCreateTab()],
    ['split pane', () => apiSplitPane('tab', 'pane', 'horizontal')],
    ['apply template', () => apiApplyTemplate({ template_id: 'template' })],
  ])('preserves the stable error code for %s', async (_name, request) => {
    authFetch.mockResolvedValue(shellErrorResponse())

    const error = await request().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'wsl_distro_missing' })
    expect((error as Error).message).not.toContain('[object Object]')
  })

  it('localizes known shell errors and marks them as settings-actionable', () => {
    const error = new ApiError('request failed', 409, 'wsl_distro_missing')
    const translate = (key: string) =>
      key === 'terminal.sessionError.wsl_distro_missing' ? 'Distribution missing' : key

    expect(shellErrorMessage(error, translate, 'terminal.createFailed')).toBe(
      'Distribution missing'
    )
    expect(canFixShellErrorInSettings(error)).toBe(true)
  })

  it('uses the localized operation fallback for untyped failures', () => {
    const translate = (key: string) =>
      key === 'terminal.createFailed' ? 'Unable to create terminal' : key

    expect(shellErrorMessage(new Error('network'), translate, 'terminal.createFailed')).toBe(
      'Unable to create terminal'
    )
    expect(canFixShellErrorInSettings(new Error('network'))).toBe(false)
  })
})

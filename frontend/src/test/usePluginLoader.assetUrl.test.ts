import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/apiBase', () => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  wsUrlWithToken: (url: string) => url,
}))

import { authFetch } from '../composables/apiBase'
import { usePluginLoader } from '../composables/usePluginLoader'

const authFetchMock = vi.mocked(authFetch)

describe('plugin assetUrl / fetchAsset', () => {
  beforeEach(() => {
    authFetchMock.mockReset()
  })

  it('strips leading ./ from relative path', () => {
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    expect(ctx.assetUrl('./vendor/lib.js')).toBe('/api/plugins/test-plugin/vendor/lib.js')
    expect(ctx.assetUrl('vendor/lib.js')).toBe('/api/plugins/test-plugin/vendor/lib.js')
  })

  it('encodes non-ASCII path segments', () => {
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    expect(ctx.assetUrl('./data/我的文件.json')).toBe(
      '/api/plugins/test-plugin/data/%E6%88%91%E7%9A%84%E6%96%87%E4%BB%B6.json'
    )
  })

  it('encodes each path segment independently', () => {
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    expect(ctx.assetUrl('./a/b/c.js')).toBe('/api/plugins/test-plugin/a/b/c.js')
  })

  it('handles empty path without crashing', () => {
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    expect(ctx.assetUrl('')).toBe('/api/plugins/test-plugin/')
  })

  it('fetchAsset calls authFetch with the built URL', async () => {
    authFetchMock.mockResolvedValue(new Response('ok'))
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    await ctx.fetchAsset('./vendor/lib.js')

    expect(authFetchMock).toHaveBeenCalledOnce()
    expect(authFetchMock).toHaveBeenCalledWith('/api/plugins/test-plugin/vendor/lib.js', undefined)
  })

  it('fetchAsset forwards init to authFetch', async () => {
    authFetchMock.mockResolvedValue(new Response('ok'))
    const ctx = usePluginLoader().getPluginContext('test-plugin')

    await ctx.fetchAsset('./data/grid.json', { method: 'GET' })

    expect(authFetchMock).toHaveBeenCalledWith('/api/plugins/test-plugin/data/grid.json', {
      method: 'GET',
    })
  })
})

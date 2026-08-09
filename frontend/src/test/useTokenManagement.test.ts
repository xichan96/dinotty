import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  fetchServerToken: vi.fn(),
  getAuthToken: vi.fn(),
  setAuthToken: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: mocks.authFetch,
  fetchServerToken: mocks.fetchServerToken,
  getAuthToken: mocks.getAuthToken,
  setAuthToken: mocks.setAuthToken,
}))

vi.mock('../composables/useConfirm', () => ({ uiConfirm: vi.fn() }))
vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn() }))

import { useTokenManagement, type TokenManagement } from '../composables/useTokenManagement'

describe('useTokenManagement', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset()
    mocks.fetchServerToken.mockReset().mockResolvedValue('old-token')
    mocks.getAuthToken.mockReset().mockReturnValue('local-token')
    mocks.setAuthToken.mockReset()
  })

  it('shows the new access token immediately after a successful manual save', async () => {
    mocks.authFetch.mockResolvedValue(new Response(null, { status: 200 }))
    const onTokenChanged = vi.fn()
    let token!: TokenManagement
    const Host = defineComponent({
      setup() {
        token = useTokenManagement({ t: (key) => key, onTokenChanged })
        return () => h('div')
      },
    })
    const wrapper = mount(Host)
    await vi.waitFor(() => expect(token.currentToken.value).toBe('old-token'))

    token.startEditToken()
    token.customToken.value = 'new-token-value'
    await token.saveToken()

    expect(mocks.authFetch).toHaveBeenCalledWith('/api/token', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'new-token-value' }),
    })
    expect(mocks.setAuthToken).toHaveBeenCalledWith('new-token-value')
    expect(token.currentToken.value).toBe('new-token-value')
    expect(token.tokenEditing.value).toBe(false)
    expect(onTokenChanged).toHaveBeenCalledOnce()

    wrapper.unmount()
  })
})

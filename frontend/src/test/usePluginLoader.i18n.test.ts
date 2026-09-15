import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../composables/apiBase', () => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  wsUrl: (path: string) => `ws://localhost${path}`,
}))

import { usePluginLoader } from '../composables/usePluginLoader'
import { settings } from '../composables/useSettings'

describe('plugin locale context', () => {
  beforeEach(() => {
    settings.locale = 'zh'
  })

  it('exposes the resolved tag rather than collapsing it to a builtin', () => {
    const context = usePluginLoader().getPluginContext('locale-test')

    expect(context.i18n.getLocale()).toBe('zh')
    settings.locale = 'en'
    expect(context.i18n.getLocale()).toBe('en')
    // An unrecognised tag is reported as-is, not squashed to a builtin: a plugin
    // may ship its own strings for a language the app's UI packs do not cover.
    // The UI's own fallback to English lives in `t()`, not here.
    settings.locale = 'unsupported'
    expect(context.i18n.getLocale()).toBe('unsupported')
  })

  it('notifies plugins when the effective locale changes', async () => {
    const context = usePluginLoader().getPluginContext('locale-test')
    const listener = vi.fn()
    const subscription = context.i18n.onDidChangeLocale(listener)

    settings.locale = 'en'
    await nextTick()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenLastCalledWith('en')

    subscription.dispose()
    settings.locale = 'zh'
    await nextTick()
    expect(listener).toHaveBeenCalledOnce()
  })
})

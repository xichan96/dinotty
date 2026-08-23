// Host singleton bridge: redirects plugin imports of the host's
// `composables/useI18n` to the host module exposed on `window.__DINOTTY_HOST__`,
// keeping locale state unified.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useI18n: {
        useI18n: () => {
          locale: { value: 'en' | 'zh' }
          t(key: string, params?: Record<string, string | number>): string
          [k: string]: unknown
        }
        t(key: string, params?: Record<string, string | number>): string
      }
    }
  }
).__DINOTTY_HOST__?.useI18n
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useI18n not assigned')
}

export const useI18n = host.useI18n
export const t = host.t

export type Locale = 'en' | 'zh'

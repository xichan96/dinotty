import { computed } from 'vue'
import { settings } from './useSettings'
import { messages } from './i18n-messages'

export type Locale = 'en' | 'zh'

function normalizeLocale(raw: string | undefined): Locale {
  return raw === 'en' ? 'en' : 'zh'
}

export function t(key: string, params?: Record<string, string | number>): string {
  const table = messages[normalizeLocale(settings.locale)]
  let msg = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(`{${k}}`, String(v))
    }
  }
  return msg
}

export function useI18n() {
  const locale = computed(() => normalizeLocale(settings.locale))

  function themeLabel(name: string): string {
    return t(`settings.theme.${name}`)
  }

  return { locale, t, themeLabel }
}

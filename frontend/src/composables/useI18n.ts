import { computed, watch } from 'vue'
import { settings } from './useSettings'
import { tables, loadLocale, type Locale } from './i18n/tables'

export type { Locale }
export { loadLocale }

function detectSystemLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : ''
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function normalizeLocale(raw: string | undefined): Locale {
  if (raw === 'en') return 'en'
  if (raw === 'auto') return detectSystemLocale()
  return 'zh'
}

export function t(key: string, params?: Record<string, string | number>): string {
  const table = tables[normalizeLocale(settings.locale)] ?? {}
  let msg = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(`{${k}}`, String(v))
    }
  }
  return msg
}

watch(
  () => normalizeLocale(settings.locale),
  (locale) => {
    void loadLocale(locale)
  },
  { immediate: true }
)

export function useI18n() {
  const locale = computed(() => normalizeLocale(settings.locale))

  function themeLabel(name: string): string {
    return t(`settings.theme.${name}`)
  }

  return { locale, t, themeLabel }
}

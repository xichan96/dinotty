import { reactive } from 'vue'

export type Locale = 'en' | 'zh'

type MessageTable = Record<string, string>

// Each locale lives in its own lazy chunk so the index bundle only ships the
// active language. `tables` is reactive so templates re-render once a table
// arrives; until then t() falls back to the key, same as a missing key.
// Kept free of useSettings imports so test setup files can preload tables
// without pulling the (mock-sensitive) settings module into the registry.
export const tables = reactive<Partial<Record<Locale, MessageTable>>>({})

const loaders: Partial<Record<Locale, Promise<void>>> = {}

export function loadLocale(locale: Locale): Promise<void> {
  loaders[locale] ??= (locale === 'en' ? import('./en') : import('./zh')).then((m) => {
    tables[locale] = m.default
  })
  return loaders[locale]!
}

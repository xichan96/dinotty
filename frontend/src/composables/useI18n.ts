import { computed, watch } from 'vue'
import { settings } from './useSettings'
import { tableFor, loadLocale, type Locale } from './i18n/tables'

export type { Locale }
export { loadLocale }

function detectSystemLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : ''
  return lang || 'en'
}

/**
 * Canonicalise the locale setting into a tag.
 *
 * `auto` follows the browser. An explicit value is passed through *as-is*: an
 * unrecognised tag is deliberately NOT collapsed to a builtin here, because
 * this is also the value plugins observe through `getLocale()`, and a plugin may
 * ship strings for a language the app's own UI packs do not cover. Falling back
 * is the table lookup's job — see `t()` and `tables.tableFor`.
 */
export function normalizeLocale(raw: string | undefined): Locale {
  if (!raw || raw === 'auto') return detectSystemLocale()
  return raw
}

/**
 * True when `tag` is `base` or a regional variant of it (`zh` matches `zh-CN`).
 *
 * A resolved locale is a full BCP-47 tag — the browser reports `zh-CN`, and an
 * installed pack may be `zh-TW` — so a plain `locale === 'zh'` comparison stops
 * matching. Compare on the primary subtag instead.
 */
export function localeIs(tag: string, base: string): boolean {
  const primary = (value: string) => value.toLowerCase().split('-')[0]
  return primary(tag) === primary(base)
}

export function t(key: string, params?: Record<string, string | number>): string {
  // A single `?? key` is enough for the whole fallback chain: every effective
  // table already carries the full `en` key set, because packs are merged *over*
  // their base rather than replacing it (see `i18n/tables.ts`).
  let msg = tableFor(normalizeLocale(settings.locale))[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // Every occurrence, not just the first: a message may name the same
      // placeholder twice — German and Russian inflection make that natural —
      // and `String.replace` would leave the second as a literal `{k}`.
      // `split`/`join` does a literal global replace without a regex and
      // without needing `replaceAll` (ES2021, above this project's ES2020 lib).
      msg = msg.split(`{${k}}`).join(String(v))
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

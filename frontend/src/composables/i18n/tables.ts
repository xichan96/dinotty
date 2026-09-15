import { reactive } from 'vue'
import en from './en'

/**
 * A locale tag. `en` and `zh` ship with the app; anything else is an installed
 * language pack (see `setInstalledPacks`). The `(string & {})` arm keeps
 * autocomplete and typo-checking for the built-ins without closing the union,
 * so an arbitrary BCP-47 tag still type-checks.
 */
export type Locale = 'en' | 'zh' | (string & {})

export type MessageTable = Record<string, string>

/** A language pack after validation: `manifest` fields plus its message patch. */
export interface LocalePack {
  /** Human-readable name shown in settings. Not translated (it is an endonym). */
  name: string
  /** Version of the pack itself. */
  version?: string
  /** App version this pack was written against; older packs are flagged, not refused. */
  minAppVersion?: string
  /** Tag this pack's messages are merged over. Defaults to `en`. */
  extends: string
  messages: MessageTable
}

// `en` is the fallback for *every* locale, so it cannot be a lazy chunk: a
// missing table would mean a frame with no messages at all, not merely an
// untranslated one. It is a static import and is always resident.
//
// Every other locale stays lazy, which is the point of the original design —
// the index bundle only ships the active language. `zh` keeps its lazy chunk.
const builtin: Record<string, MessageTable> = { en }

const builtinLoaders: Record<string, () => Promise<{ default: MessageTable }>> = {
  zh: () => import('./zh'),
}

/**
 * Installed language packs, by tag.
 *
 * A pack whose tag matches a builtin is a *patch* of that builtin — that is how
 * brand-word and white-label overrides work — never a replacement. Patching is
 * the only mode: it keeps keys added by an app upgrade flowing through from the
 * base table, so a user who overrode `en` does not get raw key names on the
 * next release. `ja` and `en` follow the same rule; there is no special case.
 */
export const packs = reactive<Record<string, LocalePack>>({})

/**
 * Effective table per tag: the base table with the pack's messages merged over
 * it. `t()` reads only this.
 *
 * Note the fallback chain from the design (`pack → base → en → key`) is realised
 * here, at merge time, rather than as a per-key lookup in `t()`: every
 * effective table already contains the full `en` key set, so a single
 * `table[key] ?? key` in `t()` is enough.
 */
export const tables = reactive<Record<string, MessageTable>>({})

/**
 * Every tag the app can render with.
 *
 * Includes not-yet-loaded builtins (`builtinLoaders` keys), not just the ones
 * already resident: matching happens *before* the chunk is fetched, so omitting
 * them would make `matchTag('zh')` fall through to `en` and the chunk would
 * never load at all.
 */
export function availableTags(): string[] {
  return [
    ...new Set([...Object.keys(builtin), ...Object.keys(builtinLoaders), ...Object.keys(packs)]),
  ]
}

/**
 * The reference key set a language pack is measured against.
 *
 * `en` is authoritative rather than a scan of `t()` call sites: 79 of the app's
 * keys (7.6%) are reached through dynamic prefixes — `settings.theme.${}`,
 * `plugin.category.${}` and seven more — which no static scan can see, yet all
 * of them are present in this table.
 */
export function referenceKeys(): string[] {
  return Object.keys(builtin.en ?? {})
}

/**
 * Best available tag for `tag`: exact match, then primary subtag, then `en`.
 *
 * Tolerates region subtags in both directions so a browser reporting `ja-JP`
 * still finds a `ja` pack (and an installed `zh-CN` is still found by `zh`).
 */
export function matchTag(tag: string): string {
  const tags = availableTags()
  const lower = tag.toLowerCase()
  const exact = tags.find((t) => t.toLowerCase() === lower)
  if (exact) return exact
  const primary = lower.split('-')[0]
  return tags.find((t) => t.toLowerCase().split('-')[0] === primary) ?? 'en'
}

/**
 * Resolve a tag to a table. Always returns a table: `en` is the last resort.
 * A builtin whose chunk has not arrived yet resolves to `en` for now and is
 * corrected by `rebuild()` once it lands.
 */
export function tableFor(tag: string): MessageTable {
  return tables[matchTag(tag)] ?? tables.en ?? {}
}

function effectiveTableFor(tag: string, seen = new Set<string>()): MessageTable {
  if (seen.has(tag)) return builtin.en ?? {} // cycle in `extends` — stop at en
  seen.add(tag)

  const self = builtin[tag]
  const parent = packs[tag]?.extends ?? 'en'
  const base = self ?? (parent === tag ? builtin.en : effectiveTableFor(parent, seen))
  return { ...base, ...(packs[tag]?.messages ?? {}) }
}

function rebuild(): void {
  const tags = new Set([...Object.keys(builtin), ...Object.keys(packs)])
  for (const tag of tags) {
    const table = effectiveTableFor(tag)
    // A lazily-loaded builtin (`zh`) has no base yet; skip it so `tableFor`
    // falls through to `en` instead of pinning an empty table for that tag.
    if (Object.keys(table).length > 0) tables[tag] = table
  }
  for (const tag of Object.keys(tables)) {
    if (!tags.has(tag) || Object.keys(tables[tag]!).length === 0) delete tables[tag]
  }
}

/**
 * Replace the installed pack set and rebuild every effective table.
 *
 * This is the invalidation path. It is deliberately separate from the builtin
 * chunk cache below: a builtin chunk never changes at runtime, but an installed
 * pack can be re-read from disk, so only this side may be reloaded.
 */
export function setInstalledPacks(next: Record<string, LocalePack>): void {
  for (const tag of Object.keys(packs)) {
    if (!(tag in next)) delete packs[tag]
  }
  for (const [tag, pack] of Object.entries(next)) packs[tag] = pack
  rebuild()
}

const pending = new Map<string, Promise<void>>()

/**
 * Load the builtin chunk that serves `locale`.
 *
 * The tag is matched first: the browser reports `zh-CN` or `zh-TW`, and the
 * chunk to fetch is `zh`. Passing the raw tag through would find no loader and
 * silently leave that locale on `en`. Installed packs are already in memory
 * (they arrive as JSON) and `en` is static, so both resolve immediately.
 */
export function loadLocale(locale: string): Promise<void> {
  const tag = matchTag(locale)
  const loader = builtinLoaders[tag]
  if (!loader) return Promise.resolve()
  let flight = pending.get(tag)
  if (!flight) {
    flight = loader().then((m) => {
      builtin[tag] = m.default
      rebuild()
    })
    pending.set(tag, flight)
  }
  return flight
}

/** Load every builtin chunk. Used by tests, which call `t()` synchronously. */
export function loadAllBuiltins(): Promise<void[]> {
  return Promise.all(Object.keys(builtinLoaders).map((tag) => loadLocale(tag)))
}

rebuild()

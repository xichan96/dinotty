/**
 * Parsing and validation for user-installed language packs.
 *
 * A pack is JSON read from `config_dir()/locales/`, i.e. entirely untrusted
 * input: it is a file the user (or anything else on the machine) can write.
 *
 * Two rules shape everything here.
 *
 * 1. **Never `import()` a pack.** `en.ts`/`zh.ts` are TS modules, so evaluating
 *    one as a module means executing it as code — arbitrary code execution from
 *    a dropped file. Packs are data, read with `JSON.parse` and nothing else.
 *
 * 2. **Validate, don't trust.** Parsing is hand-rolled rather than regex-driven,
 *    following `utils/themeImport.ts` (which carries a ReDoS test for exactly
 *    this reason): these inputs are attacker-shaped.
 */

import type { LocalePack, MessageTable } from './tables'

/** Reject a pack outright above this; a language table is ~45KB in practice. */
export const MAX_PACK_BYTES = 512 * 1024

/** A pack translating more keys than the app has is padding, not translation. */
export const MAX_MESSAGES = 20000

/** Above this a single "translation" is a payload, not a sentence. */
export const MAX_VALUE_LENGTH = 4000

/** Longest plausible BCP-47 tag (`zh-Hant-TW` and friends). */
const MAX_TAG_LENGTH = 35

/**
 * Keys that would poison the prototype chain.
 *
 * `JSON.parse` gives `__proto__` back as a *own* property, and copying it onto a
 * plain object with `Object.assign` or `table[k] = v` goes through `[[Set]]`,
 * which invokes the `__proto__` setter and rewrites the object's prototype.
 * Filtering by hand is the only reliable fix; `JSON.parse` alone does not help.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface PackParseResult {
  ok: boolean
  /** Present only when `ok`. */
  pack?: LocalePack
  tag?: string
  errors: string[]
  warnings: string[]
  stats?: { translated: number; dropped: number }
}

/**
 * A tag used as a filename on the Rust side, so it may not contain a path
 * separator or traversal segment. Character-by-character rather than a regex
 * (see the module note).
 */
export function isValidTag(tag: string): boolean {
  if (tag.length < 2 || tag.length > MAX_TAG_LENGTH) return false
  if (tag.startsWith('-') || tag.endsWith('-')) return false
  let lastWasDash = false
  for (const ch of tag) {
    if (ch === '-') {
      if (lastWasDash) return false
      lastWasDash = true
      continue
    }
    lastWasDash = false
    const isLower = ch >= 'a' && ch <= 'z'
    const isUpper = ch >= 'A' && ch <= 'Z'
    const isDigit = ch >= '0' && ch <= '9'
    if (!isLower && !isUpper && !isDigit) return false
  }
  return true
}

export interface MessageSanitizeResult {
  messages: MessageTable
  dropped: number
  /** Per-entry problems that do not invalidate the pack. */
  warnings: string[]
  /** Set only when the pack cannot be used at all. */
  error?: string
}

/**
 * Reduce an arbitrary object to a safe message table.
 *
 * Dropping is deliberately *not* fatal: a pack with one bad entry should still
 * deliver every other key, so per-entry problems are warnings and only a
 * structural failure rejects the pack.
 */
export function sanitizeMessages(raw: unknown): MessageSanitizeResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { messages: {}, dropped: 0, warnings: [], error: '"messages" must be an object' }
  }

  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_MESSAGES) {
    return {
      messages: {},
      dropped: 0,
      warnings: [],
      error: `too many messages (${entries.length}, max ${MAX_MESSAGES})`,
    }
  }

  // A null-prototype table so even a key that slipped past the filter cannot
  // reach `Object.prototype`.
  const messages: MessageTable = Object.create(null) as MessageTable
  const warnings: string[] = []
  let dropped = 0

  for (const [key, value] of entries) {
    if (FORBIDDEN_KEYS.has(key)) {
      dropped++
      warnings.push(`ignored reserved key "${key}"`)
      continue
    }
    if (typeof value !== 'string') {
      dropped++
      continue
    }
    if (value.length > MAX_VALUE_LENGTH) {
      dropped++
      warnings.push(`ignored "${key}": value longer than ${MAX_VALUE_LENGTH} chars`)
      continue
    }
    messages[key] = value
  }

  return { messages, dropped, warnings }
}

/**
 * Parse one language pack.
 *
 * `text` is the raw file body; `fallbackTag` is the filename stem, used only
 * when the manifest omits `tag` (a reasonable convenience — but the manifest
 * wins, so a file may be renamed freely).
 */
export function parseLocalePack(text: string, fallbackTag = ''): PackParseResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (text.length > MAX_PACK_BYTES) {
    return {
      ok: false,
      errors: [`pack is larger than ${Math.round(MAX_PACK_BYTES / 1024)}KB`],
      warnings,
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return {
      ok: false,
      errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['pack must be a JSON object'], warnings }
  }

  const manifest = raw as Record<string, unknown>
  const tag = typeof manifest.tag === 'string' && manifest.tag ? manifest.tag : fallbackTag

  if (!isValidTag(tag)) {
    return {
      ok: false,
      errors: [
        tag
          ? `invalid locale tag "${tag}" (letters, digits and single dashes, 2-${MAX_TAG_LENGTH} chars)`
          : 'missing "tag"',
      ],
      warnings,
    }
  }

  const sanitized = sanitizeMessages(manifest.messages)
  // Entry-level problems are warnings, not errors — see `sanitizeMessages`.
  warnings.push(...sanitized.warnings)
  const { messages, dropped } = sanitized

  if (sanitized.error) errors.push(sanitized.error)
  else if (Object.keys(messages).length === 0) errors.push('no usable messages')

  const extends_ =
    typeof manifest.extends === 'string' && manifest.extends ? manifest.extends : 'en'
  if (extends_ !== tag && !isValidTag(extends_)) {
    errors.push(`invalid "extends" tag "${extends_}"`)
  }

  if (errors.length > 0) return { ok: false, errors, warnings, tag }

  return {
    ok: true,
    tag,
    errors,
    warnings,
    stats: { translated: Object.keys(messages).length, dropped },
    pack: {
      name: typeof manifest.name === 'string' && manifest.name ? manifest.name : tag,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      minAppVersion:
        typeof manifest.minAppVersion === 'string' ? manifest.minAppVersion : undefined,
      extends: extends_,
      messages,
    },
  }
}

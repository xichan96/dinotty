import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import en from '../composables/i18n/en'
import zh from '../composables/i18n/zh'

// Guards the class of bug the parallel-branch merge produced: two branches
// invented separate namespaces for the same feature (`server.*` vs
// `serverSwitcher.*`), and the loser's keys were never added to the tables, so
// its UI rendered raw key names. A missing key is silent — `t()` falls back to
// the key itself — so nothing but a test like this catches it.

const SRC = path.resolve(__dirname, '..')

/** Every file that can call `t()`, excluding the locale tables themselves. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // `i18n` holds the tables under test; the rest are irrelevant to t().
      return entry.name === 'i18n' ? [] : sourceFiles(full)
    }
    return /\.(ts|vue)$/.test(entry.name) ? [full] : []
  })
}

/**
 * Literal keys from `t('...')`, `t("...")` and `titleKey: '...'`.
 *
 * Dynamic keys (`t(\`plugin.category.${c}\`)`) and bare string literals are
 * deliberately not collected: the former cannot be resolved statically, and the
 * latter would drag in every unrelated string. Both remain uncovered by this
 * test, which is why it is a floor and not a proof.
 */
const LITERAL_T = /\bt\(\s*(['"`])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/g
const LITERAL_TITLE_KEY = /\btitleKey:\s*(['"`])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/g

function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file)
    const src = fs.readFileSync(file, 'utf8')
    for (const re of [LITERAL_T, LITERAL_TITLE_KEY]) {
      for (const match of src.matchAll(re)) {
        const key = match[2]
        const files = used.get(key) ?? []
        files.push(rel)
        used.set(key, files)
      }
    }
  }
  return used
}

const usedKeys = collectUsedKeys()

describe('i18n key coverage', () => {
  it('finds t() call sites (guards against the scanner silently matching nothing)', () => {
    // A regex that stops matching would make every assertion below vacuous.
    expect(usedKeys.size).toBeGreaterThan(200)
  })

  it('every key passed to t() exists in en.ts', () => {
    const missing = [...usedKeys].filter(([key]) => !(key in en))
    expect(
      missing.map(([key, files]) => `${key}  (used in ${[...new Set(files)].join(', ')})`)
    ).toEqual([])
  })

  it('every key passed to t() exists in zh.ts', () => {
    const missing = [...usedKeys].filter(([key]) => !(key in zh))
    expect(
      missing.map(([key, files]) => `${key}  (used in ${[...new Set(files)].join(', ')})`)
    ).toEqual([])
  })

  it('en and zh define the same key set (no half-translated pair)', () => {
    const onlyEn = Object.keys(en).filter((k) => !(k in zh))
    const onlyZh = Object.keys(zh).filter((k) => !(k in en))
    expect({ onlyEn, onlyZh }).toEqual({ onlyEn: [], onlyZh: [] })
  })

  // Deliberately no "every table key is used" assertion: the tables carry keys
  // with no literal call site by design (dynamic prefixes like
  // `plugin.category.*`, spec-only strings), so it would fail on pre-existing
  // repo state rather than on a regression this change could introduce.
})

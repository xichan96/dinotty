import { reactive } from 'vue'
import { apiUrl, authFetch } from './apiBase'
import { parseLocalePack, type PackParseResult } from './i18n/localePack'
import { referenceKeys, setInstalledPacks } from './i18n/tables'

/**
 * Language packs installed on this Dinotty instance.
 *
 * Packs live in `config_dir()/locales/*.json` on the server, so installing one
 * is the same act as changing a setting: it applies to every client attached to
 * that instance, and it survives a reload of any single device.
 *
 * Nothing here writes. There is no upload route — a pack is installed by putting
 * a file in the directory.
 */

/** One reported pack that failed to load, kept so the UI can explain itself. */
export interface RejectedPack {
  file: string
  errors: string[]
  warnings: string[]
}

/**
 * Per-pack translation coverage, shown in settings.
 *
 * A pack is a *patch*, so a low number here is normal and not an error — the
 * untranslated keys fall back to English.
 */
export interface PackCoverage {
  file: string
  tag: string
  name: string
  version?: string
  /** The app this pack was written against; unflagged when absent. */
  minAppVersion?: string
  /** Out of date only when we know the app's version and it is lower. */
  outdated: boolean
  translated: number
  total: number
  percent: number
  /** Keys carried by the pack that the app no longer has — harmless, but drift. */
  unknownKeys: number
  dropped: number
  warnings: string[]
}

export const localePacks = reactive({
  loaded: false,
  /** True once a load has finished, successfully or not. */
  loading: false,
  /** An install or removal is in flight; drives the per-action button state. */
  importing: false,
  /** Tag currently being removed, so only that row shows a spinner. */
  removing: null as string | null,
  /** Null when the question could not be asked — distinct from "none installed". */
  lastError: null as string | null,
  covers: [] as PackCoverage[],
  rejected: [] as RejectedPack[],
})

/** `1.2.3` -> `[1, 2, 3]`. Anything unparseable yields null, and is not compared. */
function parseVersion(value: string): number[] | null {
  const parts = value.trim().split('.')
  if (parts.length === 0) return null
  const out: number[] = []
  for (const part of parts) {
    // Stop at the first non-numeric segment (`1.0.0-beta.1` compares as 1.0.0).
    const n = Number.parseInt(part, 10)
    if (Number.isNaN(n)) break
    out.push(n)
  }
  return out.length > 0 ? out : null
}

/** Whether `wanted` (the pack's floor) is above `actual` (the running app). */
function isNewer(wanted: string | undefined, actual: string | undefined): boolean {
  if (!wanted || !actual) return false
  const a = parseVersion(wanted)
  const b = parseVersion(actual)
  // An unparseable version on either side means we cannot tell, and "cannot
  // tell" must not render as "out of date".
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}

/** Read the app's own version, or undefined if the server would not say. */
async function fetchAppVersion(): Promise<string | undefined> {
  try {
    const res = await authFetch(apiUrl('/api/info'))
    if (!res.ok) return undefined
    const body = await res.json()
    return typeof body?.version === 'string' ? body.version : undefined
  } catch {
    return undefined
  }
}

async function fetchLocaleFiles(): Promise<{ file: string; body: string }[] | null> {
  try {
    const res = await authFetch(apiUrl('/api/locales'))
    // A server predating this route answers 404. That is "no packs", not a
    // failure worth surfacing — the feature is simply absent there, and the
    // packs live on the server, so there is nothing to fall back to locally.
    if (res.status === 404) return []
    if (!res.ok) return null
    const body = await res.json()
    if (!Array.isArray(body)) return null
    return body.filter(
      (entry): entry is { file: string; body: string } =>
        !!entry && typeof entry.file === 'string' && typeof entry.body === 'string'
    )
  } catch {
    return null
  }
}

/** What the server said when it refused an install. */
export interface InstallFailure {
  ok: false
  /** `error` from the server, or a transport/shape message. */
  error: string
  /** Per-entry complaints, when the pack parsed but had bad entries. */
  warnings: string[]
}

export type InstallResult = { ok: true; tag: string; name: string; count: number } | InstallFailure

/**
 * Install or replace a language pack on the server.
 *
 * The pack is validated here first so the user gets a specific message ("invalid
 * JSON", "reserved key") instead of a round-trip and a generic 400 — but this is
 * a *usability* check, not a security boundary: the server revalidates and
 * rewrites whatever it is sent, and a client can post without ever running this.
 *
 * Reloads the registry on success, so the new language appears immediately.
 */
export async function installLocalePack(text: string, filename: string): Promise<InstallResult> {
  const parsed = parseLocalePack(text, filename.replace(/\.json$/i, ''))
  if (!parsed.ok || !parsed.pack || !parsed.tag) {
    return { ok: false, error: parsed.errors[0] ?? 'invalid language pack', warnings: [] }
  }

  localePacks.importing = true
  try {
    // `?file=` only seeds the tag when the manifest omits one, so the server has
    // the same name to fall back on that we did.
    const url = apiUrl(`/api/locales?file=${encodeURIComponent(filename)}`)
    const res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return {
        ok: false,
        error: body?.error ?? `server refused the pack (HTTP ${res.status})`,
        warnings: [],
      }
    }
    const body = await res.json()
    await loadLocalePacks()
    return {
      ok: true,
      tag: typeof body?.tag === 'string' ? body.tag : parsed.tag,
      name: parsed.pack.name,
      count: typeof body?.count === 'number' ? body.count : (parsed.stats?.translated ?? 0),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), warnings: [] }
  } finally {
    localePacks.importing = false
  }
}

/**
 * Remove an installed pack from the server.
 *
 * Deleting is idempotent server-side, so a pack that is already gone is not an
 * error. Reloads the registry so the language disappears from the picker.
 */
export async function removeLocalePack(tag: string): Promise<{ ok: true } | InstallFailure> {
  localePacks.removing = tag
  try {
    const res = await authFetch(apiUrl(`/api/locales/${encodeURIComponent(tag)}`), {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return {
        ok: false,
        error: body?.error ?? `could not remove the pack (HTTP ${res.status})`,
        warnings: [],
      }
    }
    await loadLocalePacks()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), warnings: [] }
  } finally {
    localePacks.removing = null
  }
}

/**
 * Load the installed packs and publish them to the i18n registry.
 *
 * Safe to call repeatedly: it replaces the whole set, so it doubles as the
 * "reload" action behind the settings button. A failed fetch leaves the
 * currently-installed packs in place rather than blanking the UI.
 */
export async function loadLocalePacks(): Promise<void> {
  localePacks.loading = true
  try {
    const [files, appVersion] = await Promise.all([fetchLocaleFiles(), fetchAppVersion()])

    if (files === null) {
      localePacks.lastError = 'could not read locale packs from this server'
      return
    }

    const known = new Set(referenceKeys())
    const accepted: Record<string, PackParseResult & { tag: string }> = {}
    const rejected: RejectedPack[] = []
    const covers: PackCoverage[] = []

    for (const file of files) {
      const result = parseLocalePack(file.body, file.file)
      if (!result.ok || !result.pack || !result.tag) {
        rejected.push({ file: file.file, errors: result.errors, warnings: result.warnings })
        continue
      }
      // Last one wins on a duplicate tag. The route sorts by filename, so this
      // is deterministic rather than filesystem-order dependent.
      accepted[result.tag] = { ...result, tag: result.tag }

      const keys = Object.keys(result.pack.messages)
      const translated = keys.reduce((count, key) => count + (known.has(key) ? 1 : 0), 0)
      covers.push({
        file: file.file,
        tag: result.tag,
        name: result.pack.name,
        version: result.pack.version,
        minAppVersion: result.pack.minAppVersion,
        outdated: isNewer(result.pack.minAppVersion, appVersion),
        translated,
        total: known.size,
        percent: known.size === 0 ? 0 : Math.round((translated / known.size) * 100),
        unknownKeys: keys.length - translated,
        dropped: result.stats?.dropped ?? 0,
        warnings: result.warnings,
      })
    }

    setInstalledPacks(
      Object.fromEntries(Object.entries(accepted).map(([tag, r]) => [tag, r.pack!]))
    )

    covers.sort((a, b) => a.tag.localeCompare(b.tag))
    localePacks.covers = covers
    localePacks.rejected = rejected
    localePacks.lastError = null
  } finally {
    localePacks.loading = false
    localePacks.loaded = true
  }
}

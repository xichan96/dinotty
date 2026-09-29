import { reactive } from 'vue'
import { apiUrl, authFetch } from './apiBase'
import { parseThemeFile } from '../utils/themeImport'
import {
  buildInstallPayload,
  isValidThemeId,
  MAX_THEME_BYTES,
  themeIdFromFilename,
} from '../utils/themePack'
import type { ThemeColors } from './useDeviceThemeSelection'

/**
 * Theme files installed on this Dinotty instance.
 *
 * Themes live in `config_dir()/themes/` on the server, so installing one is the
 * same act as changing a setting: it applies to every client attached to that
 * instance, and it survives a reload of any single device.
 *
 * They are deliberately *not* `settings.custom_themes`. That array is the
 * user's own editable library, it round-trips through `PUT /api/settings`, and
 * the server caps it at 15 — an installed theme written there would be silently
 * truncated by the next save of a full library. Installed themes are content:
 * read-only here, removed by their own route, and unlimited.
 *
 * Nothing here evaluates a theme. `parseThemeFile` does `JSON.parse` (or a
 * hand-rolled `.conf` scan) and nothing else — see `utils/themePack.ts`.
 */

/** One installed theme the frontend could not read, kept so the UI can explain. */
export interface RejectedTheme {
  file: string
  errors: string[]
}

export interface InstalledTheme {
  /** Filename stem on the server; also the key the delete route takes. */
  id: string
  name: string
  colors: ThemeColors
}

/**
 * An entry the server offered from the configured registry.
 *
 * No `sha256`: verifying a digest is the server's job, and one the client
 * cannot do over plain `http://` (where `crypto.subtle` is unavailable) would
 * be worse than none, because it would look like a check and not be one.
 */
export interface RegistryEntry {
  id: string
  name: string
  version?: string
  minAppVersion?: string
}

export const themePacks = reactive({
  loaded: false,
  /** True once a load has finished, successfully or not. */
  loading: false,
  /** An install or removal is in flight; drives the per-action button state. */
  importing: false,
  /** Id currently being removed, so only that row shows a spinner. */
  removing: null as string | null,
  /** Null when the question could not be asked — distinct from "none installed". */
  lastError: null as string | null,
  installed: [] as InstalledTheme[],
  rejected: [] as RejectedTheme[],
  /** Null until the registry has been asked for; `[]` when it has none to show. */
  registry: null as RegistryEntry[] | null,
  /** False on a server with no registry configured, which is the default. */
  registryConfigured: false,
  registryUrl: null as string | null,
  registryLoading: false,
  registryError: null as string | null,
  /** Id currently being installed from the registry. */
  installing: null as string | null,
})

/** What the server said when it refused an install or a removal. */
export interface ThemeFailure {
  ok: false
  /** `error` from the server, or a transport/shape message. */
  error: string
}

export type ThemeActionResult = { ok: true; id: string; name: string } | ThemeFailure

async function fetchThemeFiles(): Promise<{ file: string; body: string }[] | null> {
  try {
    const res = await authFetch(apiUrl('/api/themes'))
    // A server predating this route answers 404. That is "no themes", not a
    // failure worth surfacing — the feature is simply absent there, and the
    // files live on the server, so there is nothing to fall back to locally.
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

/**
 * Load the installed themes.
 *
 * Safe to call repeatedly: it replaces the whole set, so it doubles as the
 * "reload" action behind the settings button. A failed fetch leaves the
 * currently-installed themes in place rather than blanking the UI — blanking
 * would also drop the device's own selection back to the server default, which
 * is a visible flicker caused by a network blip.
 */
export async function loadThemePacks(): Promise<void> {
  themePacks.loading = true
  try {
    const files = await fetchThemeFiles()
    if (files === null) {
      themePacks.lastError = 'could not read theme files from this server'
      return
    }

    const installed: InstalledTheme[] = []
    const rejected: RejectedTheme[] = []
    for (const file of files) {
      const result = parseThemeFile(file.body)
      if (!result.ok) {
        rejected.push({ file: file.file, errors: result.errors })
        continue
      }
      installed.push({
        id: file.file,
        name: (result.name && result.name.trim()) || file.file,
        colors: result.colors,
      })
    }

    // Sorted here rather than relying on the route's order, so the list does
    // not reshuffle because a transport layer changed.
    installed.sort((a, b) => a.id.localeCompare(b.id))

    themePacks.installed = installed
    themePacks.rejected = rejected
    themePacks.lastError = null
  } finally {
    themePacks.loading = false
    themePacks.loaded = true
  }
}

/**
 * Install or replace one theme file on the server.
 *
 * The file is validated here first so the user gets a specific message ("invalid
 * `palette 3`", "that filename cannot be a theme id") instead of a round-trip
 * and a generic 400 — but this is a *usability* check, not a security boundary:
 * the server revalidates and rewrites whatever it is sent, and a client can post
 * without ever running this.
 *
 * A Ghostty `.conf` is accepted here and translated to JSON on the way out,
 * because the server parses what it stores in order to revalidate it and does
 * not carry a second `.conf` parser.
 */
export async function installThemePack(text: string, filename: string): Promise<ThemeActionResult> {
  const id = themeIdFromFilename(filename)
  if (!isValidThemeId(id)) {
    return {
      ok: false,
      error: `"${id}" cannot be a theme id — use letters, digits and single dashes, 2-64 characters`,
    }
  }

  // A fast pre-check for a friendlier message than a request that gets refused.
  // `String.length` counts UTF-16 units and never exceeds the UTF-8 byte count
  // the server measures, so this can only be optimistic — the server's bound is
  // what holds.
  if (text.length > MAX_THEME_BYTES) {
    return { ok: false, error: `theme file is larger than ${MAX_THEME_BYTES / 1024}KB` }
  }

  const parsed = parseThemeFile(text)
  if (!parsed.ok) {
    return { ok: false, error: parsed.errors[0] ?? 'invalid theme file' }
  }

  const name = (parsed.name ?? '').trim() || id

  themePacks.importing = true
  try {
    // `?file=` only seeds the id when the document omits one, so the server has
    // the same name to fall back on that we did.
    const res = await authFetch(apiUrl(`/api/themes?file=${encodeURIComponent(id)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInstallPayload(id, name, parsed.colors)),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return {
        ok: false,
        error: body?.error ?? `server refused the theme (HTTP ${res.status})`,
      }
    }
    const body = await res.json()
    await loadThemePacks()
    return {
      ok: true,
      id: typeof body?.id === 'string' ? body.id : id,
      name: typeof body?.name === 'string' ? body.name : name,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    themePacks.importing = false
  }
}

/**
 * Remove an installed theme from the server.
 *
 * Deleting is idempotent server-side, so a theme that is already gone is not an
 * error. Reloads the list so the card disappears immediately.
 */
export async function removeThemePack(id: string): Promise<ThemeActionResult> {
  themePacks.removing = id
  try {
    const res = await authFetch(apiUrl(`/api/themes/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return {
        ok: false,
        error: body?.error ?? `could not remove the theme (HTTP ${res.status})`,
      }
    }
    await loadThemePacks()
    return { ok: true, id, name: id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    themePacks.removing = null
  }
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && typeof entry.name === 'string'
}

/**
 * Ask the server for the theme registry.
 *
 * The server does the fetching, not this client: the registry URL is configured
 * on the instance (and defaulting to "none"), so there is no CORS question and
 * no per-device setting to keep in sync. `configured: false` is a normal
 * answer, not a failure — the theme store simply ships switched off.
 */
export async function loadThemeRegistry(): Promise<void> {
  themePacks.registryLoading = true
  try {
    const res = await authFetch(apiUrl('/api/themes/registry'))
    // A server predating this route has no theme store at all.
    if (res.status === 404) {
      themePacks.registryConfigured = false
      themePacks.registryUrl = null
      themePacks.registry = []
      themePacks.registryError = null
      return
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      themePacks.registry = null
      themePacks.registryError =
        body?.error ?? `could not reach the theme registry (HTTP ${res.status})`
      return
    }

    const body = await res.json()
    const configured = body?.configured === true
    themePacks.registryConfigured = configured
    themePacks.registryUrl = typeof body?.url === 'string' ? body.url : null
    themePacks.registry =
      configured && Array.isArray(body?.themes) ? body.themes.filter(isRegistryEntry) : []
    themePacks.registryError = null
  } catch (e) {
    themePacks.registry = null
    themePacks.registryError = e instanceof Error ? e.message : String(e)
  } finally {
    themePacks.registryLoading = false
  }
}

/**
 * Install one theme the registry lists, by id.
 *
 * The id is all that is sent: the server looks the entry up and fetches the URL
 * itself, so a client cannot ask the instance to fetch an arbitrary address,
 * and the `sha256` check happens where the bytes are actually read.
 */
export async function installFromRegistry(id: string): Promise<ThemeActionResult> {
  themePacks.installing = id
  try {
    const res = await authFetch(apiUrl(`/api/themes/install/${encodeURIComponent(id)}`), {
      method: 'POST',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return {
        ok: false,
        error: body?.error ?? `could not install "${id}" (HTTP ${res.status})`,
      }
    }
    const body = await res.json()
    await loadThemePacks()
    return {
      ok: true,
      id: typeof body?.id === 'string' ? body.id : id,
      name: typeof body?.name === 'string' ? body.name : id,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    themePacks.installing = null
  }
}

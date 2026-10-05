<template>
  <div class="settings-group" @click="pendingDeleteKey = null">
    <h3 class="settings-group-title">{{ t('settings.theme') }}</h3>

    <div class="theme-manager-toolbar">
      <div class="theme-manager-actions">
        <button type="button" :disabled="atCap" @click.stop="openCreate">
          {{ t('settings.theme.new') }}
        </button>
        <button type="button" :disabled="atCap" @click.stop="openImport">
          {{ t('settings.theme.import') }}
        </button>
        <!-- Import adds to this user's own library (editable, capped at 15).
             Install writes a theme file to the server for every device to use
             (read-only here, uncapped). Two different destinations, so two
             different buttons rather than one that guesses. -->
        <button type="button" :disabled="themePacks.importing" @click.stop="openInstall">
          {{ themePacks.importing ? t('settings.theme.installing') : t('settings.theme.install') }}
        </button>
        <button type="button" @click.stop="exportCurrentTheme">
          {{ t('settings.theme.exportTheme') }}
        </button>
        <input
          ref="fileInput"
          class="theme-file-input"
          type="file"
          accept=".conf,.txt,.json"
          @change="onFile"
        />
        <input
          ref="installInput"
          class="theme-file-input"
          type="file"
          accept=".json,.conf"
          @change="onInstallFile"
        />
      </div>
      <div class="theme-manager-count">
        <span>{{ visibleCount }}/{{ VISIBLE_CAP }}</span>
        <span v-if="atCap" class="theme-manager-cap">{{ t('settings.theme.atCap') }}</span>
      </div>
    </div>

    <div v-if="libraryError" class="theme-manager-error">{{ libraryError }}</div>
    <div v-if="importErrors.length" class="theme-manager-error">
      <div>{{ t('settings.theme.importError') }}</div>
      <ul>
        <li v-for="error in importErrors" :key="error">{{ error }}</li>
      </ul>
    </div>
    <div v-if="importedUuid" class="theme-manager-apply">
      <button type="button" @click.stop="applyImportedTheme">
        {{ t('settings.theme.applyHere') }}
      </button>
    </div>

    <div v-if="installError" class="theme-manager-error">{{ installError }}</div>
    <div v-if="installNotice" class="theme-manager-notice">{{ installNotice }}</div>
    <div v-if="themePacks.lastError" class="theme-manager-error">{{ themePacks.lastError }}</div>
    <p v-for="pack in themePacks.rejected" :key="pack.file" class="theme-manager-error">
      {{ t('settings.theme.invalidPack', { file: pack.file }) }} — {{ pack.errors.join('; ') }}
    </p>

    <div class="theme-grid">
      <div
        v-for="item in themeItems"
        :key="item.key"
        class="theme-card"
        :class="{ active: item.active }"
        :data-kind="item.kind"
        role="button"
        tabindex="0"
        @click.stop="selectItem(item)"
        @keydown.enter.prevent="selectItem(item)"
        @keydown.space.prevent="selectItem(item)"
      >
        <div class="theme-preview" :style="{ background: previewColors(item)['--bg'] }">
          <div class="theme-preview-header">
            <span
              class="theme-dot"
              :style="{ background: previewColors(item)['--color-red'] }"
            ></span>
            <span
              class="theme-dot"
              :style="{ background: previewColors(item)['--color-yellow'] }"
            ></span>
            <span
              class="theme-dot"
              :style="{ background: previewColors(item)['--color-green'] }"
            ></span>
          </div>
          <div class="theme-preview-body">
            <span :style="{ color: previewColors(item)['--color-green'] }">$</span>
            <span :style="{ color: previewColors(item)['--fg'] }"> ls</span>
            <span :style="{ color: previewColors(item)['--color-blue'] }"> ~/src</span>
          </div>
          <div class="theme-swatches">
            <span class="swatch" :style="{ background: previewColors(item)['--color-red'] }"></span>
            <span
              class="swatch"
              :style="{ background: previewColors(item)['--color-green'] }"
            ></span>
            <span
              class="swatch"
              :style="{ background: previewColors(item)['--color-yellow'] }"
            ></span>
            <span
              class="swatch"
              :style="{ background: previewColors(item)['--color-blue'] }"
            ></span>
            <span
              class="swatch"
              :style="{ background: previewColors(item)['--color-magenta'] }"
            ></span>
            <span
              class="swatch"
              :style="{ background: previewColors(item)['--color-cyan'] }"
            ></span>
          </div>
        </div>
        <span class="theme-name">{{ item.label }}</span>
        <!-- A builtin and an installed theme can legitimately share a name, so
             the card has to say which one it is. -->
        <span v-if="item.kind === 'installed'" class="theme-card-badge">
          {{ t('settings.theme.installedBadge') }}
        </span>
        <div class="theme-card-actions">
          <!-- An installed theme is not ours to edit: it lives on the server as
               a file, and editing it here would fork it into a custom theme
               instead. Hidden rather than disabled so the card stays honest. -->
          <button v-if="item.kind !== 'installed'" type="button" @click.stop="openEdit(item)">
            {{ t('settings.theme.edit') }}
          </button>
          <button
            v-if="item.deletable"
            type="button"
            :class="{ confirm: pendingDeleteKey === item.key }"
            :disabled="themePacks.removing === item.id"
            @click.stop="deleteItem(item)"
          >
            {{
              item.kind === 'installed'
                ? themePacks.removing === item.id
                  ? t('settings.theme.removing')
                  : t('settings.theme.remove')
                : t('settings.theme.delete')
            }}<span v-if="pendingDeleteKey === item.key">?</span>
          </button>
        </div>
      </div>
    </div>

    <div class="theme-manager-installed-head">
      <span class="settings-hint">{{ t('settings.theme.installedHint') }}</span>
      <!-- Deliberately user-initiated: opening the appearance tab must not hit
           the server on its own. -->
      <button type="button" :disabled="themePacks.loading" @click.stop="reloadInstalled">
        {{ themePacks.loading ? t('settings.theme.reloading') : t('settings.theme.reload') }}
      </button>
    </div>

    <div class="theme-store">
      <div class="theme-store-head">
        <h4 class="theme-store-title">{{ t('settings.theme.store') }}</h4>
        <button type="button" :disabled="themePacks.registryLoading" @click.stop="browseStore">
          {{
            themePacks.registryLoading
              ? t('settings.theme.storeLoading')
              : t('settings.theme.storeBrowse')
          }}
        </button>
      </div>
      <p v-if="storeError" class="theme-manager-error">{{ storeError }}</p>
      <!-- Unset is the shipped default, not a fault: say so plainly. -->
      <p
        v-else-if="themePacks.registry !== null && !themePacks.registryConfigured"
        class="settings-hint"
      >
        {{ t('settings.theme.storeUnconfigured') }}
      </p>
      <p v-else-if="themePacks.registry?.length === 0" class="settings-hint">
        {{ t('settings.theme.storeEmpty') }}
      </p>
      <div v-if="themePacks.registry?.length" class="theme-store-list">
        <div v-for="entry in themePacks.registry" :key="entry.id" class="theme-store-row">
          <span class="theme-store-name">{{ entry.name }}</span>
          <span v-if="entry.version" class="theme-store-version">{{ entry.version }}</span>
          <button
            type="button"
            :disabled="themePacks.installing !== null"
            @click.stop="installStoreTheme(entry.id)"
          >
            {{
              themePacks.installing === entry.id
                ? t('settings.theme.storeInstalling')
                : t('settings.theme.storeInstall')
            }}
          </button>
        </div>
      </div>
    </div>

    <ThemeEditorDialog
      :open="editor.open"
      :initial-colors="editor.initialColors"
      :initial-name="editor.initialName"
      :can-save-changes="editor.canSaveChanges"
      @save-as-new="onSaveAsNew"
      @save-changes="onSaveChanges"
      @cancel="onCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { getThemeByName, themes } from '../../themes'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import {
  buildCustomThemeColors,
  clearThemeSelection,
  effectiveTheme,
  getThemeSelection,
  setThemeSelection,
  type SavedTheme,
  type ThemeColors,
} from '../../composables/useDeviceThemeSelection'
import {
  installFromRegistry,
  installThemePack,
  loadThemePacks,
  loadThemeRegistry,
  removeThemePack,
  themePacks,
} from '../../composables/useThemePacks'
import { randomId } from '../../utils/id'
import { parseThemeFile } from '../../utils/themeImport'
import { downloadTheme } from '../../utils/themeTemplate'
import ThemeEditorDialog from './ThemeEditorDialog.vue'

const BASE_NAMES = ['dark', 'light', 'dracula']
const VISIBLE_CAP = 15

const ANSI_KEYS = [
  '--color-black',
  '--color-red',
  '--color-green',
  '--color-yellow',
  '--color-blue',
  '--color-magenta',
  '--color-cyan',
  '--color-white',
  '--color-bright-black',
  '--color-bright-red',
  '--color-bright-green',
  '--color-bright-yellow',
  '--color-bright-blue',
  '--color-bright-magenta',
  '--color-bright-cyan',
  '--color-bright-white',
] as const

interface ThemeItem {
  key: string
  kind: 'builtin' | 'custom' | 'installed'
  name?: string
  uuid?: string
  /** Set only for `installed`, where the id is the server-side filename. */
  id?: string
  label: string
  colors: Record<string, string>
  deletable: boolean
  isBase: boolean
  active: boolean
}

const { settings, saveSettings, applyCurrentTheme } = useSettings()
const { t, themeLabel } = useI18n()

const pendingDeleteKey = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const installInput = ref<HTMLInputElement | null>(null)
const importErrors = ref<string[]>([])
const libraryError = ref('')
const importedUuid = ref<string | null>(null)
/** Failure and success of the server-side install actions, which are not part
 *  of the local library and so must not be reported as library problems. */
const installError = ref('')
const installNotice = ref('')
const storeError = ref('')

// The list is loaded once at startup (so a device showing an installed theme
// gets it on first paint) and refreshed by the actions below. There is no
// fetch on mount: rendering the appearance tab must not talk to the server, and
// this button is the recovery path when the startup fetch did not land.
async function reloadInstalled() {
  libraryError.value = ''
  await loadThemePacks()
}

function extractColors(full: Record<string, string>): ThemeColors {
  return {
    foreground: full['--fg'],
    background: full['--bg'],
    cursor: full['--cursor'] || full['--fg-muted'],
    ansi: ANSI_KEYS.map((key) => full[key]),
  }
}

function previewColors(item: ThemeItem): Record<string, string> {
  if (item.kind === 'builtin') return getThemeByName(item.name!).colors
  if (item.kind === 'installed') {
    const installed = themePacks.installed.find((theme) => theme.id === item.id)
    return installed ? buildCustomThemeColors(installed) : item.colors
  }
  const saved = settings.custom_themes.find((theme) => theme.uuid === item.uuid)
  return saved ? buildCustomThemeColors(saved) : item.colors
}

async function exportCurrentTheme() {
  const activeItem = themeItems.value.find((item) => item.active)
  const name = activeItem ? activeItem.label : themeLabel(settings.theme.preset)
  const colors = activeItem
    ? extractColors(previewColors(activeItem))
    : extractColors(effectiveTheme.value.colors)
  await downloadTheme(name, colors)
}

const themeItems = computed<ThemeItem[]>(() => {
  const hidden = new Set(settings.hidden_builtins)
  const selection = getThemeSelection()
  const activeBuiltin = selection
    ? selection.kind === 'builtin'
      ? selection.name
      : null
    : settings.theme.preset
  const activeUuid = selection?.kind === 'custom' ? selection.uuid : null
  const activeInstalledId = selection?.kind === 'installed' ? selection.id : null
  const items: ThemeItem[] = []

  const builtinItem = (name: string, deletable: boolean, isBase: boolean): ThemeItem => ({
    key: `b:${name}`,
    kind: 'builtin',
    name,
    label: themeLabel(name),
    colors: getThemeByName(name).colors,
    deletable,
    isBase,
    active: activeBuiltin === name,
  })

  for (const name of BASE_NAMES) items.push(builtinItem(name, false, true))
  for (const theme of themes) {
    if (BASE_NAMES.includes(theme.name) || hidden.has(theme.name)) continue
    items.push(builtinItem(theme.name, true, false))
  }
  for (const saved of settings.custom_themes) {
    items.push({
      key: `c:${saved.uuid}`,
      kind: 'custom',
      uuid: saved.uuid,
      name: saved.name,
      label: saved.name,
      colors: buildCustomThemeColors(saved),
      deletable: true,
      isBase: false,
      active: activeUuid === saved.uuid,
    })
  }
  // Installed themes last: they are a separate source, and grouping them keeps
  // "mine" and "this server's" visually distinct.
  for (const installed of themePacks.installed) {
    items.push({
      key: `i:${installed.id}`,
      kind: 'installed',
      id: installed.id,
      name: installed.name,
      label: installed.name,
      colors: buildCustomThemeColors(installed),
      deletable: true,
      isBase: false,
      active: activeInstalledId === installed.id,
    })
  }
  return items
})

// The cap bounds `custom_themes`, so installed themes must not count toward it
// — otherwise installing a few would disable "New theme" for no reason.
const visibleCount = computed(
  () => themeItems.value.filter((item) => item.kind !== 'installed').length
)
const atCap = computed(() => visibleCount.value >= VISIBLE_CAP)

const editor = reactive<{
  open: boolean
  initialColors: ThemeColors
  initialName: string
  canSaveChanges: boolean
  targetUuid: string | null
}>({
  open: false,
  initialColors: extractColors(getThemeByName('dark').colors),
  initialName: '',
  canSaveChanges: false,
  targetUuid: null,
})

async function rebaseLibrary() {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/settings'))
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.custom_themes)) settings.custom_themes = data.custom_themes
      if (Array.isArray(data.hidden_builtins)) settings.hidden_builtins = data.hidden_builtins
    }
  } catch {
    // Offline: fall through to optimistic save.
  }
}

async function commitLibrary(op: () => void) {
  await rebaseLibrary()
  op()
  await saveSettings()
}

function selectItem(item: ThemeItem) {
  pendingDeleteKey.value = null
  if (item.kind === 'builtin') setThemeSelection({ kind: 'builtin', name: item.name! })
  else if (item.kind === 'installed') setThemeSelection({ kind: 'installed', id: item.id! })
  else setThemeSelection({ kind: 'custom', uuid: item.uuid! })
}

async function deleteItem(item: ThemeItem) {
  if (item.isBase) return
  if (pendingDeleteKey.value !== item.key) {
    pendingDeleteKey.value = item.key
    return
  }

  pendingDeleteKey.value = null
  const selection = getThemeSelection()

  if (item.kind === 'installed') {
    // Removing is a server call, not a settings write: it takes the file out
    // of the directory every device reads from, so there is no optimistic
    // local edit to make and no library to rebase.
    const result = await removeThemePack(item.id!)
    if (!result.ok) {
      libraryError.value = result.error
      return
    }
  } else if (item.kind === 'builtin') {
    await commitLibrary(() => {
      if (!settings.hidden_builtins.includes(item.name!)) settings.hidden_builtins.push(item.name!)
    })
  } else {
    await commitLibrary(() => {
      settings.custom_themes = settings.custom_themes.filter((theme) => theme.uuid !== item.uuid)
    })
  }

  const wasActive =
    (item.kind === 'builtin' && selection?.kind === 'builtin' && selection.name === item.name) ||
    (item.kind === 'custom' && selection?.kind === 'custom' && selection.uuid === item.uuid) ||
    (item.kind === 'installed' && selection?.kind === 'installed' && selection.id === item.id)
  if (wasActive) {
    clearThemeSelection()
    applyCurrentTheme()
  }
}

function openInstall() {
  pendingDeleteKey.value = null
  libraryError.value = ''
  installError.value = ''
  installNotice.value = ''
  installInput.value?.click()
}

async function onInstallFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  installError.value = ''
  installNotice.value = ''
  if (!file) return
  try {
    const result = await installThemePack(await file.text(), file.name)
    if (!result.ok) {
      installError.value = result.error
      return
    }
    installNotice.value = t('settings.theme.installed', { name: result.name })
  } finally {
    input.value = ''
  }
}

async function browseStore() {
  storeError.value = ''
  await loadThemeRegistry()
  // The server reports an unreachable registry in the body, not as a throw.
  if (themePacks.registryError) storeError.value = themePacks.registryError
}

async function installStoreTheme(id: string) {
  storeError.value = ''
  installNotice.value = ''
  const result = await installFromRegistry(id)
  if (!result.ok) {
    storeError.value = result.error
    return
  }
  installNotice.value = t('settings.theme.installed', { name: result.name })
}

function uniqueName(base: string): string {
  const names = new Set<string>()
  for (const theme of themes) {
    names.add(theme.name)
    names.add(themeLabel(theme.name))
  }
  for (const name of settings.hidden_builtins) names.add(name)
  for (const theme of settings.custom_themes) names.add(theme.name)
  // Installed names too: a custom theme that shadowed one would make the grid
  // show the same label twice with no way to tell which is which.
  for (const theme of themePacks.installed) names.add(theme.name)
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} (${suffix})`)) suffix += 1
  return `${base} (${suffix})`
}

function translatedOr(key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

function showCapError() {
  libraryError.value = t('settings.theme.atCap')
}

function openCreate() {
  pendingDeleteKey.value = null
  libraryError.value = ''
  if (atCap.value) {
    showCapError()
    return
  }
  editor.initialColors = extractColors(effectiveTheme.value.colors)
  editor.initialName = uniqueName(translatedOr('settings.theme.newName', 'Custom'))
  editor.canSaveChanges = false
  editor.targetUuid = null
  editor.open = true
}

function openEdit(item: ThemeItem) {
  pendingDeleteKey.value = null
  libraryError.value = ''
  if (item.kind === 'builtin') {
    editor.initialColors = extractColors(item.colors)
    editor.initialName = uniqueName(`${item.label} copy`)
    editor.canSaveChanges = false
    editor.targetUuid = null
  } else {
    const saved = settings.custom_themes.find((theme) => theme.uuid === item.uuid)
    if (!saved) return
    editor.initialColors = cloneSavedColors(saved)
    editor.initialName = item.name!
    editor.canSaveChanges = true
    editor.targetUuid = item.uuid!
  }
  editor.open = true
}

function cloneSavedColors(saved: SavedTheme): ThemeColors {
  return {
    foreground: saved.colors.foreground,
    background: saved.colors.background,
    cursor: saved.colors.cursor,
    ansi: saved.colors.ansi.slice(0, 16),
  }
}

async function onSaveAsNew(colors: ThemeColors, name: string) {
  libraryError.value = ''
  if (atCap.value) {
    showCapError()
    return
  }
  const finalName = uniqueName(name || 'Custom')
  const uuid = randomId()
  await commitLibrary(() => {
    settings.custom_themes.push({ uuid, name: finalName, colors })
  })
  setThemeSelection({ kind: 'custom', uuid })
  editor.open = false
}

async function onSaveChanges(colors: ThemeColors) {
  const uuid = editor.targetUuid
  if (!uuid) return
  await commitLibrary(() => {
    const theme = settings.custom_themes.find((candidate) => candidate.uuid === uuid)
    if (theme) theme.colors = colors
  })
  editor.open = false
}

function onCancel() {
  editor.open = false
  applyCurrentTheme()
}

function openImport() {
  pendingDeleteKey.value = null
  libraryError.value = ''
  importErrors.value = []
  if (atCap.value) {
    showCapError()
    return
  }
  fileInput.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importErrors.value = []
  libraryError.value = ''
  importedUuid.value = null
  try {
    const result = parseThemeFile(await file.text())
    if (!result.ok) {
      importErrors.value = result.errors
      return
    }
    if (atCap.value) {
      showCapError()
      return
    }
    const fileBaseName = file.name.replace(/\.[^.]+$/, '').trim()
    const finalName = uniqueName((result.name && result.name.trim()) || fileBaseName || 'Imported')
    const uuid = randomId()
    await commitLibrary(() => {
      settings.custom_themes.push({ uuid, name: finalName, colors: result.colors })
    })
    importedUuid.value = uuid
  } finally {
    input.value = ''
  }
}

function applyImportedTheme() {
  if (!importedUuid.value) return
  setThemeSelection({ kind: 'custom', uuid: importedUuid.value })
  importedUuid.value = null
}
</script>

<style scoped>
.theme-manager-toolbar,
.theme-manager-actions,
.theme-manager-count,
.theme-card-actions,
.theme-manager-apply {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-manager-toolbar {
  justify-content: space-between;
  margin-bottom: 10px;
}

.theme-manager-toolbar button,
.theme-card-actions button,
.theme-manager-apply button {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg-muted);
  background: var(--bg-input);
  font-size: 11px;
  cursor: pointer;
}

.theme-manager-toolbar button:hover:not(:disabled),
.theme-card-actions button:hover,
.theme-manager-apply button:hover {
  border-color: var(--accent);
  color: var(--fg);
}

.theme-manager-toolbar button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.theme-manager-count {
  justify-content: flex-end;
  color: var(--fg-muted);
  font-size: 11px;
}

.theme-manager-cap,
.theme-manager-error {
  color: var(--danger);
}

.theme-manager-error,
.theme-manager-notice,
.theme-manager-hint {
  margin: 8px 0;
  font-size: 12px;
}

.theme-manager-notice {
  color: var(--accent);
}

.theme-manager-hint {
  color: var(--fg-muted);
}

.theme-card-badge {
  display: block;
  padding: 0 8px 4px;
  color: var(--accent);
  font-size: 9px;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.theme-manager-installed-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.theme-manager-installed-head .settings-hint {
  flex: 1;
  margin-bottom: 0;
}

.theme-manager-installed-head button {
  flex: none;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg-muted);
  background: var(--bg-input);
  font-size: 11px;
  cursor: pointer;
}

.theme-manager-installed-head button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--fg);
}

.theme-manager-installed-head button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.theme-store {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--divider);
}

.theme-store-head,
.theme-store-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-store-head {
  justify-content: space-between;
  margin-bottom: 6px;
}

.theme-store-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.theme-store-row {
  padding: 4px 0;
}

.theme-store-name {
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-store-version {
  color: var(--fg-muted);
  font-size: 10px;
}

.theme-store-head button,
.theme-store-row button {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg-muted);
  background: var(--bg-input);
  font-size: 11px;
  cursor: pointer;
}

.theme-store-head button:hover:not(:disabled),
.theme-store-row button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--fg);
}

.theme-store-head button:disabled,
.theme-store-row button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.theme-manager-error ul {
  margin: 4px 0 0;
  padding-left: 18px;
}

.theme-manager-apply {
  margin: 8px 0;
}

.theme-file-input {
  display: none;
}

.theme-card-actions {
  justify-content: center;
  padding: 0 6px 6px;
}

.theme-card-actions button {
  padding: 3px 6px;
  font-size: 9px;
}

.theme-card-actions button.confirm {
  border-color: var(--danger);
  color: var(--danger);
}

@media (max-width: 560px) {
  .theme-manager-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

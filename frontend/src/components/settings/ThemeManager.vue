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

    <div class="theme-grid">
      <div
        v-for="item in themeItems"
        :key="item.key"
        class="theme-card"
        :class="{ active: item.active }"
        role="button"
        tabindex="0"
        @click.stop="selectItem(item)"
        @keydown.enter.prevent="selectItem(item)"
        @keydown.space.prevent="selectItem(item)"
      >
        <div class="theme-preview" :style="{ background: previewColors(item)['--bg'] }">
          <div class="theme-preview-header">
            <span class="theme-dot" :style="{ background: previewColors(item)['--color-red'] }"></span>
            <span class="theme-dot" :style="{ background: previewColors(item)['--color-yellow'] }"></span>
            <span class="theme-dot" :style="{ background: previewColors(item)['--color-green'] }"></span>
          </div>
          <div class="theme-preview-body">
            <span :style="{ color: previewColors(item)['--color-green'] }">$</span>
            <span :style="{ color: previewColors(item)['--fg'] }"> ls</span>
            <span :style="{ color: previewColors(item)['--color-blue'] }"> ~/src</span>
          </div>
          <div class="theme-swatches">
            <span class="swatch" :style="{ background: previewColors(item)['--color-red'] }"></span>
            <span class="swatch" :style="{ background: previewColors(item)['--color-green'] }"></span>
            <span class="swatch" :style="{ background: previewColors(item)['--color-yellow'] }"></span>
            <span class="swatch" :style="{ background: previewColors(item)['--color-blue'] }"></span>
            <span class="swatch" :style="{ background: previewColors(item)['--color-magenta'] }"></span>
            <span class="swatch" :style="{ background: previewColors(item)['--color-cyan'] }"></span>
          </div>
        </div>
        <span class="theme-name">{{ item.label }}</span>
        <div class="theme-card-actions">
          <button type="button" @click.stop="openEdit(item)">
            {{ t('settings.theme.edit') }}
          </button>
          <button
            v-if="item.deletable"
            type="button"
            :class="{ confirm: pendingDeleteKey === item.key }"
            @click.stop="deleteItem(item)"
          >
            {{ t('settings.theme.delete') }}<span v-if="pendingDeleteKey === item.key">?</span>
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
  kind: 'builtin' | 'custom'
  name?: string
  uuid?: string
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
const importErrors = ref<string[]>([])
const libraryError = ref('')
const importedUuid = ref<string | null>(null)

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
  const saved = settings.custom_themes.find((theme) => theme.uuid === item.uuid)
  return saved ? buildCustomThemeColors(saved) : item.colors
}

function exportCurrentTheme() {
  const activeItem = themeItems.value.find((item) => item.active)
  const name = activeItem ? activeItem.label : themeLabel(settings.theme.preset)
  const colors = activeItem
    ? extractColors(previewColors(activeItem))
    : extractColors(effectiveTheme.value.colors)
  downloadTheme(name, colors)
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
  return items
})

const visibleCount = computed(() => themeItems.value.length)
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
  setThemeSelection(
    item.kind === 'builtin'
      ? { kind: 'builtin', name: item.name! }
      : { kind: 'custom', uuid: item.uuid! },
  )
}

async function deleteItem(item: ThemeItem) {
  if (item.isBase) return
  if (pendingDeleteKey.value !== item.key) {
    pendingDeleteKey.value = item.key
    return
  }

  pendingDeleteKey.value = null
  const selection = getThemeSelection()
  if (item.kind === 'builtin') {
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
    (item.kind === 'custom' && selection?.kind === 'custom' && selection.uuid === item.uuid)
  if (wasActive) {
    clearThemeSelection()
    applyCurrentTheme()
  }
}

function uniqueName(base: string): string {
  const names = new Set<string>()
  for (const theme of themes) {
    names.add(theme.name)
    names.add(themeLabel(theme.name))
  }
  for (const name of settings.hidden_builtins) names.add(name)
  for (const theme of settings.custom_themes) names.add(theme.name)
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
  color: var(--color-red, #ef4444);
}

.theme-manager-error {
  margin: 8px 0;
  font-size: 12px;
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
  border-color: var(--color-red, #ef4444);
  color: var(--color-red, #ef4444);
}

@media (max-width: 560px) {
  .theme-manager-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

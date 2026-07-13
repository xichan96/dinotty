<template>
  <div>
    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.theme') }}</h3>
      <div class="theme-grid">
        <button
          v-for="th in themes"
          :key="th.name"
          class="theme-card"
          :class="{ active: settings.theme.preset === th.name }"
          @click="
            settings.theme.preset = th.name;
            selectTheme();
          "
        >
          <div class="theme-preview" :style="{ background: th.colors['--bg'] }">
            <div class="theme-preview-header">
              <span class="theme-dot" :style="{ background: th.colors['--color-red'] }"></span>
              <span class="theme-dot" :style="{ background: th.colors['--color-yellow'] }"></span>
              <span class="theme-dot" :style="{ background: th.colors['--color-green'] }"></span>
            </div>
            <div class="theme-preview-body">
              <span :style="{ color: th.colors['--color-green'] }">$</span>
              <span :style="{ color: th.colors['--fg'] }"> ls</span>
              <span :style="{ color: th.colors['--color-blue'] }"> ~/src</span>
            </div>
            <div class="theme-swatches">
              <span class="swatch" :style="{ background: th.colors['--color-red'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-green'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-yellow'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-blue'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-magenta'] }"></span>
              <span class="swatch" :style="{ background: th.colors['--color-cyan'] }"></span>
            </div>
          </div>
          <span class="theme-name">{{ themeLabel(th.name) }}</span>
        </button>
      </div>
    </div>

    <CollapsibleSection :title="t('settings.customColors')" level="group" default-open>
      <p class="settings-hint">{{ t('settings.customColorsHint') }}</p>
      <div class="custom-colors-grid">
        <label class="color-field">
          <span>{{ t('settings.color.fg') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customFg" @input="setCustomColor('fg', $event)" />
            <span class="color-hex">{{ customFg }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.bg') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customBg" @input="setCustomColor('bg', $event)" />
            <span class="color-hex">{{ customBg }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.cursor') }}</span>
          <div class="color-input-wrap">
            <input type="color" :value="customCursor" @input="setCustomColor('cursor', $event)" />
            <span class="color-hex">{{ customCursor }}</span>
          </div>
        </label>
      </div>
      <details class="ansi-details">
        <summary>{{ t('settings.color.ansi') }}</summary>
        <div class="ansi-grid">
          <label v-for="(c, i) in ansiColors" :key="i" class="ansi-field">
            <span class="ansi-label">{{ ansiNames[i] }}</span>
            <input type="color" :value="c" @input="setAnsiColor(i, $event)" />
          </label>
        </div>
      </details>
    </CollapsibleSection>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.text') }}</h3>

      <div class="settings-row">
        <label>{{ t('settings.text.fontSize') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="fontSize"
            :min="FONT_SIZE_MIN"
            :max="FONT_SIZE_MAX"
            step="1"
          />
          <span class="range-val">{{ fontSize }}px</span>
          <button
            v-if="hasOverride('font_size')"
            type="button"
            class="setting-reset"
            title="reset to default"
            aria-label="reset to default"
            @click="resetOverride('font_size')"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.fontFamily') }}</label>
        <div class="font-dropdown">
          <div
            class="font-dropdown-trigger shortcut-input"
            :style="{ fontFamily: fontFamily || 'inherit' }"
            @click="toggleFontDropdown"
          >
            <span>{{ currentFontLabel }}</span>
            <span class="font-dropdown-arrow">▾</span>
          </div>
          <div v-if="fontDropdownOpen" class="font-dropdown-backdrop" @click="closeFontDropdown"></div>
          <div v-if="fontDropdownOpen" class="font-dropdown-menu" @wheel="onFontMenuWheel">
            <div
              v-for="item in fontList"
              :key="item.kind + ':' + item.family"
              class="font-dropdown-item"
              :class="{ active: item.selected }"
              @click="selectFontItem(item)"
            >
              <span class="font-item-label">{{ fontItemLabel(item) }}</span>
              <span
                v-if="item.available"
                class="font-item-sample"
                :style="{ fontFamily: item.previewStack }"
              >Aa 01</span>
              <span v-else class="font-item-badge">{{ t('settings.text.fontNotInstalled') }}</span>
              <button
                v-if="item.removable"
                class="font-item-remove"
                :title="t('settings.text.fontRemove')"
                @click.stop="removeFontItem(item)"
              >×</button>
              <button
                v-else-if="item.kind === 'orphan'"
                class="font-item-remove"
                :title="t('settings.text.fontAdd')"
                @click.stop="addOrphanToList(item)"
              >+</button>
            </div>
            <div class="font-dropdown-divider"></div>
            <div class="font-custom-input-wrap" @click.stop>
              <input
                ref="addFontInput"
                v-model="addFontName"
                class="shortcut-input font-custom-input"
                :placeholder="t('settings.text.fontAddPlaceholder')"
                @keydown.enter="addFontFromInput"
              />
              <button class="shortcut-add" @click="addFontFromInput">{{ t('settings.text.fontAdd') }}</button>
            </div>
            <div v-if="addFontError" class="font-add-error">{{ addFontError }}</div>
          </div>
        </div>
        <button
          v-if="hasOverride('font_family')"
          type="button"
          class="setting-reset"
          title="reset to default"
          aria-label="reset to default"
          @click="resetOverride('font_family')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.lineHeight') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="lineHeight"
            min="0.8"
            max="2.0"
            step="0.1"
          />
          <span class="range-val">{{ lineHeight.toFixed(1) }}</span>
          <button
            v-if="hasOverride('line_height')"
            type="button"
            class="setting-reset"
            title="reset to default"
            aria-label="reset to default"
            @click="resetOverride('line_height')"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.letterSpacing') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="letterSpacing"
            min="0"
            max="4"
            step="0.5"
          />
          <span class="range-val">{{ letterSpacing }}px</span>
          <button
            v-if="hasOverride('letter_spacing')"
            type="button"
            class="setting-reset"
            title="reset to default"
            aria-label="reset to default"
            @click="resetOverride('letter_spacing')"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      </div>

      <CollapsibleSection :title="t('settings.advancedText')" level="section" default-open>

      <div class="settings-row">
        <label>{{ t('settings.text.cursorStyle') }}</label>
        <select
          v-model="settings.text.cursor_style"
          class="shortcut-input"
          style="flex: 1"
          @change="onTextSettingChange"
        >
          <option value="block">{{ t('settings.text.cursor.block') }}</option>
          <option value="underline">{{ t('settings.text.cursor.underline') }}</option>
          <option value="bar">{{ t('settings.text.cursor.bar') }}</option>
        </select>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.cursorBlink') }}</label>
        <label class="toggle">
          <input
            type="checkbox"
            v-model="settings.text.cursor_blink"
            @change="onTextSettingChange"
          />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.scrollback') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.scrollback"
            min="1000"
            max="100000"
            step="1000"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.scrollback.toLocaleString() }}</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.scrollSensitivity') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.scroll_sensitivity"
            min="0.1"
            max="2"
            step="0.1"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.scroll_sensitivity.toFixed(1) }}</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.scrollAcceleration') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.scroll_acceleration"
            min="0"
            max="5"
            step="1"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.scroll_acceleration.toFixed(0) }}</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.scrollbarWidth') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.scrollbar_width"
            min="4"
            max="16"
            step="1"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.scrollbar_width }}</span>
        </div>
      </div>

      </CollapsibleSection>
    </div>

    <div class="settings-group" style="text-align: right">
      <button class="shortcut-add" @click="resetCustomColors">
        {{ t('settings.color.reset') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, reactive } from 'vue'
import { useSettings, notifyTextChange } from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import { useI18n } from '../../composables/useI18n'
import { themes, getThemeByName } from '../../themes'
import { primaryFamily, toFontFamilyStack, fontIdentity } from '../../utils/fontFamily'
import {
  buildFontList,
  normalizeCustomFonts,
  validateFontName,
  type FontItem,
  type AddFontError,
} from '../../utils/fontList'
import { isFontAvailable, clearNegativeFontCache } from '../../utils/fontAvailability'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  useDeviceTextSettings,
} from '../../composables/useDeviceTextSettings'

const { settings, saveSettings, applyCurrentTheme } = useSettings()
const {
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  hasOverride,
  resetOverride,
} = useDeviceTextSettings()
const { t, themeLabel } = useI18n()

// ── Theme ──

function selectTheme() {
  applyCurrentTheme()
  saveSettings()
}

const ansiNames = [
  'Black',
  'Red',
  'Green',
  'Yellow',
  'Blue',
  'Magenta',
  'Cyan',
  'White',
  'Bright Black',
  'Bright Red',
  'Bright Green',
  'Bright Yellow',
  'Bright Blue',
  'Bright Magenta',
  'Bright Cyan',
  'Bright White',
]

const ansiColorKeys = [
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
]

function ensureCustom() {
  if (!settings.theme.custom) {
    settings.theme.custom = {
      foreground: undefined,
      background: undefined,
      cursor: undefined,
      ansi: undefined,
    }
  }
  return settings.theme.custom!
}

const customFg = computed(() => {
  const c = settings.theme.custom
  if (c?.foreground) return c.foreground
  return getThemeByName(settings.theme.preset).colors['--fg']
})

const customBg = computed(() => {
  const c = settings.theme.custom
  if (c?.background) return c.background
  return getThemeByName(settings.theme.preset).colors['--bg']
})

const customCursor = computed(() => {
  const c = settings.theme.custom
  if (c?.cursor) return c.cursor
  return getThemeByName(settings.theme.preset).colors['--fg-muted']
})

const ansiColors = computed(() => {
  const theme = getThemeByName(settings.theme.preset)
  const custom = settings.theme.custom
  return ansiColorKeys.map((key, i) => {
    if (custom?.ansi?.[i]) return custom.ansi[i]
    return theme.colors[key]
  })
})

function setCustomColor(which: 'fg' | 'bg' | 'cursor', e: Event) {
  const val = (e.target as HTMLInputElement).value
  const custom = ensureCustom()
  if (which === 'fg') custom.foreground = val
  else if (which === 'bg') custom.background = val
  else custom.cursor = val
  applyCurrentTheme()
  saveSettings()
}

function setAnsiColor(index: number, e: Event) {
  const val = (e.target as HTMLInputElement).value
  const custom = ensureCustom()
  if (!custom.ansi) custom.ansi = []
  custom.ansi[index] = val
  applyCurrentTheme()
  saveSettings()
}

function resetCustomColors() {
  settings.theme.custom = null
  applyCurrentTheme()
  saveSettings()
}

// ── Text / Font ──

const customColorsOpen = ref(false)
const advancedTextOpen = ref(false)
const fontDropdownOpen = ref(false)

// ── Font picker (DT17) ──
const availability = reactive<Record<string, boolean>>({})
const addFontName = ref('')
const addFontError = ref('')
const addFontInput = ref<HTMLInputElement | null>(null)

const customFonts = computed<string[]>(() => settings.text.custom_fonts ?? [])

interface DecoratedItem extends FontItem { available: boolean }

const fontList = computed<DecoratedItem[]>(() =>
  buildFontList(fontFamily.value || '', customFonts.value).map((it) => {
    let available = true
    if (it.kind !== 'default') {
      const id = fontIdentity(it.family)
      available = id === 'monospace' ? true : (availability[id] ?? true)
    }
    return { ...it, available }
  }),
)

const currentFontLabel = computed(() =>
  fontFamily.value ? primaryFamily(fontFamily.value) : t('settings.text.fontFamilyDefault'),
)

function fontItemLabel(item: FontItem): string {
  return item.kind === 'default' ? t('settings.text.fontFamilyDefault') : item.family
}

function probe(family: string) {
  const id = fontIdentity(family)
  if (id in availability) return
  availability[id] = isFontAvailable(family)
}

async function runProbes() {
  try {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) await fonts.ready
  } catch { /* ignore */ }
  clearNegativeFontCache()
  for (const key of Object.keys(availability)) delete availability[key]
  for (const it of buildFontList(fontFamily.value || '', customFonts.value)) {
    if (it.kind !== 'default') probe(it.family)
  }
}

function onFontMenuWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  const atTop = el.scrollTop <= 0 && e.deltaY < 0
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && e.deltaY > 0
  if (atTop || atBottom) e.preventDefault()
}

function toggleFontDropdown() {
  if (fontDropdownOpen.value) { closeFontDropdown(); return }
  fontDropdownOpen.value = true
  addFontError.value = ''
  void runProbes()
}

function closeFontDropdown() {
  fontDropdownOpen.value = false
  addFontError.value = ''
}

function selectFontItem(item: FontItem) {
  fontFamily.value = item.kind === 'default' ? '' : toFontFamilyStack(item.family)
  fontDropdownOpen.value = false
}

const ADD_ERR_KEY: Record<Exclude<AddFontError, ''>, string> = {
  blank: 'settings.text.fontErrBlank',
  tooLong: 'settings.text.fontErrTooLong',
  invalidChars: 'settings.text.fontErrInvalidChars',
  duplicate: 'settings.text.fontErrDuplicate',
  limit: 'settings.text.fontErrLimit',
}

function addFontValue(rawName: string) {
  const name = primaryFamily(rawName)
  const err = validateFontName(name, customFonts.value)
  if (err) { addFontError.value = t(ADD_ERR_KEY[err]); return }
  settings.text.custom_fonts = normalizeCustomFonts([...customFonts.value, name])
  addFontName.value = ''
  addFontError.value = ''
  probe(name)
  onTextSettingChange()
}

function addFontFromInput() { addFontValue(addFontName.value) }

function addOrphanToList(item: FontItem) { addFontValue(item.family) }

function removeFontItem(item: FontItem) {
  if (!item.removable) return
  const id = fontIdentity(item.family)
  settings.text.custom_fonts = normalizeCustomFonts(customFonts.value.filter((c) => fontIdentity(c) !== id))
  if (fontIdentity(fontFamily.value || '') === id) {
    fontFamily.value = 'monospace'
  }
  onTextSettingChange()
}

let textChangeTimer: ReturnType<typeof setTimeout> | null = null

function onTextSettingChange() {
  if (textChangeTimer) clearTimeout(textChangeTimer)
  textChangeTimer = setTimeout(() => {
    notifyTextChange()
    saveSettings()
    textChangeTimer = null
  }, 100)
}

onBeforeUnmount(() => {
  if (textChangeTimer) clearTimeout(textChangeTimer)
})
</script>

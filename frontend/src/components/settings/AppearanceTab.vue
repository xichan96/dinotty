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

    <div class="settings-group">
      <h3
        class="settings-group-title section-title--collapsible"
        @click="customColorsOpen = !customColorsOpen"
      >
        <span class="chevron" :class="{ open: customColorsOpen }">▶</span>
        {{ t('settings.customColors') }}
      </h3>
      <template v-if="customColorsOpen">
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
      </template>
    </div>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.text') }}</h3>

      <div class="settings-row">
        <label>{{ t('settings.text.fontSize') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.font_size"
            min="8"
            max="32"
            step="1"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.font_size }}px</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.fontFamily') }}</label>
        <div class="font-dropdown">
          <div
            class="font-dropdown-trigger shortcut-input"
            :style="{ fontFamily: settings.text.font_family || 'inherit' }"
            @click="toggleFontDropdown"
          >
            <span>{{ currentFontLabel }}</span>
            <span class="font-dropdown-arrow">▾</span>
          </div>
          <div
            v-if="fontDropdownOpen"
            class="font-dropdown-backdrop"
            @click="closeFontDropdown"
          ></div>
          <div v-if="fontDropdownOpen" class="font-dropdown-menu">
            <div
              class="font-dropdown-item"
              :class="{ active: !settings.text.font_family }"
              @click="selectFont('')"
            >
              <span class="font-item-label">{{ t('settings.text.fontFamilyDefault') }}</span>
            </div>
            <div
              v-for="font in fontFamilies"
              :key="font.value"
              class="font-dropdown-item"
              :class="{ active: settings.text.font_family === font.value }"
              :style="{ fontFamily: font.value }"
              @click="selectFont(font.value)"
            >
              <span class="font-item-label">{{ font.label }}</span>
              <span class="font-item-sample">Aa 01</span>
            </div>
            <div class="font-dropdown-divider"></div>
            <div
              class="font-dropdown-item"
              :class="{ active: isCustomFont || customFontEditing }"
              @click="enterCustomFont"
            >
              <span class="font-item-label">{{ t('settings.text.fontFamilyCustom') }}</span>
            </div>
            <div
              v-if="isCustomFont || customFontEditing"
              class="font-custom-input-wrap"
              @click.stop
            >
              <input
                ref="customFontInput"
                v-model="customFontName"
                class="shortcut-input font-custom-input"
                :placeholder="t('settings.text.fontFamilyCustomHint')"
                @keydown.enter="applyCustomFont"
                @blur="applyCustomFont"
              />
            </div>
          </div>
        </div>
      </div>

      <details class="ansi-details">
        <summary>{{ t('settings.advancedText') }}</summary>

      <div class="settings-row">
        <label>{{ t('settings.text.lineHeight') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.line_height"
            min="0.8"
            max="2.0"
            step="0.1"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.line_height.toFixed(1) }}</span>
        </div>
      </div>

      <div class="settings-row">
        <label>{{ t('settings.text.letterSpacing') }}</label>
        <div class="range-wrap">
          <input
            type="range"
            v-model.number="settings.text.letter_spacing"
            min="0"
            max="4"
            step="0.5"
            @input="onTextSettingChange"
          />
          <span class="range-val">{{ settings.text.letter_spacing }}px</span>
        </div>
      </div>

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

      </details>
    </div>

    <div class="settings-group" style="text-align: right">
      <button class="shortcut-add" @click="resetCustomColors">
        {{ t('settings.color.reset') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useSettings, notifyTextChange } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { themes, getThemeByName } from '../../themes'

const { settings, saveSettings, applyCurrentTheme } = useSettings()
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

const fontFamilies = [
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'SF Mono', value: '"SF Mono", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'FiraCode Nerd Font', value: '"FiraCode Nerd Font", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'IBM Plex Mono', value: '"IBM Plex Mono", monospace' },
  { label: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
]

const customColorsOpen = ref(false)
const advancedTextOpen = ref(false)
const fontDropdownOpen = ref(false)
const customFontEditing = ref(false)
const customFontName = ref('')
const customFontInput = ref<HTMLInputElement | null>(null)

const isCustomFont = computed(() => {
  const current = settings.text.font_family
  if (!current) return false
  return !fontFamilies.some((f) => f.value === current)
})

const currentFontLabel = computed(() => {
  const current = settings.text.font_family
  if (!current) return t('settings.text.fontFamilyDefault')
  const found = fontFamilies.find((f) => f.value === current)
  if (found) return found.label
  return customFontName.value || current.replace(/, monospace$/, '')
})

function selectFont(value: string) {
  settings.text.font_family = value
  customFontEditing.value = false
  customFontName.value = ''
  fontDropdownOpen.value = false
  onTextSettingChange()
}

function enterCustomFont() {
  customFontEditing.value = true
  if (isCustomFont.value) {
    customFontName.value = settings.text.font_family.replace(/, monospace$/, '')
  }
  nextTick(() => customFontInput.value?.focus())
}

function toggleFontDropdown() {
  if (fontDropdownOpen.value) {
    closeFontDropdown()
    return
  }
  fontDropdownOpen.value = true
}

function closeFontDropdown() {
  fontDropdownOpen.value = false
  customFontEditing.value = false
}

function applyCustomFont() {
  const name = customFontName.value.trim()
  if (name) {
    settings.text.font_family = `${name}, monospace`
    onTextSettingChange()
  }
  closeFontDropdown()
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

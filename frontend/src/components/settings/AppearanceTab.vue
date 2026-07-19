<template>
  <div>
    <ThemeManager />

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
            ref="fontTriggerEl"
            class="font-dropdown-trigger shortcut-input"
            :style="{ fontFamily: fontFamily || 'inherit' }"
            @click="toggleFontDropdown"
          >
            <span>{{ currentFontLabel }}</span>
            <span class="font-dropdown-arrow">▾</span>
          </div>
          <div v-if="fontDropdownOpen" class="font-dropdown-backdrop" @click="closeFontDropdown" @wheel.prevent></div>
          <div
            v-if="fontDropdownOpen"
            class="font-dropdown-menu"
            :class="{ 'drop-up': fontMenuDropUp }"
            :style="{ maxHeight: fontMenuMaxHeight + 'px' }"
            @wheel="onFontMenuWheel"
          >
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

      <CollapsibleSection :title="t('settings.advancedText')" level="section">

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

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, reactive } from 'vue'
import { useSettings, notifyTextChange } from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import ThemeManager from './ThemeManager.vue'
import { useI18n } from '../../composables/useI18n'
import { primaryFamily, toFontFamilyStack, fontIdentity } from '../../utils/fontFamily'
import {
  buildFontList,
  normalizeCustomFonts,
  validateFontName,
  type FontItem,
  type AddFontError,
} from '../../utils/fontList'
import { isFontAvailable, clearNegativeFontCache } from '../../utils/fontAvailability'
import { computeDropdownPlacement } from '../../utils/dropdownPlacement'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  useDeviceTextSettings,
} from '../../composables/useDeviceTextSettings'

const { settings, saveSettings } = useSettings()
const {
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  hasOverride,
  resetOverride,
} = useDeviceTextSettings()
const { t } = useI18n()

// ── Text / Font ──

const PREFERRED_FONT_MENU_HEIGHT = 260
const fontTriggerEl = ref<HTMLElement | null>(null)
const fontDropdownOpen = ref(false)
const fontMenuDropUp = ref(false)
const fontMenuMaxHeight = ref(PREFERRED_FONT_MENU_HEIGHT)

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
  const el = fontTriggerEl.value
  const placement = el
    ? computeDropdownPlacement(
        el.getBoundingClientRect(),
        el.closest('.settings-body')?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight },
        PREFERRED_FONT_MENU_HEIGHT,
      )
    : { dropUp: false, maxHeight: PREFERRED_FONT_MENU_HEIGHT }
  fontMenuDropUp.value = placement.dropUp
  fontMenuMaxHeight.value = placement.maxHeight
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

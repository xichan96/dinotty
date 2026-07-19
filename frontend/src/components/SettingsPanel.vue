<template>
  <div class="settings-backdrop" :class="{ open }" @click.self="$emit('close')">
    <div class="settings-panel" :class="{ open }">
      <div class="settings-header">
        <h2>{{ t('settings.title') }}</h2>
        <button class="settings-close" @click="$emit('close')"><X :size="14" /></button>
      </div>

      <div class="settings-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="settings-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="settings-tab-icon"><component :is="tab.icon" :size="20" /></span
          ><span class="settings-tab-label">{{ tab.label }}</span>
        </button>
      </div>

      <div class="settings-body">
        <GeneralTab v-show="activeTab === 'general'" @token-changed="emit('token-changed')" />
        <AppearanceTab v-show="activeTab === 'appearance'" />
        <KeyboardTab v-show="activeTab === 'keyboard'" />
        <MonitorTab v-show="activeTab === 'monitor'" />
        <NotificationTab v-show="activeTab === 'notification'" />
        <PluginsTab v-show="activeTab === 'plugins'" />
        <AboutTab v-show="activeTab === 'about'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, defineAsyncComponent } from 'vue'
import { useSettings, notifyTextChange } from '../composables/useSettings'
import { effectiveTheme } from '../composables/useDeviceThemeSelection'
import { useI18n } from '../composables/useI18n'
import {
  Settings as SettingsIcon,
  Palette,
  Keyboard,
  Activity,
  Bell,
  Puzzle,
  Info,
  X,
} from 'lucide-vue-next'
import GeneralTab from './settings/GeneralTab.vue'
import AppearanceTab from './settings/AppearanceTab.vue'
import KeyboardTab from './settings/KeyboardTab.vue'
const MonitorTab = defineAsyncComponent(() => import('./settings/MonitorTab.vue'))
import NotificationTab from './settings/NotificationTab.vue'
import PluginsTab from './settings/PluginsTab.vue'
import AboutTab from './settings/AboutTab.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; 'token-changed': [] }>()

const { settings, saveSettings, loadSettings, applyCurrentTheme } = useSettings()
const { t } = useI18n()

const activeTab = ref<
  'general' | 'appearance' | 'keyboard' | 'monitor' | 'notification' | 'plugins' | 'about'
>('general')

let saveTimer: ReturnType<typeof setTimeout> | null = null
let suppressSave = false
function scheduleSave() {
  if (suppressSave) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSettings(), 500)
}

// Only trigger DOM-heavy theme application when theme fields actually change
watch(effectiveTheme, applyCurrentTheme)

// Only notify terminal text changes when text settings change
watch(() => ({ ...settings.text }), notifyTextChange)

// Save on any setting change
watch(settings, scheduleSave, { deep: true })

// Re-fetch settings from backend when the panel opens (multi-end sync).
// Cancel any pending debounced save and suppress the autosave that the
// remote Object.assign would trigger, so we neither PUT back the fetched
// value nor let a stale pending timer overwrite it.
watch(() => props.open, (v) => {
  if (!v) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  suppressSave = true
  void loadSettings().finally(() => nextTick(() => { suppressSave = false }))
})

const tabs = computed(() => [
  { id: 'general' as const, label: t('settings.tab.general'), icon: SettingsIcon },
  { id: 'appearance' as const, label: t('settings.tab.appearance'), icon: Palette },
  { id: 'keyboard' as const, label: t('settings.tab.keyboard'), icon: Keyboard },
  { id: 'plugins' as const, label: t('settings.tab.plugins'), icon: Puzzle },
  { id: 'monitor' as const, label: t('settings.tab.monitor'), icon: Activity },
  { id: 'notification' as const, label: t('settings.tab.notification'), icon: Bell },
  { id: 'about' as const, label: t('settings.tab.about'), icon: Info },
])
</script>

<style>
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 900;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}
.settings-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.settings-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  right: 0;
  width: min(520px, calc(100vw - 12px));
  max-width: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 901;
  padding-top: env(safe-area-inset-top, 0px);
}
.settings-panel.open {
  transform: translateX(0);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.settings-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--fg-bright);
}
.settings-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--fg-muted);
}
.settings-close:hover {
  background: var(--bg-hover);
  color: var(--fg-bright);
}

.settings-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
  overflow-x: auto;
  scrollbar-width: none;
}
.settings-tabs::-webkit-scrollbar {
  display: none;
}
.settings-tab {
  padding: 12px 16px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-muted);
  border-bottom: 2px solid transparent;
  transition:
    color 0.15s,
    border-color 0.15s;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.settings-tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.settings-tab-label {
  font-size: 10px;
  letter-spacing: 0.3px;
}
.settings-tab:hover .settings-tab-icon,
.settings-tab.active .settings-tab-icon {
  opacity: 1;
}
.settings-tab:hover {
  color: var(--fg);
}
.settings-tab.active {
  color: var(--accent, #8a8a8a);
  border-bottom-color: var(--accent, #8a8a8a);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

.settings-group {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.settings-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin: 0 0 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.settings-group .settings-section:last-child {
  margin-bottom: 0;
}

.settings-section {
  margin-bottom: 20px;
}
.settings-section h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.theme-card {
  border: 2px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.15s,
    transform 0.15s;
  text-align: left;
}
.theme-card.active {
  border-color: var(--accent, #8a8a8a);
  box-shadow: 0 0 0 1px var(--accent, #8a8a8a);
}
.theme-card:hover {
  border-color: var(--accent-hover, #9e9e9e);
  transform: translateY(-1px);
}
.theme-preview {
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.theme-preview-header {
  display: flex;
  gap: 4px;
}
.theme-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  opacity: 0.9;
}
.theme-preview-body {
  flex: 1;
  display: flex;
  align-items: center;
  font-size: 11px;
}
.theme-swatches {
  display: flex;
  gap: 3px;
}
.swatch {
  width: 100%;
  height: 3px;
  border-radius: 1px;
}
.theme-name {
  display: block;
  padding: 4px 8px 5px;
  font-size: 10px;
  color: var(--fg-muted);
  text-align: center;
}

/* ── Access URL ────────────────────────────────────────── */
.access-url-row {
  margin-bottom: 10px;
}
.access-url-display {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 6px;
}
.access-url-text {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--accent, #8a8a8a);
  word-break: break-all;
}
.access-url-copy {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--fg-muted);
  background: var(--bg-hover);
}
.access-url-copy:hover {
  background: var(--bg-hover);
  color: var(--fg-bright);
}

/* ── Custom Colors ──────────────────────────────────────── */
.custom-colors-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.color-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.color-field > span {
  font-size: 11px;
  color: var(--fg-muted);
}
.color-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
.color-input-wrap input[type='color'] {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  background: none;
}
.color-input-wrap input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color-input-wrap input[type='color']::-webkit-color-swatch {
  border: 1px solid var(--border);
  border-radius: 4px;
}
.color-hex {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
  text-transform: uppercase;
}
.ansi-details {
  margin-bottom: 10px;
}
.ansi-details summary {
  font-size: 12px;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 4px 0;
  user-select: none;
}
.ansi-details summary:hover {
  color: var(--fg);
}
.ansi-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
  margin-top: 8px;
}
.ansi-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.ansi-field input[type='color'] {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  background: none;
}
.ansi-field input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.ansi-field input[type='color']::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}
.ansi-label {
  font-size: 8px;
  color: var(--fg-muted);
  text-align: center;
  line-height: 1.1;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.settings-row label {
  font-size: 13px;
  color: var(--fg);
  white-space: nowrap;
}
.settings-row select,
.settings-row input[type='color'] {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 4px 8px;
  font-size: 13px;
}
.settings-row input[type='range'] {
  flex: 1;
  accent-color: var(--accent, #8a8a8a);
}
.settings-row input[type='file'] {
  font-size: 12px;
  color: var(--fg-muted);
}

/* ── Font Dropdown ──────────────────────────────────────── */
.font-dropdown {
  position: relative;
  flex: 1;
  min-width: 0;
}
.font-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  min-height: 28px;
}
.font-dropdown-trigger:hover {
  border-color: var(--accent, #8a8a8a);
}
.font-dropdown-arrow {
  font-size: 10px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.font-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}
.font-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  padding: 4px 0;
}
.font-dropdown-menu.drop-up {
  top: auto;
  bottom: calc(100% + 4px);
}
.font-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--fg);
  cursor: pointer;
  transition: background 0.1s;
}
.font-dropdown-item:hover {
  background: var(--bg-hover);
}
.font-dropdown-item.active {
  background: rgba(77, 127, 255, 0.15);
  color: var(--accent, #8a8a8a);
}
.font-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.font-item-sample {
  font-size: 12px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.font-dropdown-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--bg-hover);
}
.font-custom-input-wrap {
  padding: 4px 8px 6px;
}
.font-custom-input {
  width: 100%;
  box-sizing: border-box;
}

.range-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}
.range-wrap input[type='range'] {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border);
  border-radius: 2px;
  outline: none;
}
.range-wrap input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent, #8a8a8a);
  cursor: pointer;
}
.range-val {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
  min-width: 40px;
  text-align: right;
}
.setting-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--fg-muted);
  cursor: pointer;
  opacity: 0.7;
  transition: color 0.15s ease, opacity 0.15s ease, background 0.15s ease;
}
.setting-reset:hover {
  color: var(--fg);
  opacity: 1;
  background: var(--border);
}

.toggle {
  position: relative;
  cursor: pointer;
}
.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-track {
  display: block;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--border);
  transition: background 0.2s;
}
.toggle input:checked + .toggle-track {
  background: var(--accent, #8a8a8a);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.toggle input:checked ~ .toggle-track .toggle-thumb {
  transform: translateX(16px);
}

.shortcut-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 4px 8px;
  font-size: 12px;
}
.shortcut-check {
  font-size: 12px;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}
.shortcut-del {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.shortcut-del:hover {
  background: rgba(255, 100, 100, 0.2);
  color: #ff6b6b;
}
.shortcut-add {
  font-size: 12px;
  color: var(--accent, #8a8a8a);
  padding: 4px 0;
}

/* ── Action Keyboard Settings ─────────────────────────────── */
.settings-hint {
  font-size: 11px;
  color: var(--fg-muted);
  margin-bottom: 10px;
}

.ak-wysiwyg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px 10px;
  margin-bottom: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.ak-wysiwyg :deep(.mkb-btn) {
  touch-action: none;
}

.ak-wyg-row-outer {
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
}

.ak-wyg-row-outer .mkb-row-wrap {
  flex: 1;
  min-width: 0;
}

.ak-wyg-chrome {
  pointer-events: none;
  opacity: 0.88;
  flex-shrink: 0;
}

.ak-wyg-slot {
  min-width: 0;
  display: flex;
}

.ak-wyg-key {
  position: relative;
  flex: 1;
  min-width: 0;
  width: 100%;
  padding-right: 20px;
  box-sizing: border-box;
  cursor: default;
}

.ak-wyg-label {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.ak-wyg-label:hover {
  text-decoration: underline;
}

.ak-key-del {
  position: absolute;
  right: 14px;
  top: 2px;
  font-size: 8px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  z-index: 3;
  padding: 0;
}

.ak-key-del:hover {
  background: rgba(255, 100, 100, 0.35);
  color: #ff6b6b;
}

.ak-key-resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
  touch-action: none;
  border-radius: 0 6px 6px 0;
  background: var(--bg-hover);
  z-index: 2;
}

.ak-key-resize:hover {
  background: rgba(77, 127, 255, 0.4);
}

.ak-wyg-add-key {
  flex: 0 0 40px !important;
  width: 40px !important;
  min-width: 40px !important;
  font-size: 18px !important;
  font-weight: 300;
  color: #8e8e93 !important;
}

.ak-wyg-remove-row {
  flex-shrink: 0;
  align-self: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--fg-muted);
  border: 1px solid var(--border, #444);
  background: var(--bg-input);
}

.ak-wyg-remove-row:hover {
  background: rgba(255, 100, 100, 0.15);
  color: #ff6b6b;
  border-color: rgba(255, 100, 100, 0.4);
}

.ak-wyg-fixed-cluster {
  pointer-events: none;
  opacity: 0.92;
  margin-top: 2px;
}

.ak-wyg-fixed-cluster .mkb-btn {
  cursor: default;
}

.ak-actions {
  display: flex;
  gap: 12px;
}

.ak-reset {
  color: var(--fg-muted) !important;
}

/* Edit modal */
.ak-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ak-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  width: 300px;
  max-width: 90vw;
}

.ak-modal h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
  margin-bottom: 12px;
}

.ak-field {
  display: block;
  margin-bottom: 10px;
}
.ak-field > span {
  display: block;
  font-size: 11px;
  color: var(--fg-muted);
  margin-bottom: 4px;
}

.ak-send-textarea {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.35;
}

.ak-send-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 10px;
}

.ak-esc-preview {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ak-record-focus-sink {
  position: fixed;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: 0;
  border: 0;
  opacity: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  left: 0;
  top: 0;
  z-index: 1001;
}

.ak-record-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  background: #2c2c2e;
  color: var(--fg);
  border: 1px solid var(--border);
}
.ak-record-btn.recording {
  background: #ff3b30;
  color: #fff;
  border-color: #ff3b30;
}

.ak-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.ak-modal-actions .settings-save {
  flex: 1;
}
.ak-modal-actions .shortcut-add {
  flex: 1;
  text-align: center;
}

.settings-footer {
  display: none;
}
.settings-save {
  width: 100%;
  padding: 8px;
  border-radius: 5px;
  background: none;
  color: var(--fg-bright, #d0d0d0);
  font-size: 13px;
  font-weight: 500;
  border: none;
  transition: background 0.15s;
}
.settings-save:hover {
  background: var(--bg-hover);
}
</style>

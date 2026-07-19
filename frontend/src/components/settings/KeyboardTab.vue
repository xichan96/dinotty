<template>
  <div>
    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('keybinding.title') }}</h3>
      <div v-if="isWindowsClient" class="settings-row">
        <label>{{ t('keybinding.windowsAltAsCmd') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.windowsAltAsCmd" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="kb-group">
        <h4>{{ t('keybinding.appShortcuts') }}</h4>

        <div class="kb-category">
          <h5>{{ t('keybinding.group.tab') }}</h5>
          <div
            v-for="def in tabDefs"
            :key="def.id"
            class="settings-row kb-shortcut-row"
            :data-kb-id="def.id"
          >
            <label><component :is="def.icon" :size="14" class="kb-icon" /> {{ t(def.titleKey) }}</label>
            <div class="kb-shortcut-ctrl">
              <span v-if="kbRecording !== def.id" class="kb-keys">
                <kbd v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')" :key="i">{{ k }}</kbd>
              </span>
              <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
              <template v-if="!isReadOnly(def.id)">
                <button v-if="kbRecording !== def.id" class="shortcut-add" data-kb-action="record" @click="startKbRecord(def.id)">{{ t('settings.record') }}</button>
                <button v-else class="shortcut-add kb-stop" data-kb-action="stop" @click="stopKbRecord()">{{ t('settings.stop') }}</button>
                <button v-if="settings.keybindings[def.id]" class="shortcut-del" data-kb-action="reset" @click="resetKbBinding(def.id)">{{ t('keybinding.reset') }}</button>
              </template>
            </div>
          </div>
        </div>

        <CollapsibleSection :title="t('keybinding.group.pane')" level="section" default-open>
          <div
            v-for="def in paneDefs"
            :key="def.id"
            class="settings-row kb-shortcut-row"
            :data-kb-id="def.id"
          >
            <label><component :is="def.icon" :size="14" class="kb-icon" /> {{ t(def.titleKey) }}</label>
            <div class="kb-shortcut-ctrl">
              <span v-if="kbRecording !== def.id" class="kb-keys">
                <kbd v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')" :key="i">{{ k }}</kbd>
              </span>
              <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
              <template v-if="!isReadOnly(def.id)">
                <button v-if="kbRecording !== def.id" class="shortcut-add" data-kb-action="record" @click="startKbRecord(def.id)">{{ t('settings.record') }}</button>
                <button v-else class="shortcut-add kb-stop" data-kb-action="stop" @click="stopKbRecord()">{{ t('settings.stop') }}</button>
                <button v-if="settings.keybindings[def.id]" class="shortcut-del" data-kb-action="reset" @click="resetKbBinding(def.id)">{{ t('keybinding.reset') }}</button>
              </template>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection :title="t('keybinding.group.nav')" level="section" default-open>
          <template v-for="def in navDefs" :key="def.id">
            <div
              class="settings-row kb-shortcut-row"
              :data-kb-id="def.id"
            >
              <label><component :is="def.icon" :size="14" class="kb-icon" /> {{ t(def.titleKey) }}</label>
              <div class="kb-shortcut-ctrl">
                <span v-if="kbRecording !== def.id" class="kb-keys">
                  <kbd v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')" :key="i">{{ k }}</kbd>
                </span>
                <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
                <template v-if="!isReadOnly(def.id)">
                  <button v-if="kbRecording !== def.id" class="shortcut-add" data-kb-action="record" @click="startKbRecord(def.id)">{{ t('settings.record') }}</button>
                  <button v-else class="shortcut-add kb-stop" data-kb-action="stop" @click="stopKbRecord()">{{ t('settings.stop') }}</button>
                  <button v-if="settings.keybindings[def.id]" class="shortcut-del" data-kb-action="reset" @click="resetKbBinding(def.id)">{{ t('keybinding.reset') }}</button>
                </template>
              </div>
            </div>
            <p v-if="def.id === 'superviseTabs' && isWindowsClient" class="settings-hint">
              {{ t('keybinding.superviseTabsHint') }}
            </p>
          </template>
        </CollapsibleSection>

        <CollapsibleSection :title="t('keybinding.group.font')" level="section" default-open>
          <div
            v-for="def in fontDefs"
            :key="def.id"
            class="settings-row kb-shortcut-row"
            :data-kb-id="def.id"
          >
            <label><component :is="def.icon" :size="14" class="kb-icon" /> {{ t(def.titleKey) }}</label>
            <div class="kb-shortcut-ctrl">
              <span v-if="kbRecording !== def.id" class="kb-keys">
                <kbd v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')" :key="i">{{ k }}</kbd>
              </span>
              <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
              <template v-if="!isReadOnly(def.id)">
                <button v-if="kbRecording !== def.id" class="shortcut-add" data-kb-action="record" @click="startKbRecord(def.id)">{{ t('settings.record') }}</button>
                <button v-else class="shortcut-add kb-stop" data-kb-action="stop" @click="stopKbRecord()">{{ t('settings.stop') }}</button>
                <button v-if="settings.keybindings[def.id]" class="shortcut-del" data-kb-action="reset" @click="resetKbBinding(def.id)">{{ t('keybinding.reset') }}</button>
              </template>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      <div class="kb-group">
        <h4>{{ t('keybinding.terminalShortcuts') }}</h4>
        <p class="settings-hint">{{ t('keybinding.terminalReservedHint') }}</p>
        <div
          v-for="def in terminalDefs"
          :key="def.id"
          class="settings-row kb-shortcut-row"
          :data-kb-id="def.id"
        >
          <label
            ><component :is="def.icon" :size="14" class="kb-icon" /> {{ t(def.titleKey) }}</label
          >
          <div class="kb-shortcut-ctrl">
            <span v-if="kbRecording !== def.id" class="kb-keys">
              <kbd
                v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')"
                :key="i"
                >{{ k }}</kbd
              >
            </span>
            <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
            <button
              v-if="kbRecording !== def.id"
              class="shortcut-add"
              data-kb-action="record"
              @click="startKbRecord(def.id)"
            >
              {{ t('settings.record') }}
            </button>
            <button
              v-else
              class="shortcut-add kb-stop"
              data-kb-action="stop"
              @click="stopKbRecord()"
            >
              {{ t('settings.stop') }}
            </button>
            <button
              v-if="settings.keybindings[def.id]"
              class="shortcut-del"
              data-kb-action="reset"
              @click="resetKbBinding(def.id)"
            >
              {{ t('keybinding.reset') }}
            </button>
          </div>
          <p v-if="kbRecordError && kbRecording === def.id" class="kb-record-error">
            {{ kbRecordError }}
          </p>
        </div>
      </div>
    </div>

    <CollapsibleSection :title="t('settings.actionKeyboard')" level="group" default-open>
      <p class="settings-hint">{{ t('settings.akHint') }}</p>
      <div class="ak-wysiwyg">
        <div v-for="(row, ri) in actionRows" :key="ri" class="ak-wyg-row-outer">
          <div class="mkb-row-wrap">
            <div class="mkb-row">
              <div
                v-if="ri === 0"
                class="mkb-btn mkb-mod mkb-action-back ak-wyg-chrome"
                style="flex-grow: 1.5; flex-basis: 0"
              >
                ⌨
              </div>
              <div
                v-for="(key, ki) in row"
                :key="akItemKey(key)"
                class="ak-wyg-slot"
                :style="akPreviewSlotStyle(ri, ki)"
              >
                <div class="mkb-btn ak-wyg-key" :class="[previewDef(ri, ki).cls]">
                  <span class="ak-wyg-label" @click="editActionKey(ri, ki)">{{
                    previewLabel(key)
                  }}</span>
                  <button type="button" class="ak-key-del" @click.stop="removeActionKey(ri, ki)">
                    ✕
                  </button>
                  <div
                    class="ak-key-resize"
                    :title="t('settings.dragResize')"
                    @pointerdown="akResizePointerDown(ri, ki, $event)"
                  />
                </div>
              </div>
              <button
                type="button"
                class="mkb-btn mkb-mod ak-wyg-add-key"
                @click="addActionKey(ri)"
              >
                +
              </button>
            </div>
          </div>
          <button
            v-if="actionRows.length > 1"
            type="button"
            class="ak-wyg-remove-row"
            :title="t('settings.deleteRow')"
            @click="removeActionRow(ri)"
          >
            ✕
          </button>
        </div>

        <div class="mkb-action-bottom ak-wyg-fixed-cluster">
          <div class="mkb-action-grid">
            <div class="mkb-btn mkb-mod mkb-action-btn">yes</div>
            <div class="mkb-btn mkb-mod mkb-action-btn">no</div>
            <div class="mkb-btn mkb-mod mkb-action-arrow">↑</div>
            <div class="mkb-btn mkb-mod mkb-action-btn mkb-action-continue">continue</div>
            <div class="mkb-btn mkb-mod mkb-action-arrow">↓</div>
          </div>
          <div class="mkb-btn mkb-mod mkb-action-enter mkb-return">↵</div>
        </div>
      </div>
      <div class="ak-actions">
        <button class="shortcut-add" @click="addActionRow">{{ t('settings.addRow') }}</button>
        <button class="shortcut-add ak-reset" @click="resetActionKeyboard">
          {{ t('settings.resetDefault') }}
        </button>
      </div>

      <h4>工具栏快捷键 / Toolbar Quick Keys</h4>
      <p class="settings-hint">移动网页输入框聚焦时显示，最多 5 个。</p>
      <div class="ak-wysiwyg">
        <div class="ak-wyg-row-outer">
          <div class="mkb-row-wrap">
            <div class="mkb-row">
              <div
                v-for="(key, ki) in toolbarQuickKeys"
                :key="akItemKey(key)"
                class="ak-wyg-slot"
                :style="toolbarPreviewSlotStyle"
              >
                <div class="mkb-btn ak-wyg-key" :class="[previewToolbarDef(key).cls]">
                  <span class="ak-wyg-label" @click="editToolbarQuickKey(ki)">{{
                    previewLabel(key)
                  }}</span>
                  <button type="button" class="ak-key-del" @click.stop="removeToolbarQuickKey(ki)">
                    ✕
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="mkb-btn mkb-mod ak-wyg-add-key"
                :disabled="toolbarQuickKeys.length >= 5"
                @click="addToolbarQuickKey"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="akEdit" class="ak-modal-backdrop" @click.self="akEdit = null">
        <div class="ak-modal">
          <h4>{{ t('settings.editKey') }}</h4>
          <label class="ak-field">
            <span>{{ t('settings.label') }}</span>
            <input v-model="akEdit.label" class="shortcut-input" />
          </label>
          <label v-if="akEdit.scope !== 'toolbar'" class="ak-field">
            <span>{{ t('actionKb.kind') }}</span>
            <select v-model="akEdit.kind" class="shortcut-input">
              <option value="send">{{ t('actionKb.kind.send') }}</option>
              <option value="action">{{ t('actionKb.kind.action') }}</option>
            </select>
          </label>
          <template v-if="akEdit.kind === 'send'">
            <label class="ak-field">
              <span>{{ t('settings.send') }}</span>
              <textarea
                v-model="akEdit.sendRaw"
                class="shortcut-input ak-send-textarea"
                rows="4"
                spellcheck="false"
                :placeholder="t('settings.sendPlaceholder')"
              />
            </label>
            <div class="ak-send-row">
              <code class="ak-esc-preview">{{ akSendPreview }}</code>
              <button
                type="button"
                class="ak-record-btn"
                :class="{ recording: akRecording }"
                @click.stop="toggleRecord"
              >
                {{ akRecording ? t('settings.stop') : t('settings.record') }}
              </button>
            </div>
            <div
              v-show="akRecording"
              ref="recordFocusSinkRef"
              class="ak-record-focus-sink"
              tabindex="-1"
              aria-hidden="true"
            />
          </template>
          <label v-else class="ak-field">
            <span>{{ t('actionKb.action') }}</span>
            <select v-model="akEdit.action" class="shortcut-input">
              <option value="" disabled>{{ t('actionKb.selectAction') }}</option>
              <option v-for="action in APP_ACTIONS" :key="action.id" :value="action.id">
                {{ t(action.labelKey) }}
              </option>
            </select>
          </label>
          <label class="ak-field">
            <span>{{ t('settings.style') }}</span>
            <select v-model="akEdit.style" class="shortcut-input">
              <option value="">{{ t('settings.style.normal') }}</option>
              <option value="danger">{{ t('settings.style.danger') }}</option>
            </select>
          </label>
          <label v-if="akEdit.kind === 'send'" class="shortcut-check">
            <input type="checkbox" v-model="akEdit.auto_enter" /> {{ t('settings.appendEnter') }}
          </label>
          <label v-if="akEdit.kind === 'send'" class="shortcut-check">
            <input type="checkbox" v-model="akEdit.repeat" /> {{ t('settings.repeatHold') }}
          </label>
          <div class="ak-modal-actions">
            <button class="settings-save" :disabled="!akCanSave" @click="saveActionKey">
              {{ t('settings.save') }}
            </button>
            <button class="shortcut-add" @click="akEdit = null">{{ t('settings.cancel') }}</button>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.keyboard.feedback') }}</h3>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.sound') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.keyboard_sound" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>

    <CollapsibleSection :title="t('settings.keyboard.openApi')" level="group" default-open>
      <p class="settings-hint">{{ t('settings.keyboard.openApiHint') }}</p>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.openApiEnabled') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.open_api.enabled" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div v-if="settings.open_api.enabled" class="api-test">
        <div class="api-method-row">
          <span class="method-badge">POST</span>
          <span class="api-url">/api/input</span>
          <div class="mode-tabs">
            <button :class="{ active: openApiMode === 'form' }" @click="switchOpenApiMode('form')">
              Form
            </button>
            <button :class="{ active: openApiMode === 'raw' }" @click="switchOpenApiMode('raw')">
              Raw
            </button>
          </div>
        </div>

        <template v-if="openApiMode === 'form'">
          <div class="api-field">
            <label>pane_id</label>
            <input
              type="text"
              v-model="openApiPaneId"
              :placeholder="t('settings.keyboard.openApiPaneHint')"
            />
          </div>
          <div class="api-field">
            <label>data <span class="required">*</span></label>
            <input type="text" v-model="openApiData" placeholder="hello\n" />
          </div>
        </template>

        <template v-else>
          <textarea class="raw-editor" v-model="openApiRawJson" rows="5" spellcheck="false" />
          <span v-if="openApiRawError" class="api-result err">{{ openApiRawError }}</span>
        </template>

        <div class="api-actions">
          <button
            class="send-btn"
            :disabled="!openApiCanSend || openApiSending"
            @click="sendOpenApiTest"
          >
            {{ openApiSending ? '...' : '▶ Send' }}
          </button>
          <span v-if="openApiResult" class="api-result" :class="openApiResultOk ? 'ok' : 'err'">{{
            openApiResult
          }}</span>
        </div>

        <details class="open-api-curl">
          <summary>curl {{ t('settings.keyboard.openApiExample') }}</summary>
          <code class="open-api-curl-code"
            >curl -X POST {{ apiBaseUrl }}/api/input \ -H "Authorization: Bearer &lt;token&gt;" \ -H
            "Content-Type: application/json" \ -d '{"data":"hello\\n"}'</code
          >
        </details>
      </div>
    </CollapsibleSection>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useSettings, DEFAULT_ACTION_KEYBOARD } from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import type { ActionKey } from '../../composables/useSettings'
import type { KeyBinding } from '../../composables/useKeybindings'
import { actionKeyToKeyDef } from '../../utils/actionKeyDef'
import { APP_ACTIONS, APP_ACTION_IDS } from '../../utils/appActionCatalog'
import { getApiBase, apiUrl, authFetch } from '../../composables/apiBase'
import { isWindowsClient } from '../../utils/clientPlatform'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()
const { defs, getBinding, formatBinding, isReadOnly } = useKeybindings()
const appDefs = computed(() => defs.filter((def) => (def.kind ?? 'app') === 'app'))
const terminalDefs = computed(() => defs.filter((def) => def.kind === 'terminal'))

const tabGroupIds = ['newTab', 'closeTab', 'switchTab']
const paneGroupIds = ['splitHorizontal', 'splitVertical', 'toggleBroadcast', 'toggleZoom', 'equalizePanes', 'focusNextPane', 'focusPrevPane']
const navGroupIds = ['togglePalette', 'openBookmarks', 'searchTerminal', 'missionControl', 'superviseTabs', 'sshConnect']
const fontGroupIds = ['fontSizeUp', 'fontSizeDown', 'fontSizeReset']

const tabDefs = computed(() => appDefs.value.filter(d => tabGroupIds.includes(d.id)))
const paneDefs = computed(() => appDefs.value.filter(d => paneGroupIds.includes(d.id)))
const navDefs = computed(() => appDefs.value.filter(d => navGroupIds.includes(d.id)))
const fontDefs = computed(() => appDefs.value.filter(d => fontGroupIds.includes(d.id)))

const openApiPaneId = ref('')
const openApiData = ref('')
const openApiMode = ref<'form' | 'raw'>('form')
const openApiRawJson = ref('{\n  "data": "hello\\n"\n}')
const openApiRawError = ref('')
const openApiResult = ref('')
const openApiResultOk = ref(false)
const openApiSending = ref(false)
const apiBaseUrl = ref('')
getApiBase().then((b) => {
  apiBaseUrl.value = b
})

// --- Keyboard shortcuts recording ---
const kbRecording = ref<string | null>(null)
const kbRecordError = ref('')
let kbRecordHandler: ((e: KeyboardEvent) => void) | null = null

function startKbRecord(id: string) {
  const def = defs.find((d) => d.id === id)
  const kind = def?.kind ?? 'app'
  kbRecording.value = id
  kbRecordError.value = ''
  kbRecordHandler = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return
    e.preventDefault()
    e.stopPropagation()
    const key = k.toLowerCase()
    if (
      kind === 'terminal' &&
      e.ctrlKey &&
      e.shiftKey &&
      !e.metaKey &&
      !e.altKey &&
      (key === 'c' || key === 'v')
    ) {
      kbRecordError.value = t('keybinding.terminalReservedError')
      return
    }
    const binding: KeyBinding =
      kind === 'terminal'
        ? {
            key,
            shift: e.shiftKey,
            meta: e.metaKey,
            ctrl: e.ctrlKey,
            alt: e.altKey,
          }
        : { key, shift: e.shiftKey }
    settings.keybindings[id] = binding
    stopKbRecord()
  }
  window.addEventListener('keydown', kbRecordHandler, true)
  nextTick(() => {
    document.querySelector<HTMLElement>('.xterm-helper-textarea')?.blur()
    const ae = document.activeElement
    if (ae instanceof HTMLElement) ae.blur()
  })
}

function stopKbRecord() {
  kbRecording.value = null
  kbRecordError.value = ''
  if (kbRecordHandler) {
    window.removeEventListener('keydown', kbRecordHandler, true)
    kbRecordHandler = null
  }
}

function resetKbBinding(id: string) {
  delete settings.keybindings[id]
}

function unescapeData(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
}

const openApiCanSend = computed(() => {
  if (openApiMode.value === 'form') return !!openApiData.value
  try {
    JSON.parse(openApiRawJson.value)
    return true
  } catch {
    return false
  }
})

function switchOpenApiMode(mode: 'form' | 'raw') {
  if (mode === openApiMode.value) return
  if (mode === 'raw') {
    const obj: Record<string, string> = { data: openApiData.value }
    if (openApiPaneId.value) obj.pane_id = openApiPaneId.value
    openApiRawJson.value = JSON.stringify(obj, null, 2)
  } else {
    try {
      const obj = JSON.parse(openApiRawJson.value)
      openApiPaneId.value = obj.pane_id ?? ''
      openApiData.value = obj.data ?? ''
    } catch {}
  }
  openApiRawError.value = ''
  openApiMode.value = mode
}

async function sendOpenApiTest() {
  openApiResult.value = ''
  openApiResultOk.value = false
  openApiSending.value = true
  try {
    let payload: Record<string, string>
    if (openApiMode.value === 'form') {
      payload = { data: unescapeData(openApiData.value) }
      if (openApiPaneId.value) payload.pane_id = openApiPaneId.value
    } else {
      try {
        payload = JSON.parse(openApiRawJson.value)
      } catch (e: any) {
        openApiRawError.value = e.message
        openApiSending.value = false
        return
      }
    }
    await getApiBase()
    const res = await authFetch(apiUrl('/api/input'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (res.ok) {
      openApiResultOk.value = true
      openApiResult.value = 'OK'
    } else {
      openApiResult.value = json.error || `HTTP ${res.status}`
    }
  } catch (e: any) {
    openApiResult.value = e.message || 'error'
  }
  openApiSending.value = false
}

const actionRows = computed(() => {
  return (settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD).rows
})

const toolbarQuickKeys = computed(() => settings.toolbar_quick_keys ?? [])
const toolbarPreviewSlotStyle = { flexGrow: 1, flexBasis: '0', minWidth: '0' }

function previewDef(ri: number, ki: number) {
  const rows = actionRows.value
  const bottom = ri === rows.length - 1
  return actionKeyToKeyDef(rows[ri][ki], bottom ? { bottomIdx: ki } : undefined)
}

function previewToolbarDef(key: ActionKey) {
  return actionKeyToKeyDef(key)
}

function akPreviewSlotStyle(ri: number, ki: number) {
  const d = previewDef(ri, ki)
  return { flexGrow: d.g ?? 1, flexBasis: '0', minWidth: '0' }
}

function previewLabel(key: ActionKey) {
  if (key.special === 'space') return ' '
  return key.label || ' '
}

const akSendPreview = computed(() => {
  if (!akEdit.value) return ''
  return akEdit.value.sendRaw
})

function cloneActionKeyboard() {
  const clone = JSON.parse(JSON.stringify(DEFAULT_ACTION_KEYBOARD))
  // Restore icon references (lost in JSON serialization)
  const iconMap = new Map<string, object>()
  for (const row of DEFAULT_ACTION_KEYBOARD.rows) {
    for (const k of row) {
      if (k.icon) iconMap.set(k.send, k.icon)
    }
  }
  for (const row of clone.rows) {
    for (const k of row) {
      const icon = iconMap.get(k.send)
      if (icon) k.icon = icon
    }
  }
  return clone
}

function ensureActionKeyboard() {
  if (!settings.action_keyboard) {
    settings.action_keyboard = cloneActionKeyboard()
  }
}

function ensureToolbarQuickKeys() {
  if (!Array.isArray(settings.toolbar_quick_keys)) {
    settings.toolbar_quick_keys = []
  }
}

function addActionRow() {
  ensureActionKeyboard()
  settings.action_keyboard!.rows.push([])
}

function removeActionRow(ri: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows.splice(ri, 1)
}

function addActionKey(ri: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows[ri].push({ label: 'new', send: '', auto_enter: true })
}

function resolveAutoEnterForEdit(key: ActionKey): boolean {
  if (typeof key.auto_enter === 'boolean') return key.auto_enter
  const s = key.send
  if (!s) return true
  if (s.charCodeAt(0) === 0x1b) return false
  if (s.length === 1) {
    const c = s.charCodeAt(0)
    if (c < 32 || c === 127) return false
  }
  return true
}

function removeActionKey(ri: number, ki: number) {
  ensureActionKeyboard()
  settings.action_keyboard!.rows[ri].splice(ki, 1)
}

function addToolbarQuickKey() {
  ensureToolbarQuickKeys()
  if (settings.toolbar_quick_keys.length >= 5) return
  akEdit.value = {
    scope: 'toolbar',
    ri: -1,
    ki: settings.toolbar_quick_keys.length,
    label: '',
    kind: 'send',
    action: '',
    sendRaw: '',
    style: '',
    repeat: false,
    auto_enter: true,
  }
}

function editToolbarQuickKey(ki: number) {
  ensureToolbarQuickKeys()
  const key = settings.toolbar_quick_keys[ki]
  if (!key) return
  akEdit.value = {
    scope: 'toolbar',
    ri: -1,
    ki,
    label: key.label,
    kind: 'send',
    action: '',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    grow: key.grow,
    icon: key.icon,
  }
}

function removeToolbarQuickKey(ki: number) {
  ensureToolbarQuickKeys()
  settings.toolbar_quick_keys.splice(ki, 1)
}

const akKeyIds = new WeakMap<ActionKey, string>()

function akItemKey(key: ActionKey) {
  let id = akKeyIds.get(key)
  if (!id) {
    id = `ak-${Math.random().toString(36).slice(2)}`
    akKeyIds.set(key, id)
  }
  return id
}

let akResizePid = -1

function akResizePointerDown(ri: number, ki: number, e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  ensureActionKeyboard()
  const row = settings.action_keyboard!.rows[ri]
  const key = row[ki]
  const startX = e.clientX
  const startGrow = key.grow != null && key.grow > 0 ? key.grow : 1
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  akResizePid = e.pointerId

  const clamp = (v: number) => Math.min(12, Math.max(0.5, Math.round(v * 4) / 4))

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== akResizePid) return
    key.grow = clamp(startGrow + (ev.clientX - startX) / 28)
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== akResizePid) return
    try {
      el.releasePointerCapture(ev.pointerId)
    } catch {}
    akResizePid = -1
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

type AkEditScope = 'action' | 'toolbar'

const akEdit = ref<{
  scope: AkEditScope
  ri: number
  ki: number
  label: string
  kind: 'send' | 'action'
  action: string
  sendRaw: string
  style: string
  repeat: boolean
  auto_enter: boolean
  special?: string
  grow?: number
  icon?: object
} | null>(null)
const akRecording = ref(false)
const recordFocusSinkRef = ref<HTMLElement | null>(null)

const akCanSave = computed(() => {
  if (!akEdit.value) return false
  if (akEdit.value.kind === 'action') {
    return akEdit.value.scope !== 'toolbar' && APP_ACTION_IDS.has(akEdit.value.action)
  }
  if (akEdit.value.scope !== 'toolbar') return true
  return akEdit.value.label.trim().length > 0 && unescapeFromDisplay(akEdit.value.sendRaw).length > 0
})

function editActionKey(ri: number, ki: number) {
  const key = actionRows.value[ri][ki]
  akEdit.value = {
    scope: 'action',
    ri,
    ki,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : 'send',
    action: key.action || '',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    grow: key.grow,
    icon: key.icon,
  }
}

function saveActionKey() {
  if (!akEdit.value || !akCanSave.value) return
  const edit = akEdit.value
  const { ri, ki } = edit
  const label = edit.scope === 'toolbar' ? edit.label.trim() : edit.label
  const next: ActionKey = edit.kind === 'action'
    ? {
        label,
        kind: 'action',
        action: edit.action,
        style: edit.style || undefined,
        grow: edit.grow,
      }
    : {
        label,
        kind: 'send',
        send: unescapeFromDisplay(edit.sendRaw),
        style: edit.style || undefined,
        repeat: edit.repeat || undefined,
        auto_enter: edit.auto_enter,
        special: edit.special,
        grow: edit.grow,
        icon: edit.icon,
      }
  if (edit.scope === 'toolbar') {
    ensureToolbarQuickKeys()
    if (ki < settings.toolbar_quick_keys.length) {
      settings.toolbar_quick_keys[ki] = next
    } else if (settings.toolbar_quick_keys.length < 5) {
      settings.toolbar_quick_keys.push(next)
    }
  } else {
    ensureActionKeyboard()
    settings.action_keyboard!.rows[ri][ki] = next
  }
  akEdit.value = null
}

function resetActionKeyboard() {
  settings.action_keyboard = cloneActionKeyboard()
}

let recordHandler: ((e: KeyboardEvent) => void) | null = null

function toggleRecord() {
  if (akRecording.value) {
    stopRecord()
  } else {
    startRecord()
  }
}

function recordingEventIgnorable(e: KeyboardEvent): boolean {
  if (e.repeat) return true
  const k = e.key
  return k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta'
}

function startRecord() {
  akRecording.value = true
  recordHandler = (e: KeyboardEvent) => {
    if (recordingEventIgnorable(e)) return
    if (!akEdit.value) return
    const seq = keyEventToSequence(e)
    if (!seq) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    akEdit.value.sendRaw = escapeForDisplay(seq)
    if (akEdit.value.label === 'new' || akEdit.value.label === '') {
      akEdit.value.label = keyEventToLabel(e)
    }
    stopRecord()
  }
  window.addEventListener('keydown', recordHandler, true)
  nextTick(() => {
    document.querySelector<HTMLElement>('.xterm-helper-textarea')?.blur()
    const ae = document.activeElement
    if (ae instanceof HTMLElement) ae.blur()
    recordFocusSinkRef.value?.focus({ preventScroll: true })
  })
}

function stopRecord() {
  akRecording.value = false
  if (recordHandler) {
    window.removeEventListener('keydown', recordHandler, true)
    recordHandler = null
  }
  recordFocusSinkRef.value?.blur()
}

onBeforeUnmount(() => {
  stopRecord()
  stopKbRecord()
})

const FKEY_SEQ: Record<string, string> = {
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
}

function letterFromPhysicalCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return null
}

function keyEventToSequence(e: KeyboardEvent): string {
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  let ch = ''

  const fk = FKEY_SEQ[e.key]
  if (fk) return fk

  if (e.key === 'Escape') ch = '\x1b'
  else if (e.key === 'Tab') ch = e.shiftKey ? '\x1b[Z' : '\t'
  else if (e.key === 'Backspace') ch = '\x7f'
  else if (e.key === 'Enter') ch = '\r'
  else if (e.key === 'ArrowUp') ch = '\x1b[A'
  else if (e.key === 'ArrowDown') ch = '\x1b[B'
  else if (e.key === 'ArrowRight') ch = '\x1b[C'
  else if (e.key === 'ArrowLeft') ch = '\x1b[D'
  else if (e.key === 'Insert') ch = '\x1b[2~'
  else if (e.key === 'Delete') ch = '\x1b[3~'
  else if (e.key === 'Home') ch = '\x1b[H'
  else if (e.key === 'End') ch = '\x1b[F'
  else if (e.key === 'PageUp') ch = '\x1b[5~'
  else if (e.key === 'PageDown') ch = '\x1b[6~'
  else if (e.key.length === 1) {
    ch = e.key
    if (ctrl) {
      const code = ch.toUpperCase().charCodeAt(0) - 64
      if (code >= 1 && code <= 26) return String.fromCharCode(code)
    }
    if (alt) return '\x1b' + ch
    return ch
  } else {
    const phys = letterFromPhysicalCode(e.code)
    if (phys && phys.length === 1) {
      if (ctrl) {
        const code = phys.toUpperCase().charCodeAt(0) - 64
        if (code >= 1 && code <= 26) return String.fromCharCode(code)
      }
      if (alt) return '\x1b' + phys
      return phys
    }
    return ''
  }

  if (alt && ch.length > 0) return '\x1b' + ch
  return ch
}

function keyEventToLabel(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.metaKey) parts.push('cmd')
  if (e.altKey) parts.push('opt')
  if (e.shiftKey) parts.push('shift')

  let key = e.key
  if (key === ' ') key = 'space'
  else if (key === 'Escape') key = 'esc'
  else if (key === 'Backspace') key = '⌫'
  else if (key === 'Tab') key = 'tab'
  else if (key === 'Enter') key = '↵'
  else if (key === 'ArrowUp') key = '↑'
  else if (key === 'ArrowDown') key = '↓'
  else if (key === 'ArrowLeft') key = '←'
  else if (key === 'ArrowRight') key = '→'
  else if (key.length === 1) key = key.toLowerCase()
  else return key

  if (parts.length && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    parts.push(key)
  } else if (!parts.length) {
    return key
  }
  return parts.join('+')
}

function escapeForDisplay(s: string | undefined): string {
  if (s === undefined) return ''
  return s.replace(/[\x00-\x1f\x7f]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code === 0x1b) return '\\e'
    if (code === 0x09) return '\\t'
    if (code === 0x0d) return '\\r'
    if (code === 0x0a) return '\\n'
    if (code === 0x7f) return '\\x7f'
    if (code <= 26) return '^' + String.fromCharCode(code + 64)
    return '\\x' + code.toString(16).padStart(2, '0')
  })
}

function unescapeFromDisplay(s: string): string {
  return s.replace(/\\e|\\t|\\r|\\n|\\x([0-9a-fA-F]{2})|\^([A-Z@\[\\\]\^_?])/g, (m, hex, caret) => {
    if (m === '\\e') return '\x1b'
    if (m === '\\t') return '\t'
    if (m === '\\r') return '\r'
    if (m === '\\n') return '\n'
    if (hex) return String.fromCharCode(parseInt(hex, 16))
    if (caret) {
      if (caret === '?') return '\x7f'
      if (caret === '@') return '\x00'
      return String.fromCharCode(caret.charCodeAt(0) - 64)
    }
    return m
  })
}
</script>

<style scoped>
.api-test {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-secondary, var(--bg-surface)));
}
.api-method-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.mode-tabs {
  margin-left: auto;
  display: flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.mode-tabs button {
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: 11px;
  padding: 2px 10px;
  cursor: pointer;
}
.mode-tabs button.active {
  background: var(--fg-muted, #555);
  color: var(--bg);
}
.raw-editor {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-family: monospace;
  font-size: 12px;
  resize: vertical;
  line-height: 1.5;
}
.method-badge {
  background: var(--success);
  color: #000;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}
.api-url {
  font-family: monospace;
  font-size: 12px;
  color: var(--fg);
}
.api-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.api-field label {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  font-family: monospace;
  color: var(--fg-muted);
}
.api-field .required {
  color: #ef4444;
}
.api-field input,
.api-field select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
  font-family: monospace;
}
.api-field input::placeholder {
  color: var(--fg-muted, #555);
}
.api-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}
.send-btn {
  background: var(--success);
  color: #000;
  border: none;
  border-radius: 4px;
  padding: 5px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.send-btn:hover {
  opacity: 0.85;
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.api-result {
  font-size: 12px;
  font-family: monospace;
}
.api-result.ok {
  color: var(--success);
}
.api-result.err {
  color: #ef4444;
}
.open-api-curl {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 4px;
}
.open-api-curl summary {
  cursor: pointer;
}
.open-api-curl-code {
  display: block;
  margin-top: 6px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
.kb-shortcut-row {
  justify-content: space-between;
}
.kb-group + .kb-group {
  margin-top: 12px;
}
.kb-group h4 {
  margin: 10px 0 6px;
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 600;
}
.kb-category {
  margin-bottom: 8px;
}
.kb-category h5 {
  margin: 8px 0 4px;
  padding: 4px 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--fg-muted, #777);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border));
}
.kb-category:last-child {
  margin-bottom: 0;
}
.kb-shortcut-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kb-keys {
  display: flex;
  gap: 3px;
  min-width: 80px;
  justify-content: flex-end;
}
.kb-keys kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
  line-height: 1.4;
  color: var(--fg, #e0e0e0);
  background: var(--bg-secondary, var(--bg-surface)));
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  min-width: 18px;
  text-align: center;
}
.kb-keys.recording {
  color: var(--fg-muted);
  font-size: 12px;
  font-style: italic;
}
.kb-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--fg-muted);
}
.kb-stop {
  color: #ef4444 !important;
  border-color: #ef4444 !important;
}
.kb-record-error {
  flex-basis: 100%;
  margin: 4px 0 0 30px;
  color: #ef4444;
  font-size: 12px;
}
</style>

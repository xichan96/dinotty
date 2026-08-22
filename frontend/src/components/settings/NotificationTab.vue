<template>
  <div>
    <div class="settings-group">
      <div class="settings-row">
        <label>{{ t('notification.enabled') }}</label>
        <label class="toggle">
          <input v-model="cfg.enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>

    <CollapsibleSection :title="t('notification.triggers')" level="group">
      <div class="settings-row">
        <label>{{ t('notification.bellTrigger') }}</label>
        <label class="toggle">
          <input v-model="cfg.bell.enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row sub">
        <label>{{ t('notification.debounce') }}</label>
        <input
          v-model.number="cfg.bell.debounce_ms"
          type="number"
          class="num-input"
          min="0"
          max="5000"
          step="50"
          @change="saveSettings()"
        />
        ms
      </div>
      <div class="settings-row">
        <label>OSC {{ t('notification.oscNotify') }}</label>
        <label class="toggle">
          <input v-model="cfg.osc_notify" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.idleReminder') }}</label>
        <label class="toggle">
          <input v-model="cfg.idle_reminder" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </CollapsibleSection>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('notification.channels') }}</h3>
      <div class="settings-row">
        <label>{{ t('notification.localPresentation') }}</label>
        <label class="toggle">
          <input v-model="presentation.presentation_enabled" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.sound') }}</label>
        <label class="toggle">
          <input v-model="presentation.channels.sound" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.vibration') }}</label>
        <label class="toggle">
          <input v-model="presentation.channels.vibration" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.popup') }}</label>
        <label class="toggle">
          <input v-model="presentation.channels.popup" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.tabIndicator') }}</label>
        <label class="toggle">
          <input v-model="presentation.channels.tab_indicator" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('notification.presentationBehavior') }}</h3>
      <div class="settings-row">
        <label>{{ t('notification.dndLevel') }}</label>
        <div class="segmented-control">
          <button
            v-for="level in dndLevels"
            :key="level.value"
            :class="{ active: presentation.dnd_level === level.value }"
            @click="presentation.dnd_level = level.value"
          >
            {{ t(level.labelKey) }}
          </button>
        </div>
      </div>
      <div class="settings-row">
        <label>{{ t('notification.ignoreCurrentTab') }}</label>
        <label class="toggle">
          <input v-model="presentation.ignore_current_tab" type="checkbox" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row quiet-hours-row">
        <label>{{ t('notification.quietHours') }}</label>
        <input v-model="presentation.quiet_hours.start" type="time" />
        <span>–</span>
        <input v-model="presentation.quiet_hours.end" type="time" />
      </div>
      <div class="settings-row">
        <label>{{ t('notification.coalesceWindow') }}</label>
        <input
          v-model.number="presentation.coalesce_window_ms"
          type="number"
          class="num-input coalesce-input"
          min="0"
          max="10000"
          step="50"
        />
        ms
      </div>
      <p v-if="isEphemeral" class="ephemeral-note">
        {{ t('notification.localPresentationHint') }}
      </p>
    </div>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('notification.sounds') }}</h3>
      <div v-for="key in soundTypes" :key="key" class="settings-row sound-row">
        <label class="sound-label">{{ t(`notification.type.${key}`) }}</label>
        <select v-model="presentation.sounds[key].value" class="sound-select">
          <option v-for="name in builtinNames" :key="name" :value="name">{{ name }}</option>
        </select>
        <input
          type="range"
          class="vol-slider"
          min="0"
          max="100"
          :value="Math.round(presentation.sounds[key].volume * 100)"
          @input="
            (e: Event) =>
              (presentation.sounds[key].volume = (e.target as HTMLInputElement).valueAsNumber / 100)
          "
        />
        <button class="preview-btn" @click="previewSound(key)">▶</button>
      </div>
    </div>

    <CollapsibleSection :title="t('notification.hooks')" level="group">
      <p class="hook-hint">{{ t('notification.hookEnvHint') }}</p>
      <div v-for="(hook, idx) in cfg.hooks" :key="idx" class="hook-row">
        <label class="toggle toggle-sm">
          <input v-model="hook.enabled" type="checkbox" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <select v-model="hook.notification_type" class="hook-type-select" @change="saveSettings()">
          <option :value="null">{{ t('notification.hookAll') }}</option>
          <option v-for="nt in notifTypes" :key="nt" :value="nt">
            {{ t(`notification.type.${nt}`) }}
          </option>
        </select>
        <input
          v-model="hook.command"
          type="text"
          class="hook-cmd-input"
          :placeholder="t('notification.hookCommand')"
          @change="saveSettings()"
        />
        <button class="hook-del-btn" @click="cfg.hooks.splice(idx, 1)">&times;</button>
      </div>
      <button
        class="hook-add-btn"
        @click="cfg.hooks.push({ enabled: true, notification_type: null, command: '' })"
      >
        + {{ t('notification.hookAdd') }}
      </button>
    </CollapsibleSection>

    <CollapsibleSection :title="t('notification.test')" level="group">
      <div class="api-test">
        <div class="api-method-row">
          <span class="method-badge">POST</span>
          <span class="api-url">/api/notify</span>
          <div class="mode-tabs">
            <button :class="{ active: testMode === 'form' }" @click="switchMode('form')">
              {{ t('notification.testForm') }}
            </button>
            <button :class="{ active: testMode === 'raw' }" @click="switchMode('raw')">
              {{ t('notification.testRaw') }}
            </button>
          </div>
        </div>

        <template v-if="testMode === 'form'">
          <div class="api-field">
            <label>pane_id</label>
            <input
              v-model="testForm.pane_id"
              type="text"
              :placeholder="t('notification.optional')"
            />
          </div>
          <div class="api-field">
            <label>title</label>
            <input v-model="testForm.title" type="text" :placeholder="t('notification.optional')" />
          </div>
          <div class="api-field">
            <label>body <span class="required">*</span></label>
            <input
              v-model="testForm.body"
              type="text"
              :placeholder="t('notification.testBodyDefault')"
            />
          </div>
          <div class="api-field">
            <label>notification_type</label>
            <select v-model="testForm.notification_type">
              <option v-for="nt in notifTypes" :key="nt" :value="nt">{{ nt }}</option>
            </select>
          </div>
        </template>

        <template v-else>
          <textarea v-model="rawJson" class="raw-editor" rows="8" spellcheck="false" />
          <span v-if="rawError" class="api-result err">{{ rawError }}</span>
        </template>

        <div class="api-actions">
          <button class="send-btn" :disabled="!canSend || sending" @click="sendTest">
            {{ sending ? '...' : `▶ ${t('notification.testSend')}` }}
          </button>
          <span v-if="testResult" class="api-result" :class="testResult.ok ? 'ok' : 'err'">{{
            testResult.text
          }}</span>
        </div>
      </div>
    </CollapsibleSection>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useSettings } from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import { useI18n } from '../../composables/useI18n'
import {
  playSound,
  getBuiltinSoundNames,
  type NotificationType,
} from '../../composables/useNotification'
import { getApiBase, authFetch } from '../../composables/apiBase'
import {
  useNotificationPresentation,
  type DndLevel,
} from '../../composables/useNotificationPresentation'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

const cfg = computed(() => settings.notification)
const { settings: presentation, isEphemeral } = useNotificationPresentation()
const builtinNames = getBuiltinSoundNames()
const soundTypes: NotificationType[] = ['info', 'success', 'warning', 'error', 'urgent']
const notifTypes = ['info', 'success', 'warning', 'error', 'urgent']
const dndLevels: Array<{ value: DndLevel; labelKey: string }> = [
  { value: 'normal', labelKey: 'notification.dnd.normal' },
  { value: 'dot_sound', labelKey: 'notification.dnd.dotSound' },
  { value: 'silent', labelKey: 'notification.dnd.silent' },
]

const testMode = ref<'form' | 'raw'>('form')
const testForm = reactive({
  pane_id: '',
  title: '',
  body: t('notification.testBodyDefault'),
  notification_type: 'info',
})
const rawJson = ref('')
const rawError = ref('')
const sending = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)

function formToPayload(): Record<string, string> {
  const p: Record<string, string> = {
    body: testForm.body,
    notification_type: testForm.notification_type,
  }
  if (testForm.pane_id) p.pane_id = testForm.pane_id
  if (testForm.title) p.title = testForm.title
  return p
}

function switchMode(mode: 'form' | 'raw') {
  if (mode === testMode.value) return
  if (mode === 'raw') {
    rawJson.value = JSON.stringify(formToPayload(), null, 2)
    rawError.value = ''
  } else {
    try {
      const obj = JSON.parse(rawJson.value)
      testForm.pane_id = obj.pane_id ?? ''
      testForm.title = obj.title ?? ''
      testForm.body = obj.body ?? ''
      testForm.notification_type = notifTypes.includes(obj.notification_type)
        ? obj.notification_type
        : 'info'
      rawError.value = ''
    } catch {
      /* keep form as-is */
    }
  }
  testMode.value = mode
}

const canSend = computed(() => {
  if (testMode.value === 'form') return !!testForm.body
  try {
    const o = JSON.parse(rawJson.value)
    return !!o.body
  } catch {
    return false
  }
})

function previewSound(type: NotificationType) {
  playSound(presentation.sounds[type])
}

async function sendTest() {
  sending.value = true
  testResult.value = null
  rawError.value = ''
  let payload: string
  if (testMode.value === 'form') {
    payload = JSON.stringify(formToPayload())
  } else {
    try {
      const obj = JSON.parse(rawJson.value)
      payload = JSON.stringify(obj)
    } catch (e: any) {
      rawError.value = t('notification.invalidJson')
      sending.value = false
      return
    }
  }
  try {
    const base = await getApiBase()
    const res = await authFetch(`${base}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    if (res.ok) {
      testResult.value = { ok: true, text: `${res.status} OK` }
    } else {
      testResult.value = { ok: false, text: `${res.status} ${res.statusText}` }
    }
  } catch (e: any) {
    testResult.value = { ok: false, text: e.message || t('notification.networkError') }
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.sub {
  padding-left: 16px;
}
.num-input {
  width: 60px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
}
.coalesce-input {
  margin-left: auto;
}
.segmented-control {
  display: flex;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.segmented-control button {
  border: 0;
  border-right: 1px solid var(--border);
  padding: 3px 8px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 11px;
}
.segmented-control button:last-child {
  border-right: 0;
}
.segmented-control button.active {
  background: var(--fg-muted);
  color: var(--bg);
}
.quiet-hours-row input[type='time'] {
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
}
.quiet-hours-row input:first-of-type {
  margin-left: auto;
}
.ephemeral-note {
  margin: 6px 0 0;
  color: var(--warning, #d9a441);
  font-size: 11px;
}
.sound-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sound-label {
  width: 60px;
  flex-shrink: 0;
  font-size: 12px;
}
.sound-select {
  flex: 1;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
}
.vol-slider {
  width: 60px;
}
.preview-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  cursor: pointer;
  padding: 3px 8px;
  font-size: 12px;
}
.preview-btn:hover {
  border-color: var(--fg-muted);
}
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
  color: var(--danger);
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
  color: var(--danger);
}
.hook-hint {
  font-size: 11px;
  color: var(--fg-muted);
  margin: 0 0 8px;
  font-family: monospace;
  word-break: break-all;
}
.hook-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.toggle-sm .toggle-track {
  width: 28px;
  height: 16px;
  border-radius: 8px;
}
.toggle-sm .toggle-thumb {
  width: 12px;
  height: 12px;
  top: 2px;
  left: 2px;
}
.toggle-sm input:checked ~ .toggle-track .toggle-thumb {
  transform: translateX(12px);
}
.hook-type-select {
  width: 80px;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 11px;
}
.hook-cmd-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
  font-family: monospace;
}
.hook-del-btn {
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.hook-del-btn:hover {
  color: var(--danger);
}
.hook-add-btn {
  background: none;
  border: 1px dashed var(--border);
  border-radius: 4px;
  color: var(--fg-muted);
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
  width: 100%;
}
.hook-add-btn:hover {
  border-color: var(--fg-muted);
  color: var(--fg);
}
</style>

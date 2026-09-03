<template>
  <div class="settings-group">
    <h3 class="settings-group-title">{{ t('keybinding.title') }}</h3>
    <div v-if="isWindowsClient" class="settings-row">
      <label>{{ t('keybinding.windowsAltAsCmd') }}</label>
      <label class="toggle">
        <input v-model="settings.windowsAltAsCmd" type="checkbox" @change="saveSettings()" />
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
          <label class="kb-shortcut-label">
            <span class="kb-icon" aria-hidden="true"><component :is="def.icon" :size="14" /></span>
            <span>{{ t(def.titleKey) }}</span>
          </label>
          <div class="kb-shortcut-ctrl">
            <span v-if="kbRecording !== def.id" class="kb-keys">
              <kbd
                v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')"
                :key="i"
                >{{ k }}</kbd
              >
            </span>
            <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
            <template v-if="!isReadOnly(def.id)">
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
          <label class="kb-shortcut-label">
            <span class="kb-icon" aria-hidden="true"><component :is="def.icon" :size="14" /></span>
            <span>{{ t(def.titleKey) }}</span>
          </label>
          <div class="kb-shortcut-ctrl">
            <span v-if="kbRecording !== def.id" class="kb-keys">
              <kbd
                v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')"
                :key="i"
                >{{ k }}</kbd
              >
            </span>
            <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
            <template v-if="!isReadOnly(def.id)">
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
            </template>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection :title="t('keybinding.group.nav')" level="section" default-open>
        <template v-for="def in navDefs" :key="def.id">
          <div class="settings-row kb-shortcut-row" :data-kb-id="def.id">
            <label class="kb-shortcut-label">
              <span class="kb-icon" aria-hidden="true"
                ><component :is="def.icon" :size="14"
              /></span>
              <span>{{ t(def.titleKey) }}</span>
            </label>
            <div class="kb-shortcut-ctrl">
              <span v-if="kbRecording !== def.id" class="kb-keys">
                <kbd
                  v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')"
                  :key="i"
                  >{{ k }}</kbd
                >
              </span>
              <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
              <template v-if="!isReadOnly(def.id)">
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
              </template>
            </div>
          </div>
          <p v-if="def.id === 'superviseTabs'" class="settings-hint">
            {{ t('keybinding.superviseTabsHint') }}
          </p>
          <template v-if="def.id === 'superviseTabs'">
            <div class="settings-row">
              <label>{{ t('keybinding.superviseTabsReload') }}</label>
              <label class="toggle">
                <input
                  v-model="reloadAfterSuperviseTabs"
                  type="checkbox"
                  data-setting="reload-after-supervise-tabs"
                />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <button
                v-if="hasOverride()"
                type="button"
                class="setting-reset"
                title="reset to default"
                aria-label="reset to default"
                @click="resetOverride()"
              >
                <RotateCcw :size="14" />
              </button>
            </div>
            <p class="settings-hint" data-hint="reload-after-supervise-tabs">
              {{ t('keybinding.superviseTabsReloadHint') }}
              {{ t('keybinding.superviseTabsReloadDeviceHint') }}
            </p>
          </template>
        </template>
      </CollapsibleSection>

      <CollapsibleSection :title="t('keybinding.group.font')" level="section" default-open>
        <div
          v-for="def in fontDefs"
          :key="def.id"
          class="settings-row kb-shortcut-row"
          :data-kb-id="def.id"
        >
          <label class="kb-shortcut-label">
            <span class="kb-icon" aria-hidden="true"><component :is="def.icon" :size="14" /></span>
            <span>{{ t(def.titleKey) }}</span>
          </label>
          <div class="kb-shortcut-ctrl">
            <span v-if="kbRecording !== def.id" class="kb-keys">
              <kbd
                v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')"
                :key="i"
                >{{ k }}</kbd
              >
            </span>
            <span v-else class="kb-keys recording">{{ t('keybinding.pressKeys') }}</span>
            <template v-if="!isReadOnly(def.id)">
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
        <label class="kb-shortcut-label">
          <span class="kb-icon" aria-hidden="true"><component :is="def.icon" :size="14" /></span>
          <span>{{ t(def.titleKey) }}</span>
        </label>
        <div class="kb-shortcut-ctrl">
          <span v-if="kbRecording !== def.id" class="kb-keys">
            <kbd v-for="(k, i) in formatBinding(getBinding(def.id), def.kind ?? 'app')" :key="i">{{
              k
            }}</kbd>
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
          <button v-else class="shortcut-add kb-stop" data-kb-action="stop" @click="stopKbRecord()">
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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import { useKbRecording } from '../../composables/useKbRecording'
import { useDeviceSuperviseReload } from '../../composables/useDeviceSuperviseReload'
import { isWindowsClient } from '../../utils/clientPlatform'
import CollapsibleSection from './CollapsibleSection.vue'
import { RotateCcw } from 'lucide-vue-next'

const { settings, saveSettings } = useSettings()
const { hasOverride, reloadAfterSuperviseTabs, resetOverride } = useDeviceSuperviseReload()
const { t } = useI18n()
const { defs, getBinding, formatBinding, isReadOnly } = useKeybindings()
const appDefs = computed(() => defs.filter((def) => (def.kind ?? 'app') === 'app'))
const terminalDefs = computed(() => defs.filter((def) => def.kind === 'terminal'))

const tabGroupIds = ['newTab', 'applyTemplate', 'closeTab', 'switchTab']
const paneGroupIds = [
  'splitHorizontal',
  'splitVertical',
  'toggleBroadcast',
  'toggleZoom',
  'equalizePanes',
  'focusNextPane',
  'focusPrevPane',
]
const navGroupIds = [
  'togglePalette',
  'openBookmarks',
  'searchTerminal',
  'missionControl',
  'superviseTabs',
  'sshConnect',
]
const fontGroupIds = ['fontSizeUp', 'fontSizeDown', 'fontSizeReset']

const tabDefs = computed(() => appDefs.value.filter((d) => tabGroupIds.includes(d.id)))
const paneDefs = computed(() => appDefs.value.filter((d) => paneGroupIds.includes(d.id)))
const navDefs = computed(() => appDefs.value.filter((d) => navGroupIds.includes(d.id)))
const fontDefs = computed(() => appDefs.value.filter((d) => fontGroupIds.includes(d.id)))

const { kbRecording, kbRecordError, startKbRecord, stopKbRecord, resetKbBinding } = useKbRecording({
  defs,
  settings,
  t,
})

onBeforeUnmount(() => stopKbRecord())
</script>

<style scoped>
.kb-shortcut-row {
  justify-content: space-between;
}
.kb-shortcut-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
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
  color: var(--fg);
  background: var(--bg-surface);
  border: 1px solid var(--border);
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
.kb-icon > svg {
  display: block;
}
.kb-stop {
  color: var(--danger) !important;
  border-color: var(--danger) !important;
}
.kb-record-error {
  flex-basis: 100%;
  margin: 4px 0 0 30px;
  color: var(--danger);
  font-size: 12px;
}
</style>

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
        <div class="ak-zone-head">
          <span class="ak-zone-title">{{ t('settings.akZoneMain') }}</span>
          <button class="shortcut-add" :title="t('settings.addRow')" @click="addActionRow">
            {{ t('settings.akAddRowMain') }}
          </button>
        </div>
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
                class="ak-wyg-target-row"
                data-ak-zone="main"
                :data-ak-row="ri"
              >
                <div
                  v-for="(key, ki) in row"
                  :key="akItemKey(key)"
                  class="ak-wyg-slot"
                  data-ak-zone="main"
                  :data-ak-row="ri"
                  :data-ak-index="ki"
                  :style="akPreviewSlotStyle(ri, ki)"
                >
                  <div class="mkb-btn ak-wyg-key" :class="[previewDef(ri, ki).cls]">
                    <button
                      type="button"
                      class="ak-key-grip"
                      :title="t('settings.dragSort')"
                      @pointerdown="akDragPointerDown({ zone: 'main', row: ri, index: ki }, $event)"
                    >
                      ⠿
                    </button>
                    <span class="ak-wyg-label" @click="editActionKey(ri, ki)">{{
                      previewLabel(key)
                    }}</span>
                    <button
                      type="button"
                      class="ak-key-del"
                      :title="t('settings.deleteKey')"
                      :aria-label="t('settings.deleteKey')"
                      @click.stop="removeActionKey(ri, ki)"
                    >
                      ✕
                    </button>
                    <div
                      class="ak-key-resize"
                      :title="t('settings.dragResize')"
                      @pointerdown="akResizePointerDown(ri, ki, $event)"
                    />
                  </div>
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

        <div class="ak-zone-sep"></div>
        <div
          class="mkb-action-bottom ak-wyg-bottom-cluster"
          :style="{ '--ak-enter-width': (actionBottom.enter_width ?? 0.28) * 100 + '%' }"
        >
          <div class="mkb-action-grid">
            <div
              v-for="(row, ri) in actionBottom.rows"
              :key="ri"
              class="ak-wyg-row-outer"
            >
              <div class="mkb-action-grid-row">
                <div
                  class="ak-wyg-target-row"
                  data-ak-zone="bottom"
                  :data-ak-row="ri"
                >
                  <div
                    v-for="(key, ki) in row"
                    :key="akItemKey(key)"
                    class="ak-wyg-slot"
                    data-ak-zone="bottom"
                    :data-ak-row="ri"
                    :data-ak-index="ki"
                    :style="bottomPreviewSlotStyle(ri, ki)"
                  >
                    <div
                      class="mkb-btn ak-wyg-key"
                      :class="[bottomPreviewDef(ri, ki).cls, footerStructuralClass(key)]"
                    >
                      <button
                        type="button"
                        class="ak-key-grip"
                        :title="t('settings.dragSort')"
                        @pointerdown="akDragPointerDown({ zone: 'bottom', row: ri, index: ki }, $event)"
                      >
                        ⠿
                      </button>
                      <span class="ak-wyg-label" @click="editBottomKey(ri, ki)">{{
                        previewLabel(key)
                      }}</span>
                      <button
                        type="button"
                        class="ak-key-del"
                        :title="t('settings.deleteKey')"
                        :aria-label="t('settings.deleteKey')"
                        @click.stop="removeBottomKey(ri, ki)"
                      >
                        ✕
                      </button>
                      <div
                        class="ak-key-resize"
                        :title="t('settings.dragResize')"
                        @pointerdown="akBottomResizePointerDown(ri, ki, $event)"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="mkb-btn mkb-mod ak-wyg-add-key"
                  @click="addBottomKey(ri)"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                class="ak-wyg-remove-row"
                :title="t('settings.deleteRow')"
                @click="removeBottomRow(ri)"
              >
                ✕
              </button>
            </div>
          </div>
          <div
            class="mkb-btn ak-wyg-key mkb-action-enter mkb-return ak-wyg-enter"
            :class="bottomEnterPreviewDef.cls"
          >
            <div
              class="ak-enter-resize"
              :title="t('settings.dragResize')"
              @pointerdown="akEnterResizePointerDown"
            />
            <span class="ak-wyg-label" @click="editBottomEnter">{{
              previewLabel(actionBottom.enter)
            }}</span>
          </div>
        </div>
        <div class="ak-zone-head">
          <span class="ak-zone-title">{{ t('settings.akZoneBottom') }}</span>
          <button
            type="button"
            class="shortcut-add"
            :title="t('settings.addRow')"
            @click="addBottomRow"
          >
            {{ t('settings.akAddRowBottom') }}
          </button>
        </div>
      </div>
      <div class="ak-actions">
        <button
          type="button"
          class="shortcut-add ak-reset"
          :title="t('settings.akResetFactory')"
          :aria-label="t('settings.akResetFactory')"
          @click="resetActionKeyboard"
        >
          {{ t('settings.akResetFactory') }}
        </button>
        <button
          type="button"
          class="shortcut-add"
          :title="t('settings.akSaveUserDefault')"
          :aria-label="t('settings.akSaveUserDefault')"
          @click="saveActionKeyboardUserDefault"
        >
          {{ t('settings.akSaveUserDefault') }}
        </button>
        <button
          type="button"
          class="shortcut-add"
          :title="t('settings.akRestoreUserDefault')"
          :aria-label="t('settings.akRestoreUserDefault')"
          :disabled="settings.action_keyboard_user_default == null"
          @click="restoreActionKeyboardUserDefault"
        >
          {{ t('settings.akRestoreUserDefault') }}
        </button>
      </div>

      <h4>{{ t('settings.toolbarQuickKeys') }}</h4>
      <p class="settings-hint">{{ t('settings.toolbarQuickKeysHint') }}</p>
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
          <label v-if="akEdit.scope !== 'toolbar' && !akIsEnterEdit" class="ak-field">
            <span>{{ t('actionKb.kind') }}</span>
            <select v-model="akEdit.kind" class="shortcut-input">
              <option value="send">{{ t('actionKb.kind.send') }}</option>
              <option value="action">{{ t('actionKb.kind.action') }}</option>
            </select>
          </label>
          <template v-if="akEdit.kind === 'send' && !akIsEnterEdit">
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
          <label v-else-if="!akIsEnterEdit" class="ak-field">
            <span>{{ t('actionKb.action') }}</span>
            <select v-model="akEdit.action" class="shortcut-input">
              <option value="" disabled>{{ t('actionKb.selectAction') }}</option>
              <option v-for="action in APP_ACTIONS" :key="action.id" :value="action.id">
                {{ t(action.labelKey) }}
              </option>
            </select>
          </label>
          <label v-if="akEdit.kind === 'action' && !akIsEnterEdit" class="ak-field">
            <span>{{ t('actionKb.display') }}</span>
            <select v-model="akEdit.display" class="shortcut-input">
              <option value="icon">{{ t('actionKb.display.icon') }}</option>
              <option value="text">{{ t('actionKb.display.text') }}</option>
            </select>
          </label>
          <label class="ak-field">
            <span>{{ t('settings.style') }}</span>
            <select v-model="akEdit.style" class="shortcut-input">
              <option value="">{{ t('settings.style.normal') }}</option>
              <option value="danger">{{ t('settings.style.danger') }}</option>
            </select>
          </label>
          <label v-if="akEdit.kind === 'send' && !akIsEnterEdit" class="shortcut-check">
            <input type="checkbox" v-model="akEdit.auto_enter" /> {{ t('settings.appendEnter') }}
          </label>
          <label v-if="akEdit.kind === 'send' && !akIsEnterEdit" class="shortcut-check">
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
      <div class="settings-row">
        <label>{{ t('settings.keyboard.keepOnScroll') }}</label>
        <label class="toggle">
          <input
            type="checkbox"
            v-model="settings.keyboard_keep_on_scroll"
            @change="saveSettings()"
          />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <p class="settings-hint">{{ t('settings.keyboard.keepOnScrollHint') }}</p>
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
              {{ t('notification.testForm') }}
            </button>
            <button :class="{ active: openApiMode === 'raw' }" @click="switchOpenApiMode('raw')">
              {{ t('notification.testRaw') }}
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
            {{ openApiSending ? '...' : `▶ ${t('settings.keyboard.openApiSend')}` }}
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

<script lang="ts">
export function akDropGripThreshold(width: number): number {
  const GRIP = 16
  return Math.min(GRIP, width / 2)
}

// Returns the insertion slot on the target's before/after side.
export function akResolveDropIndex(
  pointerX: number,
  rect: { left: number; right: number; width: number },
  targetIndex: number,
  direction: 'before' | 'after' | 'unknown',
): number {
  const threshold = akDropGripThreshold(rect.width)
  if (direction === 'after') {
    return pointerX >= rect.left + threshold ? targetIndex + 1 : targetIndex
  }
  if (direction === 'before') {
    return pointerX <= rect.right - threshold ? targetIndex : targetIndex + 1
  }
  return pointerX >= rect.left + rect.width / 2 ? targetIndex + 1 : targetIndex
}
</script>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount, toRaw } from 'vue'
import {
  useSettings,
  DEFAULT_ACTION_KEYBOARD,
  DEFAULT_ACTION_BOTTOM,
  cloneWithoutIcons,
  currentLoadGeneration,
  effectiveActionKeyboard,
  ensureBottom,
  isLoadInFlight,
  resetActionKeyboard,
  restoreActionKeyboardUserDefault,
  restoreActionIcons,
  saveActionKeyboardUserDefault,
} from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import type {
  ActionBottomCluster,
  ActionKey,
  ActionKeyboardConfig,
} from '../../composables/useSettings'
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

const akDraft = ref<ActionKeyboardConfig | null>(null)

const actionRows = computed(() => (akDraft.value ?? effectiveActionKeyboard()).rows)

const actionBottom = computed<ActionBottomCluster>(() =>
  (akDraft.value ?? effectiveActionKeyboard()).bottom ?? DEFAULT_ACTION_BOTTOM
)

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

function bottomPreviewDef(ri: number, ki: number) {
  return actionKeyToKeyDef(actionBottom.value.rows[ri][ki])
}

const bottomEnterPreviewDef = computed(() => actionKeyToKeyDef(actionBottom.value.enter))

function footerStructuralClass(key: ActionKey) {
  return key.shape === 'arrow' ? 'mkb-action-arrow' : 'mkb-action-btn'
}

function akPreviewSlotStyle(ri: number, ki: number) {
  const d = previewDef(ri, ki)
  return { flexGrow: d.g ?? 1, flexBasis: '0', minWidth: '0' }
}

function bottomPreviewSlotStyle(ri: number, ki: number) {
  const d = bottomPreviewDef(ri, ki)
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

function addBottomRow() {
  ensureBottom().rows.push([])
}

function removeBottomRow(ri: number) {
  ensureBottom().rows.splice(ri, 1)
}

function addBottomKey(ri: number) {
  ensureBottom().rows[ri].push({ label: 'new', send: '', auto_enter: true })
}

function removeBottomKey(ri: number, ki: number) {
  ensureBottom().rows[ri].splice(ki, 1)
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
    display: 'icon',
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
    display: 'icon',
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
  const rawKey = toRaw(key)
  let id = akKeyIds.get(rawKey)
  if (!id) {
    id = 'ak-' + Math.random().toString(36).slice(2)
    akKeyIds.set(rawKey, id)
  }
  return id
}

type AkZone = 'main' | 'bottom'
type AkLoc = { zone: AkZone; row: number; index: number }

interface AkGestureBase {
  pointerId: number
  captureEl: HTMLElement
  generation: number
  draft: ActionKeyboardConfig
  preserveBottomAbsence: boolean
  footerTouched: boolean
}

type AkGesture = AkGestureBase & (
  | {
      kind: 'drag'
      currentLoc: AkLoc
      validTargetPreviewed: boolean
    }
  | {
      kind: 'grow'
      loc: AkLoc
      startX: number
      startGrow: number
      changed: boolean
    }
  | {
      kind: 'enter-width'
      startX: number
      startWidth: number
      footerWidth: number
      changed: boolean
    }
)

let akGesture: AkGesture | null = null

function akRowsFor(cfg: ActionKeyboardConfig, zone: AkZone): ActionKey[][] {
  return zone === 'main' ? cfg.rows : (cfg.bottom?.rows ?? [])
}

function akKeyAt(cfg: ActionKeyboardConfig, loc: AkLoc): ActionKey | undefined {
  return akRowsFor(cfg, loc.zone)[loc.row]?.[loc.index]
}

function akTransferItemKeys(source: ActionKeyboardConfig, draft: ActionKeyboardConfig) {
  const transferRows = (sourceRows: ActionKey[][], draftRows: ActionKey[][]) => {
    for (let ri = 0; ri < sourceRows.length; ri++) {
      for (let ki = 0; ki < sourceRows[ri].length; ki++) {
        const sourceKey = sourceRows[ri][ki]
        const draftKey = draftRows[ri]?.[ki]
        if (draftKey) akKeyIds.set(draftKey, akItemKey(sourceKey))
      }
    }
  }
  transferRows(source.rows, draft.rows)
  if (source.bottom && draft.bottom) transferRows(source.bottom.rows, draft.bottom.rows)
}

function akStartGestureDraft(e: PointerEvent): {
  draft: ActionKeyboardConfig
  captureEl: HTMLElement
  preserveBottomAbsence: boolean
} | null {
  if (e.button !== 0 || akGesture || isLoadInFlight()) return null

  e.preventDefault()
  e.stopPropagation()
  const source = effectiveActionKeyboard()
  const rawDraft = cloneWithoutIcons(source)
  akTransferItemKeys(source, rawDraft)

  const captureEl = e.currentTarget as HTMLElement
  captureEl.setPointerCapture(e.pointerId)
  akDraft.value = rawDraft
  return {
    draft: akDraft.value,
    captureEl,
    preserveBottomAbsence:
      settings.action_keyboard !== null && settings.action_keyboard.bottom === undefined,
  }
}

function akActivateGesture(gesture: AkGesture) {
  akGesture = gesture
  window.addEventListener('pointermove', akGesturePointerMove)
  window.addEventListener('pointerup', akGesturePointerUp)
  window.addEventListener('pointercancel', akGesturePointerCancel)
}

function akResolveElementLoc(element: Element, needsIndex: boolean): AkLoc | null {
  const zone = element.getAttribute('data-ak-zone')
  if (zone !== 'main' && zone !== 'bottom') return null

  const rowValue = element.getAttribute('data-ak-row')
  if (rowValue === null) return null
  const row = Number(rowValue)
  if (!Number.isInteger(row) || row < 0) return null
  const rows = akDraft.value ? akRowsFor(akDraft.value, zone) : []
  if (!rows[row]) return null

  if (!needsIndex) return { zone, row, index: rows[row].length }
  const indexValue = element.getAttribute('data-ak-index')
  if (indexValue === null) return null
  const index = Number(indexValue)
  if (!Number.isInteger(index) || index < 0 || index >= rows[row].length) return null
  return { zone, row, index }
}

function akResolveDropTarget(e: PointerEvent, currentLoc: AkLoc): AkLoc | null {
  const hit = document.elementFromPoint(e.clientX, e.clientY)
  if (!hit) return null

  const keyElement = hit.closest('[data-ak-index]')
  if (keyElement) {
    const loc = akResolveElementLoc(keyElement, true)
    if (!loc) return null
    const rect = keyElement.getBoundingClientRect()
    const direction = loc.zone === currentLoc.zone && loc.row === currentLoc.row
      ? loc.index < currentLoc.index
        ? 'before'
        : loc.index > currentLoc.index
          ? 'after'
          : 'unknown'
      : 'unknown'
    loc.index = akResolveDropIndex(e.clientX, rect, loc.index, direction)
    return loc
  }

  const rowElement = hit.closest('[data-ak-row]')
  return rowElement ? akResolveElementLoc(rowElement, false) : null
}

function akDragPointerDown(loc: AkLoc, e: PointerEvent) {
  if (!akKeyAt(effectiveActionKeyboard(), loc)) return
  const started = akStartGestureDraft(e)
  if (!started) return
  akActivateGesture({
    ...started,
    kind: 'drag',
    pointerId: e.pointerId,
    generation: currentLoadGeneration(),
    footerTouched: false,
    currentLoc: { ...loc },
    validTargetPreviewed: false,
  })
}

function akResizePointerDown(ri: number, ki: number, e: PointerEvent) {
  const loc: AkLoc = { zone: 'main', row: ri, index: ki }
  const sourceKey = akKeyAt(effectiveActionKeyboard(), loc)
  if (!sourceKey) return
  const started = akStartGestureDraft(e)
  if (!started) return
  const key = akKeyAt(started.draft, loc)!
  akActivateGesture({
    ...started,
    kind: 'grow',
    pointerId: e.pointerId,
    generation: currentLoadGeneration(),
    footerTouched: false,
    loc,
    startX: e.clientX,
    startGrow: key.grow != null && key.grow > 0 ? key.grow : 1,
    changed: false,
  })
}

function akBottomResizePointerDown(ri: number, ki: number, e: PointerEvent) {
  const loc: AkLoc = { zone: 'bottom', row: ri, index: ki }
  const sourceKey = akKeyAt(effectiveActionKeyboard(), loc)
  if (!sourceKey) return
  const started = akStartGestureDraft(e)
  if (!started) return
  const key = akKeyAt(started.draft, loc)!
  akActivateGesture({
    ...started,
    kind: 'grow',
    pointerId: e.pointerId,
    generation: currentLoadGeneration(),
    footerTouched: false,
    loc,
    startX: e.clientX,
    startGrow: key.grow != null && key.grow > 0 ? key.grow : 1,
    changed: false,
  })
}

function akEnterResizePointerDown(e: PointerEvent) {
  const footer = (e.currentTarget as HTMLElement).closest<HTMLElement>('.mkb-action-bottom')
  const footerWidth = footer?.getBoundingClientRect().width ?? 0
  if (footerWidth <= 0) return
  const started = akStartGestureDraft(e)
  if (!started) return
  akActivateGesture({
    ...started,
    kind: 'enter-width',
    pointerId: e.pointerId,
    generation: currentLoadGeneration(),
    footerTouched: false,
    startX: e.clientX,
    startWidth: started.draft.bottom?.enter_width ?? 0.28,
    footerWidth,
    changed: false,
  })
}

function akMoveDraggedKey(gesture: Extract<AkGesture, { kind: 'drag' }>, target: AkLoc) {
  const source = gesture.currentLoc
  const sourceRow = akRowsFor(gesture.draft, source.zone)[source.row]
  const targetRow = akRowsFor(gesture.draft, target.zone)[target.row]
  if (!sourceRow || !targetRow || !sourceRow[source.index]) return

  const [key] = sourceRow.splice(source.index, 1)
  let insertIndex = target.index
  if (source.zone === target.zone && source.row === target.row && insertIndex > source.index) {
    insertIndex--
  }
  insertIndex = Math.max(0, Math.min(insertIndex, targetRow.length))
  targetRow.splice(insertIndex, 0, key)
  gesture.currentLoc = { zone: target.zone, row: target.row, index: insertIndex }
  gesture.validTargetPreviewed = true
  if (source.zone === 'bottom' || target.zone === 'bottom') gesture.footerTouched = true
}

function akGesturePointerMove(e: PointerEvent) {
  const gesture = akGesture
  if (!gesture || e.pointerId !== gesture.pointerId) return
  e.preventDefault()

  if (gesture.kind === 'drag') {
    const target = akResolveDropTarget(e, gesture.currentLoc)
    if (target) akMoveDraggedKey(gesture, target)
    return
  }

  if (gesture.kind === 'grow') {
    const key = akKeyAt(gesture.draft, gesture.loc)
    if (!key) return
    const nextGrow = Math.min(
      12,
      Math.max(0.5, Math.round((gesture.startGrow + (e.clientX - gesture.startX) / 28) * 4) / 4),
    )
    if (key.grow !== nextGrow) {
      key.grow = nextGrow
      gesture.changed = true
      if (gesture.loc.zone === 'bottom') gesture.footerTouched = true
    }
    return
  }

  const bottom = gesture.draft.bottom
  if (!bottom) return
  const nextWidth = Math.min(
    0.5,
    Math.max(0.15, gesture.startWidth - (e.clientX - gesture.startX) / gesture.footerWidth),
  )
  if (bottom.enter_width !== nextWidth) {
    bottom.enter_width = nextWidth
    gesture.changed = true
    gesture.footerTouched = true
  }
}

function akCleanupGesture(gesture: AkGesture) {
  try {
    gesture.captureEl.releasePointerCapture(gesture.pointerId)
  } catch {}
  window.removeEventListener('pointermove', akGesturePointerMove)
  window.removeEventListener('pointerup', akGesturePointerUp)
  window.removeEventListener('pointercancel', akGesturePointerCancel)
  akGesture = null
  akDraft.value = null
}

function akCommitGestureDraft(gesture: AkGesture) {
  if (gesture.preserveBottomAbsence && !gesture.footerTouched) delete gesture.draft.bottom
  settings.action_keyboard = gesture.draft
  restoreActionIcons()
}

function akFinishGesture(e: PointerEvent, cancelled: boolean) {
  const gesture = akGesture
  if (!gesture || e.pointerId !== gesture.pointerId) return
  const generationMatches = currentLoadGeneration() === gesture.generation
  const hasCommit = gesture.kind === 'drag'
    ? gesture.validTargetPreviewed
    : gesture.changed
  akCleanupGesture(gesture)
  if (!cancelled && generationMatches && hasCommit) akCommitGestureDraft(gesture)
}

function akGesturePointerUp(e: PointerEvent) {
  akFinishGesture(e, false)
}

function akGesturePointerCancel(e: PointerEvent) {
  akFinishGesture(e, true)
}

function akAbortGesture() {
  if (akGesture) akCleanupGesture(akGesture)
}

type AkEditScope = 'action' | 'bottom' | 'bottom-enter' | 'toolbar'

const akEdit = ref<{
  scope: AkEditScope
  ri: number
  ki: number
  label: string
  kind: 'send' | 'action'
  action: string
  display: 'icon' | 'text'
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
const akIsEnterEdit = computed(() => akEdit.value?.scope === 'bottom-enter')

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
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    grow: key.grow,
    icon: key.icon,
  }
}

function editBottomKey(ri: number, ki: number) {
  const key = actionBottom.value.rows[ri][ki]
  if (!key) return
  akEdit.value = {
    scope: 'bottom',
    ri,
    ki,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : 'send',
    action: key.action || '',
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    grow: key.grow,
    icon: key.icon,
  }
}

function editBottomEnter() {
  const key = actionBottom.value.enter
  akEdit.value = {
    scope: 'bottom-enter',
    ri: -1,
    ki: -1,
    label: key.label,
    kind: 'send',
    action: '',
    display: 'icon',
    sendRaw: '\\r',
    style: key.style || '',
    repeat: false,
    auto_enter: false,
  }
}

function saveActionKey() {
  if (!akEdit.value || !akCanSave.value) return
  const edit = akEdit.value
  const { ri, ki } = edit
  if (edit.scope === 'bottom-enter') {
    ensureBottom().enter = {
      label: edit.label,
      kind: 'send',
      send: '\r',
      style: edit.style || undefined,
    }
    akEdit.value = null
    return
  }
  const label = edit.scope === 'toolbar' ? edit.label.trim() : edit.label
  const next: ActionKey = edit.kind === 'action'
    ? {
        label,
        kind: 'action',
        action: edit.action,
        display: edit.display,
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
  } else if (edit.scope === 'bottom') {
    ensureBottom().rows[ri][ki] = next
  } else {
    ensureActionKeyboard()
    settings.action_keyboard!.rows[ri][ki] = next
  }
  akEdit.value = null
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
  akAbortGesture()
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

.ak-actions .shortcut-add:disabled {
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

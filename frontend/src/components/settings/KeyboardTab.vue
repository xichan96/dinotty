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
            <p v-if="def.id === 'superviseTabs'" class="settings-hint">
              {{ t('keybinding.superviseTabsHint') }}
            </p>
            <template v-if="def.id === 'superviseTabs'">
              <div class="settings-row">
                <label>{{ t('keybinding.superviseTabsReload') }}</label>
                <label class="toggle">
                  <input
                    type="checkbox"
                    v-model="reloadAfterSuperviseTabs"
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
          <label v-if="akSupportsAutoEnter" class="shortcut-check">
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
        <label>{{ t('settings.keyboard.quickSendThreshold') }}</label>
        <input
          v-model.number="settings.quick_send_threshold"
          type="number"
          min="0"
          max="5000"
          step="1"
          class="settings-input-number"
          data-setting="quick-send-threshold"
          @change="onQuickSendThresholdChange"
        />
      </div>
      <p class="settings-hint">{{ t('settings.keyboard.quickSendThresholdHint') }}</p>
      <div class="settings-row">
        <label>{{ t('settings.keyboard.sound') }}</label>
        <label class="toggle">
          <input type="checkbox" v-model="settings.keyboard_sound" @change="saveSettings()" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="settings-row keyboard-guard-row">
        <label>{{ t('settings.keyboard.guardMode.label') }}</label>
        <SegmentedControl
          class="keyboard-guard-control"
          data-setting="keyboard-guard-mode"
          :model-value="settings.keyboard_guard_mode"
          :options="keyboardGuardModeOptions"
          :aria-label="t('settings.keyboard.guardMode.label')"
          @update:model-value="onKeyboardGuardModeChange"
        />
      </div>
      <p class="settings-hint">{{ t('settings.keyboard.guardMode.hint') }}</p>
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
export { akDropGripThreshold, akResolveDropIndex } from '../../composables/useActionKeyboardGesture'

export function normalizeQuickSendThreshold(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 63
  return Math.min(5000, Math.max(0, Math.trunc(numeric)))
}
</script>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import {
  useSettings,
  DEFAULT_ACTION_KEYBOARD,
  DEFAULT_ACTION_BOTTOM,
  effectiveActionKeyboard,
  ensureBottom,
  resetActionKeyboard,
  restoreActionKeyboardUserDefault,
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
import { actionKeyToKeyDef } from '../../utils/actionKeyDef'
import { APP_ACTIONS, APP_ACTION_IDS } from '../../utils/appActionCatalog'
import { isWindowsClient } from '../../utils/clientPlatform'
import { useDeviceSuperviseReload } from '../../composables/useDeviceSuperviseReload'
import { RotateCcw } from 'lucide-vue-next'
import SegmentedControl from '../ui/SegmentedControl.vue'
import type { KeyboardGuardMode } from '../../utils/keyboardGuardMode'
import { useOpenApiTest } from '../../composables/useOpenApiTest'
import { useKbRecording } from '../../composables/useKbRecording'
import { useActionKeyboardGesture } from '../../composables/useActionKeyboardGesture'
import {
  escapeForDisplay,
  unescapeFromDisplay,
  keyEventToSequence,
  keyEventToLabel,
} from '../../composables/useKeySequenceUtils'

const { settings, saveSettings } = useSettings()
const { hasOverride, reloadAfterSuperviseTabs, resetOverride } = useDeviceSuperviseReload()
const { t } = useI18n()

const keyboardGuardModeOptions = computed(() => [
  { value: 'off', label: t('settings.keyboard.guardMode.off') },
  { value: 'collapse_only', label: t('settings.keyboard.guardMode.collapseOnly') },
  { value: 'open_only', label: t('settings.keyboard.guardMode.openOnly') },
  { value: 'both', label: t('settings.keyboard.guardMode.both') },
])

function onKeyboardGuardModeChange(value: string) {
  settings.keyboard_guard_mode = value as KeyboardGuardMode
  void saveSettings()
}

function onQuickSendThresholdChange() {
  settings.quick_send_threshold = normalizeQuickSendThreshold(settings.quick_send_threshold)
  void saveSettings()
}
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

const {
  openApiPaneId,
  openApiData,
  openApiMode,
  openApiRawJson,
  openApiRawError,
  openApiResult,
  openApiResultOk,
  openApiSending,
  apiBaseUrl,
  openApiCanSend,
  switchOpenApiMode,
  sendOpenApiTest,
} = useOpenApiTest()

const { kbRecording, kbRecordError, startKbRecord, stopKbRecord, resetKbBinding } = useKbRecording({
  defs,
  settings,
  t,
})

const akDraft = ref<ActionKeyboardConfig | null>(null)

const {
  akItemKey,
  akDragPointerDown,
  akResizePointerDown,
  akBottomResizePointerDown,
  akEnterResizePointerDown,
  akAbortGesture,
} = useActionKeyboardGesture({ akDraft, settings })

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
const akSupportsAutoEnter = computed(() =>
  !!akEdit.value &&
  !akIsEnterEdit.value &&
  (akEdit.value.kind === 'send' ||
    (akEdit.value.kind === 'action' && akEdit.value.action === 'pasteTerminal'))
)

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
        ...(edit.action === 'pasteTerminal' ? { auto_enter: edit.auto_enter } : {}),
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
.keyboard-guard-row {
  align-items: stretch;
  flex-direction: column;
}
.keyboard-guard-control {
  width: 100%;
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

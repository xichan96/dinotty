<template>
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
            <div class="ak-wyg-target-row" data-ak-zone="main" :data-ak-row="ri">
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
            <button type="button" class="mkb-btn mkb-mod ak-wyg-add-key" @click="addActionKey(ri)">
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
          <div v-for="(row, ri) in actionBottom.rows" :key="ri" class="ak-wyg-row-outer">
            <div class="mkb-action-grid-row">
              <div class="ak-wyg-target-row" data-ak-zone="bottom" :data-ak-row="ri">
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
                      @pointerdown="
                        akDragPointerDown({ zone: 'bottom', row: ri, index: ki }, $event)
                      "
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
        <label v-if="!akIsEnterEdit" class="ak-field">
          <span>{{ t('actionKb.kind') }}</span>
          <select
            v-model="akEdit.kind"
            class="shortcut-input"
            data-special-field="kind"
            @change="onAkKindChange"
          >
            <option value="send">{{ t('actionKb.kind.send') }}</option>
            <option value="special">{{ t('actionKb.kind.special') }}</option>
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
              @click.stop="toggleAkRecord('action')"
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
        <template v-else-if="akEdit.kind === 'special' && !akIsEnterEdit">
          <label class="ak-field">
            <span>{{ t('settings.specialKey') }}</span>
            <select
              v-model="akEdit.specialId"
              class="shortcut-input"
              data-special-field="key"
              @change="onAkSpecialChange"
            >
              <option v-for="item in KEYBOARD_SPECIAL_KEYS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </select>
          </label>
          <label v-if="akSpecialEntry?.modifier" class="shortcut-check">
            <input v-model="akEdit.keepHeld" type="checkbox" data-special-field="hold" />
            <span>{{ t('settings.modifierKeepHeld') }}</span>
          </label>
          <label class="ak-field">
            <span>{{ t('actionKb.display') }}</span>
            <select v-model="akEdit.display" class="shortcut-input" data-special-field="display">
              <option value="icon">{{ t('actionKb.display.icon') }}</option>
              <option value="text">{{ t('actionKb.display.text') }}</option>
            </select>
          </label>
          <p v-if="akSpecialEntry?.modifier === 'meta'" class="settings-hint">
            {{ t('settings.terminalMetaHint') }}
          </p>
        </template>
        <label v-else-if="!akIsEnterEdit" class="ak-field">
          <span>{{ t('actionKb.action') }}</span>
          <select v-model="akEdit.action" class="shortcut-input">
            <option value="" disabled>{{ t('actionKb.selectAction') }}</option>
            <option v-for="action in akActionOptions" :key="action.id" :value="action.id">
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
        <label
          v-if="akEdit.kind === 'send' && !akIsEnterEdit"
          class="shortcut-check ak-agent-icon-check"
          :class="{ disabled: !akAgentIconAvailable }"
        >
          <input
            type="checkbox"
            :disabled="!akAgentIconAvailable"
            :checked="akEdit.display !== 'text'"
            @change="akEdit.display = ($event.target as HTMLInputElement).checked ? 'icon' : 'text'"
          />
          {{ t('settings.agentDisplayIcon') }}
        </label>
        <p
          v-if="akEdit.kind === 'send' && !akIsEnterEdit && !akAgentIconAvailable"
          class="settings-hint ak-agent-icon-hint"
        >
          {{ t('settings.agentDisplayIconHint') }}
        </p>
        <label class="ak-field">
          <span>{{ t('settings.style') }}</span>
          <select v-model="akEdit.style" class="shortcut-input">
            <option value="">{{ t('settings.style.normal') }}</option>
            <option value="danger">{{ t('settings.style.danger') }}</option>
          </select>
        </label>
        <label v-if="akSupportsAutoEnter" class="shortcut-check ak-auto-enter-check">
          <input v-model="akEdit.auto_enter" type="checkbox" /> {{ t('settings.appendEnter') }}
        </label>
        <label v-if="!akIsEnterEdit && akSupportsRepeat" class="shortcut-check ak-repeat-check">
          <input v-model="akEdit.repeat" type="checkbox" /> {{ t('settings.repeatHold') }}
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
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import {
  resetActionKeyboard,
  restoreActionKeyboardUserDefault,
  saveActionKeyboardUserDefault,
  useSettings,
} from '../../composables/useSettings'
import { useActionKeyboardEditor } from '../../composables/useActionKeyboardEditor'
import { useI18n } from '../../composables/useI18n'
import { previewLabel } from '../../utils/keyboardEditUtils'
import { KEYBOARD_SPECIAL_KEYS } from '../../utils/keyboardSpecialKeys'
import CollapsibleSection from './CollapsibleSection.vue'

const { settings } = useSettings()
const { t } = useI18n()

const {
  akItemKey,
  akDragPointerDown,
  akResizePointerDown,
  akBottomResizePointerDown,
  akEnterResizePointerDown,
  akAbortGesture,
  actionRows,
  actionBottom,
  toolbarQuickKeys,
  toolbarPreviewSlotStyle,
  previewDef,
  previewToolbarDef,
  bottomPreviewDef,
  bottomEnterPreviewDef,
  footerStructuralClass,
  akPreviewSlotStyle,
  bottomPreviewSlotStyle,
  akEdit,
  akSendPreview,
  recordFocusSinkRef,
  akRecording,
  toggleAkRecord,
  akIsEnterEdit,
  akAgentIconAvailable,
  akSpecialEntry,
  akSupportsRepeat,
  akSupportsAutoEnter,
  akActionOptions,
  akCanSave,
  editActionKey,
  editBottomKey,
  editBottomEnter,
  editToolbarQuickKey,
  addToolbarQuickKey,
  removeToolbarQuickKey,
  onAkSpecialChange,
  onAkKindChange,
  saveActionKey,
  addActionRow,
  removeActionRow,
  addActionKey,
  removeActionKey,
  addBottomRow,
  removeBottomRow,
  addBottomKey,
  removeBottomKey,
} = useActionKeyboardEditor(settings)

onBeforeUnmount(() => akAbortGesture())
</script>

<style scoped>
.shortcut-check.disabled {
  opacity: 0.55;
}
.ak-agent-icon-hint {
  margin-top: 6px;
  line-height: 1.45;
}
.ak-actions .shortcut-add:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>

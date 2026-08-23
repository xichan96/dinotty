<template>
  <CollapsibleSection :title="t('settings.systemKeyboard')" level="group" default-open>
    <p class="settings-hint">{{ t('settings.systemKeyboardHint') }}</p>
    <div class="settings-row">
      <label>{{ t('settings.systemKeyboardPersistent') }}</label>
      <label class="toggle">
        <input
          type="checkbox"
          data-setting="system-toolbar-persistent"
          :checked="settings.system_toolbar_mode === 'persistent_mobile'"
          @change="onSystemToolbarModeChange"
        />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>

    <div class="ak-zone-head system-editor-head">
      <span class="ak-zone-title">
        {{ t('settings.systemKeyboardUpper') }} · {{ systemStatus.upperPages }} / 5
      </span>
      <label class="system-editor-pin-control">
        <span>{{ t('settings.systemKeyboardPinned') }}</span>
        <select :value="systemStatus.upperPinned" @change="onPinnedChange('upper', $event)">
          <option v-for="count in systemUpperPinnedOptions" :key="count" :value="count">
            {{ count }}
          </option>
        </select>
      </label>
      <button
        class="shortcut-add system-editor-add"
        type="button"
        data-system-add="upper"
        @click="addSystemKey('upper')"
      >
        {{ t('settings.systemKeyboardAddKey') }}
      </button>
    </div>
    <div class="system-editor-pages">
      <div
        v-for="(page, pageIndex) in systemUpperPages"
        :key="`upper-${pageIndex}`"
        class="system-editor-page system-editor-upper-page"
        data-system-region="upper"
        :data-system-page-end="page.end"
      >
        <div class="system-editor-grid">
          <div
            v-for="item in page.pinnedCopies"
            :key="`copy-${systemItemKey(item.key)}`"
            class="ak-wyg-slot system-editor-slot system-editor-pinned-copy"
            :style="systemSlotStyle(item.units)"
            aria-hidden="true"
          >
            <div class="mkb-btn ak-wyg-key" :class="systemPreviewDef(item.key).cls">
              <Pin :size="12" class="system-editor-pin-mark" />
              <component
                :is="systemPreviewDef(item.key).icon"
                v-if="systemPreviewDef(item.key).icon"
                :size="18"
              />
              <span v-else class="ak-wyg-label">{{ previewLabel(item.key) }}</span>
            </div>
          </div>
          <div
            v-for="item in page.items"
            :key="systemItemKey(item.key)"
            class="ak-wyg-slot system-editor-slot"
            :class="{
              'system-editor-pinned': item.index < systemStatus.upperPinned,
              'system-editor-dragging': systemDraggedKey === systemItemKey(item.key),
              'system-editor-compact': item.units === 1,
              'system-editor-resizable': item.key.grow != null,
            }"
            data-system-region="upper"
            :data-system-index="item.index"
            :style="systemSlotStyle(item.units)"
          >
            <div class="mkb-btn ak-wyg-key" :class="systemPreviewDef(item.key).cls">
              <button
                type="button"
                class="ak-key-grip"
                :title="t('settings.dragSort')"
                @pointerdown="systemDragPointerDown({ region: 'upper', index: item.index }, $event)"
              >
                <Pin
                  v-if="item.index < systemStatus.upperPinned"
                  :size="12"
                  class="system-editor-pin-mark"
                />
                <template v-else>⠿</template>
              </button>
              <button
                type="button"
                class="system-editor-edit-hit"
                :aria-label="`${t('settings.editKey')}: ${previewLabel(item.key)}`"
                @click="beginSystemEdit('upper', item.index)"
              >
                <component
                  :is="systemPreviewDef(item.key).icon"
                  v-if="systemPreviewDef(item.key).icon"
                  :size="18"
                  class="system-editor-key-icon"
                />
                <span v-else class="ak-wyg-label">{{ previewLabel(item.key) }}</span>
              </button>
              <button
                type="button"
                class="ak-key-del"
                :aria-label="t('settings.deleteKey')"
                @click.stop="removeSystemKey('upper', item.index)"
              >
                ✕
              </button>
              <div
                v-if="item.key.grow != null"
                class="ak-key-resize"
                :title="t('settings.dragResize')"
                @pointerdown="
                  systemResizePointerDown({ region: 'upper', index: item.index }, $event)
                "
              />
            </div>
          </div>
          <div
            class="mkb-btn mkb-mod system-editor-ime-pin"
            role="img"
            :aria-label="t('mobileKb.showKeyboard')"
            :title="t('mobileKb.showKeyboard')"
          >
            <Keyboard :size="18" />
          </div>
        </div>
      </div>
    </div>

    <div class="ak-zone-head system-editor-head">
      <span class="ak-zone-title">
        {{ t('settings.systemKeyboardLower') }} · {{ systemStatus.storedLowerPages }} / 5
      </span>
      <label class="toggle" :title="t('settings.systemKeyboardLowerEnabled')">
        <input
          type="checkbox"
          data-setting="system-lower-enabled"
          :checked="systemLayout.lower_enabled !== false"
          @change="onSystemLowerEnabledChange"
        />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
      <label class="system-editor-pin-control">
        <span>{{ t('settings.systemKeyboardPinned') }}</span>
        <select :value="systemStatus.lowerPinned" @change="onPinnedChange('lower', $event)">
          <option v-for="count in systemLowerPinnedOptions" :key="count" :value="count">
            {{ count }}
          </option>
        </select>
      </label>
      <button
        class="shortcut-add system-editor-add"
        type="button"
        data-system-add="lower"
        @click="addSystemKey('lower')"
      >
        {{ t('settings.systemKeyboardAddKey') }}
      </button>
    </div>
    <p v-if="systemLayoutMessage" class="settings-hint system-layout-warning" role="status">
      {{ systemLayoutMessage }}
    </p>
    <p v-else-if="systemStatus.overLimit" class="settings-hint system-layout-warning" role="status">
      {{ t('settings.systemKeyboardOverLimit') }}
    </p>
    <p
      v-else-if="systemStatus.upperPages === 5 || systemStatus.storedLowerPages === 5"
      class="settings-hint system-layout-at-limit"
    >
      {{ t('settings.systemKeyboardAtLimit') }}
    </p>
    <div class="system-editor-pages">
      <div
        v-for="(page, pageIndex) in systemLowerPages"
        :key="`lower-${pageIndex}`"
        class="system-editor-page system-editor-lower-page"
        data-system-region="lower"
        :data-system-page-end="page.end"
      >
        <div class="system-editor-grid">
          <div
            v-for="item in page.pinnedCopies"
            :key="`copy-${systemItemKey(item.key)}`"
            class="ak-wyg-slot system-editor-slot system-editor-pinned-copy"
            :style="systemSlotStyle(item.units)"
            aria-hidden="true"
          >
            <div class="mkb-btn ak-wyg-key" :class="systemPreviewDef(item.key).cls">
              <Pin :size="12" class="system-editor-pin-mark" />
              <component
                :is="systemPreviewDef(item.key).icon"
                v-if="systemPreviewDef(item.key).icon"
                :size="18"
              />
              <span v-else class="ak-wyg-label">{{ previewLabel(item.key) }}</span>
            </div>
          </div>
          <div
            v-for="item in page.items"
            :key="systemItemKey(item.key)"
            class="ak-wyg-slot system-editor-slot"
            :class="{
              'system-editor-pinned': item.index < systemStatus.lowerPinned,
              'system-editor-dragging': systemDraggedKey === systemItemKey(item.key),
              'system-editor-compact': item.units === 1,
              'system-editor-resizable': item.key.grow != null,
            }"
            data-system-region="lower"
            :data-system-index="item.index"
            :style="systemSlotStyle(item.units)"
          >
            <div class="mkb-btn ak-wyg-key" :class="systemPreviewDef(item.key).cls">
              <button
                type="button"
                class="ak-key-grip"
                :title="t('settings.dragSort')"
                @pointerdown="systemDragPointerDown({ region: 'lower', index: item.index }, $event)"
              >
                <Pin
                  v-if="item.index < systemStatus.lowerPinned"
                  :size="12"
                  class="system-editor-pin-mark"
                />
                <template v-else>⠿</template>
              </button>
              <button
                type="button"
                class="system-editor-edit-hit"
                :aria-label="`${t('settings.editKey')}: ${previewLabel(item.key)}`"
                @click="beginSystemEdit('lower', item.index)"
              >
                <component
                  :is="systemPreviewDef(item.key).icon"
                  v-if="systemPreviewDef(item.key).icon"
                  :size="18"
                  class="system-editor-key-icon"
                />
                <span v-else class="ak-wyg-label">{{ previewLabel(item.key) }}</span>
              </button>
              <button
                type="button"
                class="ak-key-del"
                :aria-label="t('settings.deleteKey')"
                @click.stop="removeSystemKey('lower', item.index)"
              >
                ✕
              </button>
              <div
                v-if="item.key.grow != null"
                class="ak-key-resize"
                :title="t('settings.dragResize')"
                @pointerdown="
                  systemResizePointerDown({ region: 'lower', index: item.index }, $event)
                "
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="ak-actions">
      <button
        type="button"
        class="shortcut-add ak-reset"
        data-system-action="reset"
        @click="resetSystemKeyboard"
      >
        {{ t('settings.akResetFactory') }}
      </button>
      <button
        type="button"
        class="shortcut-add"
        data-system-action="save-default"
        @click="saveSystemKeyboardUserDefault"
      >
        {{ t('settings.akSaveUserDefault') }}
      </button>
      <button
        type="button"
        class="shortcut-add"
        data-system-action="restore-default"
        :disabled="settings.system_keyboard_user_default == null"
        @click="restoreSystemKeyboardUserDefault"
      >
        {{ t('settings.akRestoreUserDefault') }}
      </button>
    </div>

    <div v-if="systemEdit" class="ak-modal-backdrop" @click.self="systemEdit = null">
      <div class="ak-modal">
        <h4>{{ t('settings.editKey') }}</h4>
        <label class="ak-field">
          <span>{{ t('settings.label') }}</span>
          <input v-model="systemEdit.label" class="shortcut-input" />
        </label>
        <label class="ak-field">
          <span>{{ t('actionKb.kind') }}</span>
          <select
            v-model="systemEdit.kind"
            class="shortcut-input"
            data-special-field="kind"
            @change="onSystemKindChange"
          >
            <option value="send">{{ t('actionKb.kind.send') }}</option>
            <option value="special">{{ t('actionKb.kind.special') }}</option>
            <option value="action">{{ t('actionKb.kind.action') }}</option>
          </select>
        </label>
        <template v-if="systemEdit.kind === 'send'">
          <label class="ak-field">
            <span>{{ t('settings.send') }}</span>
            <textarea
              v-model="systemEdit.sendRaw"
              class="shortcut-input ak-send-textarea system-send-textarea"
              rows="4"
              spellcheck="false"
            />
          </label>
          <div class="ak-send-row">
            <code class="ak-esc-preview">{{ systemEdit.sendRaw }}</code>
            <button
              type="button"
              class="ak-record-btn"
              :class="{ recording: systemRecording }"
              data-system-record
              @click.stop="toggleSystemRecord('system')"
            >
              {{ systemRecording ? t('settings.stop') : t('settings.record') }}
            </button>
          </div>
          <div
            v-show="systemRecording"
            ref="recordFocusSinkRef"
            class="ak-record-focus-sink"
            tabindex="-1"
            aria-hidden="true"
          />
        </template>
        <template v-else-if="systemEdit.kind === 'special'">
          <label class="ak-field">
            <span>{{ t('settings.specialKey') }}</span>
            <select
              v-model="systemEdit.specialId"
              class="shortcut-input"
              data-special-field="key"
              @change="onSystemSpecialChange"
            >
              <option v-for="item in KEYBOARD_SPECIAL_KEYS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </select>
          </label>
          <label v-if="systemSpecialEntry?.modifier" class="shortcut-check">
            <input v-model="systemEdit.keepHeld" type="checkbox" data-special-field="hold" />
            <span>{{ t('settings.modifierKeepHeld') }}</span>
          </label>
          <label class="ak-field">
            <span>{{ t('actionKb.display') }}</span>
            <select
              v-model="systemEdit.display"
              class="shortcut-input"
              data-special-field="display"
            >
              <option value="icon">{{ t('actionKb.display.icon') }}</option>
              <option value="text">{{ t('actionKb.display.text') }}</option>
            </select>
          </label>
          <p v-if="systemSpecialEntry?.modifier === 'meta'" class="settings-hint">
            {{ t('settings.terminalMetaHint') }}
          </p>
        </template>
        <label v-else class="ak-field">
          <span>{{ t('actionKb.action') }}</span>
          <select v-model="systemEdit.action" class="shortcut-input">
            <option value="" disabled>{{ t('actionKb.selectAction') }}</option>
            <option v-for="action in systemActionOptions" :key="action.id" :value="action.id">
              {{ t(action.labelKey) }}
            </option>
          </select>
        </label>
        <label v-if="systemEdit.kind === 'action'" class="ak-field">
          <span>{{ t('actionKb.display') }}</span>
          <select v-model="systemEdit.display" class="shortcut-input">
            <option value="icon">{{ t('actionKb.display.icon') }}</option>
            <option value="text">{{ t('actionKb.display.text') }}</option>
          </select>
        </label>
        <label
          v-if="systemEdit.kind === 'send'"
          class="shortcut-check system-agent-icon-check"
          :class="{ disabled: !systemAgentIconAvailable }"
        >
          <input
            type="checkbox"
            :disabled="!systemAgentIconAvailable"
            :checked="systemEdit.display !== 'text'"
            @change="
              systemEdit.display = ($event.target as HTMLInputElement).checked ? 'icon' : 'text'
            "
          />
          {{ t('settings.agentDisplayIcon') }}
        </label>
        <p
          v-if="systemEdit.kind === 'send' && !systemAgentIconAvailable"
          class="settings-hint system-agent-icon-hint"
        >
          {{ t('settings.agentDisplayIconHint') }}
        </p>
        <label class="ak-field">
          <span>{{ t('settings.style') }}</span>
          <select v-model="systemEdit.style" class="shortcut-input">
            <option value="">{{ t('settings.style.normal') }}</option>
            <option value="danger">{{ t('settings.style.danger') }}</option>
          </select>
        </label>
        <label class="shortcut-check">
          <input
            type="checkbox"
            data-system-auto-width
            :checked="systemEdit.grow == null"
            @change="onSystemAutoWidthChange"
          />
          {{ t('settings.adaptiveWidth') }}
        </label>
        <label
          v-if="systemEdit.kind === 'send' || systemEdit.action === 'pasteTerminal'"
          class="shortcut-check"
        >
          <input v-model="systemEdit.auto_enter" type="checkbox" />
          {{ t('settings.appendEnter') }}
        </label>
        <label v-if="systemSupportsRepeat" class="shortcut-check">
          <input v-model="systemEdit.repeat" type="checkbox" /> {{ t('settings.repeatHold') }}
        </label>
        <div class="ak-modal-actions">
          <button class="settings-save" :disabled="!systemCanSave" @click="saveSystemKey">
            {{ t('settings.save') }}
          </button>
          <button class="shortcut-add" @click="systemEdit = null">
            {{ t('settings.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </CollapsibleSection>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import {
  resetSystemKeyboard,
  restoreSystemKeyboardUserDefault,
  saveSystemKeyboardUserDefault,
  useSettings,
} from '../../composables/useSettings'
import { useSystemKeyboardEditor } from '../../composables/useSystemKeyboardEditor'
import { useI18n } from '../../composables/useI18n'
import { previewLabel } from '../../utils/keyboardEditUtils'
import { KEYBOARD_SPECIAL_KEYS } from '../../utils/keyboardSpecialKeys'
import CollapsibleSection from './CollapsibleSection.vue'
import { Keyboard, Pin } from 'lucide-vue-next'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

const {
  systemItemKey,
  systemDraggedKey,
  systemDragPointerDown,
  systemResizePointerDown,
  abortSystemGesture,
  systemLayout,
  systemStatus,
  systemUpperPages,
  systemLowerPages,
  systemLayoutMessage,
  systemUpperPinnedOptions,
  systemLowerPinnedOptions,
  systemEdit,
  systemSpecialEntry,
  systemSupportsRepeat,
  systemAgentIconAvailable,
  systemActionOptions,
  systemCanSave,
  systemPreviewDef,
  systemSlotStyle,
  recordFocusSinkRef,
  systemRecording,
  toggleSystemRecord,
  beginSystemEdit,
  addSystemKey,
  saveSystemKey,
  removeSystemKey,
  onSystemAutoWidthChange,
  onSystemLowerEnabledChange,
  onPinnedChange,
  onSystemSpecialChange,
  onSystemKindChange,
} = useSystemKeyboardEditor(settings, t)

function onSystemToolbarModeChange(event: Event) {
  settings.system_toolbar_mode = (event.target as HTMLInputElement).checked
    ? 'persistent_mobile'
    : 'follow_ime'
  void saveSettings()
}

onBeforeUnmount(() => abortSystemGesture())
</script>

<style scoped>
.system-editor-head {
  margin-top: 14px;
  margin-bottom: 6px;
}
.system-editor-grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
  min-height: 44px;
}
.system-editor-ime-pin {
  grid-column: 10;
  min-width: 0;
  min-height: 44px;
  pointer-events: none;
}
.system-editor-slot {
  position: relative;
  min-width: 0;
}
.system-editor-slot .ak-wyg-key {
  min-height: 44px;
  padding-right: 0;
  padding-left: 20px;
}
.system-editor-slot .ak-key-grip {
  width: 20px;
}
.system-editor-slot .ak-key-del {
  right: 2px;
}
.system-editor-slot .ak-key-resize {
  width: 12px;
}
.system-editor-resizable .ak-wyg-key {
  padding-right: 12px;
}
.system-editor-resizable .ak-key-del {
  right: 8px;
}
.system-editor-compact .ak-wyg-key {
  padding-left: 14px;
}
.system-editor-compact .ak-key-grip {
  width: 14px;
}
.system-editor-compact.system-editor-resizable .ak-wyg-key {
  padding-right: 8px;
}
.system-editor-compact.system-editor-resizable .ak-key-resize {
  width: 8px;
}
.system-editor-edit-hit {
  align-self: stretch;
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.system-editor-key-icon {
  flex: 0 0 auto;
  margin: auto;
}
.system-editor-pinned .ak-wyg-key,
.system-editor-pinned-copy .ak-wyg-key,
.system-editor-ime-pin {
  border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-input));
}
.system-editor-pinned-copy {
  pointer-events: none;
  opacity: 0.76;
}
.system-editor-pinned-copy .ak-wyg-key {
  gap: 3px;
  padding: 0 6px;
}
.system-editor-pin-mark {
  flex: 0 0 auto;
  color: var(--accent);
}
.system-editor-dragging {
  z-index: 4;
}
.system-editor-dragging::before {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: -3px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
  content: '';
}
.system-editor-dragging .ak-wyg-key {
  outline: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 24%, var(--bg-input));
}
.system-editor-pin-control {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--fg-muted);
  font-size: 12px;
  white-space: nowrap;
}
.system-editor-pin-control select {
  min-width: 48px;
}
.system-editor-add {
  flex: 0 0 auto;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 56%, var(--border));
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  touch-action: manipulation;
  transition:
    transform 80ms ease,
    border-color 80ms ease,
    background 80ms ease,
    box-shadow 80ms ease;
}
.system-editor-add:active {
  transform: translateY(1px) scale(0.97);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 24%, var(--bg-input));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent);
}
.system-editor-add:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (max-width: 600px) {
  .system-editor-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 8px;
  }
  .system-editor-pin-control {
    grid-row: 2;
    grid-column: 1;
    justify-self: start;
  }
  .system-editor-add {
    grid-row: 2;
    grid-column: 2;
  }
  .system-editor-head > .toggle {
    justify-self: end;
  }
}
.system-layout-warning {
  color: var(--warning);
}
.system-layout-at-limit {
  color: var(--fg-muted);
}
.shortcut-check.disabled {
  opacity: 0.55;
}
.system-agent-icon-hint {
  margin-top: 6px;
  line-height: 1.45;
}
.system-editor-pages {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.system-editor-page {
  overflow: hidden;
  border: 0;
  border-radius: 0;
  padding: 5px 7px;
  min-width: 0;
}
.system-editor-page + .system-editor-page {
  border-top: 1px solid var(--border);
}
.ak-actions .shortcut-add:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>

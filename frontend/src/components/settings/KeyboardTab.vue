<template>
  <div>
    <div class="settings-group mobile-input-settings">
      <h3 class="settings-group-title">{{ t('settings.keyboard.mobileInputMode.label') }}</h3>
      <SegmentedControl
        class="mobile-input-mode-control"
        data-setting="mobile-input-mode"
        :model-value="settings.mobile_input_mode ?? ''"
        :options="mobileInputModeOptions"
        :aria-label="t('settings.keyboard.mobileInputMode.label')"
        @update:model-value="onMobileInputModeChange"
      />
    </div>

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
        </div>

        <CollapsibleSection :title="t('keybinding.group.pane')" level="section" default-open>
          <div
            v-for="def in paneDefs"
            :key="def.id"
            class="settings-row kb-shortcut-row"
            :data-kb-id="def.id"
          >
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
                @click.stop="toggleRecord('action')"
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
              @change="
                akEdit.display = ($event.target as HTMLInputElement).checked ? 'icon' : 'text'
              "
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
            <input type="checkbox" v-model="akEdit.auto_enter" /> {{ t('settings.appendEnter') }}
          </label>
          <label v-if="!akIsEnterEdit && akSupportsRepeat" class="shortcut-check ak-repeat-check">
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
                  @pointerdown="
                    systemDragPointerDown({ region: 'upper', index: item.index }, $event)
                  "
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
      <p
        v-else-if="systemStatus.overLimit"
        class="settings-hint system-layout-warning"
        role="status"
      >
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
                  @pointerdown="
                    systemDragPointerDown({ region: 'lower', index: item.index }, $event)
                  "
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
                @click.stop="toggleRecord('system')"
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
            <input type="checkbox" v-model="systemEdit.auto_enter" />
            {{ t('settings.appendEnter') }}
          </label>
          <label v-if="systemSupportsRepeat" class="shortcut-check">
            <input type="checkbox" v-model="systemEdit.repeat" /> {{ t('settings.repeatHold') }}
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

    <CollapsibleSection :title="t('settings.advancedText')" level="group">
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
      <div class="settings-row">
        <label>{{ t('settings.text.imeKeyboardOverlapPx') }}</label>
        <input
          v-model.number="imeKeyboardOverlapPx"
          type="number"
          min="0"
          max="300"
          step="8"
          class="settings-input-number"
          data-setting="ime-keyboard-overlap-px"
        />
      </div>
      <p class="settings-hint">{{ t('settings.text.imeKeyboardOverlapHint') }}</p>
    </CollapsibleSection>

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
import { ref, computed, nextTick, onBeforeUnmount, watch } from 'vue'
import {
  useSettings,
  DEFAULT_ACTION_KEYBOARD,
  DEFAULT_ACTION_BOTTOM,
  cloneWithoutIcons,
  cloneSystemKeyboardWithoutIcons,
  effectiveActionKeyboard,
  ensureBottom,
  resetActionKeyboard,
  restoreActionKeyboardUserDefault,
  saveActionKeyboardUserDefault,
  effectiveSystemKeyboard,
  resetSystemKeyboard,
  restoreSystemKeyboardUserDefault,
  saveSystemKeyboardUserDefault,
} from '../../composables/useSettings'
import CollapsibleSection from './CollapsibleSection.vue'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import type {
  ActionBottomCluster,
  ActionKey,
  ActionKeyboardConfig,
  MobileInputMode,
  SystemKeyboardConfig,
} from '../../composables/useSettings'
import { actionKeyToKeyDef } from '../../utils/actionKeyDef'
import { isAgentIconEnabled } from '../../utils/agentShortcutIcon'
import {
  KEYBOARD_SPECIAL_KEYS,
  keyboardSpecialEntry,
  parseKeyboardSpecial,
  serializeKeyboardSpecial,
  type KeyboardSpecialId,
} from '../../utils/keyboardSpecialKeys'
import {
  MAX_SYSTEM_PINNED,
  SYSTEM_ROW_UNITS,
  UPPER_USER_UNITS,
  canonicalLowerKeys,
  canonicalizeSystemKeyboard,
  packSystemKeys,
  systemKeyboardCandidateAllowed,
  systemKeyboardLayoutStatus,
  systemKeyUnits,
} from '../../utils/systemKeyboardLayout'
import {
  APP_ACTIONS,
  APP_ACTION_IDS,
  SYSTEM_KEYBOARD_ACTIONS,
  SYSTEM_KEYBOARD_ACTION_IDS,
  TOOLBAR_CONTEXT_ACTION_IDS,
} from '../../utils/appActionCatalog'
import { isWindowsClient } from '../../utils/clientPlatform'
import { useDeviceSuperviseReload } from '../../composables/useDeviceSuperviseReload'
import { Keyboard, Pin, RotateCcw } from 'lucide-vue-next'
import SegmentedControl from '../ui/SegmentedControl.vue'
import type { KeyboardGuardMode } from '../../utils/keyboardGuardMode'
import { useOpenApiTest } from '../../composables/useOpenApiTest'
import { useKbRecording } from '../../composables/useKbRecording'
import { useActionKeyboardGesture } from '../../composables/useActionKeyboardGesture'
import { useSystemKeyboardGesture } from '../../composables/useSystemKeyboardGesture'
import { useDeviceKeyboardSettings } from '../../composables/useDeviceKeyboardSettings'
import { applyAfterTerminalComposition } from '../../utils/terminalInput'
import {
  escapeForDisplay,
  unescapeFromDisplay,
  keyEventToSequence,
  keyEventToLabel,
} from '../../composables/useKeySequenceUtils'

const { settings, saveSettings } = useSettings()
const { imeKeyboardOverlapPx } = useDeviceKeyboardSettings()
const { hasOverride, reloadAfterSuperviseTabs, resetOverride } = useDeviceSuperviseReload()
const { t } = useI18n()

const keyboardGuardModeOptions = computed(() => [
  { value: 'off', label: t('settings.keyboard.guardMode.off') },
  { value: 'collapse_only', label: t('settings.keyboard.guardMode.collapseOnly') },
  { value: 'open_only', label: t('settings.keyboard.guardMode.openOnly') },
  { value: 'both', label: t('settings.keyboard.guardMode.both') },
])

const mobileInputModeOptions = computed(() => [
  { value: 'builtin', label: t('settings.keyboard.mobileInputMode.builtin') },
  { value: 'system', label: t('settings.keyboard.mobileInputMode.system') },
])

function onMobileInputModeChange(value: string) {
  applyAfterTerminalComposition(() => {
    settings.mobile_input_mode = value as MobileInputMode
    void saveSettings()
  })
}

function onKeyboardGuardModeChange(value: string) {
  settings.keyboard_guard_mode = value as KeyboardGuardMode
  void saveSettings()
}

function onSystemToolbarModeChange(event: Event) {
  settings.system_toolbar_mode = (event.target as HTMLInputElement).checked
    ? 'persistent_mobile'
    : 'follow_ime'
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

const actionBottom = computed<ActionBottomCluster>(
  () => (akDraft.value ?? effectiveActionKeyboard()).bottom ?? DEFAULT_ACTION_BOTTOM
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
  return cloneWithoutIcons(DEFAULT_ACTION_KEYBOARD)
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

const systemDraft = ref<SystemKeyboardConfig | null>(null)
const {
  itemKey: systemItemKey,
  draggedKey: systemDraggedKey,
  dragPointerDown: systemDragPointerDown,
  resizePointerDown: systemResizePointerDown,
  abort: abortSystemGesture,
} = useSystemKeyboardGesture({ draft: systemDraft, settings })
const systemLayout = computed(() => systemDraft.value ?? effectiveSystemKeyboard())
const systemUpper = computed(() => systemLayout.value.upper)
const systemLower = computed(() => canonicalLowerKeys(systemLayout.value))
const systemStatus = computed(() => systemKeyboardLayoutStatus(systemLayout.value))
type SystemEditorItem = { key: ActionKey; index: number; units: number }
type SystemEditorPage = { items: SystemEditorItem[]; pinnedCopies: SystemEditorItem[]; end: number }

function indexedSystemPages(keys: ActionKey[], capacity: number, offset = 0): SystemEditorPage[] {
  let index = offset
  return packSystemKeys(keys, capacity).map((page) => ({
    items: page.map(({ key, units }) => ({ key, units, index: index++ })),
    pinnedCopies: [],
    end: index,
  }))
}

function pinnedSystemPages(keys: ActionKey[], pinnedCount: number, capacity: number) {
  const pinned: SystemEditorItem[] = keys.slice(0, pinnedCount).map((key, index) => ({
    key,
    index,
    units: systemKeyUnits(key, capacity),
  }))
  const pagerCapacity = Math.max(1, capacity - pinned.reduce((sum, item) => sum + item.units, 0))
  return indexedSystemPages(keys.slice(pinned.length), pagerCapacity, pinned.length).map(
    (page, index) => ({
      ...page,
      items: index === 0 ? [...pinned, ...page.items] : page.items,
      pinnedCopies: index === 0 ? [] : pinned,
    })
  )
}
const systemUpperPages = computed(() =>
  pinnedSystemPages(systemUpper.value, systemStatus.value.upperPinned, UPPER_USER_UNITS)
)
const systemLowerPages = computed(() =>
  pinnedSystemPages(systemLower.value, systemStatus.value.lowerPinned, SYSTEM_ROW_UNITS)
)
const systemLayoutMessage = ref('')
const pinnedOptions = (length: number) =>
  Array.from({ length: Math.min(MAX_SYSTEM_PINNED, length) + 1 }, (_, index) => index)
const systemUpperPinnedOptions = computed(() => pinnedOptions(systemUpper.value.length))
const systemLowerPinnedOptions = computed(() => pinnedOptions(systemLower.value.length))

type SystemEdit = {
  region: 'upper' | 'lower'
  index: number
  label: string
  kind: 'send' | 'special' | 'action'
  action: string
  display: 'icon' | 'text'
  sendRaw: string
  style: string
  repeat: boolean
  auto_enter: boolean
  special?: string
  specialId: KeyboardSpecialId
  keepHeld: boolean
  grow?: number
}

const systemEdit = ref<SystemEdit | null>(null)
const systemSpecialEntry = computed(() => keyboardSpecialEntry(systemEdit.value?.specialId))
const systemSupportsRepeat = computed(
  () => systemEdit.value?.kind !== 'special' || !systemSpecialEntry.value?.modifier
)
function editHasAgentIcon(edit: { kind: 'send' | 'special' | 'action'; label: string }): boolean {
  return edit.kind === 'send' && isAgentIconEnabled({ kind: 'send', label: edit.label })
}
const systemAgentIconAvailable = computed(
  () => !!systemEdit.value && editHasAgentIcon(systemEdit.value)
)
watch(
  () => [systemEdit.value?.kind, systemEdit.value?.label] as const,
  ([kind, label], previous) => {
    if (!systemEdit.value || previous[1] === undefined) return
    const matched = kind === 'send' && editHasAgentIcon(systemEdit.value)
    const previouslyMatched =
      previous[0] === 'send' && isAgentIconEnabled({ kind: previous[0], label: previous[1] ?? '' })
    if (matched && !previouslyMatched) systemEdit.value.display = 'icon'
  }
)
const systemActionOptions = [...APP_ACTIONS, ...SYSTEM_KEYBOARD_ACTIONS]
const systemCanSave = computed(() => {
  if (!systemEdit.value) return false
  if (systemEdit.value.kind === 'special') return !!systemSpecialEntry.value
  return systemEdit.value.kind === 'send'
    ? systemEdit.value.label.trim().length > 0
    : APP_ACTION_IDS.has(systemEdit.value.action) ||
        SYSTEM_KEYBOARD_ACTION_IDS.has(systemEdit.value.action)
})

function systemPreviewDef(key: ActionKey) {
  return actionKeyToKeyDef(key)
}

function systemSlotStyle(units: number) {
  return { gridColumn: `span ${units}` }
}

function beginSystemEdit(region: 'upper' | 'lower', index: number) {
  const key = region === 'upper' ? systemUpper.value[index] : systemLower.value[index]
  if (!key) return
  const parsedSpecial = parseKeyboardSpecial(key.special)
  systemEdit.value = {
    region,
    index,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : parsedSpecial ? 'special' : 'send',
    action: key.action ?? '',
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style ?? '',
    repeat: key.repeat ?? false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    specialId: parsedSpecial?.id ?? 'ctrl',
    keepHeld: parsedSpecial?.behavior === 'lock',
    grow: key.grow,
  }
}

function addSystemKey(region: 'upper' | 'lower') {
  const index = region === 'upper' ? systemUpper.value.length : systemLower.value.length
  systemEdit.value = {
    region,
    index,
    label: '',
    kind: 'send',
    action: '',
    display: 'icon',
    sendRaw: '',
    style: '',
    repeat: false,
    auto_enter: true,
    specialId: 'ctrl',
    keepHeld: false,
  }
}

function onSystemSpecialChange() {
  if (!systemEdit.value) return
  const entry = keyboardSpecialEntry(systemEdit.value.specialId)
  if (!entry) return
  systemEdit.value.label = entry.label
  if (!entry.modifier) systemEdit.value.keepHeld = false
}

function onSystemKindChange() {
  if (systemEdit.value?.kind === 'special') onSystemSpecialChange()
  else stopRecord()
}

function commitSystemCandidate(mutator: (candidate: SystemKeyboardConfig) => void): boolean {
  const source = effectiveSystemKeyboard()
  const candidate = cloneSystemKeyboardWithoutIcons(source)
  mutator(candidate)
  const canonical = canonicalizeSystemKeyboard(candidate)
  if (!systemKeyboardCandidateAllowed(source, canonical)) {
    systemLayoutMessage.value = t('settings.systemKeyboardPageLimit')
    return false
  }
  settings.system_keyboard = canonical
  systemLayoutMessage.value = ''
  return true
}

function saveSystemKey() {
  const edit = systemEdit.value
  if (!edit || !systemCanSave.value) return
  const key: ActionKey =
    edit.kind === 'action'
      ? {
          label: edit.label,
          kind: 'action',
          action: edit.action,
          display: edit.display,
          style: edit.style || undefined,
          repeat: edit.repeat || undefined,
          ...(edit.action === 'pasteTerminal' ? { auto_enter: edit.auto_enter } : {}),
          grow: edit.grow,
        }
      : edit.kind === 'special'
        ? {
            label: edit.label || keyboardSpecialEntry(edit.specialId)?.label || '',
            kind: 'send',
            special: serializeKeyboardSpecial(edit.specialId, edit.keepHeld ? 'lock' : 'once'),
            display: edit.display,
            style: edit.style || undefined,
            repeat: systemSpecialEntry.value?.modifier ? undefined : edit.repeat || undefined,
            grow: edit.grow,
          }
        : {
            label: edit.label,
            kind: 'send',
            send: unescapeFromDisplay(edit.sendRaw),
            display: editHasAgentIcon(edit) ? edit.display : undefined,
            style: edit.style || undefined,
            repeat: edit.repeat || undefined,
            auto_enter: edit.auto_enter,
            special: parseKeyboardSpecial(edit.special) ? undefined : edit.special,
            grow: edit.grow,
          }
  const saved = commitSystemCandidate((config) => {
    const row = edit.region === 'upper' ? config.upper : config.pages[0]
    if (edit.index < row.length) row[edit.index] = key
    else row.push(key)
  })
  if (saved) systemEdit.value = null
}

function onSystemAutoWidthChange(event: Event) {
  if (!systemEdit.value) return
  const adaptive = (event.target as HTMLInputElement).checked
  if (adaptive) {
    systemEdit.value.grow = undefined
    return
  }
  const edit = systemEdit.value
  const capacity = edit.region === 'upper' ? UPPER_USER_UNITS : SYSTEM_ROW_UNITS
  systemEdit.value.grow = systemKeyUnits(
    {
      label: edit.label,
      kind: edit.kind === 'action' ? 'action' : 'send',
      action: edit.action || undefined,
      display: edit.display,
    },
    capacity
  )
}

function removeSystemKey(region: 'upper' | 'lower', index: number) {
  commitSystemCandidate((config) => {
    const row = region === 'upper' ? config.upper : config.pages[0]
    row.splice(index, 1)
    const field = region === 'upper' ? 'upper_pinned' : 'lower_pinned'
    config[field] = Math.min(config[field] ?? 0, row.length)
  })
}

function onSystemLowerEnabledChange(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  commitSystemCandidate((config) => {
    config.lower_enabled = enabled
  })
}

function onPinnedChange(region: 'upper' | 'lower', event: Event) {
  const count = Number((event.target as HTMLSelectElement).value)
  commitSystemCandidate((config) => {
    config[region === 'upper' ? 'upper_pinned' : 'lower_pinned'] = count
  })
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
  if (toolbarQuickKeys.value.length >= 5) return
  akEdit.value = {
    scope: 'toolbar',
    ri: -1,
    ki: toolbarQuickKeys.value.length,
    label: '',
    kind: 'send',
    action: '',
    display: 'icon',
    sendRaw: '',
    style: '',
    repeat: false,
    auto_enter: true,
    specialId: 'ctrl',
    keepHeld: false,
  }
}

function editToolbarQuickKey(ki: number) {
  ensureToolbarQuickKeys()
  const key = toolbarQuickKeys.value[ki]
  if (!key) return
  const parsedSpecial = parseKeyboardSpecial(key.special)
  akEdit.value = {
    scope: 'toolbar',
    ri: -1,
    ki,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : parsedSpecial ? 'special' : 'send',
    action: key.action || '',
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    specialId: parsedSpecial?.id ?? 'ctrl',
    keepHeld: parsedSpecial?.behavior === 'lock',
    grow: key.grow,
    icon: key.icon,
  }
}

function removeToolbarQuickKey(ki: number) {
  ensureToolbarQuickKeys()
  toolbarQuickKeys.value.splice(ki, 1)
}

type AkEditScope = 'action' | 'bottom' | 'bottom-enter' | 'toolbar'

const akEdit = ref<{
  scope: AkEditScope
  ri: number
  ki: number
  label: string
  kind: 'send' | 'special' | 'action'
  action: string
  display: 'icon' | 'text'
  sendRaw: string
  style: string
  repeat: boolean
  auto_enter: boolean
  special?: string
  specialId: KeyboardSpecialId
  keepHeld: boolean
  grow?: number
  icon?: object
} | null>(null)
const recordingTarget = ref<'action' | 'system' | null>(null)
const akRecording = computed(() => recordingTarget.value === 'action')
const systemRecording = computed(() => recordingTarget.value === 'system')
const recordFocusSinkRef = ref<HTMLElement | null>(null)
watch(akEdit, (edit) => {
  if (!edit && recordingTarget.value === 'action') stopRecord()
})
watch(systemEdit, (edit) => {
  if (!edit && recordingTarget.value === 'system') stopRecord()
})
const akIsEnterEdit = computed(() => akEdit.value?.scope === 'bottom-enter')
const akAgentIconAvailable = computed(() => !!akEdit.value && editHasAgentIcon(akEdit.value))
const akSpecialEntry = computed(() => keyboardSpecialEntry(akEdit.value?.specialId))
const akSupportsRepeat = computed(
  () => akEdit.value?.kind !== 'special' || !akSpecialEntry.value?.modifier
)
watch(
  () => [akEdit.value?.kind, akEdit.value?.label] as const,
  ([kind], previous) => {
    if (!akEdit.value || previous[1] === undefined) return
    const matched = kind === 'send' && editHasAgentIcon(akEdit.value)
    const previouslyMatched =
      previous[0] === 'send' && isAgentIconEnabled({ kind: previous[0], label: previous[1] ?? '' })
    if (matched && !previouslyMatched) akEdit.value.display = 'icon'
  }
)
const akSupportsAutoEnter = computed(
  () =>
    !!akEdit.value &&
    !akIsEnterEdit.value &&
    (akEdit.value.kind === 'send' ||
      (akEdit.value.kind === 'action' && akEdit.value.action === 'pasteTerminal'))
)
const akActionOptions = computed(() =>
  akEdit.value?.scope === 'toolbar'
    ? APP_ACTIONS
    : APP_ACTIONS.filter((action) => !TOOLBAR_CONTEXT_ACTION_IDS.has(action.id))
)

const akCanSave = computed(() => {
  if (!akEdit.value) return false
  if (akEdit.value.kind === 'action') {
    return APP_ACTION_IDS.has(akEdit.value.action)
  }
  if (akEdit.value.kind === 'special') return !!akSpecialEntry.value
  if (akEdit.value.scope !== 'toolbar') return true
  return (
    akEdit.value.label.trim().length > 0 && unescapeFromDisplay(akEdit.value.sendRaw).length > 0
  )
})

function editActionKey(ri: number, ki: number) {
  const key = actionRows.value[ri][ki]
  const parsedSpecial = parseKeyboardSpecial(key.special)
  akEdit.value = {
    scope: 'action',
    ri,
    ki,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : parsedSpecial ? 'special' : 'send',
    action: key.action || '',
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    specialId: parsedSpecial?.id ?? 'ctrl',
    keepHeld: parsedSpecial?.behavior === 'lock',
    grow: key.grow,
    icon: key.icon,
  }
}

function editBottomKey(ri: number, ki: number) {
  const key = actionBottom.value.rows[ri][ki]
  if (!key) return
  const parsedSpecial = parseKeyboardSpecial(key.special)
  akEdit.value = {
    scope: 'bottom',
    ri,
    ki,
    label: key.label,
    kind: key.kind === 'action' ? 'action' : parsedSpecial ? 'special' : 'send',
    action: key.action || '',
    display: key.display ?? 'icon',
    sendRaw: escapeForDisplay(key.send),
    style: key.style || '',
    repeat: key.repeat || false,
    auto_enter: resolveAutoEnterForEdit(key),
    special: key.special,
    specialId: parsedSpecial?.id ?? 'ctrl',
    keepHeld: parsedSpecial?.behavior === 'lock',
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
    specialId: 'ctrl',
    keepHeld: false,
  }
}

function onAkSpecialChange() {
  if (!akEdit.value) return
  const entry = keyboardSpecialEntry(akEdit.value.specialId)
  if (!entry) return
  akEdit.value.label = entry.label
  if (!entry.modifier) akEdit.value.keepHeld = false
}

function onAkKindChange() {
  if (akEdit.value?.kind === 'special') onAkSpecialChange()
  else stopRecord()
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
  const next: ActionKey =
    edit.kind === 'action'
      ? {
          label,
          kind: 'action',
          action: edit.action,
          display: edit.display,
          style: edit.style || undefined,
          repeat: edit.repeat || undefined,
          ...(edit.action === 'pasteTerminal' ? { auto_enter: edit.auto_enter } : {}),
          grow: edit.grow,
        }
      : edit.kind === 'special'
        ? {
            label: label || keyboardSpecialEntry(edit.specialId)?.label || '',
            kind: 'send',
            special: serializeKeyboardSpecial(edit.specialId, edit.keepHeld ? 'lock' : 'once'),
            display: edit.display,
            style: edit.style || undefined,
            repeat: akSpecialEntry.value?.modifier ? undefined : edit.repeat || undefined,
            grow: edit.grow,
          }
        : {
            label,
            kind: 'send',
            send: unescapeFromDisplay(edit.sendRaw),
            display: editHasAgentIcon(edit) ? edit.display : undefined,
            style: edit.style || undefined,
            repeat: edit.repeat || undefined,
            auto_enter: edit.auto_enter,
            special: parseKeyboardSpecial(edit.special) ? undefined : edit.special,
            grow: edit.grow,
          }
  if (edit.scope === 'toolbar') {
    ensureToolbarQuickKeys()
    if (ki < toolbarQuickKeys.value.length) {
      toolbarQuickKeys.value[ki] = next
    } else if (toolbarQuickKeys.value.length < 5) {
      toolbarQuickKeys.value.push(next)
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

function toggleRecord(target: 'action' | 'system') {
  if (recordingTarget.value === target) {
    stopRecord()
  } else {
    stopRecord()
    startRecord(target)
  }
}

function recordingEventIgnorable(e: KeyboardEvent): boolean {
  if (e.repeat) return true
  const k = e.key
  return k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta'
}

function startRecord(target: 'action' | 'system') {
  recordingTarget.value = target
  recordHandler = (e: KeyboardEvent) => {
    if (recordingEventIgnorable(e)) return
    const edit = target === 'action' ? akEdit.value : systemEdit.value
    if (!edit) return
    const seq = keyEventToSequence(e)
    if (!seq) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    edit.sendRaw = escapeForDisplay(seq)
    if (edit.label === 'new' || edit.label === '') {
      edit.label = keyEventToLabel(e)
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
  recordingTarget.value = null
  if (recordHandler) {
    window.removeEventListener('keydown', recordHandler, true)
    recordHandler = null
  }
  recordFocusSinkRef.value?.blur()
}

onBeforeUnmount(() => {
  akAbortGesture()
  abortSystemGesture()
  stopRecord()
  stopKbRecord()
})
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
.ak-agent-icon-hint,
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
.mobile-input-settings {
  border: 1px solid color-mix(in srgb, var(--accent), var(--border) 68%);
  border-radius: 8px;
  padding: 14px;
  background: color-mix(in srgb, var(--bg-surface), var(--accent) 4%);
}
.mobile-input-mode-control {
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
.kb-icon > svg {
  display: block;
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

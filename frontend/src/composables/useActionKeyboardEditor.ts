import { computed, ref, watch } from 'vue'
import {
  cloneWithoutIcons,
  DEFAULT_ACTION_BOTTOM,
  DEFAULT_ACTION_KEYBOARD,
  effectiveActionKeyboard,
  ensureBottom,
  type ActionBottomCluster,
  type ActionKey,
  type ActionKeyboardConfig,
  type SettingsData,
} from './useSettings'
import { useActionKeyboardGesture } from './useActionKeyboardGesture'
import { useKeyEditRecording } from './useKeyEditRecording'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import {
  keyboardSpecialEntry,
  parseKeyboardSpecial,
  serializeKeyboardSpecial,
  type KeyboardSpecialId,
} from '../utils/keyboardSpecialKeys'
import { APP_ACTIONS, APP_ACTION_IDS, TOOLBAR_CONTEXT_ACTION_IDS } from '../utils/appActionCatalog'
import { escapeForDisplay, unescapeFromDisplay } from './useKeySequenceUtils'
import {
  createAutoIconWatch,
  editHasAgentIcon,
  resolveAutoEnterForEdit,
} from '../utils/keyboardEditUtils'

export type AkEditScope = 'action' | 'bottom' | 'bottom-enter' | 'toolbar'

export interface AkEditState {
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
}

export function useActionKeyboardEditor(settings: SettingsData) {
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

  const akEdit = ref<AkEditState | null>(null)

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

  const akRecordingRec = useKeyEditRecording(() => akEdit.value)
  const { toggleRecord: toggleAkRecord } = akRecordingRec
  const recordFocusSinkRef = akRecordingRec.recordFocusSinkRef
  const akRecording = computed(() => akRecordingRec.isRecording('action'))

  watch(akEdit, (edit) => {
    if (!edit) akRecordingRec.stopRecord()
  })

  const akIsEnterEdit = computed(() => akEdit.value?.scope === 'bottom-enter')
  const akAgentIconAvailable = computed(() => !!akEdit.value && editHasAgentIcon(akEdit.value))
  const akSpecialEntry = computed(() => keyboardSpecialEntry(akEdit.value?.specialId))
  const akSupportsRepeat = computed(
    () => akEdit.value?.kind !== 'special' || !akSpecialEntry.value?.modifier
  )
  createAutoIconWatch(() => akEdit.value)
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

  function removeToolbarQuickKey(ki: number) {
    ensureToolbarQuickKeys()
    toolbarQuickKeys.value.splice(ki, 1)
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
    else akRecordingRec.stopRecord()
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

  return {
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
  }
}

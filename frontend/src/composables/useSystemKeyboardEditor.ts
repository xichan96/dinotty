import { computed, ref, watch } from 'vue'
import {
  cloneSystemKeyboardWithoutIcons,
  effectiveSystemKeyboard,
  type ActionKey,
  type SettingsData,
  type SystemKeyboardConfig,
} from './useSettings'
import { useSystemKeyboardGesture } from './useSystemKeyboardGesture'
import { useKeyEditRecording } from './useKeyEditRecording'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import {
  keyboardSpecialEntry,
  parseKeyboardSpecial,
  serializeKeyboardSpecial,
  type KeyboardSpecialId,
} from '../utils/keyboardSpecialKeys'
import {
  APP_ACTIONS,
  APP_ACTION_IDS,
  SYSTEM_KEYBOARD_ACTIONS,
  SYSTEM_KEYBOARD_ACTION_IDS,
} from '../utils/appActionCatalog'
import { escapeForDisplay, unescapeFromDisplay } from './useKeySequenceUtils'
import {
  canonicalLowerKeys,
  canonicalizeSystemKeyboard,
  MAX_SYSTEM_PINNED,
  packSystemKeys,
  systemKeyboardCandidateAllowed,
  systemKeyboardLayoutStatus,
  systemKeyUnits,
  SYSTEM_ROW_UNITS,
  UPPER_USER_UNITS,
} from '../utils/systemKeyboardLayout'
import {
  createAutoIconWatch,
  editHasAgentIcon,
  resolveAutoEnterForEdit,
} from '../utils/keyboardEditUtils'

type TFunc = (key: string, params?: Record<string, string | number>) => string

export interface SystemEditState {
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

export function useSystemKeyboardEditor(settings: SettingsData, t: TFunc) {
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
  type SystemEditorPage = {
    items: SystemEditorItem[]
    pinnedCopies: SystemEditorItem[]
    end: number
  }

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

  const systemEdit = ref<SystemEditState | null>(null)
  const systemSpecialEntry = computed(() => keyboardSpecialEntry(systemEdit.value?.specialId))
  const systemSupportsRepeat = computed(
    () => systemEdit.value?.kind !== 'special' || !systemSpecialEntry.value?.modifier
  )
  const systemAgentIconAvailable = computed(
    () => !!systemEdit.value && editHasAgentIcon(systemEdit.value)
  )
  createAutoIconWatch(() => systemEdit.value)
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

  const systemRecordingRec = useKeyEditRecording(() => systemEdit.value)
  const systemRecording = computed(() => systemRecordingRec.isRecording('system'))
  const recordFocusSinkRef = systemRecordingRec.recordFocusSinkRef
  const { toggleRecord: toggleSystemRecord } = systemRecordingRec
  watch(systemEdit, (edit) => {
    if (!edit) systemRecordingRec.stopRecord()
  })

  function onSystemKindChange() {
    if (systemEdit.value?.kind === 'special') onSystemSpecialChange()
    else systemRecordingRec.stopRecord()
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

  return {
    systemItemKey,
    systemDraggedKey,
    systemDragPointerDown,
    systemResizePointerDown,
    abortSystemGesture,
    systemLayout,
    systemUpper,
    systemLower,
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
  }
}

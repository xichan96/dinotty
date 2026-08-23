import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue'
import { escapeForDisplay, keyEventToLabel, keyEventToSequence } from './useKeySequenceUtils'

/**
 * "录制按键" 交互：把用户按下的物理键序列写进编辑中的快捷键 sendRaw。
 * 由 action keyboard 编辑器与 system keyboard 编辑器共用（原 KeyboardTab.vue 内联实现）。
 * getEdit 返回当前正在编辑的草稿（无草稿返回 null），录制命中时直接改写其 sendRaw/label。
 */
export type KeyEditTarget = 'action' | 'system'

export interface KeyEditRecording {
  recordingTarget: Ref<KeyEditTarget | null>
  recordFocusSinkRef: Ref<HTMLElement | null>
  isRecording: (target: KeyEditTarget) => boolean
  toggleRecord: (target: KeyEditTarget) => void
  stopRecord: () => void
}

export function useKeyEditRecording(
  getEdit: () => { sendRaw: string; label: string } | null
): KeyEditRecording {
  const recordingTarget = ref<KeyEditTarget | null>(null)
  const recordFocusSinkRef = ref<HTMLElement | null>(null)
  let recordHandler: ((e: KeyboardEvent) => void) | null = null

  function isRecording(target: KeyEditTarget): boolean {
    return recordingTarget.value === target
  }

  function recordingEventIgnorable(e: KeyboardEvent): boolean {
    if (e.repeat) return true
    const k = e.key
    return k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta'
  }

  function startRecord(target: KeyEditTarget) {
    recordingTarget.value = target
    recordHandler = (e: KeyboardEvent) => {
      if (recordingEventIgnorable(e)) return
      const edit = getEdit()
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

  function toggleRecord(target: KeyEditTarget) {
    if (recordingTarget.value === target) {
      stopRecord()
    } else {
      stopRecord()
      startRecord(target)
    }
  }

  onBeforeUnmount(() => stopRecord())

  return { recordingTarget, recordFocusSinkRef, isRecording, toggleRecord, stopRecord }
}

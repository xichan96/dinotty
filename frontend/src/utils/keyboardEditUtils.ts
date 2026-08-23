import { watch, type WatchHandle } from 'vue'
import type { ActionKey } from '../composables/useSettings'
import { isAgentIconEnabled } from './agentShortcutIcon'

/** Resolve whether an action key should append Enter, based on its send payload. */
export function resolveAutoEnterForEdit(key: ActionKey): boolean {
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

/** Whether an edit draft should show the agent display-icon toggle. */
export function editHasAgentIcon(edit: {
  kind: 'send' | 'special' | 'action'
  label: string
}): boolean {
  return edit.kind === 'send' && isAgentIconEnabled({ kind: 'send', label: edit.label })
}

/** Label rendered inside a WYSIWYG key slot. */
export function previewLabel(key: ActionKey): string {
  if (key.special === 'space') return ' '
  return key.label || ' '
}

/** Clamp a quick-send threshold to [0, 5000], default 63 for non-finite input. */
export function normalizeQuickSendThreshold(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 63
  return Math.min(5000, Math.max(0, Math.trunc(numeric)))
}

export type KeyEditLike = {
  kind: 'send' | 'special' | 'action'
  label: string
  display: 'icon' | 'text'
}

/**
 * Auto-switch an edit draft to `display: 'icon'` when its label becomes an
 * agent shortcut. Shared by the action-keyboard and system-keyboard edit modals.
 */
export function createAutoIconWatch(getEdit: () => KeyEditLike | null): WatchHandle {
  return watch(
    () => {
      const edit = getEdit()
      return [edit?.kind, edit?.label] as const
    },
    ([kind], previous) => {
      const edit = getEdit()
      if (!edit || previous[1] === undefined) return
      const matched = kind === 'send' && editHasAgentIcon(edit)
      const previouslyMatched =
        previous[0] === 'send' &&
        isAgentIconEnabled({ kind: previous[0], label: previous[1] ?? '' })
      if (matched && !previouslyMatched) edit.display = 'icon'
    }
  )
}

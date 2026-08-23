import { terminalKeyBindingDefs, useKeybindings } from '../composables/useKeybindings'
import { trailingPathDeleteLen } from './shell'
import { terminalKeybindingMatches } from './terminalInputCore'

// Pure helpers live in terminalInputCore.ts (bundle-safe, no host composable
// imports); this module re-exports them so the public surface is unchanged.
export * from './terminalInputCore'

export function handleTerminalShortcutKeydown(
  e: KeyboardEvent,
  sendData: (data: string) => void,
  virtualMeta = false,
  getLineBeforeCursor?: () => string | null
): boolean {
  const key = e.key.toLowerCase()
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (key === 'c' || key === 'v'))
    return false

  const { getBinding } = useKeybindings()
  for (const def of terminalKeyBindingDefs) {
    const sequence = def.sequence
    if (!sequence) continue
    if (terminalKeybindingMatches(e, getBinding(def.id), virtualMeta)) {
      e.preventDefault()
      e.stopPropagation()
      if (def.id === 'term.deleteToLineStart' && getLineBeforeCursor) {
        const line = getLineBeforeCursor()
        if (line !== null) {
          const len = trailingPathDeleteLen(line)
          if (len > 0) {
            sendData('\x7f'.repeat(len))
            return true
          }
        }
      }
      sendData(sequence)
      return true
    }
  }
  return false
}

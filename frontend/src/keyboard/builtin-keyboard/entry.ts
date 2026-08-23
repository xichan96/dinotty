// Builtin mobile keyboard plugin (keyboard-plugin-design.md Phase 1b).
// The component tree is the host's MobileKeyboard (single-sourced via @/
// specifiers); the lib build aliases host modules to the host-bridge shims.
import MobileKeyboard from '@/components/keyboard/MobileKeyboard.vue'
import type { KeyboardContribution } from '../../../../plugin-api/index'

export function activate(): { keyboard: KeyboardContribution } {
  return {
    keyboard: {
      id: 'builtin-keyboard',
      component: MobileKeyboard,
      desiredHeight: 'auto',
      defaultEnabled: true,
    },
  }
}

export { MobileKeyboard }

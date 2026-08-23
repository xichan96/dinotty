import { ref, type Ref } from 'vue'
import { vi } from 'vitest'
import { createKeyboardContext } from '../../keyboard/createKeyboardContext'
import type { KeyboardHostDeps } from '../../keyboard/createKeyboardContext'

export interface MakeMobileKeyboardCtxOptions {
  visible?: boolean | Ref<boolean>
  activePaneId?: string | null | Ref<string | null>
  sendActive?: KeyboardHostDeps['sendActive']
  sendBroadcast?: KeyboardHostDeps['sendBroadcast']
  sendToPane?: KeyboardHostDeps['sendToPane']
  nativeImeOpen?: boolean | Ref<boolean>
  setNativeImeOpen?: KeyboardHostDeps['setNativeImeOpen']
  onHostEvent?: ReturnType<typeof vi.fn>
}

export interface MobileKeyboardCtxHarness {
  ctx: ReturnType<typeof createKeyboardContext>
  visible: Ref<boolean>
  activePaneId: Ref<string | null>
  sendActive: KeyboardHostDeps['sendActive']
  onHostEvent: ReturnType<typeof vi.fn>
}

/**
 * Build a KeyboardContext for mounting the builtin MobileKeyboard directly
 * (host-free unit path). Mirrors App.vue: upload-status is forwarded to the
 * legacy window event so existing subscribers observe it.
 */
export function makeMobileKeyboardCtx(
  options: MakeMobileKeyboardCtxOptions = {}
): MobileKeyboardCtxHarness {
  const visible =
    typeof options.visible === 'boolean' ? ref(options.visible) : (options.visible ?? ref(false))
  const activePaneId =
    typeof options.activePaneId === 'string' || options.activePaneId === null
      ? ref<string | null>(options.activePaneId)
      : (options.activePaneId ?? ref<string | null>('p1'))
  const onHostEvent =
    options.onHostEvent ??
    vi.fn((event: string, data: unknown) => {
      if (event === 'upload-status') {
        window.dispatchEvent(new CustomEvent('dinotty-upload-status', { detail: data }))
      }
    })
  const sendActive = options.sendActive ?? (async () => {})
  const ctx = createKeyboardContext({
    visible,
    activePaneId,
    sendActive,
    sendBroadcast: options.sendBroadcast ?? (async () => {}),
    sendToPane: options.sendToPane ?? (async () => {}),
    nativeImeOpen:
      typeof options.nativeImeOpen === 'boolean'
        ? ref(options.nativeImeOpen)
        : (options.nativeImeOpen ?? ref(false)),
    setNativeImeOpen: options.setNativeImeOpen ?? vi.fn(),
    onHostEvent,
  })
  return { ctx, visible, activePaneId, sendActive, onHostEvent }
}

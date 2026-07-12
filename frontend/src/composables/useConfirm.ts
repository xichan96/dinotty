import { reactive } from 'vue'

type ConfirmOptions = {
  title?: string
  confirmText?: string
  cancelText?: string
}

export const confirmState = reactive<{
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  resolve: ((ok: boolean) => void) | null
}>({
  visible: false,
  title: '',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  resolve: null,
})

function settle(ok: boolean) {
  const resolve = confirmState.resolve
  confirmState.visible = false
  confirmState.resolve = null
  resolve?.(ok)
}

export function uiConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (confirmState.resolve) settle(false)

  confirmState.title = opts.title ?? ''
  confirmState.message = message
  confirmState.confirmText = opts.confirmText ?? 'OK'
  confirmState.cancelText = opts.cancelText ?? 'Cancel'
  confirmState.visible = true

  return new Promise<boolean>((resolve) => {
    confirmState.resolve = resolve
  })
}

export function confirmResolve() {
  settle(true)
}

export function confirmCancel() {
  settle(false)
}

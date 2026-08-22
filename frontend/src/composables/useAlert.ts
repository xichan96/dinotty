import { reactive } from 'vue'

type AlertOptions = {
  title?: string
  confirmText?: string
}

export const alertState = reactive<{
  visible: boolean
  title: string
  message: string
  confirmText: string
  resolve: (() => void) | null
}>({
  visible: false,
  title: '',
  message: '',
  confirmText: 'OK',
  resolve: null,
})

function settle() {
  const resolve = alertState.resolve
  alertState.visible = false
  alertState.resolve = null
  resolve?.()
}

export function uiAlert(message: string, opts: AlertOptions = {}): Promise<void> {
  if (alertState.resolve) settle()

  alertState.title = opts.title ?? ''
  alertState.message = message
  alertState.confirmText = opts.confirmText ?? 'OK'
  alertState.visible = true

  return new Promise<void>((resolve) => {
    alertState.resolve = resolve
  })
}

export function alertResolve() {
  settle()
}

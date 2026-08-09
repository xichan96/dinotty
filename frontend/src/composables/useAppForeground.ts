import { ref, type Ref } from 'vue'
import { isTauri } from './useTransport'

export const isAppForeground: Ref<boolean> = ref(false)

let forcedValue: boolean | null = null
const foregroundGainSubscribers = new Set<() => void>()

function setForeground(value: boolean) {
  const nextValue = forcedValue ?? value
  const gainedForeground = !isAppForeground.value && nextValue
  isAppForeground.value = nextValue
  if (gainedForeground) {
    for (const subscriber of foregroundGainSubscribers) subscriber()
  }
}

function readWebForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function refreshWebForeground() {
  setForeground(readWebForeground())
}

async function initializeTauriForeground() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    let focusEventApplied = false
    await appWindow.onFocusChanged(({ payload }) => {
      focusEventApplied = true
      setForeground(payload)
    })
    const initiallyFocused = await appWindow.isFocused()
    if (!focusEventApplied) setForeground(initiallyFocused || readWebForeground())
  } catch {
    refreshWebForeground()
  }
}

// DOM focus is available before Tauri's async native focus query settles.
// Keep it as a fallback so startup notifications are not lost in that gap.
refreshWebForeground()
document.addEventListener('visibilitychange', refreshWebForeground)
window.addEventListener('focus', refreshWebForeground)
window.addEventListener('blur', refreshWebForeground)

if (isTauri()) void initializeTauriForeground()

export function getIsAppForeground(): boolean {
  return isAppForeground.value
}

export function onAppForegroundGain(callback: () => void): () => void {
  foregroundGainSubscribers.add(callback)
  return () => foregroundGainSubscribers.delete(callback)
}

export function __setAppForegroundForTest(value: boolean | null) {
  forcedValue = value
  if (value !== null) {
    setForeground(value)
  } else if (!isTauri()) {
    refreshWebForeground()
  }
}

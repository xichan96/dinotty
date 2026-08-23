import { computed, onBeforeUnmount, watch, type Ref } from 'vue'

export interface KeyboardOverlapGate {
  kbVisible: boolean
  textInputFocused: boolean
  layoutEligible: boolean
  hasVerticalPreview: boolean
}

export interface KeyboardOverlapInputs {
  settingPx: Ref<number>
  kbVisible: Ref<boolean>
  textInputFocused: Ref<boolean>
  layoutEligible: Ref<boolean>
  hasVerticalPreview: Ref<boolean>
}

export function computeOverlapPx(settingPx: number, gate: KeyboardOverlapGate): number {
  const overlapActive =
    gate.kbVisible && gate.textInputFocused && gate.layoutEligible && !gate.hasVerticalPreview

  return overlapActive ? settingPx : 0
}

export function useKeyboardOverlap(inputs: KeyboardOverlapInputs) {
  const overlapActive = computed(
    () =>
      inputs.kbVisible.value &&
      inputs.textInputFocused.value &&
      inputs.layoutEligible.value &&
      !inputs.hasVerticalPreview.value
  )
  const overlapPx = computed(() =>
    computeOverlapPx(inputs.settingPx.value, {
      kbVisible: inputs.kbVisible.value,
      textInputFocused: inputs.textInputFocused.value,
      layoutEligible: inputs.layoutEligible.value,
      hasVerticalPreview: inputs.hasVerticalPreview.value,
    })
  )

  let lastWritten: number | undefined
  function writeOverlap(value: number) {
    if (value === lastWritten) return
    lastWritten = value
    document.documentElement.style.setProperty('--kb-overlap', `${value}px`)
  }

  const stop = watch(overlapPx, writeOverlap, { immediate: true, flush: 'sync' })

  onBeforeUnmount(() => {
    stop()
    writeOverlap(0)
  })

  return { overlapActive, overlapPx }
}

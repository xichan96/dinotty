import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface KeyboardBandDeps {
  /** Whether the keyboard is currently shown (the ctx.visible contract). */
  visible: Ref<boolean>
  /** Active provider's contribution desiredHeight: number | 'auto' | undefined. */
  desiredHeight: Ref<number | 'auto' | undefined>
  /** Template ref of the rendered keyboard provider component (needs $el). */
  hostRef: Ref<{ $el?: Element | null } | null>
}

/**
 * Host-owned keyboard reservation band (keyboard-plugin-design.md §三 D / Phase 2).
 *
 * Reads the active provider's `desiredHeight`:
 *  - a fixed number reserves exactly that height while the keyboard is visible;
 *  - 'auto' measures the rendered component root via ResizeObserver;
 *  - undefined means the provider self-reports through ctx.setDesiredHeight and
 *    the host leaves the band alone.
 *
 * The reserved height is written to the shared `--mkb-height` var — the same
 * var ctx.setDesiredHeight writes — so the terminal shrinks. Gated on visibility:
 * the band releases to 0 whenever the keyboard is hidden or unmounts.
 */
export function useKeyboardBand(deps: KeyboardBandDeps) {
  const reserved = ref(0)
  let observer: ResizeObserver | null = null

  function writeVar() {
    const h = deps.visible.value ? reserved.value : 0
    document.documentElement.style.setProperty('--mkb-height', `${h}px`)
  }

  function rootEl(): HTMLElement | null {
    const instance = deps.hostRef.value as { $el?: Element | null } | null
    if (!instance?.$el || !(instance.$el instanceof Element)) return null
    return instance.$el as HTMLElement
  }

  function sync() {
    observer?.disconnect()
    observer = null
    const h = deps.desiredHeight.value
    if (h === 'auto') {
      const el = rootEl()
      if (!el) {
        // Keyboard not rendered: release the band.
        reserved.value = 0
        writeVar()
        return
      }
      observer = new ResizeObserver(() => {
        reserved.value = el.getBoundingClientRect().height
        writeVar()
      })
      observer.observe(el)
      reserved.value = el.getBoundingClientRect().height
      writeVar()
      return
    }
    if (typeof h === 'number') {
      reserved.value = h
      writeVar()
      return
    }
    // No host-owned band: the provider self-reports through setDesiredHeight.
    reserved.value = 0
  }

  watch(deps.visible, (visible) => {
    // Re-measure synchronously on reveal so a stale hidden-size (0) does not
    // flash before the ResizeObserver fires with the rendered height.
    if (visible && observer) {
      const el = rootEl()
      if (el) reserved.value = el.getBoundingClientRect().height
    }
    writeVar()
  })

  watch(deps.desiredHeight, sync)
  watch(deps.hostRef, () => {
    void nextTick().then(sync)
  })

  onBeforeUnmount(() => observer?.disconnect())

  return { reserved, sync }
}

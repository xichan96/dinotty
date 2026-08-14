import { computed, ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { Tab } from '../types/pane'
import { getAllLeaves } from '../types/pane'
import { isIPhoneClient } from '../utils/clientPlatform'

const MAX_PAN_RESETS = 3

export interface ViewportResizeOptions {
  kbVisible: Ref<boolean>
  activePaneId: Ref<string | null>
  tabs: Ref<Tab[]>
  termRefs: Record<string, { fit: () => void }>
  terminalImeFocused?: Ref<boolean>
  builtinTextareaFocused: Ref<boolean>
  onSystemKeyboardClose?: () => void
}

export interface ViewportResizeState {
  isLandscape: Ref<boolean>
  imeOccluding: Ref<boolean>
  systemKeyboardOpen: Ref<boolean>
  systemKeyboardHeight: Ref<number>
  terminalImeFocused: Ref<boolean>
  toolbarBottom: Ref<number>
  onViewportResize: () => void
  onOrientationChange: () => void
  reset: () => void
  revalidate: () => void
  dispose: () => void
}

export function useViewportResize(opts: ViewportResizeOptions): ViewportResizeState {
  const { kbVisible, activePaneId, tabs, termRefs } = opts

  const isLandscape = ref(window.innerWidth > window.innerHeight)
  const imeOccluding = ref(false)
  const systemKeyboardOpen = ref(false)
  const systemKeyboardHeight = ref(0)
  const terminalImeFocused = opts.terminalImeFocused ?? ref(false)
  const toolbarBottom = computed(() =>
    terminalImeFocused.value && systemKeyboardOpen.value ? systemKeyboardHeight.value : 0
  )
  let viewportRefitTimer = 0
  let orientationRevalidateFrame = 0
  let earlyPanReleaseFrame = 0
  let naturalVH = 0
  let panResetAttempts = 0
  let lastSampledKeyboardOpen = false
  let awaitingPostOrientationBaseline = false
  let postOrientationOccludedVH = 0
  let disposed = false

  function sampleViewport(allowBaselineReset = false) {
    const viewport = window.visualViewport
    if (!viewport) {
      panResetAttempts = 0
      imeOccluding.value = false
      systemKeyboardOpen.value = false
      systemKeyboardHeight.value = 0
      return
    }

    const vh = viewport.height
    // offsetTop is WebKit's temporary caret pan, not keyboard occlusion. Keeping
    // the inset pan-invariant prevents the keyboard bar from painting short and
    // then jumping down after the visual viewport returns to zero.
    const off = Math.max(0, window.innerHeight - vh)
    let preserveKeyboardWithoutBaseline = false
    // Layout-resize browsers report off=0 even with the IME open. After a
    // rotation, retain the known-open state until the viewport expands again.
    if (awaitingPostOrientationBaseline) {
      const expandedPastKeyboard =
        postOrientationOccludedVH > 0 && vh - postOrientationOccludedVH > 120
      if (off > 0 || expandedPastKeyboard) {
        awaitingPostOrientationBaseline = false
        postOrientationOccludedVH = 0
      } else {
        postOrientationOccludedVH =
          postOrientationOccludedVH > 0 ? Math.min(postOrientationOccludedVH, vh) : vh
        preserveKeyboardWithoutBaseline = true
      }
    }
    if (off === 0 && vh > 0) {
      naturalVH = allowBaselineReset ? vh : Math.max(naturalVH, vh)
    } else if (naturalVH === 0 && off > 0) {
      // The first sample after a rotation or restore can still be occluded. In
      // overlay-style viewports, innerHeight remains the unoccluded baseline.
      naturalVH = Math.max(vh, window.innerHeight)
    }
    const heightDelta = Math.max(0, naturalVH - vh)
    const sysKbOpen = preserveKeyboardWithoutBaseline || (naturalVH > 0 && heightDelta > 120)
    // `off` is the part of the layout viewport actually occluded by the IME.
    // On browsers that resize the layout viewport, it stays at zero and avoids
    // subtracting the keyboard height a second time.
    const keyboardHeight = sysKbOpen ? off : 0
    systemKeyboardOpen.value = sysKbOpen
    systemKeyboardHeight.value = keyboardHeight
    imeOccluding.value = sysKbOpen && keyboardHeight > 0
    const keyboardClosed = lastSampledKeyboardOpen && !sysKbOpen
    lastSampledKeyboardOpen = sysKbOpen
    document.documentElement.style.setProperty('--sys-kb-height', `${keyboardHeight}px`)
    document.documentElement.style.setProperty(
      '--system-toolbar-bottom',
      `${toolbarBottom.value}px`
    )
    document.documentElement.style.setProperty(
      '--kb-open',
      sysKbOpen || kbVisible.value ? '1' : '0'
    )
    if (keyboardClosed) {
      panResetAttempts = 0
      opts.onSystemKeyboardClose?.()
    }
  }

  function scheduleBuiltinPanRelease() {
    cancelAnimationFrame(earlyPanReleaseFrame)
    earlyPanReleaseFrame = 0
    const viewport = window.visualViewport
    if (
      !viewport ||
      !isIPhoneClient() ||
      !opts.builtinTextareaFocused.value ||
      !systemKeyboardOpen.value ||
      viewport.offsetTop <= 0 ||
      panResetAttempts >= MAX_PAN_RESETS
    )
      return
    earlyPanReleaseFrame = requestAnimationFrame(() => {
      earlyPanReleaseFrame = 0
      const current = window.visualViewport
      if (disposed || !current) return
      sampleViewport()
      if (
        !opts.builtinTextareaFocused.value ||
        !systemKeyboardOpen.value ||
        current.offsetTop <= 0 ||
        panResetAttempts >= MAX_PAN_RESETS
      )
        return
      panResetAttempts += 1
      window.scrollTo(0, 0)
    })
  }

  function onViewportResize() {
    if (document.visibilityState === 'hidden') {
      reset()
      return
    }
    if (!window.visualViewport) return
    sampleViewport()
    scheduleBuiltinPanRelease()

    clearTimeout(viewportRefitTimer)
    // The terminal ResizeObserver already owns the iPhone frame resize. A
    // second delayed fit repaints the upper frame during the IME animation.
    if (isIPhoneClient()) return
    viewportRefitTimer = window.setTimeout(() => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      for (const leaf of getAllLeaves(tab.layout)) {
        termRefs[leaf.paneId]?.fit()
      }
    }, 100)
  }

  function onOrientationChange() {
    isLandscape.value = window.innerWidth > window.innerHeight
  }

  function clearViewportState(discardBaseline = false) {
    clearTimeout(viewportRefitTimer)
    cancelAnimationFrame(earlyPanReleaseFrame)
    earlyPanReleaseFrame = 0
    if (discardBaseline) naturalVH = 0
    panResetAttempts = 0
    imeOccluding.value = false
    systemKeyboardOpen.value = false
    systemKeyboardHeight.value = 0
    document.documentElement.style.setProperty('--sys-kb-height', '0px')
    document.documentElement.style.setProperty('--kb-open', kbVisible.value ? '1' : '0')
    document.documentElement.style.setProperty('--system-toolbar-bottom', '0px')
  }

  function reset() {
    clearViewportState()
  }

  function revalidate() {
    const viewport = window.visualViewport
    if (!viewport) {
      reset()
      return
    }
    // Reset a stale baseline only from a confirmed-unoccluded sample. If this
    // is the first sample after rotation and it is still occluded, sampleViewport
    // derives the new orientation's baseline from the layout viewport instead.
    const off = Math.max(0, window.innerHeight - viewport.height)
    const preservedDelta = Math.max(0, naturalVH - viewport.height)
    const confirmedUnoccluded =
      off === 0 &&
      !awaitingPostOrientationBaseline &&
      !(lastSampledKeyboardOpen && preservedDelta > 120)
    if (confirmedUnoccluded) naturalVH = 0
    sampleViewport(confirmedUnoccluded)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') reset()
  }

  function onOrientationLifecycle() {
    onOrientationChange()
    awaitingPostOrientationBaseline = lastSampledKeyboardOpen
    postOrientationOccludedVH = 0
    clearViewportState(true)
    cancelAnimationFrame(orientationRevalidateFrame)
    orientationRevalidateFrame = requestAnimationFrame(revalidate)
  }

  watch(kbVisible, (v) => {
    document.documentElement.style.setProperty('--kb-open', v ? '1' : '0')
  })

  watch(toolbarBottom, (value) => {
    document.documentElement.style.setProperty('--system-toolbar-bottom', `${value}px`)
  })

  onMounted(() => {
    window.addEventListener('resize', onOrientationChange)
    window.addEventListener('blur', reset)
    window.addEventListener('focus', revalidate)
    window.addEventListener('pagehide', reset)
    window.addEventListener('pageshow', revalidate)
    window.addEventListener('orientationchange', onOrientationLifecycle)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportResize)
      window.visualViewport.addEventListener('scroll', onViewportResize)
    }
    revalidate()
  })

  function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(viewportRefitTimer)
    cancelAnimationFrame(orientationRevalidateFrame)
    cancelAnimationFrame(earlyPanReleaseFrame)
    naturalVH = 0
    panResetAttempts = 0
    lastSampledKeyboardOpen = false
    awaitingPostOrientationBaseline = false
    postOrientationOccludedVH = 0
    imeOccluding.value = false
    window.removeEventListener('resize', onOrientationChange)
    window.removeEventListener('blur', reset)
    window.removeEventListener('focus', revalidate)
    window.removeEventListener('pagehide', reset)
    window.removeEventListener('pageshow', revalidate)
    window.removeEventListener('orientationchange', onOrientationLifecycle)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onViewportResize)
      window.visualViewport.removeEventListener('scroll', onViewportResize)
    }
    document.documentElement.style.removeProperty('--sys-kb-height')
    document.documentElement.style.removeProperty('--system-toolbar-bottom')
    document.documentElement.style.setProperty('--kb-open', '0')
  }

  onBeforeUnmount(dispose)

  return {
    isLandscape,
    imeOccluding,
    systemKeyboardOpen,
    systemKeyboardHeight,
    terminalImeFocused,
    toolbarBottom,
    onViewportResize,
    onOrientationChange,
    reset,
    revalidate,
    dispose,
  }
}

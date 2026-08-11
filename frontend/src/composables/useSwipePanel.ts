import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue'

export interface SwipePanelOptions {
  kbMode: Ref<'default' | 'action'>
  barRef: Ref<HTMLElement | null | undefined>
  applyHeight: () => void
  fetchSuggestions: () => void
}

export interface SwipePanelState {
  swipeStartX: Ref<number>
  swipeStartY: Ref<number>
  swipeDeltaX: Ref<number>
  swiping: Ref<boolean>
  swipeTransition: Ref<boolean>
  swipeTrackStyle: ComputedRef<{
    transform: string
    transition: string
  }>
  onSwipeStart: (e: TouchEvent) => void
  onSwipeMove: (e: TouchEvent) => void
  onSwipeEnd: () => void
  switchMode: (mode: 'default' | 'action') => void
}

// Preserve the existing clipping guard below each panel.
const SWIPE_PANEL_HEIGHT_GUARD = 2

export function resolveSwipePanelHeight(
  mode: 'default' | 'action',
  mainHeight: number,
  actionHeight: number
): number {
  return (mode === 'default' ? mainHeight : actionHeight) + SWIPE_PANEL_HEIGHT_GUARD
}

export function observeSwipePanelHeightTargets(observer: ResizeObserver, bar: HTMLElement) {
  observer.observe(bar)
  for (const selector of ['#mkb-main-panel', '#mkb-action-panel']) {
    const panel = bar.querySelector(selector)
    if (panel) observer.observe(panel)
  }
}

export function useSwipePanel(opts: SwipePanelOptions): SwipePanelState {
  const { kbMode, barRef, applyHeight, fetchSuggestions } = opts

  const swipeStartX = ref(0)
  const swipeStartY = ref(0)
  const swipeDeltaX = ref(0)
  const swiping = ref(false)
  const swipeTransition = ref(false)

  const swipeTrackStyle = computed(() => {
    const baseOffset = kbMode.value === 'default' ? 0 : -50
    const dragPct = swiping.value ? (swipeDeltaX.value / (barRef.value?.offsetWidth || 375)) * 50 : 0
    return {
      transform: `translateX(${baseOffset + dragPct}%)`,
      transition: swipeTransition.value ? 'transform 0.25s ease-out' : 'none',
    }
  })

  function onSwipeStart(e: TouchEvent) {
    swipeTransition.value = false
    swipeStartX.value = e.touches[0].clientX
    swipeStartY.value = e.touches[0].clientY
    swipeDeltaX.value = 0
    swiping.value = false
  }

  function onSwipeMove(e: TouchEvent) {
    const dx = e.touches[0].clientX - swipeStartX.value
    const dy = e.touches[0].clientY - swipeStartY.value
    if (!swiping.value) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        swipeDeltaX.value = NaN
        return
      }
      if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiping.value = true
      } else {
        return
      }
    }
    swipeDeltaX.value = dx
  }

  function onSwipeEnd() {
    if (!swiping.value) {
      swipeDeltaX.value = 0
      swiping.value = false
      return
    }
    const threshold = (barRef.value?.offsetWidth || 375) * 0.15
    swipeTransition.value = true
    if (swipeDeltaX.value < -threshold && kbMode.value === 'default') {
      kbMode.value = 'action'
    } else if (swipeDeltaX.value > threshold && kbMode.value === 'action') {
      kbMode.value = 'default'
      fetchSuggestions()
    }
    swipeDeltaX.value = 0
    swiping.value = false
    nextTick(applyHeight)
  }

  function switchMode(mode: 'default' | 'action') {
    if (kbMode.value === mode) return
    swipeTransition.value = true
    kbMode.value = mode
    if (mode === 'default') fetchSuggestions()
    nextTick(applyHeight)
  }

  return {
    swipeStartX,
    swipeStartY,
    swipeDeltaX,
    swiping,
    swipeTransition,
    swipeTrackStyle,
    onSwipeStart,
    onSwipeMove,
    onSwipeEnd,
    switchMode,
  }
}

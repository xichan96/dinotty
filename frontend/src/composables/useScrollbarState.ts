import { ref, computed, watch, type Ref, type ShallowRef, type ComputedRef } from 'vue'
import type { ScrollPositionHandle } from './useScrollPosition'
import type { SettingsData } from './useSettings'

export interface ScrollbarStateOptions {
  scrollPos: ShallowRef<ScrollPositionHandle | null>
  scrollbarTrackRef: Ref<HTMLElement | null | undefined>
  scrollbarThumbRef: Ref<HTMLElement | null | undefined>
  isMobile: Ref<boolean>
  settings: SettingsData
  onScrollToLine: (line: number) => void
}

export interface ScrollbarState {
  scrollbarVisible: Ref<boolean>
  scrollbarWidthPx: ComputedRef<string>
  showScrollbar: ComputedRef<boolean>
  thumbHeightPct: ComputedRef<number>
  thumbTopPct: ComputedRef<number>
  bumpScrollbarActivity: () => void
  scrollbarLineFromClientY: (clientY: number) => number | null
  onScrollbarDragTo: (clientY: number) => void
  onScrollbarTouchStart: (e: TouchEvent) => void
  onScrollbarTouchMove: (e: TouchEvent) => void
  onScrollbarTouchEnd: () => void
  dispose: () => void
}

export function useScrollbarState(opts: ScrollbarStateOptions): ScrollbarState {
  const { scrollPos, scrollbarTrackRef, scrollbarThumbRef, isMobile, settings, onScrollToLine } =
    opts

  const scrollbarVisible = ref(false)
  let scrollbarIdleTimer: ReturnType<typeof setTimeout> | null = null
  let scrollbarDragging = false

  const scrollbarWidthPx = computed(() => `${settings.text.scrollbar_width ?? 8}px`)

  const showScrollbar = computed(() => {
    const h = scrollPos.value
    if (!h) return false
    const s = h.state
    return isMobile.value && !s.isAltScreen && s.length > s.rows
  })

  const thumbHeightPct = computed(() => {
    const s = scrollPos.value?.state
    if (!s || s.length <= 0) return 100
    return Math.max(12, (s.rows / s.length) * 100)
  })

  const thumbTopPct = computed(() => {
    const s = scrollPos.value?.state
    if (!s) return 0
    return (s.viewportY / Math.max(1, s.baseY)) * (100 - thumbHeightPct.value)
  })

  function bumpScrollbarActivity() {
    scrollbarVisible.value = true
    if (scrollbarIdleTimer) clearTimeout(scrollbarIdleTimer)
    scrollbarIdleTimer = setTimeout(() => {
      scrollbarVisible.value = false
    }, 1200)
  }

  watch(
    () => scrollPos.value?.state.viewportY,
    () => {
      if (!showScrollbar.value || scrollbarDragging) return
      bumpScrollbarActivity()
    }
  )

  function scrollbarLineFromClientY(clientY: number): number | null {
    const track = scrollbarTrackRef.value
    const thumb = scrollbarThumbRef.value
    const state = scrollPos.value?.state
    if (!track || !thumb || !state) return null
    const trackRect = track.getBoundingClientRect()
    const thumbH = thumb.getBoundingClientRect().height
    const range = Math.max(1, trackRect.height - thumbH)
    const thumbTop = clientY - trackRect.top - thumbH / 2
    const ratio = Math.min(1, Math.max(0, thumbTop / range))
    return Math.round(ratio * state.baseY)
  }

  function onScrollbarDragTo(clientY: number) {
    const line = scrollbarLineFromClientY(clientY)
    if (line === null) return
    onScrollToLine(line)
    scrollPos.value?.kick()
    scrollbarVisible.value = true
    if (scrollbarIdleTimer) clearTimeout(scrollbarIdleTimer)
  }

  function onScrollbarTouchStart(e: TouchEvent) {
    scrollbarDragging = true
    onScrollbarDragTo(e.touches[0].clientY)
  }

  function onScrollbarTouchMove(e: TouchEvent) {
    if (!scrollbarDragging) return
    onScrollbarDragTo(e.touches[0].clientY)
  }

  function onScrollbarTouchEnd() {
    scrollbarDragging = false
    bumpScrollbarActivity()
  }

  function dispose() {
    if (scrollbarIdleTimer) {
      clearTimeout(scrollbarIdleTimer)
      scrollbarIdleTimer = null
    }
  }

  return {
    scrollbarVisible,
    scrollbarWidthPx,
    showScrollbar,
    thumbHeightPct,
    thumbTopPct,
    bumpScrollbarActivity,
    scrollbarLineFromClientY,
    onScrollbarDragTo,
    onScrollbarTouchStart,
    onScrollbarTouchMove,
    onScrollbarTouchEnd,
    dispose,
  }
}

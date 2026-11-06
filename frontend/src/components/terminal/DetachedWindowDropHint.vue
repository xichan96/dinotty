<template>
  <Transition name="dw-hint">
    <div v-if="hint" class="dw-hint" :class="`dw-hint--${hint}`" aria-hidden="true">
      <div class="dw-hint__frame" :style="hint === 'dock' ? dockFrameStyle : undefined">
        <div v-if="hint === 'dock'" class="dw-hint__pill dw-hint__pill--dock">
          <AppWindow :size="14" />
          <span>{{ t('tab.dockReceiveHint') }}</span>
        </div>
      </div>
      <div v-if="hint === 'detach'" class="dw-hint__pill">
        <SquareArrowOutUpRight :size="15" />
        <span>{{ t('tab.detachDropHint') }}</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppWindow, SquareArrowOutUpRight } from 'lucide-vue-next'
import { usePaneDrag } from '../../composables/paneDragContext'
import { useDetachedWindowFeedback } from '../../composables/detachedWindowFeedback'
import { t } from '../../composables/useI18n'

/**
 * Drop-target feedback for the two detached-window gestures:
 *
 * - `detach`: a tab is being dragged outside the main window; releasing it
 *   opens the tab in its own window. The whole window is the target.
 * - `dock`: a detached window's title bar is over the main tab bar; releasing
 *   (and settling) recalls the tab here. The highlight is pinned to the real
 *   tab bar, not the whole window, so the target matches what the user aims
 *   at.
 */
const drag = usePaneDrag()
const feedback = useDetachedWindowFeedback()

interface TabBarBox {
  left: number
  top: number
  width: number
  height: number
}

const tabBarBox = ref<TabBarBox | null>(null)

function measureTabBar(): void {
  const element = document.getElementById('tab-bar')
  if (!element) {
    tabBarBox.value = null
    return
  }
  const rect = element.getBoundingClientRect()
  tabBarBox.value =
    rect.width > 0 && rect.height > 0
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : null
}

function onResize(): void {
  if (feedback.state.dockHintTabId) measureTabBar()
}

watch(
  () => feedback.state.dockHintTabId,
  (tabId) => {
    if (tabId) measureTabBar()
    else tabBarBox.value = null
  },
  { flush: 'post' }
)

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const hint = computed<'detach' | 'dock' | null>(() => {
  if (drag.state.isDragging && drag.state.wholeTab && drag.state.outsideWindow) return 'detach'
  if (feedback.state.dockHintTabId && tabBarBox.value) return 'dock'
  return null
})

const dockFrameStyle = computed(() => {
  const box = tabBarBox.value
  if (!box) return undefined
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
})
</script>

<style scoped>
.dw-hint {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  pointer-events: none;
}

.dw-hint__frame {
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--accent, #8a8a8a);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent, #8a8a8a) 7%, transparent);
  animation: dw-hint-pulse 1.3s ease-in-out infinite;
}

/* Dock: cover exactly the tab bar, wherever the user placed it. */
.dw-hint--dock .dw-hint__frame {
  inset: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: solid;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #8a8a8a) 16%, transparent);
}

.dw-hint__pill {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--accent, #8a8a8a);
  border-radius: 999px;
  background: var(--bg-surface, #262626);
  color: var(--fg-bright, #fff);
  font-size: 13px;
  line-height: 1;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  animation: dw-hint-pop 0.16s ease-out;
}

.dw-hint__pill--dock {
  padding: 6px 12px;
  font-size: 12px;
}

.dw-hint-enter-active,
.dw-hint-leave-active {
  transition: opacity 0.14s ease;
}

.dw-hint-enter-from,
.dw-hint-leave-to {
  opacity: 0;
}

@keyframes dw-hint-pop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes dw-hint-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dw-hint__frame,
  .dw-hint__pill {
    animation: none;
  }
}
</style>

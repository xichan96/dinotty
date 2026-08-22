<template>
  <template v-if="embedded && visible">
    <!-- Embedded mode: grid with direction slide animation on workspace switch -->
    <AnimatePresence mode="wait">
      <Motion
        :key="cardsKey"
        class="mc-grid"
        :initial="{ opacity: 0, x: switchDirection === 'right' ? 20 : -20 }"
        :animate="{ opacity: 1, x: 0, transition: { duration: 0.18, ease: 'easeOut' } }"
        :exit="{ opacity: 0, transition: { duration: 0.1, ease: 'easeOut' } }"
      >
        <Motion
          v-for="(card, i) in cards"
          :key="card.paneId"
          :ref="(el: any) => setCardRef(i, el)"
          class="mc-card"
          :class="{ active: card.paneId === activePaneId, focused: i === focusedIndex }"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1, transition: { duration: 0.12 } }"
          :exit="{ opacity: 0, transition: { duration: 0.08 } }"
          @click="$emit('activate', card.paneId)"
          @mouseenter="focusedIndex = i"
          @contextmenu.prevent="openCardCtx($event, card)"
        >
          <div class="mc-card-header">
            <span class="mc-card-index">{{ card.index }}</span>
            <span class="mc-card-title">{{ card.title }}</span>
            <span
              v-if="indicators[card.paneId]"
              class="mc-notif-dot"
              :class="'dot-' + indicators[card.paneId]"
            ></span>
            <button
              class="mc-card-close"
              :aria-label="`Close ${card.title}`"
              @click.stop="$emit('close-tab', card.paneId)"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mc-card-preview">
            <img v-if="card.previewImage" :src="card.previewImage" />
            <SplitPreviewNode
              v-else-if="isSplitPreview(card.htmlContent)"
              :node="card.htmlContent"
            />
            <pre v-else-if="card.htmlContent" class="mc-card-text" v-html="card.htmlContent"></pre>
            <pre v-else-if="card.textContent" class="mc-card-text">{{ card.textContent }}</pre>
            <div v-else-if="card.type === 'plugin'" class="mc-plugin-placeholder">
              <Puzzle :size="32" />
              <span class="mc-plugin-label">{{ card.title }}</span>
            </div>
            <pre v-else class="mc-card-text"></pre>
          </div>
        </Motion>
        <Motion
          :ref="(el: any) => setCardRef(cards.length, el)"
          class="mc-card mc-card-add"
          :class="{ focused: cards.length === focusedIndex }"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1, transition: { duration: 0.12 } }"
          :exit="{ opacity: 0, transition: { duration: 0.08 } }"
          role="button"
          :aria-label="t('keybinding.newTab')"
          @click="$emit('new-tab')"
          @mouseenter="focusedIndex = cards.length"
        >
          <div class="mc-card-header"></div>
          <div class="mc-card-preview">
            <Plus :size="32" />
          </div>
        </Motion>
      </Motion>
    </AnimatePresence>
  </template>
  <AnimatePresence v-else>
    <!-- Standalone mode: backdrop + grid -->
    <Motion
      v-if="visible"
      key="backdrop"
      ref="backdropRef"
      class="mc-backdrop"
      :class="{ 'mc-closing': closing }"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
      tabindex="0"
      @click.self="$emit('close')"
      @keydown="onKeydown"
    >
      <Motion
        key="card-grid"
        class="mc-grid"
        :initial="{ scale: 0.96, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } }"
        :exit="{ scale: 0.96, opacity: 0, transition: { duration: 0.1, ease: 'easeOut' } }"
      >
        <Motion
          v-for="(card, i) in cards"
          :key="card.paneId"
          :ref="(el: any) => setCardRef(i, el)"
          class="mc-card"
          :class="{ active: card.paneId === activePaneId, focused: i === focusedIndex }"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1, transition: { duration: 0.12 } }"
          :exit="{ opacity: 0, transition: { duration: 0.08 } }"
          @click="$emit('activate', card.paneId)"
          @mouseenter="focusedIndex = i"
        >
          <div class="mc-card-header">
            <span class="mc-card-index">{{ card.index }}</span>
            <span class="mc-card-title">{{ card.title }}</span>
            <button
              class="mc-card-close"
              :aria-label="`Close ${card.title}`"
              @click.stop="$emit('close-tab', card.paneId)"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mc-card-preview">
            <img v-if="card.previewImage" :src="card.previewImage" />
            <SplitPreviewNode
              v-else-if="isSplitPreview(card.htmlContent)"
              :node="card.htmlContent"
            />
            <pre v-else-if="card.htmlContent" class="mc-card-text" v-html="card.htmlContent"></pre>
            <pre v-else-if="card.textContent" class="mc-card-text">{{ card.textContent }}</pre>
            <div v-else-if="card.type === 'plugin'" class="mc-plugin-placeholder">
              <Puzzle :size="32" />
              <span class="mc-plugin-label">{{ card.title }}</span>
            </div>
            <pre v-else class="mc-card-text"></pre>
          </div>
        </Motion>
        <Motion
          :ref="(el: any) => setCardRef(cards.length, el)"
          class="mc-card mc-card-add"
          :class="{ focused: cards.length === focusedIndex }"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1, transition: { duration: 0.12 } }"
          :exit="{ opacity: 0, transition: { duration: 0.08 } }"
          role="button"
          :aria-label="t('keybinding.newTab')"
          @click="$emit('new-tab')"
          @mouseenter="focusedIndex = cards.length"
        >
          <div class="mc-card-header"></div>
          <div class="mc-card-preview">
            <Plus :size="32" />
          </div>
        </Motion>
      </Motion>
    </Motion>
  </AnimatePresence>
  <ContextMenu
    :visible="ctxVisible"
    :x="ctxX"
    :y="ctxY"
    :items="ctxItems"
    @close="ctxVisible = false"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import {
  X,
  Puzzle,
  Pencil,
  Square,
  Plus,
  Layers,
  ArrowLeftToLine,
  ArrowRightToLine,
} from 'lucide-vue-next'
import type { TabCard, PanePreviewNode } from '../../composables/useTabPreview'
import SplitPreviewNode from './SplitPreviewNode.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { uiPrompt } from '../../composables/usePrompt'
import { useMissionControlState, sendMcOp } from '../../composables/useMissionControlState'

const { t } = useI18n()

function isSplitPreview(content: string | PanePreviewNode): content is PanePreviewNode {
  return typeof content === 'object' && content !== null && 'direction' in content
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    cards: TabCard[]
    activePaneId: string | null
    embedded?: boolean
    switchDirection?: 'left' | 'right'
    indicators?: Record<string, string>
  }>(),
  { embedded: false, switchDirection: 'right', indicators: () => ({}) }
)

// Key for AnimatePresence — changes when workspace switches, not when individual tabs change
const cardsKey = computed(() => props.cards.map((c) => c.paneId).join(','))

const emit = defineEmits<{
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
  'close-tabs': [paneIds: string[]]
  'rename-tab': [paneId: string, title: string]
  'new-tab': []
}>()

// Context menu for tab cards
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function openCardCtx(e: MouseEvent, card: TabCard) {
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  const idx = props.cards.findIndex((c) => c.paneId === card.paneId)
  const workspaceTabs = props.cards.filter((c) => c.type !== 'plugin')
  const leftTabs = props.cards.slice(0, idx).filter((c) => c.type !== 'plugin')
  const rightTabs = props.cards.slice(idx + 1).filter((c) => c.type !== 'plugin')
  const closeWorkspaceLabel = t('overview.closeWorkspaceTabs')
  const closeLeftLabel = t('overview.closeTabsLeft')
  const closeRightLabel = t('overview.closeTabsRight')

  async function confirmCloseTabs(label: string, targets: TabCard[]) {
    const ok = await uiConfirm(
      t('overview.confirmCloseTabs').replace('{count}', String(targets.length)),
      {
        title: label,
        confirmText: t('overview.closeTabsConfirm'),
        cancelText: t('filePreview.cancel'),
      }
    )
    if (!ok) return
    emit(
      'close-tabs',
      targets.map((c) => c.paneId)
    )
  }

  function currentSideTabs(side: 'left' | 'right'): TabCard[] | null {
    const currentCards = props.cards
    const currentIdx = currentCards.findIndex((c) => c.paneId === card.paneId)
    if (currentIdx === -1) return null
    const sideCards =
      side === 'left' ? currentCards.slice(0, currentIdx) : currentCards.slice(currentIdx + 1)
    return sideCards.filter((c) => c.type !== 'plugin')
  }

  ctxItems.value = [
    {
      label: t('palette.rename'),
      icon: Pencil,
      action: async () => {
        const name = await uiPrompt(t('palette.rename'), card.title, {
          confirmText: t('settings.token.save'),
          cancelText: t('confirm.closeWindowCancel'),
        })
        if (name && name.trim()) {
          emit('rename-tab', card.paneId, name.trim())
        }
      },
    },
    {
      label: closeWorkspaceLabel,
      icon: Layers,
      disabled: workspaceTabs.length === 0,
      action: () =>
        confirmCloseTabs(
          closeWorkspaceLabel,
          props.cards.filter((c) => c.type !== 'plugin')
        ),
    },
    {
      label: closeLeftLabel,
      icon: ArrowLeftToLine,
      disabled: leftTabs.length === 0,
      action: () => {
        const targets = currentSideTabs('left')
        if (targets === null) return
        void confirmCloseTabs(closeLeftLabel, targets)
      },
    },
    {
      label: closeRightLabel,
      icon: ArrowRightToLine,
      disabled: rightTabs.length === 0,
      action: () => {
        const targets = currentSideTabs('right')
        if (targets === null) return
        void confirmCloseTabs(closeRightLabel, targets)
      },
    },
    {
      label: t('overview.closeTab'),
      icon: Square,
      danger: true,
      action: () => emit('close-tab', card.paneId),
    },
  ]
  ctxVisible.value = true
}

const mcState = useMissionControlState()
const cardRefs = ref<(HTMLElement | null)[]>([])
const backdropRef = ref<any>(null)
const closing = ref(false)

function setCardRef(index: number, el: any) {
  cardRefs.value[index] = el?.$el ?? el ?? null
}

/// Focused index derives from `mcState.selectedTabId` - the backend is the
/// single source of truth. Falls back to `cards.length` (the "add" card)
/// when no tab is selected, so empty workspaces are still keyboard-actionable.
const focusedIndex = computed(() => {
  const idx = props.cards.findIndex((c) => c.paneId === mcState.selectedTabId)
  return idx >= 0 ? idx : props.cards.length
})

// Reset closing flag when overlay visibility flips. No local focused-index
// seeding - the backend seeds selected_tab_id from the active tab on
// toggle-open and broadcasts it via `selection_changed`.
watch(
  () => props.visible,
  (v) => {
    if (v) {
      closing.value = false
      if (!props.embedded) {
        nextTick(() => backdropRef.value?.$el?.focus?.())
      }
    } else {
      closing.value = true
    }
  }
)

// Keep the focused card scrolled into view whenever the backend-driven
// focused index changes (e.g. hardware keyboard arrow keys on another
// client moved the selection).
watch(focusedIndex, () => {
  nextTick(() => {
    const el = cardRefs.value[focusedIndex.value]
    el?.scrollIntoView({ block: 'nearest' })
  })
})

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowLeft':
      // Linear tab nav: previous tab. The backend cycles through tab_order
      // and broadcasts `selection_changed` - we never mutate focusedIndex
      // locally. Left/Right maps to the horizontal tab grid in MC.
      e.preventDefault()
      sendMcOp({ kind: 'navigate', dir: 'left' })
      return
    case 'ArrowRight':
      e.preventDefault()
      sendMcOp({ kind: 'navigate', dir: 'right' })
      return
    case 'Enter':
      e.preventDefault()
      // Confirm: if a tab is selected, the backend activates it and closes
      // MC. If selected_tab_id is None (the "add" card), we emit new-tab
      // locally because the backend's Confirm op does not (yet) create a
      // new tab.
      if (mcState.selectedTabId) {
        sendMcOp({ kind: 'confirm' })
      } else {
        emit('new-tab')
      }
      return
    case 'Escape':
      e.preventDefault()
      sendMcOp({ kind: 'cancel' })
      return
    case 'ArrowUp':
    case 'ArrowDown':
      // Up/Down are workspace-nav keys - handled by the parent
      // WorkspaceOverview, not TabOverview. Swallow them so the parent's
      // onKeydown doesn't double-fire.
      e.preventDefault()
      return
    default:
      return
  }
}

defineExpose({
  focusedIndex,
  onKeydown,
  activateFocused() {
    if (focusedIndex.value < props.cards.length) {
      emit('activate', props.cards[focusedIndex.value].paneId)
    } else {
      emit('new-tab')
    }
  },
})
</script>

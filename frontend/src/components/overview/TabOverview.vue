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
          <SplitPreviewNode v-else-if="isSplitPreview(card.htmlContent)" :node="card.htmlContent" />
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
            <SplitPreviewNode v-else-if="isSplitPreview(card.htmlContent)" :node="card.htmlContent" />
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
  { embedded: false, switchDirection: 'right', indicators: () => ({}) },
)

// Key for AnimatePresence — changes when workspace switches, not when individual tabs change
const cardsKey = computed(() => props.cards.map(c => c.paneId).join(','))

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
      },
    )
    if (!ok) return
    emit('close-tabs', targets.map((c) => c.paneId))
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
      action: () => confirmCloseTabs(
        closeWorkspaceLabel,
        props.cards.filter((c) => c.type !== 'plugin'),
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

const COLS_SM = 2
const COLS_MD = 3
const COLS_LG = 4
const COLS_XL = 5

const focusedIndex = ref(0)
const cardRefs = ref<(HTMLElement | null)[]>([])
const backdropRef = ref<any>(null)
const closing = ref(false)

function setCardRef(index: number, el: any) {
  cardRefs.value[index] = el?.$el ?? el ?? null
}

function getCols(): number {
  const w = window.innerWidth
  if (w >= 1200) return COLS_XL
  if (w >= 900) return COLS_LG
  if (w >= 480) return COLS_MD
  return COLS_SM
}

// Reset focused index when overlay opens; mark closing when overlay starts to dismiss
watch(
  () => props.visible,
  (v) => {
    if (v) {
      closing.value = false
      const idx = props.cards.findIndex((c) => c.paneId === props.activePaneId)
      // Fall back to the "add" card so empty workspaces are still keyboard-actionable
      focusedIndex.value = idx >= 0 ? idx : props.cards.length
      if (!props.embedded) {
        nextTick(() => backdropRef.value?.$el?.focus?.())
      }
    } else {
      closing.value = true
    }
  },
)

// Reset focused index when cards change (workspace switch, tab close, etc.)
watch(
  () => props.cards,
  (cards) => {
    // "add" card lives at index cards.length; only clamp when beyond that
    if (focusedIndex.value > cards.length) focusedIndex.value = cards.length
    if (!cards.length) return
    // Try to focus the active pane
    const idx = cards.findIndex((c) => c.paneId === props.activePaneId)
    if (idx >= 0) focusedIndex.value = idx
  },
  { deep: false },
)

function onKeydown(e: KeyboardEvent) {
  // Total cells = cards + trailing "add" card
  const tabCount = props.cards.length
  const total = tabCount + 1
  const cols = getCols()
  const cur = focusedIndex.value
  const row = Math.floor(cur / cols)
  const col = cur % cols
  const lastRow = Math.floor((total - 1) / cols)

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      if (row > 0) {
        focusedIndex.value = cur - cols
      } else {
        // Wrap to last row, same col (clamp to last cell if col is out of range)
        const target = lastRow * cols + col
        focusedIndex.value = target < total ? target : total - 1
      }
      break
    case 'ArrowDown':
      e.preventDefault()
      if (row < lastRow) {
        const target = cur + cols
        focusedIndex.value = target < total ? target : total - 1
      } else {
        // Wrap to first row, same col
        focusedIndex.value = col < total ? col : 0
      }
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (col > 0) {
        focusedIndex.value = cur - 1
      } else if (row > 0) {
        // Wrap to end of previous row
        focusedIndex.value = row * cols - 1
      } else {
        // At the very first cell — wrap to last cell
        focusedIndex.value = total - 1
      }
      break
    case 'ArrowRight':
      e.preventDefault()
      if (col < cols - 1 && cur + 1 < total) {
        focusedIndex.value = cur + 1
      } else if (row < lastRow) {
        // Wrap to start of next row
        focusedIndex.value = (row + 1) * cols
      } else {
        // At the very last cell — wrap to first cell
        focusedIndex.value = 0
      }
      break
    case 'Enter':
      e.preventDefault()
      if (cur < tabCount) {
        emit('activate', props.cards[cur].paneId)
      } else {
        emit('new-tab')
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
    default:
      return
  }

  nextTick(() => {
    const el = cardRefs.value[focusedIndex.value]
    el?.scrollIntoView({ block: 'nearest' })
  })
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

<template>
  <Motion
    key="ws-grid-mobile"
    class="mc-ws-mobile-grid"
    :initial="{ x: 20, opacity: 0 }"
    :animate="{ x: 0, opacity: 1 }"
    :exit="{ x: 20, opacity: 0 }"
    :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
  >
    <div class="mc-ws-mobile-header">
      <button class="mc-ws-mobile-back" @click="$emit('back')">
        <ChevronLeft :size="20" />
        <span>{{ t('workspace.back') }}</span>
      </button>
      <span class="mc-ws-mobile-title">{{ workspaceName }}</span>
      <button class="mc-ws-mobile-close" @click="emit('close')">
        <X :size="18" />
      </button>
    </div>

    <div v-if="cards.length === 0" class="mc-ws-mobile-empty-grid">
      <p class="mc-ws-empty-text">{{ emptyHint }}</p>
    </div>

    <div v-else class="mc-ws-mobile-cards">
      <div
        v-for="card in cards"
        :key="card.paneId"
        class="mc-card"
        :class="{ active: card.paneId === activePaneId }"
        @click="$emit('activate', card.paneId)"
        @touchstart.passive="onCardTouchStart($event, card)"
        @touchend="onCardTouchEnd"
        @touchmove.passive="onCardTouchMove"
      >
        <div class="mc-card-header">
          <span class="mc-card-index">{{ card.index }}</span>
          <span class="mc-card-title">{{ card.title }}</span>
          <button class="mc-card-close" @click.stop="$emit('close-tab', card.paneId)">
            <X :size="14" />
          </button>
        </div>
        <div class="mc-card-preview">
          <img v-if="card.previewImage" :src="card.previewImage" />
          <pre v-else-if="card.htmlContent" class="mc-card-text" v-html="card.htmlContent"></pre>
          <pre v-else-if="card.textContent" class="mc-card-text">{{ card.textContent }}</pre>
          <div v-else-if="card.type === 'plugin'" class="mc-plugin-placeholder">
            <Puzzle :size="32" />
            <span class="mc-plugin-label">{{ card.title }}</span>
          </div>
          <pre v-else class="mc-card-text"></pre>
        </div>
      </div>
    </div>

    <button class="mc-ws-mobile-new-tab" @click="$emit('new-tab', workspacePath)">
      <Plus :size="16" />
      {{ t('workspace.newTerminal') }}
    </button>
  </Motion>
  <ContextMenu
    :visible="ctxVisible"
    :x="ctxX"
    :y="ctxY"
    :items="ctxItems"
    @close="ctxVisible = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Motion } from 'motion-v'
import { ChevronLeft, X, Puzzle, Plus, Pencil, Square } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { DEFAULT_WORKSPACE_ID } from '../../composables/useWorkspaces'
import { uiPrompt } from '../../composables/usePrompt'
import type { TabCard } from '../../composables/useTabPreview'
import type { Workspace } from '../../types/workspace'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'

const { t } = useI18n()

const props = defineProps<{
  workspace: Workspace | null
  workspaceId: string | null | undefined
  cards: TabCard[]
  activePaneId: string | null
}>()

const emit = defineEmits<{
  back: []
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
  'new-tab': [cwd?: string]
  'switch-workspace': [direction: 'prev' | 'next']
  'rename-tab': [paneId: string, title: string]
}>()

const workspaceName = computed(() => {
  if (props.workspaceId === DEFAULT_WORKSPACE_ID) return t('workspace.default')
  return props.workspace?.name ?? t('workspace.ungrouped')
})
const workspacePath = computed(() => props.workspace?.path)
const emptyHint = computed(() =>
  props.workspace ? `${t('workspace.firstUse')}` : t('workspace.ungrouped')
)

// Swipe gesture
const SWIPE_THRESHOLD = 50
let startX = 0
let startY = 0
let swiping = false

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  startX = touch.clientX
  startY = touch.clientY
  swiping = false
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  const dx = touch.clientX - startX
  const dy = touch.clientY - startY

  // Only detect horizontal swipes
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
    // Check if in middle 80% of screen (avoid system back gesture area)
    const screenW = window.innerWidth
    const relX = touch.clientX / screenW
    if (relX > 0.1 && relX < 0.9) {
      swiping = true
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (!swiping) return
  const touch = e.changedTouches[0]
  const dx = touch.clientX - startX

  if (Math.abs(dx) > SWIPE_THRESHOLD) {
    if (dx > 0) {
      emit('switch-workspace', 'prev')
    } else {
      emit('switch-workspace', 'next')
    }
  }
  swiping = false
}

// Context menu
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function showCardCtx(card: TabCard, x: number, y: number) {
  ctxX.value = x
  ctxY.value = y
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
      label: t('workspace.delete'),
      icon: Square,
      danger: true,
      action: () => emit('close-tab', card.paneId),
    },
  ]
  ctxVisible.value = true
}

// Long-press detection on cards
const LONG_PRESS_MS = 500
let pressTimer = 0
let pressCard: TabCard | null = null
let pressX = 0
let pressY = 0

function onCardTouchStart(e: TouchEvent, card: TabCard) {
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  pressCard = card
  pressX = touch.clientX
  pressY = touch.clientY
  pressTimer = window.setTimeout(() => {
    if (pressCard) {
      showCardCtx(pressCard, pressX, pressY)
      pressCard = null
    }
  }, LONG_PRESS_MS)
}

function onCardTouchMove() {
  clearTimeout(pressTimer)
  pressCard = null
}

function onCardTouchEnd() {
  clearTimeout(pressTimer)
  pressCard = null
}
</script>

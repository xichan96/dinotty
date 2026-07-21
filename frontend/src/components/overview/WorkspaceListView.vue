<template>
  <Motion
    key="ws-list-mobile"
    class="mc-ws-mobile-list"
    :initial="{ x: -20, opacity: 0 }"
    :animate="{ x: 0, opacity: 1 }"
    :exit="{ x: -20, opacity: 0 }"
    :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
  >
    <div class="mc-ws-mobile-header">
      <span class="mc-ws-mobile-title">{{ t('settings.tab.workspaces') }}</span>
      <button class="mc-ws-mobile-close" @click="emit('close')">
        <X :size="18" />
      </button>
    </div>

    <div class="mc-ws-mobile-items">
      <button
        class="mc-ws-mobile-item"
        :class="{ active: activeId === '__all__' }"
        @click="$emit('selectAll')"
        @contextmenu.prevent="showCtx(defaultWorkspace, $event.clientX, $event.clientY)"
        @touchstart.passive="onTouchStart($event, defaultWorkspace)"
        @touchend="onTouchEnd"
        @touchmove.passive="onTouchMove"
      >
        <WorkspaceBadge
          :abbr="resolveAbbr(defaultWorkspace)"
          :color="resolveColor(defaultWorkspace)"
          :size="18"
        />
        <div class="mc-ws-mobile-info">
          <span class="mc-ws-mobile-name">{{ defaultWorkspace.name }}</span>
          <span class="mc-ws-mobile-path">{{ defaultWorkspace.path }}</span>
        </div>
        <span v-if="allCount" class="mc-ws-mobile-count">{{ allCount }}</span>
      </button>
      <button
        v-for="ws in workspaces"
        :key="ws.id"
        class="mc-ws-mobile-item"
        :class="{ active: ws.id === activeId }"
        @click="$emit('drilldown', ws.id)"
        @contextmenu.prevent="showCtx(ws, $event.clientX, $event.clientY)"
        @touchstart.passive="onTouchStart($event, ws)"
        @touchend="onTouchEnd"
        @touchmove.passive="onTouchMove"
      >
        <WorkspaceBadge
          :remote="!!ws.connection_id"
          :abbr="resolveAbbr(ws)"
          :color="resolveColor(ws)"
          :size="18"
        />
        <div class="mc-ws-mobile-info">
          <span class="mc-ws-mobile-name">{{ ws.name }}</span>
          <span class="mc-ws-mobile-path">{{ ws.path }}</span>
        </div>
        <span v-if="tabCounts[ws.id]" class="mc-ws-mobile-count">{{ tabCounts[ws.id] }}</span>
      </button>

      <button class="mc-ws-mobile-add" @click="$emit('add')">
        <Plus :size="16" />
        {{ t('workspace.add') }}
      </button>
    </div>
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
import { ref } from 'vue'
import { Motion } from 'motion-v'
import { Plus, Pencil, Trash2, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../../composables/useWorkspaces'
import type { Workspace } from '../../types/workspace'
import { resolveAbbr, resolveColor } from '../../utils/workspaceIcon'
import WorkspaceBadge from '../WorkspaceBadge.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'

const { t } = useI18n()
const { defaultWorkspace, deleteWorkspace } = useWorkspaces()

const props = defineProps<{
  workspaces: Workspace[]
  activeId: string | null
  tabCounts: Record<string, number>
  allCount: number
}>()

const emit = defineEmits<{
  close: []
  drilldown: [id: string | null]
  selectAll: []
  add: []
  rename: [id: string]
}>()

// Context menu
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function showCtx(ws: Workspace, x: number, y: number) {
  ctxX.value = x
  ctxY.value = y
  ctxItems.value = [
    {
      label: ws.id === DEFAULT_WORKSPACE_ID ? t('workspace.editDefault') : t('palette.rename'),
      icon: Pencil,
      action: () => emit('rename', ws.id),
    },
  ]
  if (ws.id !== DEFAULT_WORKSPACE_ID) {
    ctxItems.value.push({
      label: t('workspace.delete'),
      icon: Trash2,
      danger: true,
      action: async () => {
        if (!(await uiConfirm(t('workspace.confirmDelete').replace('{name}', ws.name), {
          title: t('workspace.delete'),
          confirmText: t('workspace.delete'),
          cancelText: t('filePreview.cancel'),
        }))) return
        try {
          await deleteWorkspace(ws.id)
        } catch (err) {
          console.error('Failed to delete workspace:', err)
        }
      },
    })
  }
  ctxVisible.value = true
}

// Long-press detection
const LONG_PRESS_MS = 500
let pressTimer = 0
let pressWs: Workspace | null = null
let pressX = 0
let pressY = 0

function onTouchStart(e: TouchEvent, ws: Workspace) {
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  pressWs = ws
  pressX = touch.clientX
  pressY = touch.clientY
  pressTimer = window.setTimeout(() => {
    if (pressWs) {
      showCtx(pressWs, pressX, pressY)
      pressWs = null
    }
  }, LONG_PRESS_MS)
}

function onTouchMove() {
  clearTimeout(pressTimer)
  pressWs = null
}

function onTouchEnd() {
  clearTimeout(pressTimer)
  pressWs = null
}
</script>

<template>
  <div class="mc-ws-list">
    <div class="mc-ws-list-scroll">
      <button
        class="mc-ws-list-item"
        :class="{ selected: selectedId === '__all__' }"
        @click="$emit('select', '__all__')"
        @contextmenu.prevent="openCtx($event, defaultWorkspace)"
      >
        <WorkspaceBadge
          :abbr="resolveAbbr(defaultWorkspace)"
          :color="resolveColor(defaultWorkspace)"
          :size="18"
        />
        <span class="mc-ws-name">{{ defaultWorkspace.name }}</span>
        <span v-if="allCount" class="mc-ws-count">{{ allCount }}</span>
      </button>

      <button
        v-for="ws in workspaces"
        :key="ws.id"
        class="mc-ws-list-item"
        :class="{ selected: ws.id === selectedId }"
        @click="$emit('select', ws.id)"
        @contextmenu.prevent="openCtx($event, ws)"
      >
        <WorkspaceBadge
          :remote="!!ws.connection_id"
          :abbr="resolveAbbr(ws)"
          :color="resolveColor(ws)"
          :size="18"
        />
        <span class="mc-ws-name">{{ ws.name }}</span>
        <span v-if="tabCounts[ws.id]" class="mc-ws-count">{{ tabCounts[ws.id] }}</span>
      </button>
    </div>

    <div class="mc-ws-footer">
      <button class="mc-ws-add-btn" @click="$emit('add')">
        <Plus :size="14" />
        {{ t('workspace.add') }}
      </button>
    </div>

    <ContextMenu
      :visible="ctxVisible"
      :x="ctxX"
      :y="ctxY"
      :items="ctxItems"
      @close="ctxVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Pencil, Trash2 } from 'lucide-vue-next'
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
  selectedId: string | null
  activeId: string | null
  tabCounts: Record<string, number>
  allCount: number
}>()

const emit = defineEmits<{
  select: [id: string | null]
  selectAll: []
  add: []
  rename: [id: string]
}>()

// Context menu
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function openCtx(e: MouseEvent, ws: Workspace) {
  ctxX.value = e.clientX
  ctxY.value = e.clientY
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
</script>

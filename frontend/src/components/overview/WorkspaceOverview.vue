<template>
  <AnimatePresence>
    <Motion
      v-if="visible"
      key="ws-backdrop"
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
        key="ws-dual"
        class="mc-ws-dual"
        :initial="{ scale: 0.9, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.9, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <button class="mc-close-btn" @click="$emit('close')" :title="t('keybinding.closeTab') + ' (Esc)'">
          <X :size="18" />
        </button>
        <WorkspaceList
          :workspaces="workspaces"
          :selected-id="selectedWorkspaceId"
          :active-id="activeWorkspaceId"
          :tab-counts="tabCounts"
          :all-count="ungroupedCount"
          @select="onSelectWorkspace"
          @add="onAddWorkspace"
          @rename="onRenameWorkspace"
        />
        <div class="mc-right-panel">
          <div v-if="selectedWorkspacePath" class="mc-right-path">{{ selectedWorkspacePath }}</div>
          <TabOverview
            ref="tabOverviewRef"
            :visible="true"
            :cards="filteredCards"
            :active-pane-id="activePaneId"
            :switch-direction="switchDirection"
            :indicators="indicators"
            :embedded="true"
            @activate="(id: string) => $emit('activate', id)"
            @close-tab="(id: string) => $emit('close-tab', id)"
            @close-tabs="(ids: string[]) => $emit('close-tabs', ids)"
            @rename-tab="onRenameTab"
            @new-tab="onNewTabForSelected"
          />
        </div>
      </Motion>
    </Motion>
  </AnimatePresence>
  <CreateWorkspaceDialog
    :visible="showCreateDialog || !!renamingWorkspace"
    :workspace="renamingWorkspace"
    @close="showCreateDialog = false; renamingWorkspace = null"
    @created="onWorkspaceCreated"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import { X } from 'lucide-vue-next'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../../composables/useWorkspaces'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabPreview, type TabCard } from '../../composables/useTabPreview'
import { getAllLeaves } from '../../types/pane'
import type { Workspace } from '../../types/workspace'
import WorkspaceList from './WorkspaceList.vue'
import TabOverview from './TabOverview.vue'
import CreateWorkspaceDialog from '../ui/CreateWorkspaceDialog.vue'
import { shallowReactive } from 'vue'
import TerminalPane from '../terminal/TerminalPane.vue'

const props = defineProps<{
  visible: boolean
  activePaneId: string | null
  termRefs: Record<string, InstanceType<typeof TerminalPane>>
  indicators?: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
  'close-tabs': [paneIds: string[]]
  'new-tab': [cwd?: string]
  'new-tab-ssh': [connectionId: string, initialCwd?: string]
  'rename-tab': [paneId: string, title: string]
}>()

const {
  workspaces,
  defaultWorkspace,
  activeWorkspaceId,
  matchWorkspace,
  deleteWorkspace,
  activateWorkspace,
} = useWorkspaces()
const { t } = useI18n()
const session = useSessionStore()
const tabPreview = useTabPreview()

const closing = ref(false)
const backdropRef = ref<any>(null)
const tabOverviewRef = ref<InstanceType<typeof TabOverview> | null>(null)
const showCreateDialog = ref(false)
const renamingWorkspace = ref<Workspace | null>(null)
const switchDirection = ref<'left' | 'right'>('right')

// Remember last active tab per workspace (workspaceId → paneId)
const workspaceActiveTab = new Map<string, string>()

// '__all__' = show all, null = "ungrouped", string = workspace id
const selectedWorkspaceId = ref<string | null>('__all__')

// Capture all cards when visible — deferred so overlay renders first
const allCards = ref<TabCard[]>([])

watch(
  () => props.visible,
  (v) => {
    if (v) {
      closing.value = false
      // Restore workspace selection immediately
      selectedWorkspaceId.value = activeWorkspaceId.value ?? '__all__'
      nextTick(() => backdropRef.value?.$el?.focus?.())
      // Defer capture so the overlay animation starts without blocking
      setTimeout(() => {
        if (props.visible) {
          allCards.value = tabPreview.captureAll(session.tabs, props.termRefs)
        }
      }, 0)
    } else {
      closing.value = true
    }
  },
)

// Update cards when tabs change while open (debounced)
let tabChangeTimer = 0
watch(
  () => session.tabs.length,
  () => {
    if (!props.visible) return
    clearTimeout(tabChangeTimer)
    tabChangeTimer = window.setTimeout(() => {
          allCards.value = tabPreview.captureAll(session.tabs, props.termRefs)
    }, 100)
  },
)

// Track active tab per workspace
watch(
  () => props.activePaneId,
  (paneId) => {
    if (paneId && selectedWorkspaceId.value && selectedWorkspaceId.value !== '__all__') {
      workspaceActiveTab.set(selectedWorkspaceId.value, paneId)
    }
  },
)

// Build tab→workspace mapping
interface CardGroup {
  workspaceId: string | null // null = ungrouped
  cards: TabCard[]
}

const tabCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const ws of workspaces.value) {
    counts[ws.id] = 0
  }
  for (const tab of session.tabs) {
    if (tab.type !== 'terminal') continue
    const ws = matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.type === 'terminal' ? tab.workspaceId : undefined)
    if (ws) counts[ws.id] = (counts[ws.id] || 0) + 1
  }
  return counts
})

const ungroupedCount = computed(() => {
  return allCards.value.filter((card) => card.type === 'terminal' && getCardWorkspace(card) === null).length
})

function getCardWorkspace(card: TabCard): string | null {
  const tab = session.tabs.find((t) => t.paneId === card.paneId)
  if (!tab || tab.type !== 'terminal') return null
  const ws = matchWorkspace(tab.cwd ?? '', tab.connectionId, tab.type === 'terminal' ? tab.workspaceId : undefined)
  return ws?.id ?? null
}

const filteredCards = computed(() => {
  const sel = selectedWorkspaceId.value
  const cards = sel === '__all__'
    ? allCards.value.filter((card) => card.type === 'plugin' || getCardWorkspace(card) === null)
    : allCards.value.filter((card) => card.type === 'plugin' || getCardWorkspace(card) === sel)
  // Reindex for display (1-based)
  return cards.map((card, i) => ({ ...card, index: i + 1 }))
})

function onSelectWorkspace(id: string | null) {
  // Track direction for card slide animation
  const ids = ['__all__', ...workspaces.value.map(w => w.id)]
  const oldIdx = ids.indexOf(selectedWorkspaceId.value ?? '__all__')
  const newIdx = ids.indexOf(id ?? '__all__')
  switchDirection.value = newIdx >= oldIdx ? 'right' : 'left'

  // Save current active tab for the old workspace
  const oldId = selectedWorkspaceId.value
  if (oldId && oldId !== '__all__' && props.activePaneId) {
    workspaceActiveTab.set(oldId, props.activePaneId)
  }

  selectedWorkspaceId.value = id

  // Restore last active tab for the new workspace (without closing MC)
  if (id && id !== '__all__') {
    const saved = workspaceActiveTab.get(id)
    if (saved && filteredCards.value.some((c) => c.paneId === saved)) {
      session.setActivePane(saved)
    }
  }

  // Also activate globally so Cmd+T / + button inherit the workspace path
  activateWorkspace(id === '__all__' ? null : id).catch(() => {})
}

function onAddWorkspace() {
  showCreateDialog.value = true
}

function onWorkspaceCreated(id: string) {
  selectedWorkspaceId.value = id
}

function onRenameTab(paneId: string, title: string) {
  emit('rename-tab', paneId, title)
}

function onRenameWorkspace(id: string) {
  const ws = id === DEFAULT_WORKSPACE_ID
    ? defaultWorkspace.value
    : workspaces.value.find((w) => w.id === id)
  if (!ws) return
  renamingWorkspace.value = ws
}

function onNewTab(cwd?: string) {
  emit('new-tab', cwd)
}

const selectedWorkspacePath = computed(() => {
  const sel = selectedWorkspaceId.value
  if (!sel) return null
  if (sel === '__all__') return defaultWorkspace.value.path || null
  return workspaces.value.find((w) => w.id === sel)?.path ?? null
})

function onNewTabForSelected() {
  const sel = selectedWorkspaceId.value
  if (sel === '__all__' || sel === null) {
    emit('new-tab')
  } else {
    const ws = workspaces.value.find((w) => w.id === sel)
    if (ws?.connection_id) {
      emit('new-tab-ssh', ws.connection_id, ws.path)
    } else {
      emit('new-tab', ws?.path)
    }
  }
}

function onKeydown(e: KeyboardEvent) {

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      {
        const ids = ['__all__', ...workspaces.value.map(w => w.id)]
        const curIdx = ids.indexOf(selectedWorkspaceId.value ?? '__all__')
        if (curIdx > 0) onSelectWorkspace(ids[curIdx - 1])
      }
      return
    case 'ArrowDown':
      e.preventDefault()
      {
        const ids = ['__all__', ...workspaces.value.map(w => w.id)]
        const curIdx = ids.indexOf(selectedWorkspaceId.value ?? '__all__')
        if (curIdx < ids.length - 1) onSelectWorkspace(ids[curIdx + 1])
      }
      return
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Enter':
      // Delegate to TabOverview for tab grid navigation
      tabOverviewRef.value?.onKeydown(e)
      break
    case 'n':
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onNewTabForSelected()
      }
      break
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      {
        const wsId = selectedWorkspaceId.value
        if (wsId !== null && wsId !== '__all__') {
          const ws = workspaces.value.find((w) => w.id === wsId)
          if (ws) {
            uiConfirm(t('workspace.confirmDelete').replace('{name}', ws.name), {
              title: t('workspace.delete'),
              confirmText: t('workspace.delete'),
              cancelText: t('filePreview.cancel'),
            }).then((ok) => {
              if (ok) deleteWorkspace(wsId).catch((e) => console.error('Failed to delete workspace:', e))
            })
          }
        }
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}
</script>

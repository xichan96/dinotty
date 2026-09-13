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
    >
      <Motion
        key="ws-dual"
        class="mc-ws-dual"
        :initial="{ scale: 0.9, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.9, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <button
          class="mc-close-btn"
          :title="t('keybinding.closeTab') + ' (Esc)'"
          @click="$emit('close')"
        >
          <X :size="18" />
        </button>
        <WorkspaceList
          v-if="syncConnected"
          :workspaces="workspaces"
          :selected-id="selectedWorkspaceId"
          :active-id="activeWorkspaceId"
          :tab-counts="tabCounts"
          :default-count="defaultCount"
          @select="onSelectWorkspace"
          @add="onAddWorkspace"
          @rename="onRenameWorkspace"
        />
        <div class="mc-right-panel">
          <div v-if="syncConnected && selectedWorkspacePath" class="mc-right-path">
            {{ selectedWorkspacePath }}
          </div>
          <!-- Disconnected: the grid would show stale cards and every op would
               be dropped, and the selection mirror is broadcast-only (see the
               `selectedWorkspaceId` comment), so a local switch here would
               never resolve. Offer the server picker instead - it is the only
               control that still works with the socket down. -->
          <div v-if="!syncConnected" class="mc-offline">
            <Unplug class="mc-offline-icon" :size="32" />
            <p class="mc-offline-title">{{ t('server.disconnected') }}</p>
            <p class="mc-offline-hint">{{ t('server.disconnectedHint') }}</p>
            <button class="mc-offline-btn" @click="toggleServerPicker()">
              <Server :size="14" />
              <span>{{ t('server.switch') }}</span>
            </button>
          </div>
          <TabOverview
            v-else
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
    @close="closeCreateDialog"
    @created="onWorkspaceCreated"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import { Server, Unplug, X } from 'lucide-vue-next'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../../composables/useWorkspaces'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { useTabPreview, type TabCard } from '../../composables/useTabPreview'
import { useMissionControlState, sendMcOp } from '../../composables/useMissionControlState'
import {
  closeServerPicker,
  serverPickerOpen,
  toggleServerPicker,
} from '../../composables/useAppCore'
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
  'new-tab': [cwd?: string, workspaceId?: string | null]
  'new-tab-ssh': [connectionId: string, initialCwd?: string, workspaceId?: string]
  'rename-tab': [paneId: string, title: string]
}>()

const { workspaces, defaultWorkspace, activeWorkspaceId, matchWorkspace, deleteWorkspace } =
  useWorkspaces()
const { t } = useI18n()
const session = useSessionStore()
const ui = useUiStore()
const tabPreview = useTabPreview()
const mcState = useMissionControlState()

// The workspace/tab grid is rebuilt from the active server's state; while the
// sync WS is down there is nothing to render and nothing to drive it, so the
// grid is replaced by the disconnected panel, which offers the status bar's
// server picker as the way out.
const syncConnected = computed(() => ui.syncConnected)

const closing = ref(false)
const backdropRef = ref<any>(null)
const tabOverviewRef = ref<InstanceType<typeof TabOverview> | null>(null)
const showCreateDialog = ref(false)
const renamingWorkspace = ref<Workspace | null>(null)
const switchDirection = ref<'left' | 'right'>('right')

// Selected workspace derives from the global MC state. `null` selected_workspace_id
// means the default workspace (`__default__`). Local mutation is intentionally
// forbidden - all changes come from `selection_changed` broadcasts.
const selectedWorkspaceId = computed(() => mcState.selectedWorkspaceId ?? DEFAULT_WORKSPACE_ID)

// The overlay is the only keyboard surface while MC is open.
//
// This is a document listener rather than a `keydown` binding on the container:
// the overlay holds `tabindex="0"`, but clicking any child moves focus there,
// so after mouse use an overlay-level binding never fires and the shortcuts go
// dead. Scoping by `backdrop.contains(e.target)` also keeps the global
// touchscreen keyboard (rendered outside this component) out of it.
onMounted(() => {
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
})

function onDocKeydown(e: KeyboardEvent) {
  const backdrop = backdropRef.value?.$el as HTMLElement | undefined
  if (!props.visible || !backdrop || !backdrop.contains(e.target as Node)) return
  onKeydown(e)
}

// Managing servers is a dialog (`ServerManagerDialog`, opened from the status
// bar's picker), so this component has no part in it: the old "close MC, open
// the settings panel" route led to a panel with no server section at all.
//
// MC hosts no switcher of its own either - see `serverPickerOpen` in
// `useAppCore`. The `s` binding below opens the status bar's picker, which
// rides above this overlay via `.status-bar.is-elevated`.

// Capture all cards when visible — deferred so overlay renders first
const allCards = ref<TabCard[]>([])

watch(
  () => props.visible,
  (v) => {
    if (v) {
      closing.value = false
      // No local workspace-selection seeding: the backend seeds selected_*
      // from the active tab on toggle-open and broadcasts
      // `mission_control_toggled`, which `mcState` mirrors.
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
  // immediate: the component lazy-mounts with visible already true on the
  // first open, and a non-immediate watcher never fires for that initial
  // value - so without this the first-open grid would stay empty.
  { immediate: true }
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
  }
)

// Build tab→workspace mapping
interface CardGroup {
  workspaceId: string | null // null = ungrouped
  cards: TabCard[]
}

const tabCounts = computed(() => {
  const counts: Record<string, number> = { [DEFAULT_WORKSPACE_ID]: 0 }
  for (const ws of workspaces.value) {
    counts[ws.id] = 0
  }
  for (const tab of session.tabs) {
    if (tab.type !== 'terminal') continue
    const ws = matchWorkspace(
      tab.cwd ?? '',
      tab.connectionId,
      tab.type === 'terminal' ? tab.workspaceId : undefined
    )
    // Unmatched terminal tabs belong to the default workspace - this is
    // the case when default_workspace_root is unset or the tab's cwd
    // doesn't fall under any configured workspace path.
    const id = ws?.id ?? DEFAULT_WORKSPACE_ID
    counts[id] = (counts[id] || 0) + 1
  }
  return counts
})

const defaultCount = computed(() => tabCounts.value[DEFAULT_WORKSPACE_ID] ?? 0)

function getCardWorkspace(card: TabCard): string | null {
  const tab = session.tabs.find((t) => t.paneId === card.paneId)
  if (!tab || tab.type !== 'terminal') return null
  const ws = matchWorkspace(
    tab.cwd ?? '',
    tab.connectionId,
    tab.type === 'terminal' ? tab.workspaceId : undefined
  )
  return ws?.id ?? null
}

const filteredCards = computed(() => {
  const sel = selectedWorkspaceId.value
  // Unmatched terminal tabs (getCardWorkspace returns null) belong to the
  // default workspace - this happens when default_workspace_root is unset
  // or the tab's cwd doesn't fall under any configured workspace path.
  const cards = allCards.value.filter((card) => {
    if (card.type === 'plugin') return true
    const ws = getCardWorkspace(card)
    return ws === sel || (ws === null && sel === DEFAULT_WORKSPACE_ID)
  })
  // Reindex for display (1-based)
  return cards.map((card, i) => ({ ...card, index: i + 1 }))
})

function onSelectWorkspace(id: string | null) {
  // Track direction for card slide animation - local UI concern, no sync.
  const ids = [DEFAULT_WORKSPACE_ID, ...workspaces.value.map((w) => w.id)]
  const oldIdx = ids.indexOf(selectedWorkspaceId.value ?? DEFAULT_WORKSPACE_ID)
  const newIdx = ids.indexOf(id ?? DEFAULT_WORKSPACE_ID)
  switchDirection.value = newIdx >= oldIdx ? 'right' : 'left'

  // Send a Jump op - the backend updates selected_workspace_id, resets
  // selected_tab_id, and broadcasts `selection_changed` to all clients
  // (including us). We do NOT mutate selectedWorkspaceId locally - the
  // computed reflects mcState, which is updated by the broadcast.
  const targetWsId = id === DEFAULT_WORKSPACE_ID ? null : id
  sendMcOp({ kind: 'jump', workspace_id: targetWsId })
}

function onAddWorkspace() {
  showCreateDialog.value = true
}

function closeCreateDialog() {
  showCreateDialog.value = false
  renamingWorkspace.value = null
}

function onWorkspaceCreated(id: string) {
  // Jump to the newly created workspace via the backend so all clients
  // follow. Local selectedWorkspaceId is a computed from mcState and will
  // update when the selection_changed broadcast arrives.
  sendMcOp({ kind: 'jump', workspace_id: id })
}

function onRenameTab(paneId: string, title: string) {
  emit('rename-tab', paneId, title)
}

function onRenameWorkspace(id: string) {
  const ws =
    id === DEFAULT_WORKSPACE_ID ? defaultWorkspace.value : workspaces.value.find((w) => w.id === id)
  if (!ws) return
  renamingWorkspace.value = ws
}

function onNewTab(cwd?: string) {
  emit('new-tab', cwd)
}

const selectedWorkspacePath = computed(() => {
  const sel = selectedWorkspaceId.value
  if (!sel) return null
  if (sel === DEFAULT_WORKSPACE_ID) return defaultWorkspace.value.path || null
  return workspaces.value.find((w) => w.id === sel)?.path ?? null
})

function onNewTabForSelected() {
  const sel = selectedWorkspaceId.value
  if (sel === DEFAULT_WORKSPACE_ID || sel === null) {
    // Pass the default workspace's path explicitly and signal
    // `workspaceId = null` so `newTab` skips the active-workspace SSH
    // auto-connect and the `activeWorkspacePath` cwd fallback. Without
    // this, the tab would inherit the previously confirmed workspace's
    // path and be attributed to it.
    emit('new-tab', defaultWorkspace.value.path || undefined, null)
  } else {
    const ws = workspaces.value.find((w) => w.id === sel)
    if (ws?.connection_id) {
      emit('new-tab-ssh', ws.connection_id, ws.path, sel)
    } else {
      emit('new-tab', ws?.path, sel)
    }
  }
}

function onKeydown(e: KeyboardEvent) {
  // While the server picker is open it owns the keyboard. It lives in the
  // status bar, underneath this backdrop, so its own Up/Down/Enter/Escape
  // handler sits on `window` - which only runs *after* this one. Without the
  // gate, Up/Down would also drive workspace navigation, Enter would confirm a
  // tab, and Escape would become the Cancel op and close MC server-side for
  // every client.
  if (serverPickerOpen.value) {
    if ((e.key === 's' || e.key === 'Escape') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      closeServerPicker()
    }
    return
  }

  switch (e.key) {
    case 'ArrowUp':
      // Workspace nav: previous workspace. Backend cycles through
      // [None (=default), ...ws_ids] and resets selected_tab_id.
      // Up/Down maps to the vertical workspace list in MC.
      e.preventDefault()
      sendMcOp({ kind: 'navigate', dir: 'up' })
      return
    case 'ArrowDown':
      e.preventDefault()
      sendMcOp({ kind: 'navigate', dir: 'down' })
      return
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Enter':
      // Delegate to TabOverview for tab navigation (Left/Right = linear
      // tab nav, Enter = confirm). TabOverview sends its own sync ops.
      tabOverviewRef.value?.onKeydown(e)
      break
    case 'n':
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onNewTabForSelected()
      }
      break
    case 's':
      // The server picker - the same one the status-bar chip opens, not a
      // second implementation of it. Device-level local view state,
      // deliberately not an McOp: the roster and the active server belong to
      // this device, not to the server's own MissionControlState. It is also
      // the way out when the sync WS is down and the grid has been replaced by
      // the disconnected panel.
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleServerPicker()
      }
      break
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      {
        const wsId = selectedWorkspaceId.value
        if (wsId !== null && wsId !== DEFAULT_WORKSPACE_ID) {
          const ws = workspaces.value.find((w) => w.id === wsId)
          if (ws) {
            uiConfirm(t('workspace.confirmDelete').replace('{name}', ws.name), {
              title: t('workspace.delete'),
              confirmText: t('workspace.delete'),
              cancelText: t('filePreview.cancel'),
            }).then((ok) => {
              if (ok)
                deleteWorkspace(wsId).catch((e) => console.error('Failed to delete workspace:', e))
            })
          }
        }
      }
      break
    case 'Escape':
      e.preventDefault()
      // Cancel closes MC server-side; the toggled broadcast mirrors the
      // new `open: false` back to us.
      sendMcOp({ kind: 'cancel' })
      break
  }
}
</script>

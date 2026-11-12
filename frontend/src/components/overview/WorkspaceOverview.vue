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
        ref="dualRef"
        class="mc-ws-dual"
        :style="dualStyle"
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
        <div v-if="syncConnected" class="mc-mobile-ws-head">
          <div class="mc-mobile-ws-top">
            <button
              class="mc-mobile-ws-current"
              type="button"
              :aria-label="`${t('workspace.switch')}: ${selectedWorkspace.name}`"
              @click="openWorkspacePicker(false)"
            >
              <WorkspaceBadge
                :remote="!!selectedWorkspace.connection_id"
                :abbr="resolveAbbr(selectedWorkspace)"
                :color="resolveColor(selectedWorkspace)"
                :size="18"
              />
              <span class="mc-mobile-ws-name">{{ selectedWorkspace.name }}</span>
              <span v-if="selectedWorkspaceCount" class="mc-mobile-ws-count">
                {{ selectedWorkspaceCount }}
              </span>
              <ChevronDown :size="14" class="mc-mobile-ws-caret" />
            </button>
            <button
              class="mc-mobile-ws-search"
              type="button"
              :aria-label="t('workspace.search')"
              @click="openWorkspacePicker(true)"
            >
              <Search :size="16" />
            </button>
          </div>
          <div v-if="recentWorkspaceChips.length" class="mc-mobile-ws-recents">
            <span class="mc-mobile-ws-recent-label">{{ t('workspace.recent') }}</span>
            <button
              v-for="ws in recentWorkspaceChips"
              :key="ws.id"
              class="mc-mobile-ws-recent"
              type="button"
              @click="onSelectWorkspace(ws.id)"
            >
              <WorkspaceBadge
                :remote="!!ws.connection_id"
                :abbr="resolveAbbr(ws)"
                :color="resolveColor(ws)"
                :size="14"
              />
              <span class="mc-mobile-ws-recent-name">{{ ws.name }}</span>
            </button>
          </div>
        </div>
        <WorkspaceList
          v-if="syncConnected"
          ref="workspaceListRef"
          :workspaces="workspaces"
          :selected-id="selectedWorkspaceId"
          :active-id="activeWorkspaceId"
          :tab-counts="tabCounts"
          :default-count="defaultCount"
          @select="onSelectWorkspace"
          @add="onAddWorkspace"
          @rename="onRenameWorkspace"
        />
        <div
          v-if="syncConnected"
          class="mc-ws-resizer"
          :class="{ active: resizingWsPane }"
          role="separator"
          aria-orientation="vertical"
          :aria-label="t('workspace.resizeList')"
          :aria-valuemin="WS_PANE_MIN_WIDTH"
          :aria-valuemax="wsPaneMaxWidth"
          :aria-valuenow="wsPaneWidth"
          tabindex="0"
          @pointerdown="onResizerPointerDown"
          @keydown="onResizerKeydown"
          @dblclick="resetWsPaneWidth"
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
            @close-terminal="(id: string) => $emit('close-terminal', id)"
            @rename-tab="onRenameTab"
            @new-tab="onNewTabForSelected"
          />
        </div>
      </Motion>
    </Motion>
  </AnimatePresence>
  <WorkspacePickerSheet
    :visible="workspacePickerOpen"
    :workspaces="allWorkspaces"
    :selected-id="selectedWorkspaceId"
    :tab-counts="tabCounts"
    :recent-ids="recentWorkspaceIdList"
    :focus-search="workspacePickerFocusSearch"
    @close="workspacePickerOpen = false"
    @select="onWorkspacePickerSelect"
    @add="onWorkspacePickerAdd"
  />
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
import { ChevronDown, Search, Server, Unplug, X } from 'lucide-vue-next'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../../composables/useWorkspaces'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { useDetachedWindowsStore } from '../../stores/detachedWindowsStore'
import { useTabPreview, type TabCard } from '../../composables/useTabPreview'
import { resolveAbbr, resolveColor } from '../../utils/workspaceIcon'
import { useMissionControlState, sendMcOp } from '../../composables/useMissionControlState'
import {
  closeServerPicker,
  serverPickerOpen,
  toggleServerPicker,
} from '../../composables/useAppCore'
import { getAllLeaves } from '../../types/pane'
import type { Workspace } from '../../types/workspace'
import WorkspaceList from './WorkspaceList.vue'
import WorkspacePickerSheet from './WorkspacePickerSheet.vue'
import TabOverview from './TabOverview.vue'
import WorkspaceBadge from '../WorkspaceBadge.vue'
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
  'close-terminal': [paneId: string]
  'new-tab': [cwd?: string, workspaceId?: string | null]
  'new-tab-ssh': [connectionId: string, initialCwd?: string, workspaceId?: string]
  'rename-tab': [paneId: string, title: string]
}>()

const { workspaces, defaultWorkspace, activeWorkspaceId, matchWorkspace, deleteWorkspace } =
  useWorkspaces()
const { t } = useI18n()
const session = useSessionStore()
const ui = useUiStore()
const detachedStore = useDetachedWindowsStore()
const tabPreview = useTabPreview()
const mcState = useMissionControlState()

// The workspace/tab grid is rebuilt from the active server's state; while the
// sync WS is down there is nothing to render and nothing to drive it, so the
// grid is replaced by the disconnected panel, which offers the status bar's
// server picker as the way out.
const syncConnected = computed(() => ui.syncConnected)

const closing = ref(false)
const backdropRef = ref<any>(null)
const dualRef = ref<any>(null)
const tabOverviewRef = ref<InstanceType<typeof TabOverview> | null>(null)
const workspaceListRef = ref<InstanceType<typeof WorkspaceList> | null>(null)
const showCreateDialog = ref(false)
const renamingWorkspace = ref<Workspace | null>(null)
const switchDirection = ref<'left' | 'right'>('right')

// ── Workspace / tab split resizer ─────────────────────────────
// The workspace list is user-resizable via a drag handle between the two
// panes. The width is a device preference, persisted rather than synced: two
// clients on different screens want different splits. It reaches CSS through
// `--mc-ws-list-width` so the mobile chip-row layout (max-width: 600px) can
// keep overriding the width wholesale.
const WS_PANE_DEFAULT_WIDTH = 200
const WS_PANE_MIN_WIDTH = 140
/** Keep at least one column of tab cards visible in the right panel. */
const WS_PANE_MIN_RIGHT_WIDTH = 320
/** Keep in sync with `.mc-ws-resizer` in mission-control.css. */
const WS_RESIZER_WIDTH = 8
/** Used for clamping until the overlay has been laid out (clientWidth = 0). */
const WS_PANE_MAX_FALLBACK = 1200
const WS_PANE_WIDTH_STORAGE_KEY = 'dinotty_mc_ws_width_v1'
/** Device-local MRU for the mobile header chips / picker sheet. */
const RECENT_WORKSPACES_STORAGE_KEY = 'dinotty_mc_recent_workspaces_v1'
const MAX_RECENT_WORKSPACES = 5

const wsPaneWidth = ref(WS_PANE_DEFAULT_WIDTH)
const dualWidth = ref(0)
const resizingWsPane = ref(false)

const dualStyle = computed<Record<string, string>>(() => ({
  '--mc-ws-list-width': `${wsPaneWidth.value}px`,
}))

const wsPaneMaxWidth = computed(() => {
  if (dualWidth.value <= 0) return WS_PANE_MAX_FALLBACK
  return Math.max(WS_PANE_MIN_WIDTH, dualWidth.value - WS_RESIZER_WIDTH - WS_PANE_MIN_RIGHT_WIDTH)
})

function clampWsPaneWidth(px: number): number {
  if (!Number.isFinite(px)) return WS_PANE_DEFAULT_WIDTH
  return Math.round(Math.min(Math.max(px, WS_PANE_MIN_WIDTH), wsPaneMaxWidth.value))
}

function loadWsPaneWidth() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(WS_PANE_WIDTH_STORAGE_KEY)
    const stored = raw === null ? NaN : Number(raw)
    if (Number.isFinite(stored)) wsPaneWidth.value = clampWsPaneWidth(stored)
  } catch {
    // localStorage may be unavailable (private mode); keep the default.
  }
}

loadWsPaneWidth()

function persistWsPaneWidth() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WS_PANE_WIDTH_STORAGE_KEY, String(wsPaneWidth.value))
  } catch {
    // Persistence is best-effort.
  }
}

function measureDualWidth() {
  const el = dualRef.value?.$el as HTMLElement | undefined
  dualWidth.value = el?.clientWidth ?? 0
}

function reclampWsPaneWidth() {
  measureDualWidth()
  wsPaneWidth.value = clampWsPaneWidth(wsPaneWidth.value)
}

let resizeStartX = 0
let resizeStartWidth = 0

function onResizerPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  measureDualWidth()
  resizeStartX = e.clientX
  resizeStartWidth = wsPaneWidth.value
  resizingWsPane.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  try {
    ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  } catch {
    // Pointer capture is an optimisation; window listeners cover the drag.
  }
  window.addEventListener('pointermove', onResizerPointerMove)
  window.addEventListener('pointerup', stopWsPaneResize)
  window.addEventListener('pointercancel', stopWsPaneResize)
}

function onResizerPointerMove(e: PointerEvent) {
  if (!resizingWsPane.value) return
  wsPaneWidth.value = clampWsPaneWidth(resizeStartWidth + (e.clientX - resizeStartX))
}

function stopWsPaneResize() {
  if (!resizingWsPane.value) return
  resizingWsPane.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.removeEventListener('pointermove', onResizerPointerMove)
  window.removeEventListener('pointerup', stopWsPaneResize)
  window.removeEventListener('pointercancel', stopWsPaneResize)
  // Persist once per gesture, not on every pointermove.
  persistWsPaneWidth()
}

function onResizerKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 32 : 8
  let next: number
  switch (e.key) {
    case 'ArrowLeft':
      next = wsPaneWidth.value - step
      break
    case 'ArrowRight':
      next = wsPaneWidth.value + step
      break
    case 'Home':
      next = WS_PANE_MIN_WIDTH
      break
    case 'End':
      next = wsPaneMaxWidth.value
      break
    default:
      return
  }
  e.preventDefault()
  // The overlay's document-level handler turns ArrowLeft/Right into tab
  // navigation; the separator owns the keys while it has focus.
  e.stopPropagation()
  wsPaneWidth.value = clampWsPaneWidth(next)
  persistWsPaneWidth()
}

function resetWsPaneWidth() {
  wsPaneWidth.value = clampWsPaneWidth(WS_PANE_DEFAULT_WIDTH)
  persistWsPaneWidth()
}

function loadRecentWorkspaceIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    // localStorage may be unavailable (private mode); start empty.
    return []
  }
}

function rememberRecentWorkspace(id: string | null) {
  const key = id ?? DEFAULT_WORKSPACE_ID
  const next = [key, ...recentWorkspaceIds.value.filter((existing) => existing !== key)].slice(
    0,
    MAX_RECENT_WORKSPACES
  )
  recentWorkspaceIds.value = next
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Persistence is best-effort.
  }
}

// Selected workspace derives from the global MC state. `null` selected_workspace_id
// means the default workspace (`__default__`). Local mutation is intentionally
// forbidden - all changes come from `selection_changed` broadcasts.
const selectedWorkspaceId = computed(() => mcState.selectedWorkspaceId ?? DEFAULT_WORKSPACE_ID)

// Mobile workspace switcher (≤600px). The desktop split still renders the full
// vertical WorkspaceList; on phones the chip row is replaced by a single
// current-workspace button plus a searchable bottom sheet, because a long
// horizontal strip hides the target and the current selection off-screen.
const allWorkspaces = computed<Workspace[]>(() => [defaultWorkspace.value, ...workspaces.value])
const selectedWorkspace = computed<Workspace>(
  () =>
    allWorkspaces.value.find((ws) => ws.id === selectedWorkspaceId.value) ?? defaultWorkspace.value
)
const workspacePickerOpen = ref(false)
/** The header's magnifier opens the same sheet in search mode. */
const workspacePickerFocusSearch = ref(false)
const recentWorkspaceIds = ref<string[]>(loadRecentWorkspaceIds())

// Backend selection is broadcast-driven, so this also captures switches made
// from another device or the keyboard. `onSelectWorkspace` records the tap
// immediately as well, so the MRU order reacts without waiting for the round
// trip.
watch(selectedWorkspaceId, (id) => rememberRecentWorkspace(id))

// The overlay is the only keyboard surface while MC is open.
//
// This is a document listener rather than a `keydown` binding on the container:
// the overlay holds `tabindex="0"`, but clicking any child moves focus there,
// so after mouse use an overlay-level binding never fires and the shortcuts go
// dead. Scoping by `backdrop.contains(e.target)` also keeps the global
// touchscreen keyboard (rendered outside this component) out of it.
onMounted(() => {
  document.addEventListener('keydown', onDocKeydown)
  // The overlay is sized from the viewport, so a window resize is the only
  // thing that changes the space the panes have to share.
  window.addEventListener('resize', reclampWsPaneWidth)
  nextTick(reclampWsPaneWidth)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('resize', reclampWsPaneWidth)
  stopWsPaneResize()
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
      nextTick(() => {
        backdropRef.value?.$el?.focus?.()
        // The overlay is re-created on each open (v-if), so the split width
        // has to be measured and re-clamped against the current viewport.
        reclampWsPaneWidth()
      })
      // Defer capture so the overlay animation starts without blocking
      setTimeout(() => {
        if (props.visible) {
          allCards.value = tabPreview.captureAll(session.tabs, props.termRefs)
        }
      }, 0)
    } else {
      closing.value = true
      // The picker sits above the overlay (teleported dialog); closing MC from
      // another client or a shortcut must not leave it floating on its own.
      workspacePickerOpen.value = false
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

// Detaching unmounts the pane (nothing to capture) and reattaching remounts it.
// Re-snapshot on that transition so the placeholder appears/disappears without
// reopening Mission Control.
watch(
  () => detachedStore.detachedTabIds,
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
  // Counts deliberately read the full session list: a tab detached into its
  // own window still belongs to its workspace and must keep its count.
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

const selectedWorkspaceCount = computed(() => tabCounts.value[selectedWorkspaceId.value] ?? 0)

const recentWorkspaces = computed<Workspace[]>(() => {
  const byId = new Map(allWorkspaces.value.map((ws) => [ws.id, ws]))
  return recentWorkspaceIds.value.map((id) => byId.get(id)).filter((ws): ws is Workspace => !!ws)
})

// One tap switches to the last two workspaces; the selected one is already the
// header button, so it is skipped here rather than repeated.
const recentWorkspaceChips = computed(() =>
  recentWorkspaces.value.filter((ws) => ws.id !== selectedWorkspaceId.value).slice(0, 2)
)
const recentWorkspaceIdList = computed(() => recentWorkspaces.value.map((ws) => ws.id))

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
  // Reindex for display (1-based) and overlay the live detached state. Reading
  // the store here (rather than only in `captureAll`) keeps the badge reactive
  // when a tab is detached or reattached while Mission Control stays open.
  return cards.map((card, i) => ({
    ...card,
    index: i + 1,
    detached: detachedStore.isDetached(card.paneId),
    windowLabel: detachedStore.windowTitleOf(card.paneId),
  }))
})

function onSelectWorkspace(id: string | null) {
  // Track direction for card slide animation - local UI concern, no sync.
  const ids = [DEFAULT_WORKSPACE_ID, ...workspaces.value.map((w) => w.id)]
  const oldIdx = ids.indexOf(selectedWorkspaceId.value ?? DEFAULT_WORKSPACE_ID)
  const newIdx = ids.indexOf(id ?? DEFAULT_WORKSPACE_ID)
  switchDirection.value = newIdx >= oldIdx ? 'right' : 'left'

  // Device-local MRU: update on the user's tap instead of waiting for the
  // broadcast, so the chips reorder immediately.
  rememberRecentWorkspace(id)

  // Send a Jump op - the backend updates selected_workspace_id, resets
  // selected_tab_id, and broadcasts `selection_changed` to all clients
  // (including us). We do NOT mutate selectedWorkspaceId locally - the
  // computed reflects mcState, which is updated by the broadcast.
  const targetWsId = id === DEFAULT_WORKSPACE_ID ? null : id
  sendMcOp({ kind: 'jump', workspace_id: targetWsId })
}

function openWorkspacePicker(focusSearch: boolean) {
  workspacePickerFocusSearch.value = focusSearch
  workspacePickerOpen.value = true
}

function onWorkspacePickerSelect(id: string) {
  workspacePickerOpen.value = false
  onSelectWorkspace(id)
}

function onWorkspacePickerAdd() {
  workspacePickerOpen.value = false
  onAddWorkspace()
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

  // The workspace search field lives inside the backdrop, so every unhandled
  // key would otherwise drive an MC shortcut (`s` server picker, `n` new tab,
  // arrows, Delete). Let the field own its keystrokes. Escape is the exception:
  // the field stops propagation while it has a query to clear, and lets the
  // event through when empty so the next Escape closes MC.
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
    e.key !== 'Escape'
  ) {
    return
  }

  switch (e.key) {
    case '/':
      if (!e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        workspaceListRef.value?.focusSearch()
      }
      break
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

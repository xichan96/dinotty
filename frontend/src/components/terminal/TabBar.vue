<template>
  <div id="tab-bar" class="tab-bar">
    <!-- Mobile compact mode -->
    <template v-if="isMobile">
      <button class="mc-trigger" @click="$emit('open-overview')">
      <WorkspaceBadge
        v-if="showWsMonogram && activeWorkspaceColor"
        :abbr="activeWorkspaceAbbr"
        :color="activeWorkspaceColor"
        :size="16"
        card-bg-var="--tab-bg"
      />
      <LayoutDashboard v-else :size="16" />
      </button>
      <span class="current-tab-index">{{ currentTabIndex }}</span>
      <span
        v-if="showWsBadge && currentWorkspace"
        class="tab-ws-badge mobile"
        :title="currentWorkspace.name"
      >
        <span
          class="tab-ws-dot"
          :style="{ background: currentWorkspace.color ?? 'var(--accent, #8a8a8a)' }"
        ></span>
        <span v-if="currentWorkspace.remote" class="tab-ws-remote">
          <Server :size="9" />
        </span>
        <span v-if="currentWorkspace.abbr" class="tab-ws-abbr">{{ currentWorkspace.abbr }}</span>
      </span>
      <span class="current-tab-name">{{ currentTabTitle }}</span>
    </template>
    <!-- Desktop mode: full tab list -->
    <template v-else>
    <button class="mc-trigger desktop-mc" @click="$emit('open-overview')">
        <WorkspaceBadge
          v-if="showWsMonogram && activeWorkspaceColor"
          :abbr="activeWorkspaceAbbr"
          :color="activeWorkspaceColor"
          :size="16"
          card-bg-var="--tab-bg"
        />
        <LayoutDashboard v-else :size="16" />
    </button>
    <div
      id="tabs-list"
      ref="tabsListRef"
      :class="{ 'fade-start': fadeStart, 'fade-end': fadeEnd }"
    >
      <div
        v-for="tab in tabs"
        :key="tab.paneId"
        class="tab"
        :class="{ active: tab.paneId === activePaneId, 'drag-over': dragOverId === tab.paneId }"
        :data-pane-id="tab.paneId"
        :data-tab-id="tab.paneId"
        @mousedown.prevent="onTabMouseDown($event, tab.paneId)"
        @touchstart="onTabTouchStart($event, tab.paneId)"
        @click="onTabClick($event, tab.paneId)"
        @touchend.prevent="onTabTouchEnd($event, tab.paneId)"
        @contextmenu.prevent="openTabCtx($event, tab)"
      >
        <span class="tab-index">{{ tab.index }}</span>
        <span
          v-if="showWsBadge && tab.workspace"
          class="tab-ws-badge"
          :title="tab.workspace.name"
        >
          <span
            class="tab-ws-dot"
            :style="{ background: tab.workspace.color ?? 'var(--accent, #8a8a8a)' }"
          ></span>
          <span v-if="tab.workspace.remote" class="tab-ws-remote">
            <Server :size="9" />
          </span>
          <span v-if="tab.workspace.abbr" class="tab-ws-abbr">{{ tab.workspace.abbr }}</span>
        </span>
        <Puzzle v-if="tab.type === 'plugin'" :size="12" class="tab-plugin-icon" />
        <Server v-else-if="tab.shellType === 'ssh'" :size="12" class="tab-ssh-icon" />
        <input
          v-if="editingPaneId === tab.paneId"
          ref="editInputRef"
          class="tab-title-input"
          :value="editValue"
          @input="editValue = ($event.target as HTMLInputElement).value"
          @blur="finishEdit(tab.paneId)"
          @keydown.enter="finishEdit(tab.paneId)"
          @keydown.escape.stop="cancelEdit"
          @mousedown.stop
          @click.stop
        />
        <span
          v-else
          class="tab-title"
          @dblclick="startEdit(tab)"
        >{{ tab.title }}</span>
        <span
          v-if="indicators[tab.paneId]"
          class="tab-notif-dot"
          :class="'dot-' + indicators[tab.paneId]"
        ></span>
        <button
          v-if="editingPaneId !== tab.paneId"
          class="tab-close"
          @click.stop="$emit('close', tab.paneId)"
          @touchend.stop.prevent="$emit('close', tab.paneId)"
        >
          <X :size="10" />
        </button>
      </div>
    </div>
    </template>
    <slot name="left" />
    <div class="new-tab-split" ref="newMenuWrapRef">
      <button
        id="tab-new-btn"
        :title="`${t('keybinding.newTab')} (${kbdNewTab})`"
        @click="newMenuOpen = !newMenuOpen"
        @touchend.prevent="newMenuOpen = !newMenuOpen"
      >
        <Terminal :size="16" />
      </button>
      <div v-if="newMenuOpen" class="new-menu-dropdown" :class="{ 'align-right': newMenuAlignRight }">
        <div
          class="new-menu-item"
          @click="emitAction('new-tab')"
          @touchend.prevent="emitAction('new-tab')"
        >
          <Terminal :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.newTab') }}</span>
          <kbd class="new-menu-kbd">{{ kbdNewTab }}</kbd>
        </div>
        <div class="new-menu-sep" />
        <div
          class="new-menu-item"
          @click="emitAction('split-h')"
          @touchend.prevent="emitAction('split-h')"
        >
          <Columns2 :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.splitHorizontal') }}</span>
          <kbd class="new-menu-kbd">{{ kbdSplitH }}</kbd>
        </div>
        <div
          class="new-menu-item"
          @click="emitAction('split-v')"
          @touchend.prevent="emitAction('split-v')"
        >
          <Rows2 :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('keybinding.splitVertical') }}</span>
          <kbd class="new-menu-kbd">{{ kbdSplitV }}</kbd>
        </div>
        <template v-if="canBroadcast">
          <div class="new-menu-sep" />
          <div
            class="new-menu-item"
            @click="emitAction('broadcast')"
            @touchend.prevent="emitAction('broadcast')"
          >
            <Radio :size="14" class="new-menu-icon" />
            <span class="new-menu-label">{{ t('split.toggleBroadcast') }}</span>
            <kbd class="new-menu-kbd">{{ kbdBroadcast }}</kbd>
          </div>
          <div v-if="broadcastActive" class="new-menu-status">{{ t('split.broadcastActive') }}</div>
        </template>
        <div class="new-menu-sep" />
        <div
          class="new-menu-item"
          @click="emitAction('ssh-connect')"
          @touchend.prevent="emitAction('ssh-connect')"
        >
          <Globe :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('palette.sshConnect') }}</span>
          <kbd class="new-menu-kbd">{{ kbdSshConnect }}</kbd>
        </div>
        <div class="new-menu-sep" />
        <div
          class="new-menu-item"
          @click="$emit('apply-template')"
          @touchend.prevent="$emit('apply-template')"
        >
          <LayoutTemplate :size="14" class="new-menu-icon" />
          <span class="new-menu-label">{{ t('palette.fromTemplate') }}</span>
        </div>
      </div>
    </div>
    <div v-if="plugins.length > 0" class="tab-bar-plugin-wrap" ref="pluginWrapRef">
      <button
        type="button"
        class="tab-bar-icon-btn"
        title="Plugins"
        @click="pluginMenuOpen = !pluginMenuOpen"
        @touchend.prevent="pluginMenuOpen = !pluginMenuOpen"
      >
        <Puzzle :size="16" />
      </button>
      <div v-if="pluginMenuOpen" class="plugin-dropdown">
        <div
          v-for="p in plugins"
          :key="p.id"
          class="plugin-dropdown-item"
          @click="
            $emit('open-plugin', p.id);
            pluginMenuOpen = false;
          "
          @touchend.prevent="
            $emit('open-plugin', p.id);
            pluginMenuOpen = false;
          "
        >
          <span class="plugin-dropdown-name">{{ p.name }}</span>
          <span v-if="p.description" class="plugin-dropdown-desc">{{ p.description }}</span>
        </div>
      </div>
    </div>
    <slot name="right"></slot>
  </div>
  <ContextMenu
    :visible="ctxVisible"
    :x="ctxX"
    :y="ctxY"
    :items="ctxItems"
    @close="ctxVisible = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  X,
  Terminal,
  Puzzle,
  Columns2,
  Rows2,
  Radio,
  LayoutDashboard,
  Globe,
  Server,
  Pencil,
  Layers,
  ArrowLeftToLine,
  ArrowRightToLine,
  Square,
  Save,
  LayoutTemplate,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import { useSettingsStore } from '../../stores'
import { resolveWorkspaceBadgeMode } from '../../composables/useWorkspaceBadgeMode'
import { uiConfirm } from '../../composables/useConfirm'
import { usePaneDrag } from '../../composables/paneDragContext'
import WorkspaceBadge from '../WorkspaceBadge.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'
import { useTabDrag } from '../../composables/useTabDrag'

const { t } = useI18n()
const { getBinding, formatBinding } = useKeybindings()
const settingsStore = useSettingsStore()
const kbdNewTab = formatBinding(getBinding('newTab')).join('')
const kbdSplitH = formatBinding(getBinding('splitHorizontal')).join('')
const kbdSplitV = formatBinding(getBinding('splitVertical')).join('')
const kbdBroadcast = formatBinding(getBinding('toggleBroadcast')).join('')
const kbdSshConnect = formatBinding(getBinding('sshConnect')).join('')

export interface TabInfo {
  paneId: string
  title: string
  index: number
  type: 'terminal' | 'plugin'
  shellType?: string // "ssh" for SSH tabs
  workspace?: {
    id: string
    abbr?: string
    name: string
    color?: string
    remote?: boolean
  }
}

export interface PluginInfo {
  id: string
  name: string
  description?: string
  icon?: string
  state: string
}

const props = withDefaults(
  defineProps<{
    tabs: TabInfo[]
    activePaneId: string | null
    indicators?: Record<string, string>
    plugins?: PluginInfo[]
    canBroadcast?: boolean
    broadcastActive?: boolean
    isMobile?: boolean
    currentTabTitle?: string
    currentTabIndex?: number
    activeWorkspaceAbbr?: string
    activeWorkspaceColor?: string
  }>(),
  {
    indicators: () => ({}),
    plugins: () => [],
    canBroadcast: false,
    broadcastActive: false,
    isMobile: false,
    currentTabTitle: '',
    currentTabIndex: 0,
    activeWorkspaceAbbr: '',
    activeWorkspaceColor: undefined,
  }
)

const wsBadgeMode = computed(() =>
  resolveWorkspaceBadgeMode(settingsStore.settings.workspace_badge_mode, props.isMobile)
)
const showWsBadge = computed(() => wsBadgeMode.value.showTabBadge)
const showWsMonogram = computed(() => wsBadgeMode.value.showMonogram)

const currentWorkspace = computed(() => {
  const tab = props.tabs.find((t) => t.paneId === props.activePaneId)
  return tab?.workspace
})

const emit = defineEmits<{
  activate: [paneId: string]
  close: [paneId: string]
  action: [
    type:
      | 'new-tab'
      | 'split-h'
      | 'split-v'
      | 'broadcast'
      | 'ssh-connect',
  ]
  reorder: [fromId: string, toId: string]
  'merge-tab-into-pane': [srcTabId: string, targetPaneId: string, direction: 'left' | 'right' | 'top' | 'bottom']
  'open-plugin': [pluginId: string]
  rename: [paneId: string, title: string]
  'open-overview': []
  'close-tabs': [paneIds: string[]]
  'save-as-template': [tabId: string]
  'apply-template': []
}>()

const tabsListRef = ref<HTMLElement | null>(null)
const fadeStart = ref(false)
const fadeEnd = ref(false)
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

function updateFades() {
  const tabsList = tabsListRef.value
  if (!tabsList) return

  const { scrollLeft, scrollWidth, clientWidth } = tabsList
  fadeStart.value = scrollLeft > 1
  fadeEnd.value = scrollLeft + clientWidth < scrollWidth - 1
}

function onTabsWheel(e: WheelEvent) {
  const tabsList = tabsListRef.value
  if (!tabsList) return
  if (tabsList.scrollWidth <= tabsList.clientWidth) return
  let deltaX = e.deltaX
  let deltaY = e.deltaY
  if (e.deltaMode === 1) {
    deltaX *= 16
    deltaY *= 16
  } else if (e.deltaMode === 2) {
    deltaX *= tabsList.clientWidth
    deltaY *= tabsList.clientWidth
  }
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY
  if (delta === 0) return
  e.preventDefault()
  tabsList.scrollLeft += delta
  updateFades()
}

watch(
  () => props.tabs.length,
  () => {
    nextTick(updateFades)
  }
)

watch(
  tabsListRef,
  (tabsList, previousTabsList) => {
    previousTabsList?.removeEventListener('scroll', updateFades)
    previousTabsList?.removeEventListener('wheel', onTabsWheel)
    tabsList?.addEventListener('scroll', updateFades, { passive: true })
    tabsList?.addEventListener('wheel', onTabsWheel, { passive: false })
    nextTick(updateFades)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('resize', updateFades)
})

function findTabElement(paneId: string): HTMLElement | undefined {
  return Array.from(tabsListRef.value?.querySelectorAll<HTMLElement>('.tab[data-pane-id]') ?? [])
    .find((tab) => tab.dataset.paneId === paneId)
}

function hasTab(paneId: string): boolean {
  return !!findTabElement(paneId)
}

const editingPaneId = ref<string | null>(null)
const editValue = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

function onDocMouseDown(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (!el.closest('.tab-title-input')) {
    finishEditIfAny()
  }
}

function finishEditIfAny() {
  if (editingPaneId.value != null) {
    finishEdit(editingPaneId.value)
  }
}

function startEdit(tab: TabInfo) {
  if (tab.type !== 'terminal') return
  editingPaneId.value = tab.paneId
  editValue.value = tab.title
  document.addEventListener('mousedown', onDocMouseDown)
  nextTick(() => {
    const input = editInputRef.value
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function openTabCtx(e: MouseEvent, tab: TabInfo) {
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  const idx = props.tabs.findIndex((t) => t.paneId === tab.paneId)
  const workspaceTabs = props.tabs.filter((t) => t.type !== 'plugin')
  const leftTabs = props.tabs.slice(0, idx).filter((t) => t.type !== 'plugin')
  const rightTabs = props.tabs.slice(idx + 1).filter((t) => t.type !== 'plugin')
  const closeWorkspaceLabel = t('overview.closeWorkspaceTabs')
  const closeLeftLabel = t('overview.closeTabsLeft')
  const closeRightLabel = t('overview.closeTabsRight')

  async function confirmCloseTabs(label: string, targets: TabInfo[]) {
    const ok = await uiConfirm(
      t('overview.confirmCloseTabs').replace('{count}', String(targets.length)),
      {
        title: label,
        confirmText: t('overview.closeTabsConfirm'),
        cancelText: t('filePreview.cancel'),
      },
    )
    if (!ok) return
    emit('close-tabs', targets.map((x) => x.paneId))
  }

  function currentSideTabs(side: 'left' | 'right'): TabInfo[] | null {
    const currentTabs = props.tabs
    const currentIdx = currentTabs.findIndex((t) => t.paneId === tab.paneId)
    if (currentIdx === -1) return null
    const sideTabs =
      side === 'left' ? currentTabs.slice(0, currentIdx) : currentTabs.slice(currentIdx + 1)
    return sideTabs.filter((t) => t.type !== 'plugin')
  }

  ctxItems.value = [
    {
      label: t('palette.rename'),
      icon: Pencil,
      action: () => startEdit(tab),
    },
    {
      label: closeWorkspaceLabel,
      icon: Layers,
      disabled: workspaceTabs.length === 0,
      action: () => confirmCloseTabs(
        closeWorkspaceLabel,
        props.tabs.filter((t) => t.type !== 'plugin'),
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
      label: t('palette.saveAsTemplate'),
      icon: Save,
      disabled: tab.type !== 'terminal',
      action: () => emit('save-as-template', tab.paneId),
    },
    {
      label: t('overview.closeTab'),
      icon: Square,
      danger: true,
      action: () => emit('close', tab.paneId),
    },
  ]
  ctxVisible.value = true
}

function finishEdit(paneId: string) {
  if (editingPaneId.value !== paneId) return
  const val = editValue.value.trim()
  editingPaneId.value = null
  document.removeEventListener('mousedown', onDocMouseDown)
  if (val) emit('rename', paneId, val)
}

function cancelEdit() {
  editingPaneId.value = null
  document.removeEventListener('mousedown', onDocMouseDown)
}

const pluginMenuOpen = ref(false)
const pluginWrapRef = ref<HTMLElement>()
const newMenuOpen = ref(false)
const newMenuAlignRight = ref(false)
const newMenuWrapRef = ref<HTMLElement>()

function emitAction(
  type:
    | 'new-tab'
    | 'split-h'
    | 'split-v'
    | 'broadcast'
    | 'ssh-connect'
) {
  emit('action', type)
  newMenuOpen.value = false
}

function onDocTouchStart(e: TouchEvent) {
  if (pluginWrapRef.value && !pluginWrapRef.value.contains(e.target as Node)) {
    pluginMenuOpen.value = false
  }
  if (newMenuWrapRef.value && !newMenuWrapRef.value.contains(e.target as Node)) {
    newMenuOpen.value = false
  }
}

function onDocMenuMouseDown(e: MouseEvent) {
  if (pluginWrapRef.value && !pluginWrapRef.value.contains(e.target as Node)) {
    pluginMenuOpen.value = false
  }
  if (newMenuWrapRef.value && !newMenuWrapRef.value.contains(e.target as Node)) {
    newMenuOpen.value = false
  }
}

watch([pluginMenuOpen, newMenuOpen], ([pluginOpen, newOpen]) => {
  if (pluginOpen || newOpen) {
    document.addEventListener('touchstart', onDocTouchStart, { passive: true })
    document.addEventListener('mousedown', onDocMenuMouseDown)
  } else {
    document.removeEventListener('touchstart', onDocTouchStart)
    document.removeEventListener('mousedown', onDocMenuMouseDown)
  }
  if (newOpen) {
    nextTick(() => {
      const wrap = newMenuWrapRef.value
      if (wrap) {
        const rect = wrap.getBoundingClientRect()
        newMenuAlignRight.value = rect.right + 220 > window.innerWidth
      }
    })
  }
})

const drag = usePaneDrag()

const {
  dragOverId,
  scrollTabIntoView,
  onTabMouseDown,
  onTabTouchStart,
  onTabClick,
  onTabTouchEnd,
  cleanup: cleanupDrag,
} = useTabDrag({
  drag,
  activePaneId: computed(() => props.activePaneId),
  findTabElement,
  onActivate: (paneId: string) => emit('activate', paneId),
  onReorder: (fromId: string, toId: string) => emit('reorder', fromId, toId),
  onMergeTabIntoPane: (tabId: string, paneId: string, zone) =>
    emit('merge-tab-into-pane', tabId, paneId, zone),
})

defineExpose({ hasTab, scrollTabIntoView })

onBeforeUnmount(() => {
  cleanupDrag()
  tabsListRef.value?.removeEventListener('scroll', updateFades)
  tabsListRef.value?.removeEventListener('wheel', onTabsWheel)
  window.removeEventListener('resize', updateFades)
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('mousedown', onDocMenuMouseDown)
  document.removeEventListener('touchstart', onDocTouchStart)
})
</script>

<style scoped>
.tab-index {
  font-size: 10px;
  color: var(--text-muted, #888);
  min-width: 12px;
  text-align: center;
  flex-shrink: 0;
  opacity: 0.7;
}
.tab-ws-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  color: var(--text-muted, #888);
  opacity: 0.75;
  line-height: 1;
}
.tab-ws-badge.mobile {
  opacity: 0.85;
}
.tab.active .tab-ws-badge {
  opacity: 0.9;
}
.tab-ws-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tab-ws-remote {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted, #888);
  opacity: 0.7;
}
.tab-ws-abbr {
  font-size: 10px;
  letter-spacing: 0.02em;
  max-width: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-ssh-icon {
  flex-shrink: 0;
  color: var(--accent, #4d7fff);
  opacity: 0.8;
}
.tab-plugin-icon {
  flex-shrink: 0;
  color: var(--color-green, #34d399);
  opacity: 0.8;
}
.tab-title-input {
  background: var(--bg-input, #2a2a2a);
  border: 1px solid var(--accent, #8a8a8a);
  border-radius: 3px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  padding: 0 4px;
  min-width: 0;
  width: 100%;
  max-width: 160px;
  outline: none;
}
.tab {
  cursor: grab;
}
.tab:active {
  cursor: grabbing;
}
.tab.drag-over {
  border-left: 2px solid var(--accent, #8a8a8a);
}
.tab-notif-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: 4px;
}
.dot-info {
  background: var(--accent, #8a8a8a);
}
.dot-success {
  background: var(--color-green, #34d399);
}
.dot-warning {
  background: var(--color-yellow, #f59e0b);
}
.dot-error {
  background: var(--color-red, #ef4444);
}
.dot-urgent {
  background: var(--color-red, #ef4444);
  animation: pulse-dot 1.5s infinite;
}
@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.tab-bar-plugin-wrap {
  position: relative;
  flex-shrink: 0;
}
.plugin-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 160px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  z-index: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.plugin-dropdown-item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plugin-dropdown-item:hover {
  background: var(--bg-hover, #2a2a2a);
}
.plugin-dropdown-name {
  white-space: nowrap;
}
.plugin-dropdown-desc {
  font-size: 11px;
  color: var(--text-muted, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.new-tab-split {
  position: relative;
  flex-shrink: 0;
}
.new-menu-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 220px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  z-index: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.new-menu-dropdown.align-right {
  left: auto;
  right: 0;
}
.new-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.new-menu-item:hover {
  background: var(--bg-hover, #2a2a2a);
}
.new-menu-icon {
  flex-shrink: 0;
  color: var(--text-muted, #888);
}
.new-menu-label {
  flex: 1;
}
.new-menu-kbd {
  font-size: 11px;
  color: var(--text-muted, #888);
  font-family: inherit;
  background: var(--bg-hover, #2a2a2a);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border, #444);
}
.new-menu-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.new-menu-status {
  font-size: 11px;
  color: var(--accent, #8a8a8a);
  padding: 2px 12px 6px;
}
.mc-trigger.desktop-mc {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.mc-trigger.desktop-mc:hover {
  background: var(--bg-hover, #2a2a2a);
  color: var(--text, #fff);
}
</style>

<template>
  <div id="tab-bar">
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
    <div id="tabs-list" ref="tabsListRef">
      <div
        v-for="tab in tabs"
        :key="tab.paneId"
        class="tab"
        :class="{ active: tab.paneId === activePaneId, 'drag-over': dragOverId === tab.paneId }"
        :data-pane-id="tab.paneId"
        @mousedown.prevent="onTabMouseDown($event, tab.paneId)"
        @touchstart="onTabTouchStart($event, tab.paneId)"
        @click="onTabClick($event, tab.paneId)"
        @touchend.prevent="onTabTouchEnd($event, tab.paneId)"
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
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { X, Terminal, Puzzle, Columns2, Rows2, Radio, LayoutDashboard, Globe, Server } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import { useSettingsStore } from '../../stores'
import { resolveWorkspaceBadgeMode } from '../../composables/useWorkspaceBadgeMode'
import WorkspaceBadge from '../WorkspaceBadge.vue'

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
  action: [type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast' | 'ssh-connect']
  reorder: [fromId: string, toId: string]
  'open-plugin': [pluginId: string]
  rename: [paneId: string, title: string]
  'open-overview': []
}>()

const tabsListRef = ref<HTMLElement | null>(null)

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

function emitAction(type: 'new-tab' | 'split-h' | 'split-v' | 'broadcast' | 'ssh-connect') {
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

const dragOverId = ref<string | null>(null)

let dragFromId: string | null = null
let dragStarted = false
let startX = 0
let startY = 0
let isTouchDrag = false
let suppressClick = false
const DRAG_THRESHOLD = 5

function scrollTabIntoView(paneId: string): boolean {
  const el = findTabElement(paneId)
  if (!el) return false
  if (!dragStarted || dragFromId === null) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }
  return true
}

defineExpose({ hasTab, scrollTabIntoView })
function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function onTabMouseDown(e: MouseEvent, paneId: string) {
  if (e.button !== 0) return
  suppressClick = false
  startDrag(e, paneId, false)
}

function onTabTouchStart(e: TouchEvent, paneId: string) {
  if (e.touches.length !== 1) return
  suppressClick = false
  startDrag(e, paneId, true)
}

function onTabClick(e: MouseEvent, paneId: string) {
  if (suppressClick) {
    e.preventDefault()
    e.stopPropagation()
    suppressClick = false
    return
  }
  emit('activate', paneId)
}

function onTabTouchEnd(e: TouchEvent, paneId: string) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  emit('activate', paneId)
}

function startDrag(e: MouseEvent | TouchEvent, paneId: string, isTouch: boolean) {
  const pos = getPointerPos(e)
  startX = pos.clientX
  startY = pos.clientY
  dragStarted = false
  isTouchDrag = isTouch
  dragFromId = paneId

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'

  window.addEventListener(
    moveEvent,
    onPointerMove as EventListener,
    { passive: !isTouch } as AddEventListenerOptions
  )
  window.addEventListener(endEvent, onPointerEnd)
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const pos = getPointerPos(e)
  if (!dragStarted) {
    if (
      Math.abs(pos.clientX - startX) < DRAG_THRESHOLD &&
      Math.abs(pos.clientY - startY) < DRAG_THRESHOLD
    ) {
      return
    }
    dragStarted = true
    // Only prevent scroll once drag gesture is confirmed
    if (isTouchDrag) {
      e.preventDefault()
    }
  } else if (isTouchDrag) {
    e.preventDefault()
  }

  // Find tab element under cursor
  const el = document.elementFromPoint(pos.clientX, pos.clientY)
  let targetId: string | null = null
  if (el) {
    const tabEl = el.closest('.tab[data-pane-id]') as HTMLElement | null
    if (tabEl) {
      const pid = tabEl.dataset.paneId
      if (pid && pid !== dragFromId) {
        targetId = pid
      }
    }
  }

  dragOverId.value = targetId
}

function onPointerEnd() {
  if (dragStarted && dragFromId && dragOverId.value && dragFromId !== dragOverId.value) {
    suppressClick = true
    emit('reorder', dragFromId, dragOverId.value)
  }

  cleanup()
}

function cleanup() {
  dragStarted = false
  dragFromId = null
  dragOverId.value = null

  window.removeEventListener('mousemove', onPointerMove as EventListener)
  window.removeEventListener('mouseup', onPointerEnd)
  window.removeEventListener('touchmove', onPointerMove as EventListener)
  window.removeEventListener('touchend', onPointerEnd)
}

onBeforeUnmount(() => {
  cleanup()
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

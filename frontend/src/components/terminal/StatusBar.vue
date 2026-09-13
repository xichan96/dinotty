<template>
  <div class="status-bar" :class="{ 'is-elevated': serverPickerOpen }">
    <!-- The one switch entry. A fixed-width slot at the far left, so the
         monitor items beside it never move when the server name changes. -->
    <div class="status-bar-server-wrap">
      <button
        class="status-bar-server"
        :class="{ 'is-open': serverPickerOpen }"
        :title="chipTitle"
        aria-haspopup="true"
        :aria-expanded="serverPickerOpen"
        @click.stop="toggleServerPicker()"
      >
        <!-- Icon size, gap and padding are `.status-bar-item`'s, so the chip
             reads as one more metric rather than as a separate control. -->
        <Server class="server-icon" :size="14" />
        <span class="server-name" :class="{ stale: currentMissing }">{{ activeServerLabel }}</span>
        <span class="server-dot" :class="{ 'is-offline': chipOffline }" />
      </button>
      <div v-if="serverPickerOpen" class="server-picker" @click.stop>
        <!-- One wrapper per row: the failure notice belongs to the row but
             cannot live inside its <button>, which may hold no interactive
             content of its own - the retry button would be nested. -->
        <div v-for="(s, i) in servers" :key="s.id" class="server-option-row">
          <button
            class="server-option"
            :class="{ 'is-active': s.id === currentId, active: i === cursor }"
            :aria-busy="isBusy(s.id) ? 'true' : undefined"
            @mouseenter="cursor = i"
            @click="onPickServer(s)"
          >
            <span class="server-option-dot" :class="dotClass(s)" />
            <span class="server-option-main">
              <span class="server-option-name">{{ label(s) }}</span>
              <!-- The origin: two LAN boards are easy to name alike, and this
                   is what tells them apart. -->
              <span class="server-option-url">{{ subtitle(s) }}</span>
            </span>
            <!-- A dot alone cannot say "no token", which is the one state that
                 means anyone reaching this server is an admin. -->
            <span v-if="statusText(s)" class="server-option-tag" :class="statusKind(s)">
              {{ statusText(s) }}
            </span>
            <span v-if="isBusy(s.id)" class="server-option-spin" />
            <KeyRound
              v-else-if="s.hasToken && !s.local"
              class="server-option-lock"
              :title="t('server.tokenConfigured')"
            />
            <Check
              v-if="s.id === currentId && !isBusy(s.id)"
              class="server-option-check"
              :size="14"
            />
          </button>
          <p v-if="failures[s.id]" class="server-option-error">
            <AlertCircle class="server-option-err-icon" :size="12" />
            <span>{{ failureText(failures[s.id]) }}</span>
            <button class="server-option-retry" @click.stop="onPickServer(s)">
              {{ t('server.retry') }}
            </button>
          </p>
        </div>

        <p v-if="status === 'loading'" class="server-picker-hint">{{ t('server.loading') }}</p>
        <p v-else-if="status === 'unavailable'" class="server-picker-hint">
          {{ t('server.listUnavailable') }}
          <button class="server-option-retry" @click.stop="refreshRemoteServers()">
            {{ t('server.retry') }}
          </button>
        </p>

        <button class="server-picker-manage" @click.stop="onManageServers">
          {{ t('server.manage') }}
        </button>
      </div>
    </div>
    <div v-if="leftItems.length" class="status-bar-left">
      <StatusBarItemRenderer v-for="item in leftItems" :key="item.id" :item="item" />
    </div>
    <div
      ref="rightEl"
      class="status-bar-right"
      :class="{ 'has-overflow-left': overflowLeft, 'has-overflow-right': overflowRight }"
      @wheel="onWheel"
      @scroll="updateOverflow"
    >
      <StatusBarItemRenderer v-for="item in allRightItems" :key="item.id" :item="item" />
    </div>
    <span v-if="warning.message.value" class="pane-warning">{{ warning.message.value }}</span>

    <MonitorPopover
      v-if="activePopover?.kind === 'system'"
      :visible="true"
      :metric="activePopover.metric"
      :data="data"
      :anchor-rect="anchorRect"
      :cpu-history="cpuHistory"
      :mem-history="memHistory"
      :net-rx-history="netRxHistory"
      :net-tx-history="netTxHistory"
      :gpu-util-history="gpuUtilHistory"
      :gpu-mem-history="gpuMemHistory"
      @close="activePopover = null"
    />
    <PluginSeriesPopover
      v-else-if="activePopover?.kind === 'plugin' && activeSeries"
      :visible="true"
      :series="activeSeries"
      :anchor-rect="anchorRect"
      @close="activePopover = null"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  defineAsyncComponent,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from 'vue'
import { monitorData } from '../../composables/useMonitor'
import {
  cpuHistory,
  memHistory,
  netRxHistory,
  netTxHistory,
  gpuUtilHistory,
  gpuMemHistory,
} from '../../composables/useMonitor'
import { AlertCircle, Check, KeyRound, Server } from 'lucide-vue-next'
import { useSettings } from '../../composables/useSettings'
import { usePaneWarning } from '../../composables/usePaneWarning'
import { useI18n } from '../../composables/useI18n'
import { switchServer, type SwitchFailure } from '../../composables/activeServer'
import {
  omitKey,
  openServerManager,
  switchFailureText,
} from '../../composables/useRemoteServerAdmin'
import {
  activeServerIdRef,
  closeServerPicker,
  serverPickerOpen,
  toggleServerPicker,
} from '../../composables/useAppCore'
import {
  refreshRemoteServers,
  serverVisualState,
  useRemoteServers,
  type ServerEntry,
} from '../../composables/useRemoteServers'
import { useUiStore } from '../../stores/uiStore'
import { useStatusBarItemsStore } from '../../stores/statusBarItems'
import { usePluginMonitorStore } from '../../stores/pluginMonitor'
import {
  createSystemStatusBarItems,
  type MetricKey,
} from '../../composables/useSystemStatusBarItems'
import { pluginSeriesToStatusBarItem } from '../../composables/usePluginStatusBarAdapter'
import StatusBarItemRenderer from './StatusBarItemRenderer.vue'

const MonitorPopover = defineAsyncComponent(() => import('./MonitorPopover.vue'))
const PluginSeriesPopover = defineAsyncComponent(() => import('./PluginSeriesPopover.vue'))

const data = monitorData
const { settings } = useSettings()
const { t } = useI18n()
const ui = useUiStore()
const warning = usePaneWarning()
const store = useStatusBarItemsStore()
const pluginMonitor = usePluginMonitorStore()

const monitorSettings = computed(
  () =>
    settings.monitor ?? {
      enabled: true,
      cpu: true,
      memory: true,
      disk: false,
      network: true,
    }
)

// ── Active server chip: the one switch entry ────────────────────────
//
// VS Code's remote indicator, in the same spot: a fixed-width slot at the far
// left of the status bar, always present, saying which server this device is
// on. Clicking it opens the roster.
//
// It is the *only* entry because Mission Control cannot host one. MC's open bit
// is server state (`overviewOpen` mirrors an McOp), so when the active server is
// unreachable MC cannot even open - exactly when a switch is needed most. The
// status bar, by contrast, is local chrome the whole way down.

const syncConnected = computed(() => ui.syncConnected)

// The roster is the hub's `GET /api/remote-servers`, read through
// `useRemoteServers`. Reading it out of the active server's settings payload
// instead would show a different list as soon as a remote server is active,
// because `settings` is relayed.
const { servers, status } = useRemoteServers()

/** "Which server are we on", as *this* component sees it.
 *
 *  Deliberately not `useRemoteServers`'s own `currentId`: that is a `computed`
 *  over `activeServerId()`, which caches a plain module variable and so has no
 *  reactive dependency at all. It never invalidates in a component that stays
 *  mounted - and this bar never unmounts. Mission Control's switcher got away
 *  with it only because MC re-mounts it on every open. `activeServerIdRef` is
 *  the reactive mirror the switch hooks update. */
const currentId = computed(() => activeServerIdRef.value)
/** True when the active id is no longer in the roster (e.g. removed). */
const currentMissing = computed(() => !servers.value.some((s) => s.id === currentId.value))

/** The row the keyboard cursor is on. Re-seeded on the active entry each time
 *  the picker opens (see the `serverPickerOpen` watcher). */
const cursor = ref(0)

function label(s: ServerEntry): string {
  if (s.local) return t('server.local')
  return s.name || s.url || s.id
}

/** The origin, which is what distinguishes two similarly named boards. */
function subtitle(s: ServerEntry): string {
  return s.local ? location.host : s.url
}

function dotClass(s: ServerEntry): string {
  switch (serverVisualState(s, currentId.value)) {
    case 'local':
    case 'current':
      return 'on'
    case 'noToken':
      return 'warn'
    default:
      return 'idle'
  }
}

/** The state as words. Colour is a hint; this is what carries it. */
function statusText(s: ServerEntry): string {
  switch (serverVisualState(s, currentId.value)) {
    case 'current':
      return t('server.statusCurrent')
    case 'noToken':
      return t('server.statusNoToken')
    default:
      return ''
  }
}

function statusKind(s: ServerEntry): string {
  return serverVisualState(s, currentId.value) === 'noToken' ? 'warn' : 'current'
}

const activeServerLabel = computed(() => {
  const s = servers.value.find((x) => x.id === currentId.value)
  return s ? label(s) : t('server.unknown')
})

/** Red for both "the socket is down" and "this id left the roster" - two
 *  different causes of the same "you are not really on that server". */
const chipOffline = computed(() => !syncConnected.value || currentMissing.value)

const chipTitle = computed(() => `${t('server.switch')} - ${activeServerLabel.value}`)

/** The row currently being switched to, if any. One at a time: the teardown
 *  sequence is global, so a second concurrent switch would race the first. */
const switchingId = ref<string | null>(null)
/** Per-row busy keys, so a spinner lands on the row that was clicked. */
const busyIds = ref<Set<string>>(new Set())
/** Last switch failure, per row, so the reason survives until it is retried. */
const failures = ref<Record<string, { failure: SwitchFailure; url: string }>>({})

function isBusy(id: string): boolean {
  return busyIds.value.has(id)
}

function setBusy(id: string, busy: boolean) {
  // Replace rather than mutate: a `ref` holding a Set does not track `add` or
  // `delete` on the Set itself.
  const next = new Set(busyIds.value)
  if (busy) next.add(id)
  else next.delete(id)
  busyIds.value = next
}

function failureText(record: { failure: SwitchFailure; url: string }): string {
  return switchFailureText(t, record.failure, record.url)
}

async function onPickServer(s: ServerEntry) {
  if (s.id === currentId.value) {
    closeServerPicker()
    return
  }
  if (switchingId.value) return

  // A retry supersedes the previous reason for the same row.
  failures.value = omitKey(failures.value, s.id)
  switchingId.value = s.id
  setBusy(s.id, true)
  try {
    const result = await switchServer(s.id)
    if (!result.ok) {
      // switchServer aborts before touching any state, so the old server is
      // still fully usable - keep the picker open and say what went wrong.
      failures.value = {
        ...failures.value,
        [s.id]: { failure: result.failure, url: subtitle(s) },
      }
      return
    }
    closeServerPicker()
  } finally {
    setBusy(s.id, false)
    switchingId.value = null
  }
}

function onManageServers() {
  closeServerPicker()
  openServerManager()
}

function onServerPickerKeydown(e: KeyboardEvent) {
  // Deliberately does not stop propagation: this listener is on `window` in the
  // bubble phase, so swallowing the key here would silence every Escape handler
  // in the app for as long as the picker is open.
  if (!serverPickerOpen.value) return
  switch (e.key) {
    case 'Escape':
      closeServerPicker()
      return
    case 'ArrowDown':
      e.preventDefault()
      cursor.value = (cursor.value + 1) % servers.value.length
      return
    case 'ArrowUp':
      e.preventDefault()
      cursor.value = (cursor.value - 1 + servers.value.length) % servers.value.length
      return
    case 'Enter':
      // A row that already has focus activates natively; this branch is for the
      // path where it does not - the picker was opened by `s` while the focus
      // was still on Mission Control's backdrop.
      if ((e.target as HTMLElement | null)?.closest?.('.server-picker')) return
      e.preventDefault()
      {
        const s = servers.value[cursor.value]
        if (s) void onPickServer(s)
      }
      return
  }
}

const leftItems = computed(() => store.leftItems)
const rightItems = computed(() => store.rightItems)

type ActivePopover =
  | { kind: 'system'; metric: MetricKey }
  | { kind: 'plugin'; seriesId: string }
  | null

const activePopover = ref<ActivePopover>(null)
const anchorRect = ref<DOMRect | null>(null)

function toggleSystemPopover(key: MetricKey, event: MouseEvent) {
  if (activePopover.value?.kind === 'system' && activePopover.value.metric === key) {
    activePopover.value = null
    return
  }
  const el = event.currentTarget as HTMLElement
  anchorRect.value = el.getBoundingClientRect()
  activePopover.value = { kind: 'system', metric: key }
}

function togglePluginPopover(seriesId: string, event: MouseEvent) {
  if (activePopover.value?.kind === 'plugin' && activePopover.value.seriesId === seriesId) {
    activePopover.value = null
    return
  }
  const el = event.currentTarget as HTMLElement
  anchorRect.value = el.getBoundingClientRect()
  activePopover.value = { kind: 'plugin', seriesId }
}

const activeSeries = computed(() => {
  const pop = activePopover.value
  if (pop?.kind !== 'plugin') return null
  return pluginMonitor.series.find((s) => s.id === pop.seriesId) ?? null
})

// Plugin series with statusText get adapted into status bar items (right side).
const pluginStatusBarItems = computed(() =>
  pluginMonitor.series
    .filter((s) => s.statusText && pluginMonitor.isVisible(s, settings.monitor.plugin_series))
    .map((s) => pluginSeriesToStatusBarItem(s, (e) => togglePluginPopover(s.id, e)))
)

// Merge system items with plugin-adapted items; system items keep their priorities,
// plugin items use priority 200 (rendered after system metrics).
const allRightItems = computed(() => {
  const sys = [...rightItems.value]
  const plugins = [...pluginStatusBarItems.value]
  return [...sys, ...plugins].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
})

const rightEl = ref<HTMLElement | null>(null)
const overflowLeft = ref(false)
const overflowRight = ref(false)

function updateOverflow() {
  const el = rightEl.value
  if (!el) return
  overflowLeft.value = el.scrollLeft > 1
  overflowRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function onWheel(e: WheelEvent) {
  const el = rightEl.value
  if (!el) return
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  if (e.shiftKey || el.scrollWidth > el.clientWidth) {
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

onMounted(() => {
  store.register('system', createSystemStatusBarItems(monitorSettings, toggleSystemPopover))
  updateOverflow()
  window.addEventListener('resize', updateOverflow)
  // The picker is opened from elsewhere too (the "Switch Server…" action), so
  // its dismissal has to work whether or not it was opened from the chip. The
  // `click` handler runs after `@click.stop` on the chip and popover, which is
  // what keeps a click inside them from closing it.
  window.addEventListener('keydown', onServerPickerKeydown)
  window.addEventListener('click', closeServerPicker)
})

onBeforeUnmount(() => {
  store.unregister('system')
  window.removeEventListener('resize', updateOverflow)
  window.removeEventListener('keydown', onServerPickerKeydown)
  window.removeEventListener('click', closeServerPicker)
})

watch(
  () => allRightItems.value.length,
  () => nextTick(updateOverflow)
)

// The picker is opened from four places (the chip, the palette, the keybinding,
// and Mission Control's disconnected panel), so the roster is refreshed - and
// the keyboard cursor seeded - on the shared open bit rather than in any one
// caller's click handler.
watch(serverPickerOpen, (open) => {
  if (!open) return
  // Re-seed on the active entry so Up/Down starts from where the user is, not
  // from wherever the mouse last hovered.
  cursor.value = Math.max(
    0,
    servers.value.findIndex((s) => s.id === currentId.value)
  )
  void refreshRemoteServers()
})
</script>

<style scoped>
.status-bar {
  height: 24px;
  box-sizing: border-box;
  background: var(--bg, #1a1a2e);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 12px;
  position: relative;
  z-index: 2;
  gap: 16px;
}
/* The bar is a stacking context of its own (`z-index: 2` above), so the picker
   it holds cannot climb out of it - and Mission Control's backdrop sits at
   2000. While the picker is open the whole bar rides above that backdrop, which
   is also how the picker is reachable from MC's disconnected panel. 2100 stays
   under ContextMenu's 2200. */
.status-bar.is-elevated {
  z-index: 2100;
}
.status-bar-server-wrap {
  position: relative;
  flex-shrink: 0;
  /* Claim the bar's full height rather than wrapping a pill: on a phone there
     is no keyboard, so this chip is the *only* way to switch servers, and the
     24px the bar has beats the 18px a centred pill would get. */
  align-self: stretch;
  display: flex;
}
/* `.status-bar-item`'s box exactly - gap, padding, font size, line height,
   radius. The chip sits beside three of those, and matching them is what makes
   it read as one more metric instead of as a separate control. */
.status-bar-server {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  /* Capped rather than fixed: the local entry ("LOC", in both locales) is what
     most sessions show, and a fixed 140px left a wide empty gap on every one of
     them. Past the cap a long remote name ellipsises, so the monitor items
     still stop moving; only a short name shifts them. */
  max-width: 140px;
}
.status-bar-server:hover,
.status-bar-server.is-open {
  color: var(--fg-bright);
}
.server-icon {
  flex: none;
}
.server-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* The active id is no longer in the roster, so the name reads as "unknown".
   Same italic-and-muted treatment the Mission Control switcher used, so the
   state looks the same wherever it is met. */
.server-name.stale {
  color: var(--text-muted, #888);
  font-style: italic;
}
.server-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.server-dot.is-offline {
  background: var(--danger);
}
/* Opens upward: the bar is pinned to the bottom of the workbench. */
.server-picker {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-width: 320px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--dialog-shadow);
}
.server-option-row {
  display: flex;
  flex-direction: column;
}
.server-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font: inherit;
  text-align: left;
  color: var(--text-color);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
}
.server-option:hover {
  background: var(--bg-hover);
}
.server-option.is-active {
  color: var(--accent);
}
/* The keyboard cursor. Hover sets it too, so the two can never disagree about
   which row Enter would pick. */
.server-option.active {
  background: var(--bg-hover);
}
/* Same set of states, and the same colours, as the Mission Control switcher's
   dot: a state has to read the same wherever it is met. */
.server-option-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted, #888);
}
.server-option-dot.on {
  background: var(--accent);
}
.server-option-dot.idle {
  background: var(--text-muted, #888);
}
/* Reachable but with no token configured: anyone who can reach it is an
   admin, so "reachable" must not read as "set up correctly". */
.server-option-dot.warn {
  background: #d97706;
}
.server-option-dot.off {
  background: #dc2626;
}
.server-option-lock {
  flex: none;
  display: flex;
  color: var(--text-muted, #888);
}
.server-option-check {
  flex: none;
  color: var(--accent);
}
.server-option-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
/* The state in words: a coloured dot is not readable on its own, and "no
   token" is the one that means anyone reaching this server is an admin. */
.server-option-tag {
  flex: none;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 9px;
  line-height: 1.6;
  color: var(--fg-muted);
}
.server-option-tag.warn {
  border-color: #d97706;
  color: #d97706;
}
/* The probe is two 4s-budgeted requests, so a switch can look inert for a
   while - long enough to be clicked again. */
.server-option-spin {
  flex: none;
  width: 10px;
  height: 10px;
  border: 2px solid var(--fg-muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: server-option-spin 0.6s linear infinite;
}
@keyframes server-option-spin {
  to {
    transform: rotate(360deg);
  }
}
.server-option-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0 8px 5px 8px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--danger);
}
.server-option-retry {
  flex: none;
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  color: var(--text-color);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.server-option-retry:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
.server-option-err-icon {
  flex: none;
}
.server-picker-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 8px 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fg-muted);
}
.server-picker-manage {
  margin-top: 4px;
  padding: 6px 8px;
  border: none;
  border-top: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.server-picker-manage:hover {
  color: var(--accent);
}
.server-option-name {
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.server-option-url {
  font-size: 10px;
  color: var(--fg-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.status-bar-left {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.status-bar-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 12px,
    #000 calc(100% - 12px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 12px,
    #000 calc(100% - 12px),
    transparent 100%
  );
  -webkit-overflow-scrolling: touch;
}
.status-bar-right::-webkit-scrollbar {
  display: none;
}
.status-bar-right.has-overflow-left:not(.has-overflow-right) {
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 12px, #000 100%);
}
.status-bar-right.has-overflow-right:not(.has-overflow-left) {
  -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 12px), transparent 100%);
  mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 12px), transparent 100%);
}
.status-bar-right:not(.has-overflow-left):not(.has-overflow-right) {
  -webkit-mask-image: none;
  mask-image: none;
}
.pane-warning {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--fg-muted);
  white-space: nowrap;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  animation: warning-fade 4s ease-in forwards;
  z-index: 3;
}
@keyframes warning-fade {
  0%,
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>

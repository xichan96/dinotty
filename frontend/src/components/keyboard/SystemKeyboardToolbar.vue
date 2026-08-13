<template>
  <div
    v-show="visible"
    id="system-mobile-kb"
    ref="rootRef"
    :class="{ 'system-action-open': actionOpen, 'ime-open': imeOpen }"
  >
    <template v-if="!actionOpen">
      <div class="system-kb-upper-shell">
        <div
          v-for="item in systemUpperPinnedDefs"
          :key="item.id"
          class="system-kb-grid-key system-kb-pinned-key"
          :style="{ gridColumn: `span ${item.units}` }"
        >
          <MkbKey
            :k="item.def"
            :state="modState"
            swipe-aware
            @key-press="onKeyPress"
            @app-action="onSystemAppAction"
            @special="onSpecial"
          />
        </div>
        <div
          v-if="systemUpperPageable.length > 0"
          class="system-kb-upper-pager"
          :style="{
            gridColumn: `span ${Math.max(1, systemStatus.upperCapacity)}`,
            '--system-page-columns': String(Math.max(1, systemStatus.upperCapacity)),
          }"
          @touchstart="onPagerTouchStart('upper', $event)"
          @touchmove.prevent="onPagerTouchMove('upper', $event)"
          @touchend="onPagerTouchEnd('upper', $event)"
          @touchcancel="onPagerTouchCancel('upper')"
        >
          <div
            v-for="item in systemUpperPageDefs"
            :key="item.id"
            class="system-kb-grid-key"
            :style="{ gridColumn: `span ${item.units}` }"
          >
            <MkbKey
              :k="item.def"
              :state="modState"
              swipe-aware
              @key-press="onKeyPress"
              @app-action="onSystemAppAction"
              @special="onSpecial"
            />
          </div>
        </div>
        <button
          type="button"
          class="system-kb-ime-toggle"
          :title="imeOpen ? t('mobileKb.dismissKeyboard') : t('mobileKb.showKeyboard')"
          @pointerdown.prevent
          @click="emit('toggle-ime')"
        >
          <KeyboardOff v-if="imeOpen" :size="18" />
          <Keyboard v-else :size="18" />
        </button>
      </div>

      <div v-if="systemLayout.lower_enabled !== false" class="system-kb-lower-shell">
        <div
          v-for="item in systemLowerPinnedDefs"
          :key="item.id"
          class="system-kb-grid-key system-kb-pinned-key"
          :style="{ gridColumn: `span ${item.units}` }"
        >
          <MkbKey
            :k="item.def"
            :state="modState"
            swipe-aware
            @key-press="onKeyPress"
            @app-action="onSystemAppAction"
            @special="onSpecial"
          />
        </div>
        <div
          v-if="systemLowerPageable.length > 0"
          class="system-kb-lower-page system-kb-lower-pager"
          :style="{
            gridColumn: `span ${Math.max(1, systemStatus.lowerCapacity)}`,
            '--system-page-columns': String(Math.max(1, systemStatus.lowerCapacity)),
          }"
          @touchstart="onPagerTouchStart('lower', $event)"
          @touchmove.prevent="onPagerTouchMove('lower', $event)"
          @touchend="onPagerTouchEnd('lower', $event)"
          @touchcancel="onPagerTouchCancel('lower')"
        >
          <div
            v-for="item in systemLowerPageDefs"
            :key="item.id"
            class="system-kb-grid-key"
            :style="{ gridColumn: `span ${item.units}` }"
          >
            <MkbKey
              :k="item.def"
              :state="modState"
              swipe-aware
              @key-press="onKeyPress"
              @app-action="onSystemAppAction"
              @special="onSpecial"
            />
          </div>
        </div>
      </div>
      <div
        v-if="showSystemPageDots"
        class="system-kb-page-dots"
        :class="{ 'upper-only': systemLayout.lower_enabled === false }"
        aria-label="Shortcut pages"
      >
        <div class="system-kb-page-dot-group upper">
          <button
            v-for="page in systemUpperPageCount"
            :key="`u-${page}`"
            v-show="systemUpperPageCount > 1"
            type="button"
            class="system-kb-page-dot"
            :class="{ active: activeUpperPage === page - 1 }"
            :aria-label="`Upper page ${page}`"
            @pointerdown.prevent
            @click="activeUpperPage = page - 1"
          />
        </div>
        <div v-if="systemLayout.lower_enabled !== false" class="system-kb-page-dot-group lower">
          <button
            v-for="page in systemLowerPageCount"
            :key="`l-${page}`"
            v-show="systemLowerPageCount > 1"
            type="button"
            class="system-kb-page-dot"
            :class="{ active: activeLowerPage === page - 1 }"
            :aria-label="`Lower page ${page}`"
            @pointerdown.prevent
            @click="activeLowerPage = page - 1"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="system-kb-action-header">
        <button
          type="button"
          :aria-label="t('mobileInputGuide.system.title')"
          @pointerdown.prevent
          @click="closeActionKeyboard"
        >
          <ChevronLeft :size="18" />
        </button>
        <strong>{{
          expandedPanel === 'termius' ? t('systemKb.terminalKeys') : t('systemKb.actions')
        }}</strong>
        <button
          type="button"
          class="system-kb-ime-toggle"
          @pointerdown.prevent
          @click="emit('toggle-ime')"
        >
          <KeyboardOff v-if="imeOpen" :size="18" />
          <Keyboard v-else :size="18" />
        </button>
      </div>

      <div v-if="expandedPanel === 'termius'" id="system-termius-key-panel">
        <MkbRow
          v-for="(row, index) in termiusKeyRows"
          :key="index"
          :keys="row"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
      </div>

      <div v-else id="system-mkb-action-panel">
        <MkbRow
          :keys="actionFirstRow"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
        <MkbRow
          v-for="(row, index) in actionFollowingRows"
          :key="index"
          :keys="row"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
        <div
          class="mkb-action-bottom"
          :style="{ '--ak-enter-width': (actionBottom.enter_width ?? 0.28) * 100 + '%' }"
        >
          <div class="mkb-action-grid">
            <div
              v-for="(row, rowIndex) in actionBottomRows"
              :key="rowIndex"
              class="mkb-action-grid-row"
            >
              <MkbKey
                v-for="(key, keyIndex) in row"
                :key="keyIndex"
                :k="key"
                :state="modState"
                @key-press="onKeyPress"
                @app-action="onAppAction"
                @special="onSpecial"
              />
            </div>
          </div>
          <MkbKey
            :k="actionEnter"
            :state="modState"
            @key-press="onKeyPress"
            @app-action="onAppAction"
            @special="onSpecial"
          />
        </div>
      </div>
    </template>

    <HistoryPanel
      v-if="showHistoryPanel"
      :items="historyItems"
      @select="onHistorySelect"
      @delete="onHistoryDelete"
      @close="showHistoryPanel = false"
    />
    <input ref="phoneFileInputRef" type="file" multiple hidden @change="onPhoneFileInputChange" />
    <FilePickerModal
      :visible="showFilePicker"
      :pane-id="paneId"
      @update:visible="showFilePicker = $event"
      @select="onFilePickerSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ChevronLeft, Keyboard, KeyboardOff } from 'lucide-vue-next'
import MkbKey from './MkbKey.vue'
import MkbRow from './MkbRow.vue'
import HistoryPanel from './HistoryPanel.vue'
import FilePickerModal from '../preview/FilePickerModal.vue'
import type { AppActionOptions, KeyDef, ModState } from './mkbTypes'
import type { SendDataFn } from '../../utils/frozenSend'
import { useKeyboardLayout } from '../../composables/useKeyboardLayout'
import { effectiveSystemKeyboard, useSettings, type ActionKey } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import type { SuggestionItem } from '../../composables/useHistory'
import {
  applyMobileTerminalModifiers,
  emptyMobileTerminalModifiers,
  mobileTerminalModifierActive,
  type MobileTerminalModifiers,
} from '../../utils/terminalInput'
import { shellEscapePath } from '../../utils/shell'
import { useUpload } from '../../composables/useUpload'
import { POSITION, useToast } from 'vue-toastification'
import { actionKeyToKeyDef } from '../../utils/actionKeyDef'
import {
  SYSTEM_ROW_UNITS,
  UPPER_USER_UNITS,
  canonicalLowerKeys,
  packSystemKeys,
  systemKeyboardLayoutStatus,
  systemKeyUnits,
} from '../../utils/systemKeyboardLayout'
import {
  parseKeyboardSpecial,
  type KeyboardModifierFamily,
  type KeyboardSpecialId,
} from '../../utils/keyboardSpecialKeys'

const props = defineProps<{
  visible: boolean
  paneId: string
  getSendFn: () => SendDataFn | null
  actionOpen: boolean
  imeOpen: boolean
}>()

const emit = defineEmits<{
  'update:actionOpen': [value: boolean]
  'modifier-change': [modifiers: MobileTerminalModifiers]
  'app-action': [id: string, options: AppActionOptions]
  bookmarks: []
  dismiss: []
  'toggle-ime': []
  'focus-xterm': []
  'paste-text': [text: string]
}>()

const { settings } = useSettings()
const { t } = useI18n()
const rootRef = ref<HTMLElement>()
const showHistoryPanel = ref(false)
const showFilePicker = ref(false)
const phoneFileInputRef = ref<HTMLInputElement>()
const phoneUploading = ref(false)
const { uploadFiles, uploadErrorStatus } = useUpload()
const toast = useToast()
const historyItems = ref<SuggestionItem[]>([])
const kbMode = ref<'default' | 'action'>('action')
const expandedPanel = ref<'termius' | 'shortcuts'>('termius')
const modifierModes = reactive<MobileTerminalModifiers>(emptyMobileTerminalModifiers())
const activeModifierSpecial = reactive<Partial<Record<KeyboardModifierFamily, KeyboardSpecialId>>>(
  {}
)
const modState = computed<ModState>(() => ({
  ctrl: mobileTerminalModifierActive(modifierModes.ctrl),
  shift: mobileTerminalModifierActive(modifierModes.shift),
  alt: mobileTerminalModifierActive(modifierModes.alt),
  meta: mobileTerminalModifierActive(modifierModes.meta),
  locked: {
    ctrl: modifierModes.ctrl === 'locked',
    shift: modifierModes.shift === 'locked',
    alt: modifierModes.alt === 'locked',
    meta: modifierModes.meta === 'locked',
  },
  activeSpecial: activeModifierSpecial,
}))

const { actionFirstRow, actionFollowingRows, actionBottom, actionBottomRows, actionEnter } =
  useKeyboardLayout({ kbMode, settings })

const systemLayout = computed(() => effectiveSystemKeyboard())
const systemStatus = computed(() => systemKeyboardLayoutStatus(systemLayout.value))
const systemUpperPinned = computed(() =>
  systemLayout.value.upper.slice(0, systemStatus.value.upperPinned)
)
const systemUpperPageable = computed(() =>
  systemLayout.value.upper.slice(systemStatus.value.upperPinned)
)
const systemUpperPages = computed(() =>
  packSystemKeys(systemUpperPageable.value, Math.max(1, systemStatus.value.upperCapacity))
)
const systemLower = computed(() => canonicalLowerKeys(systemLayout.value))
const systemLowerPinned = computed(() => systemLower.value.slice(0, systemStatus.value.lowerPinned))
const systemLowerPageable = computed(() => systemLower.value.slice(systemStatus.value.lowerPinned))
const systemLowerPages = computed(() =>
  packSystemKeys(systemLowerPageable.value, Math.max(1, systemStatus.value.lowerCapacity))
)
const activeUpperPage = ref(0)
const activeLowerPage = ref(0)
const systemUpperPageCount = computed(() => systemUpperPages.value.length)
const systemLowerPageCount = computed(() => systemLowerPages.value.length)
const showSystemPageDots = computed(
  () =>
    systemUpperPageCount.value > 1 ||
    (systemLayout.value.lower_enabled !== false && systemLowerPageCount.value > 1)
)

function runtimeItem(item: { key: ActionKey; units: number }, id: string) {
  return { id, units: item.units, def: actionKeyToKeyDef(item.key) }
}

const systemUpperPinnedDefs = computed(() =>
  systemUpperPinned.value.map((key, index) =>
    runtimeItem(
      { key, units: systemKeyUnits(key, UPPER_USER_UNITS) },
      `pinned-${index}-${key.label}`
    )
  )
)
const systemLowerPinnedDefs = computed(() =>
  systemLowerPinned.value.map((key, index) =>
    runtimeItem(
      { key, units: systemKeyUnits(key, SYSTEM_ROW_UNITS) },
      `lower-pinned-${index}-${key.label}`
    )
  )
)
const systemUpperPageDefs = computed(() =>
  (systemUpperPages.value[activeUpperPage.value] ?? []).map((item, index) =>
    runtimeItem(item, `upper-${activeUpperPage.value}-${index}-${item.key.label}`)
  )
)
const systemLowerPageDefs = computed(() =>
  (systemLowerPages.value[activeLowerPage.value] ?? []).map((item, index) =>
    runtimeItem(item, `lower-${activeLowerPage.value}-${index}-${item.key.label}`)
  )
)

watch(systemUpperPageCount, (count) => {
  activeUpperPage.value = Math.min(activeUpperPage.value, count - 1)
})
watch(systemLowerPageCount, (count) => {
  activeLowerPage.value = Math.min(activeLowerPage.value, count - 1)
})

type PagerRegion = 'upper' | 'lower'
const pagerTouch = new Map<PagerRegion, { x: number; y: number; moved: boolean }>()
function onPagerTouchStart(region: PagerRegion, event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return
  pagerTouch.set(region, { x: touch.clientX, y: touch.clientY, moved: false })
}
function onPagerTouchMove(region: PagerRegion, event: TouchEvent) {
  const start = pagerTouch.get(region)
  const touch = event.touches[0]
  if (!start || !touch) return
  if (Math.abs(touch.clientX - start.x) > 10) start.moved = true
}
function onPagerTouchEnd(region: PagerRegion, event: TouchEvent) {
  const start = pagerTouch.get(region)
  pagerTouch.delete(region)
  if (!start) return
  const touch = event.changedTouches[0]
  if (!touch) return
  const deltaX = touch.clientX - start.x
  const deltaY = touch.clientY - start.y
  if (Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY)) return
  const page = region === 'upper' ? activeUpperPage : activeLowerPage
  const count = region === 'upper' ? systemUpperPageCount.value : systemLowerPageCount.value
  page.value = Math.min(count - 1, Math.max(0, page.value + (deltaX < 0 ? 1 : -1)))
}
function onPagerTouchCancel(region: PagerRegion) {
  pagerTouch.delete(region)
}

const termiusKeyRows: KeyDef[][] = [
  [
    { l: 'esc', s: '\x1b' },
    { l: 'tab', s: '\x09' },
    { l: 'ctrl', sp: 'ctrl' },
    { l: 'alt', sp: 'alt' },
    { l: '/', s: '/' },
    { l: '|', s: '|' },
    { l: '~', s: '~' },
    { l: '-', s: '-' },
  ],
  [
    { l: '^C', s: '\x03' },
    { l: '^I', s: '\x09' },
    { l: '^S', s: '\x13' },
    { l: '^Z', s: '\x1a' },
    { l: 'shift-tab', s: '\x1b[Z' },
    { l: '?', s: '?' },
    { l: '/', s: '/' },
    { l: '|', s: '|' },
  ],
  [
    { l: 'home', s: '\x1b[H' },
    { l: 'pgUp', s: '\x1b[5~' },
    { l: 'pgDn', s: '\x1b[6~' },
    { l: 'end', s: '\x1b[F' },
    { l: '=', s: '=' },
    { l: ':', s: ':' },
    { l: ';', s: ';' },
    { l: '!', s: '!' },
  ],
  [
    { l: '*', s: '*' },
    { l: '$', s: '$' },
    { l: '%', s: '%' },
    { l: '^', s: '^' },
    { l: '<', s: '<' },
    { l: '>', s: '>' },
    { l: '(', s: '(' },
    { l: ')', s: ')' },
  ],
  [
    { l: '{', s: '{' },
    { l: '}', s: '}' },
    { l: '[', s: '[' },
    { l: ']', s: ']' },
    { l: 'paste', act: 'pasteTerminal', autoEnter: false },
    { l: 'del', s: '\x1b[3~' },
    { l: 'ins', s: '\x1b[2~' },
    { l: '@', s: '@' },
  ],
  [
    { l: 'F1', s: '\x1bOP' },
    { l: 'F2', s: '\x1bOQ' },
    { l: 'F3', s: '\x1bOR' },
    { l: 'F4', s: '\x1bOS' },
    { l: 'F5', s: '\x1b[15~' },
    { l: 'F6', s: '\x1b[17~' },
    { l: 'F7', s: '\x1b[18~' },
    { l: 'F8', s: '\x1b[19~' },
  ],
  [
    { l: 'F9', s: '\x1b[20~' },
    { l: 'F10', s: '\x1b[21~' },
    { l: 'F11', s: '\x1b[23~' },
    { l: 'F12', s: '\x1b[24~' },
    { l: '^_', s: '\x1f' },
    { l: '^L', s: '\x0c' },
    { l: 'Alt-r', s: '\x1br' },
    { l: '^X^X', s: '\x18\x18' },
  ],
  [
    { l: '^R', s: '\x12' },
    { l: '^G', s: '\x07' },
    { l: '^N', s: '\x0e' },
    { l: '^P', s: '\x10' },
    { l: '◀', s: '\x1b[D', cls: 'mkb-arrow' },
    { l: '▲', s: '\x1b[A', cls: 'mkb-arrow' },
    { l: '▼', s: '\x1b[B', cls: 'mkb-arrow' },
    { l: '▶', s: '\x1b[C', cls: 'mkb-arrow' },
  ],
]

function publishModifiers() {
  emit('modifier-change', { ...modifierModes })
}

function resetModifiers() {
  Object.assign(modifierModes, emptyMobileTerminalModifiers())
  publishModifiers()
}

function onKeyPress(input: string) {
  const applied = applyMobileTerminalModifiers(input, { ...modifierModes })
  Object.assign(modifierModes, applied.modifiers)
  publishModifiers()
  props.getSendFn()?.(applied.data)
}

function onSpecial(special: string) {
  const parsed = parseKeyboardSpecial(special)
  if (parsed?.entry.modifier) {
    const family = parsed.entry.modifier
    modifierModes[family] =
      modifierModes[family] === 'off' ? (parsed.behavior === 'lock' ? 'locked' : 'once') : 'off'
    if (modifierModes[family] !== 'off') activeModifierSpecial[family] = parsed.id
  }
  if (special === 'bookmarks') emit('bookmarks')
  if (special === 'kbswitch') closeActionKeyboard()
  publishModifiers()
}

function onAppAction(id: string, options: AppActionOptions) {
  emit('app-action', id, options)
}

function onSystemAppAction(id: string, options: AppActionOptions) {
  if (id === 'system.history') {
    void openHistory()
    return
  }
  if (id === 'system.extended') {
    openTermiusKeyboard()
    return
  }
  if (id === 'system.actions') {
    openActionKeyboard()
    return
  }
  if (id === 'insertWorkspaceFile') {
    showFilePicker.value = true
    return
  }
  if (id === 'uploadMobileFile') {
    if (!phoneUploading.value) phoneFileInputRef.value?.click()
    return
  }
  onAppAction(id, options)
}

function onFilePickerSelect(path: string) {
  props.getSendFn()?.(`${shellEscapePath(path)} `)
  showFilePicker.value = false
  emit('focus-xterm')
}

async function onPhoneFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || phoneUploading.value) return
  phoneUploading.value = true
  try {
    const data = await uploadFiles(files)
    const paths = data.saved ?? []
    if (paths.length) props.getSendFn()?.(`${paths.map(shellEscapePath).join(' ')} `)
    window.dispatchEvent(new CustomEvent('dinotty-upload-status', { detail: data }))
    toast.success(t('mobileKb.uploadDone'), { position: POSITION.BOTTOM_CENTER })
    emit('focus-xterm')
  } catch (error) {
    const status = uploadErrorStatus(error)
    const key =
      status === 413
        ? 'mobileKb.uploadTooLarge'
        : status === 507
          ? 'settings.uploads.toastDiskFull'
          : 'mobileKb.uploadFailed'
    toast.error(t(key), { position: POSITION.BOTTOM_CENTER })
  } finally {
    phoneUploading.value = false
  }
}

function openActionKeyboard() {
  resetModifiers()
  expandedPanel.value = 'shortcuts'
  emit('update:actionOpen', true)
}

function openTermiusKeyboard() {
  resetModifiers()
  expandedPanel.value = 'termius'
  emit('update:actionOpen', true)
}

function closeActionKeyboard() {
  resetModifiers()
  emit('update:actionOpen', false)
  emit('focus-xterm')
}

async function openHistory() {
  const { authFetch, apiUrl } = await import('../../composables/apiBase')
  try {
    const response = await authFetch(apiUrl('/api/history?limit=100'))
    if (response.ok) historyItems.value = await response.json()
  } catch {}
  showHistoryPanel.value = true
}

function onHistorySelect(command: string) {
  showHistoryPanel.value = false
  props.getSendFn()?.('\x15')
  emit('paste-text', command)
  emit('focus-xterm')
}

function onHistoryDelete(command: string) {
  historyItems.value = historyItems.value.filter((item) => item.command !== command)
}

function updateHeight() {
  const height = props.visible && rootRef.value ? rootRef.value.getBoundingClientRect().height : 0
  document.documentElement.style.setProperty('--mkb-height', `${height}px`)
}

function onModifiersConsumed(event: Event) {
  const detail = (
    event as CustomEvent<{
      paneId: string
      modifiers: MobileTerminalModifiers
    }>
  ).detail
  if (!detail || detail.paneId !== props.paneId) return
  Object.assign(modifierModes, detail.modifiers)
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) resetModifiers()
    requestAnimationFrame(updateHeight)
  }
)
watch(
  () => props.actionOpen,
  () => requestAnimationFrame(updateHeight)
)
watch(() => props.paneId, resetModifiers)

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('dinotty-mobile-modifiers-consumed', onModifiersConsumed)
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(rootRef.value)
  }
  updateHeight()
})

onBeforeUnmount(() => {
  resetModifiers()
  resizeObserver?.disconnect()
  window.removeEventListener('dinotty-mobile-modifiers-consumed', onModifiersConsumed)
  document.documentElement.style.setProperty('--mkb-height', '0px')
})
</script>

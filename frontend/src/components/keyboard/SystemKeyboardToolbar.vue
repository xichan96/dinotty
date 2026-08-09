<template>
  <div
    v-show="visible"
    id="system-mobile-kb"
    ref="rootRef"
    :class="{ 'system-action-open': actionOpen }"
  >
    <template v-if="!actionOpen">
      <div class="system-kb-tool-row">
        <button
          type="button"
          class="system-kb-tool"
          :title="t('systemKb.history')"
          @pointerdown.prevent
          @click="openHistory"
        >
          <History :size="17" />
        </button>
        <button
          type="button"
          class="system-kb-tool"
          :title="t('systemKb.favorites')"
          @pointerdown.prevent
          @click="emit('bookmarks')"
        >
          <Bookmark :size="17" />
        </button>
        <button
          type="button"
          class="system-kb-tool"
          :title="t('systemKb.terminalKeys')"
          @pointerdown.prevent
          @click="openTermiusKeyboard"
        >
          <LayoutGrid class="system-kb-extended-icon" :size="18" />
        </button>
        <button
          type="button"
          class="system-kb-tool system-kb-action-toggle"
          :title="t('systemKb.actions')"
          @pointerdown.prevent
          @click="openActionKeyboard"
        >
          <SquareTerminal class="system-kb-action-icon" :size="20" />
          <span>{{ t('systemKb.actions') }}</span>
        </button>
        <button
          type="button"
          class="system-kb-tool system-kb-dismiss"
          :title="t('mobileKb.dismissKeyboard')"
          @pointerdown.prevent
          @click="dismiss"
        >
          <KeyboardOff :size="18" />
        </button>
      </div>

      <div v-if="toolbarQuickKeyDefs.length" class="system-kb-quick-row">
        <MkbKey
          v-for="(key, index) in toolbarQuickKeyDefs"
          :key="`${key.l}-${key.s ?? key.sp ?? index}-${index}`"
          :k="key"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
      </div>

      <div class="system-kb-shortcut-strip" aria-label="Terminal shortcuts">
        <MkbKey
          v-for="(key, index) in systemShortcutDefs"
          :key="`${key.l}-${index}`"
          :k="key"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
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
        <button type="button" @pointerdown.prevent @click="dismiss">
          <KeyboardOff :size="18" />
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
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Bookmark,
  ChevronLeft,
  History,
  KeyboardOff,
  LayoutGrid,
  SquareTerminal,
} from 'lucide-vue-next'
import MkbKey from './MkbKey.vue'
import MkbRow from './MkbRow.vue'
import HistoryPanel from './HistoryPanel.vue'
import type { AppActionOptions, KeyDef, ModState } from './mkbTypes'
import type { SendDataFn } from '../../utils/frozenSend'
import { useKeyboardLayout } from '../../composables/useKeyboardLayout'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import type { SuggestionItem } from '../../composables/useHistory'
import { applyMobileTerminalModifiers } from '../../utils/terminalInput'

const props = defineProps<{
  visible: boolean
  paneId: string
  getSendFn: () => SendDataFn | null
  actionOpen: boolean
}>()

const emit = defineEmits<{
  'update:actionOpen': [value: boolean]
  'modifier-change': [modifiers: { ctrl: boolean; alt: boolean }]
  'app-action': [id: string, options: AppActionOptions]
  bookmarks: []
  dismiss: []
  'focus-xterm': []
  'paste-text': [text: string]
}>()

const { settings } = useSettings()
const { t } = useI18n()
const rootRef = ref<HTMLElement>()
const showHistoryPanel = ref(false)
const historyItems = ref<SuggestionItem[]>([])
const kbMode = ref<'default' | 'action'>('action')
const expandedPanel = ref<'termius' | 'shortcuts'>('termius')
const modState = reactive<ModState>({ shift: false, ctrl: false, alt: false })

const {
  actionFirstRow,
  actionFollowingRows,
  actionBottom,
  actionBottomRows,
  actionEnter,
  toolbarQuickKeyDefs,
} = useKeyboardLayout({ kbMode, settings })

const systemShortcutDefs: KeyDef[] = [
  { l: 'Esc', s: '\x1b', cls: 'mkb-mod' },
  { l: 'Tab', s: '\x09', cls: 'mkb-mod' },
  { l: 'Ctrl', sp: 'ctrl', cls: 'mkb-mod', id: 'system-kb-ctrl' },
  { l: 'Alt', sp: 'alt', cls: 'mkb-mod', id: 'system-kb-alt' },
  { l: '/', s: '/' },
  { l: '|', s: '|' },
  { l: '~', s: '~' },
  { l: '-', s: '-' },
  { l: '^C', s: '\x03', cls: 'mkb-mod' },
  { l: '^I', s: '\x09', cls: 'mkb-mod' },
  { l: '^S', s: '\x13', cls: 'mkb-mod' },
  { l: '^Z', s: '\x1a', cls: 'mkb-mod' },
]

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
  emit('modifier-change', { ctrl: modState.ctrl, alt: modState.alt })
}

function resetModifiers() {
  modState.shift = false
  modState.ctrl = false
  modState.alt = false
  publishModifiers()
}

function onKeyPress(input: string) {
  const code = input.length === 1 ? input.charCodeAt(0) : -1
  if (input.length !== 1 || code < 32 || code === 127) {
    resetModifiers()
    props.getSendFn()?.(input)
    return
  }
  const applied = applyMobileTerminalModifiers(input, {
    ctrl: modState.ctrl,
    alt: modState.alt,
  })
  modState.ctrl = applied.modifiers.ctrl
  modState.alt = applied.modifiers.alt
  modState.shift = false
  publishModifiers()
  props.getSendFn()?.(applied.data)
}

function onSpecial(special: string) {
  if (special === 'ctrl') modState.ctrl = !modState.ctrl
  if (special === 'alt') modState.alt = !modState.alt
  if (special === 'shift') modState.shift = !modState.shift
  if (special === 'bookmarks') emit('bookmarks')
  if (special === 'kbswitch') closeActionKeyboard()
  publishModifiers()
}

function onAppAction(id: string, options: AppActionOptions) {
  emit('app-action', id, options)
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
  emit('update:actionOpen', false)
  emit('focus-xterm')
}

function dismiss() {
  resetModifiers()
  emit('update:actionOpen', false)
  emit('dismiss')
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
      modifiers: { ctrl: boolean; alt: boolean }
    }>
  ).detail
  if (!detail || detail.paneId !== props.paneId) return
  modState.ctrl = detail.modifiers.ctrl
  modState.alt = detail.modifiers.alt
}

let resizeObserver: ResizeObserver | null = null
watch(
  () => props.visible,
  () => requestAnimationFrame(updateHeight)
)
watch(
  () => props.actionOpen,
  () => requestAnimationFrame(updateHeight)
)
watch(() => props.paneId, resetModifiers)

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

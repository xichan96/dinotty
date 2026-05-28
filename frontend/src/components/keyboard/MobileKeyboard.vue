<template>
  <div ref="barRef" id="mobile-kb" v-show="visible">
    <!-- Default mode: suggestion bar on top -->
    <div class="mkb-kb-bar" v-show="kbMode === 'default'">
      <SuggestionBar :suggestions="suggestions" @select="onSuggestionSelect" @edit="onSuggestionEdit" @expand="onExpandHistory" />
      <button
        type="button"
        class="mkb-collapse-btn"
        @mousedown.prevent="emit('update:visible', false)"
        @touchstart.prevent="emit('update:visible', false)"
      >▼</button>
    </div>

    <!-- Action mode: text input on top -->
    <div class="mkb-kb-bar" v-show="kbMode === 'action'">
      <div class="mkb-text-input-glow" :class="{ 'mkb-glow-active': !textInputFocused }">
        <textarea
          ref="textInputRef"
          class="mkb-text-input"
          :class="{ 'mkb-text-input-focused': textInputFocused }"
          placeholder=""
          enterkeyhint="send"
          v-model="textInput"
          @focus="onTextInputFocus"
          @blur="onTextInputBlur"
          @keydown.enter.exact.prevent="sendTextInput"
        />
      </div>
      <button
        v-show="!textInputFocused"
        type="button"
        class="mkb-collapse-btn"
        @mousedown.prevent="emit('update:visible', false)"
        @touchstart.prevent="emit('update:visible', false)"
      >▼</button>
    </div>

    <!-- Toolbar (visible when textarea focused) -->
    <div class="mkb-toolbar" v-show="textInputFocused">
      <button class="mkb-tool-btn" @mousedown.prevent="showFilePicker = true">
        <FolderOpen :size="18" />
      </button>
      <button
        v-if="globalSelectedPath"
        class="mkb-tool-btn mkb-path-chip"
        @mousedown.prevent="onFilePickerSelect(globalSelectedPath!)"
      >
        <FileText :size="14" />
        <span class="mkb-path-label">{{ globalSelectedPath!.split('/').pop() }}</span>
      </button>
    </div>

    <!-- Swipeable panels container -->
    <div
      ref="swipeContainerRef"
      class="mkb-swipe-container"
      v-show="!textInputFocused"
    >
    <div class="mkb-swipe-track" :style="swipeTrackStyle">

    <!-- Main keyboard panel -->
    <div id="mkb-main-panel">
      <!-- Row 1: ` 1-0 - = ⌫ -->
      <MkbRow :keys="row1" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <!-- Row 2: tab q-p [ ] \ -->
      <MkbRow :keys="row2" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <!-- Row 3: ⌨ a-l ; ' ↵ (stagger) -->
      <MkbRow :keys="row3" :state="modState" @key-press="onKeyPress" @special="onSpecial" stagger="asdf" />
      <!-- Rows 4-5 with arrow cluster -->
      <div class="mkb-rows-45">
        <div class="mkb-rows-45-main">
          <MkbRow :keys="row4zxcv" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          <MkbRow :keys="row5bottom" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
        </div>
        <div class="mkb-arrow-cluster">
          <MkbKey :k="arrowUp" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          <div class="mkb-arrow-cluster-bot">
            <MkbKey :k="arrowLeft" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
            <MkbKey :k="arrowDown" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
            <MkbKey :k="arrowRight" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
        </div>
      </div>
    </div>

    <!-- Action panel -->
    <div id="mkb-action-panel">
      <MkbRow :keys="actionFirstRow" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      <MkbRow
        v-for="(r, i) in actionFollowingRows"
        :key="i"
        :keys="r"
        :state="modState"
        @key-press="onKeyPress"
        @special="onSpecial"
      />
      <div class="mkb-action-arrow-enter">
        <div class="mkb-action-arrowpad">
          <div class="mkb-action-arrow-top">
            <MkbKey :k="actionArrowUp" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
          <div class="mkb-action-arrow-bot">
            <MkbKey v-for="k in actionArrowBot" :key="k.l" :k="k" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
          </div>
        </div>
        <MkbKey :k="actionEnter" :state="modState" @key-press="onKeyPress" @special="onSpecial" />
      </div>
    </div>

    </div><!-- /mkb-swipe-track -->
    </div><!-- /mkb-swipe-container -->

    <!-- Swipe indicator dots (outside overflow-hidden container) -->
    <div
      class="mkb-swipe-dots"
      v-show="!textInputFocused"
      @touchstart.passive="onSwipeStart"
      @touchmove.passive="onSwipeMove"
      @touchend="onSwipeEnd"
    >
      <span class="mkb-dot" :class="{ active: kbMode === 'default' }" @click="switchMode('default')"></span>
      <span class="mkb-dot" :class="{ active: kbMode === 'action' }" @click="switchMode('action')"></span>
    </div>

    <HistoryPanel
      v-if="showHistoryPanel"
      :items="allSuggestions"
      @select="onHistoryPanelSelect"
      @delete="onHistoryPanelDelete"
      @close="showHistoryPanel = false"
    />

    <FilePickerModal
      :visible="showFilePicker"
      :pane-id="props.paneId"
      @update:visible="showFilePicker = $event"
      @select="onFilePickerSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MkbRow from './MkbRow.vue'
import MkbKey from './MkbKey.vue'
import SuggestionBar from './SuggestionBar.vue'
import HistoryPanel from './HistoryPanel.vue'
import FilePickerModal from '../preview/FilePickerModal.vue'
import type { KeyDef, ModState } from './mkbTypes'
import { useSettings, DEFAULT_ACTION_KEYBOARD } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useHistory } from '../../composables/useHistory'
import { mapActionKeys } from '../../utils/actionKeyDef'
import { Keyboard, SquareTerminal, FolderOpen, FileText } from 'lucide-vue-next'
import { useSelectedPath } from '../../composables/useFileNavigation'

const props = defineProps<{
  visible: boolean
  paneId: string
  getSendFn: () => ((data: string) => void) | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
}>()

const { settings } = useSettings()
const { t } = useI18n()
const { suggestions, fetchSuggestions, fetchDebounced } = useHistory()
const { selectedPath: globalSelectedPath } = useSelectedPath()

const showHistoryPanel = ref(false)
const allSuggestions = ref<import('../../composables/useHistory').SuggestionItem[]>([])
const showFilePicker = ref(false)
const barRef = ref<HTMLElement>()
const swipeContainerRef = ref<HTMLElement>()
const textInputRef = ref<HTMLTextAreaElement>()
const textInput = ref('')
const textInputFocused = ref(false)
const kbMode = ref<'default' | 'action'>('action')
const inputBuffer = ref('')

// Swipe gesture state
const swipeStartX = ref(0)
const swipeStartY = ref(0)
const swipeDeltaX = ref(0)
const swiping = ref(false)
const swipeTransition = ref(false)

const swipeTrackStyle = computed(() => {
  const baseOffset = kbMode.value === 'default' ? 0 : -50
  const dragPct = swiping.value ? (swipeDeltaX.value / (barRef.value?.offsetWidth || 375)) * 50 : 0
  return {
    transform: `translateX(${baseOffset + dragPct}%)`,
    transition: swipeTransition.value ? 'transform 0.25s ease-out' : 'none',
  }
})

function onSwipeStart(e: TouchEvent) {
  swipeTransition.value = false
  swipeStartX.value = e.touches[0].clientX
  swipeStartY.value = e.touches[0].clientY
  swipeDeltaX.value = 0
  swiping.value = false
}

function onSwipeMove(e: TouchEvent) {
  const dx = e.touches[0].clientX - swipeStartX.value
  const dy = e.touches[0].clientY - swipeStartY.value
  if (!swiping.value) {
    // Lock direction once finger moves enough — vertical locks out swipe entirely
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
      // Mark as locked-out by setting delta to NaN sentinel
      swipeDeltaX.value = NaN
      return
    }
    if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiping.value = true
    } else {
      return
    }
  }
  swipeDeltaX.value = dx
}

function onSwipeEnd() {
  if (!swiping.value) { swipeDeltaX.value = 0; swiping.value = false; return }
  const threshold = (barRef.value?.offsetWidth || 375) * 0.15
  swipeTransition.value = true
  if (swipeDeltaX.value < -threshold && kbMode.value === 'default') {
    kbMode.value = 'action'
  } else if (swipeDeltaX.value > threshold && kbMode.value === 'action') {
    kbMode.value = 'default'
    fetchSuggestions()
  }
  swipeDeltaX.value = 0
  swiping.value = false
  nextTick(() => updateHeight())
}

function switchMode(mode: 'default' | 'action') {
  if (kbMode.value === mode) return
  swipeTransition.value = true
  kbMode.value = mode
  if (mode === 'default') fetchSuggestions()
  nextTick(() => updateHeight())
}

const modState = reactive<ModState>({
  shift: false,
  ctrl: false,
  alt: false,
})

// Key definitions
const row1: KeyDef[] = [
  { l:'`', sl:'~', s:'`' }, { l:'1',sl:'!',s:'1' }, { l:'2',sl:'@',s:'2' },
  { l:'3',sl:'#',s:'3' }, { l:'4',sl:'$',s:'4' }, { l:'5',sl:'%',s:'5' },
  { l:'6',sl:'^',s:'6' }, { l:'7',sl:'&',s:'7' }, { l:'8',sl:'*',s:'8' },
  { l:'9',sl:'(',s:'9' }, { l:'0',sl:')',s:'0' }, { l:'-',sl:'_',s:'-' },
  { l:'=',sl:'+',s:'=' }, { l:'⌫', s:'\x7f', g:1.5, cls:'mkb-mod', repeat:true },
]

const row2: KeyDef[] = [
  { l:'tab', s:'\x09', g:1.5, cls:'mkb-mod' },
  { l:'q',s:'q' }, { l:'w',s:'w' }, { l:'e',s:'e' }, { l:'r',s:'r' },
  { l:'t',s:'t' }, { l:'y',s:'y' }, { l:'u',s:'u' }, { l:'i',s:'i' },
  { l:'o',s:'o' }, { l:'p',s:'p' },
  { l:'[',sl:'{',s:'[' }, { l:']',sl:'}',s:']' }, { l:'\\',sl:'|',s:'\\', g:1.5, cls:'mkb-mod' },
]

const row3 = computed<KeyDef[]>(() => [
  { l:'', icon: kbMode.value === 'default' ? SquareTerminal : Keyboard, sp:'kbswitch', g:1.7, cls:'mkb-mod', id:'mkb-kbswitch' },
  { l:'a',s:'a' }, { l:'s',s:'s' }, { l:'d',s:'d' }, { l:'f',s:'f' },
  { l:'g',s:'g' }, { l:'h',s:'h' }, { l:'j',s:'j' }, { l:'k',s:'k' },
  { l:'l',s:'l' }, { l:';',sl:':',s:';' }, { l:"'",sl:'"',s:"'" },
  { l:'↵', s:'\r', g:1.5, cls:'mkb-mod mkb-return' },
])

const row4zxcv: KeyDef[] = [
  { l:'⇧', sp:'shift', g:2.2, cls:'mkb-mod', id:'mkb-shift' },
  { l:'z',s:'z' }, { l:'x',s:'x' }, { l:'c',s:'c' }, { l:'v',s:'v' },
  { l:'b',s:'b' }, { l:'n',s:'n' }, { l:'m',s:'m' },
  { l:',',sl:'<',s:',',cls:'mkb-alpha' }, { l:'.',sl:'>',s:'.',cls:'mkb-alpha' }, { l:'/',sl:'?',s:'/',cls:'mkb-alpha' },
]

const arrowUp: KeyDef = { l:'↑', s:'\x1b[A', repeat:true, cls:'mkb-arrow' }
const arrowDown: KeyDef = { l:'↓', s:'\x1b[B', repeat:true, cls:'mkb-arrow' }
const arrowLeft: KeyDef = { l:'←', s:'\x1b[D', repeat:true, cls:'mkb-arrow' }
const arrowRight: KeyDef = { l:'→', s:'\x1b[C', repeat:true, cls:'mkb-arrow' }

const row5bottom: KeyDef[] = [
  { l:'fn', sp:'fn', g:1.05, cls:'mkb-mod' },
  { l:'ctrl', sp:'ctrl', g:1.05, cls:'mkb-mod', id:'mkb-ctrl' },
  { l:'opt', sp:'alt', g:1.05, cls:'mkb-mod', id:'mkb-alt' },
  { l:'⌘', sp:'cmd', g:1.05, cls:'mkb-mod' },
  { l:'', s:' ', g:8, id:'mkb-space' },
]

const kbswitchAction = computed<KeyDef>(() => ({
  l: '',
  icon: Keyboard,
  sp: 'kbswitch',
  g: 1.5,
  cls: 'mkb-mod mkb-action-back',
  id: 'mkb-kbswitch2',
}))

const actionFirstRow = computed(() => {
  const cfg = settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD
  const rows = cfg.rows?.length ? cfg.rows : DEFAULT_ACTION_KEYBOARD.rows
  const first = rows[0] ?? []
  return [kbswitchAction.value, ...mapActionKeys(first, false)]
})

const actionFollowingRows = computed(() => {
  const cfg = settings.action_keyboard ?? DEFAULT_ACTION_KEYBOARD
  const rows = cfg.rows?.length ? cfg.rows : DEFAULT_ACTION_KEYBOARD.rows
  if (rows.length < 2) return []
  const tail = rows.slice(1)
  return tail.map((r, i) => mapActionKeys(r ?? [], i === tail.length - 1))
})

const actionArrowUp: KeyDef = { l:'↑', s:'\x1b[A', cls:'mkb-mod mkb-action-arrow', repeat:true }

const actionArrowBot: KeyDef[] = [
  { l:'←', s:'\x1b[D', cls:'mkb-mod mkb-action-arrow', repeat:true },
  { l:'↓', s:'\x1b[B', cls:'mkb-mod mkb-action-arrow', repeat:true },
  { l:'→', s:'\x1b[C', cls:'mkb-mod mkb-action-arrow', repeat:true },
]

const actionEnter: KeyDef = { l:'↵', s:'\r', cls:'mkb-mod mkb-action-enter mkb-return' }

function onTextInputFocus() {
  textInputFocused.value = true
}

function onTextInputBlur() {
  setTimeout(() => { textInputFocused.value = false }, 100)
}

function sendTextInput() {
  const text = textInput.value
  if (!text) return
  props.getSendFn()?.(text + '\r')
  textInput.value = ''
  textInputRef.value?.focus()
}

function onKeyPress(ch: string) {
  let data = ch
  if (data.length !== 1) {
    if (data === '\r' || data === '\n') inputBuffer.value = ''
    else if (data === '\x1b[A' || data === '\x1b[B') inputBuffer.value = ''
    modState.ctrl = false
    modState.alt = false
    modState.shift = false
    props.getSendFn()?.(data)
    if (kbMode.value === 'default') fetchDebounced(inputBuffer.value || undefined)
    return
  }
  const cc = data.charCodeAt(0)
  if (cc < 32 || cc === 127) {
    if (cc === 13 || cc === 10) inputBuffer.value = ''
    else if (cc === 127 || cc === 8) inputBuffer.value = inputBuffer.value.slice(0, -1)
    modState.ctrl = false
    modState.alt = false
    modState.shift = false
    props.getSendFn()?.(data)
    if (kbMode.value === 'default') fetchDebounced(inputBuffer.value || undefined)
    return
  }
  if (modState.ctrl) {
    const code = data.toUpperCase().charCodeAt(0) - 64
    if (code >= 1 && code <= 26) data = String.fromCharCode(code)
    modState.ctrl = false
    inputBuffer.value = ''
  } else {
    inputBuffer.value += data
  }
  if (modState.alt) {
    data = '\x1b' + data
    modState.alt = false
  }
  if (modState.shift) modState.shift = false

  props.getSendFn()?.(data)
  if (kbMode.value === 'default') fetchDebounced(inputBuffer.value || undefined)
}

function onSpecial(sp: string) {
  if (sp === 'shift') modState.shift = !modState.shift
  if (sp === 'ctrl') modState.ctrl = !modState.ctrl
  if (sp === 'alt') modState.alt = !modState.alt
  if (sp === 'kbswitch') {
    swipeTransition.value = true
    kbMode.value = kbMode.value === 'action' ? 'default' : 'action'
    if (kbMode.value === 'default') fetchSuggestions()
    nextTick(() => updateHeight())
  }
}

function onSuggestionSelect(command: string) {
  const sendFn = props.getSendFn()
  if (!sendFn) return
  // Clear current input line before inserting suggestion
  const currentLen = inputBuffer.value.length
  if (currentLen > 0) {
    sendFn('\x15') // Ctrl+U: kill line (works in bash/zsh)
  }
  inputBuffer.value = command
  sendFn(command)
}

function onSuggestionEdit(command: string) {
  const sendFn = props.getSendFn()
  if (kbMode.value === 'action') {
    inputBuffer.value = command
    textInput.value = command
    nextTick(() => textInputRef.value?.focus())
  } else {
    if (sendFn && inputBuffer.value.length > 0) {
      sendFn('\x15')
    }
    inputBuffer.value = command
    sendFn?.(command)
  }
}

async function onExpandHistory() {
  const { authFetch, apiUrl } = await import('../../composables/apiBase')
  try {
    const res = await authFetch(apiUrl('/api/history?limit=100'))
    if (res.ok) allSuggestions.value = await res.json()
  } catch {}
  showHistoryPanel.value = true
}

function onHistoryPanelSelect(command: string) {
  showHistoryPanel.value = false
  const sendFn = props.getSendFn()
  if (sendFn && inputBuffer.value.length > 0) {
    sendFn('\x15')
  }
  inputBuffer.value = command
  sendFn?.(command)
}

function onHistoryPanelDelete(command: string) {
  allSuggestions.value = allSuggestions.value.filter(s => s.command !== command)
}

function onFilePickerSelect(path: string) {
  const el = textInputRef.value
  if (el) {
    const start = el.selectionStart ?? textInput.value.length
    const end = el.selectionEnd ?? start
    textInput.value = textInput.value.slice(0, start) + path + textInput.value.slice(end)
    nextTick(() => {
      el.selectionStart = el.selectionEnd = start + path.length
      el.focus()
    })
  } else {
    textInput.value += path
  }
  showFilePicker.value = false
}

function updateHeight() {
  if (!barRef.value) return
  // Sync swipe container height to main panel so action panel doesn't exceed it
  const mainPanel = barRef.value.querySelector('#mkb-main-panel') as HTMLElement | null
  const actionPanel = barRef.value.querySelector('#mkb-action-panel') as HTMLElement | null
  if (swipeContainerRef.value) {
    const mainH = mainPanel ? mainPanel.scrollHeight : 0
    const actionH = actionPanel ? actionPanel.scrollHeight : 0
    swipeContainerRef.value.style.height = `${Math.max(mainH, actionH) + 2}px`
  }
  const h = props.visible ? barRef.value.getBoundingClientRect().height : 0
  document.documentElement.style.setProperty('--mkb-height', `${h}px`)
}

// Viewport listener for system keyboard detection
let naturalVH = 0

function onViewportChange() {
  if (!window.visualViewport) return
  const vh = window.visualViewport.height
  if (vh > naturalVH) naturalVH = vh
  const off = window.innerHeight - (window.visualViewport.offsetTop + vh)
  const sysKbOpen = (naturalVH - vh) > 120
  if (barRef.value) {
    if (!props.visible) {
      barRef.value.style.display = 'none'
    } else if (sysKbOpen && textInputFocused.value) {
      // System keyboard open with our input focused: show bar, hide panels via v-show
      barRef.value.style.display = ''
      barRef.value.style.bottom = `${Math.max(0, off)}px`
    } else if (sysKbOpen) {
      barRef.value.style.display = 'none'
    } else {
      barRef.value.style.display = ''
      barRef.value.style.bottom = `${Math.max(0, off)}px`
    }
  }
  updateHeight()
}

watch(() => props.visible, (v) => {
  nextTick(() => updateHeight())
})

watch(globalSelectedPath, () => {
  if (globalSelectedPath.value && props.visible) {
    emit('update:visible', false)
  }
})

onMounted(() => {
  fetchSuggestions()

  if (window.visualViewport) {
    naturalVH = window.visualViewport.height
    window.visualViewport.addEventListener('resize', onViewportChange)
    window.visualViewport.addEventListener('scroll', onViewportChange)
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { naturalVH = window.visualViewport!.height }, 300)
    })
  }

  let roAf = 0
  if (barRef.value) {
    new ResizeObserver(() => {
      cancelAnimationFrame(roAf)
      roAf = requestAnimationFrame(() => updateHeight())
    }).observe(barRef.value)
  }
})

onBeforeUnmount(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportChange)
    window.visualViewport.removeEventListener('scroll', onViewportChange)
  }
  document.documentElement.style.setProperty('--mkb-height', '0px')
})
</script>

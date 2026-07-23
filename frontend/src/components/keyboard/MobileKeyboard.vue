<template>
  <div ref="barRef" id="mobile-kb" v-show="visible">
    <!-- Default mode: suggestion bar on top -->
    <div class="mkb-kb-bar" v-show="kbMode === 'default'">
      <SuggestionBar
        :suggestions="suggestions"
        @select="onSuggestionSelect"
        @edit="onSuggestionEdit"
        @expand="onExpandHistory"
      />
      <button
        type="button"
        class="mkb-collapse-btn"
        @mousedown.prevent="emit('update:visible', false)"
        @touchstart.prevent="emit('update:visible', false)"
      >
        ▼
      </button>
    </div>

    <!-- Action mode: text input on top -->
    <div class="mkb-kb-bar" v-show="kbMode === 'action'">
      <div class="mkb-text-input-glow" :class="{ 'mkb-glow-active': !textInputFocused }">
        <textarea
          ref="textInputRef"
          class="mkb-text-input"
          :class="{ 'mkb-text-input-focused': textInputFocused }"
          :placeholder="t('mobileKb.actionPlaceholder')"
          enterkeyhint="send"
          rows="1"
          v-model="textInput"
          @focus="onTextInputFocus"
          @blur="onTextInputBlur"
          @input="resizeTextInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact.prevent="sendTextInput"
        />
      </div>
      <button
        v-show="!textInputFocused"
        type="button"
        class="mkb-collapse-btn"
        @mousedown.prevent="emit('update:visible', false)"
        @touchstart.prevent="emit('update:visible', false)"
      >
        ▼
      </button>
    </div>

    <!-- Toolbar (visible when textarea focused) -->
    <div class="mkb-toolbar" v-show="textInputFocused">
      <button
        type="button"
        class="mkb-tool-btn"
        :title="t('mobileKb.insertMacFile')"
        @mousedown.prevent="showFilePicker = true"
      >
        <FolderOpen :size="18" />
      </button>
      <input
        v-if="!isTauri()"
        ref="phoneFileInputRef"
        type="file"
        accept="*/*"
        multiple
        hidden
        @change="onPhoneFileInputChange"
      />
      <button
        v-if="!isTauri()"
        type="button"
        class="mkb-tool-btn"
        :title="t('mobileKb.insertPhoneFile')"
        :disabled="phoneUploading"
        @mousedown.prevent="openPhoneFilePicker"
      >
        <LoaderCircle v-if="phoneUploading" :size="18" class="mkb-spin" />
        <Upload v-else :size="18" />
      </button>
      <button
        v-if="pasteSupported"
        type="button"
        class="mkb-tool-btn"
        :title="t('mobileKb.phonePaste')"
        @mousedown.prevent="onPhonePaste"
      >
        <ClipboardPaste :size="18" />
      </button>
      <button
        v-if="globalSelectedPath"
        type="button"
        class="mkb-tool-btn mkb-path-chip"
        @mousedown.prevent="onFilePickerSelect(globalSelectedPath!)"
      >
        <FileText :size="14" />
        <span class="mkb-path-label">{{ globalSelectedPath!.split('/').pop() }}</span>
      </button>
      <button
        type="button"
        class="mkb-tool-btn"
        :title="t('mobileKb.newline')"
        @mousedown.prevent="insertTextAtCaret('\n')"
      >
        <CornerDownLeft :size="18" />
        <span class="mkb-btn-label">{{ t('mobileKb.newline') }}</span>
      </button>
      <button
        type="button"
        class="mkb-tool-btn mkb-btn-danger"
        :title="t('mobileKb.deleteLine')"
        @mousedown.prevent="deleteSelectedOrLogicalLine"
      >
        <Trash2 :size="18" />
        <span class="mkb-btn-label">{{ t('mobileKb.deleteLine') }}</span>
      </button>
      <button
        type="button"
        class="mkb-tool-btn mkb-dismiss-btn"
        :title="t('mobileKb.dismissKeyboard')"
        :aria-label="t('mobileKb.dismissKeyboard')"
        @mousedown.prevent.stop="dismissSystemKeyboard"
      >
        <KeyboardOff :size="18" />
      </button>
    </div>

    <div v-if="toolbarQuickKeyDefs.length" v-show="textInputFocused" class="mkb-toolbar mkb-toolbar-quick-row">
      <div class="mkb-toolbar-quick-strip">
        <MkbKey
          v-for="(key, i) in toolbarQuickKeyDefs"
          :key="`${key.l}-${key.s ?? key.sp ?? i}-${i}`"
          class="mkb-toolbar-quick-key"
          :k="key"
          :state="modState"
          @key-press="onKeyPress"
          @app-action="onAppAction"
          @special="onSpecial"
        />
      </div>
    </div>

    <div v-if="phoneUploading" class="mkb-upload-progress">
      <div class="mkb-upload-progress-track">
        <div class="mkb-upload-progress-fill" :style="{ width: `${phoneUploadProgress}%` }"></div>
      </div>
      <span>{{ phoneUploadProgressLabel() }}</span>
    </div>

    <!-- Swipeable panels container -->
    <div ref="swipeContainerRef" class="mkb-swipe-container" v-show="!textInputFocused">
      <div class="mkb-swipe-track" :style="swipeTrackStyle">
        <!-- Main keyboard panel -->
        <div id="mkb-main-panel">
          <!-- Row 1: ` 1-0 - = ⌫ -->
          <MkbRow :keys="row1" :state="modState" @key-press="onKeyPress" @app-action="onAppAction" @special="onSpecial" />
          <!-- Row 2: tab q-p [ ] \ -->
          <MkbRow :keys="row2" :state="modState" @key-press="onKeyPress" @app-action="onAppAction" @special="onSpecial" />
          <!-- Row 3: ⌨ a-l ; ' ↵ (stagger) -->
          <MkbRow
            :keys="row3"
            :state="modState"
            @key-press="onKeyPress"
            @app-action="onAppAction"
            @special="onSpecial"
            stagger="asdf"
          />
          <!-- Rows 4-5 with arrow cluster -->
          <div class="mkb-rows-45">
            <div class="mkb-rows-45-main">
              <MkbRow
                :keys="row4zxcv"
                :state="modState"
                @key-press="onKeyPress"
                @app-action="onAppAction"
                @special="onSpecial"
              />
              <MkbRow
                :keys="row5bottom"
                :state="modState"
                @key-press="onKeyPress"
                @app-action="onAppAction"
                @special="onSpecial"
              />
            </div>
            <div class="mkb-arrow-cluster">
              <MkbKey :k="arrowUp" :state="modState" @key-press="onKeyPress" @app-action="onAppAction" @special="onSpecial" />
              <div class="mkb-arrow-cluster-bot">
                <MkbKey
                  :k="arrowLeft"
                  :state="modState"
                  @key-press="onKeyPress"
                  @app-action="onAppAction"
                  @special="onSpecial"
                />
                <MkbKey
                  :k="arrowDown"
                  :state="modState"
                  @key-press="onKeyPress"
                  @app-action="onAppAction"
                  @special="onSpecial"
                />
                <MkbKey
                  :k="arrowRight"
                  :state="modState"
                  @key-press="onKeyPress"
                  @app-action="onAppAction"
                  @special="onSpecial"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Action panel -->
        <div id="mkb-action-panel">
          <MkbRow
            :keys="actionFirstRow"
            :state="modState"
            @key-press="onKeyPress"
            @app-action="onAppAction"
            @special="onSpecial"
          />
          <MkbRow
            v-for="(r, i) in actionFollowingRows"
            :key="i"
            :keys="r"
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
              <div v-for="(row, ri) in actionBottomRows" :key="ri" class="mkb-action-grid-row">
                <MkbKey
                  v-for="(key, ki) in row"
                  :key="ki"
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
      </div>
      <!-- /mkb-swipe-track -->
    </div>
    <!-- /mkb-swipe-container -->

    <!-- Swipe indicator dots (outside overflow-hidden container) -->
    <div
      class="mkb-swipe-dots"
      v-show="!textInputFocused"
      @touchstart.passive="onSwipeStart"
      @touchmove.passive="onSwipeMove"
      @touchend="onSwipeEnd"
    >
      <span
        class="mkb-dot"
        :class="{ active: kbMode === 'default' }"
        @click="switchMode('default')"
      ></span>
      <span
        class="mkb-dot"
        :class="{ active: kbMode === 'action' }"
        @click="switchMode('action')"
      ></span>
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

<script lang="ts">
export const SPLIT_DELAY_MS = 50
</script>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MkbRow from './MkbRow.vue'
import MkbKey from './MkbKey.vue'
import SuggestionBar from './SuggestionBar.vue'
import HistoryPanel from './HistoryPanel.vue'
import FilePickerModal from '../preview/FilePickerModal.vue'
import type { AppActionOptions, ModState } from './mkbTypes'
import {
  useSettings,
  onThemeChange,
  onTextChange,
} from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useHistory } from '../../composables/useHistory'
import {
  FolderOpen,
  FileText,
  Upload,
  LoaderCircle,
  CornerDownLeft,
  ClipboardPaste,
  Trash2,
  KeyboardOff,
} from 'lucide-vue-next'
import { useSelectedPath } from '../../composables/useFileNavigation'
import { shellEscapePath, trailingPathDeleteLen } from '../../utils/shell'
import { isTauri } from '../../composables/useTransport'
import { formatMB, useUpload, type UploadProgress } from '../../composables/useUpload'
import type { UploadResponse } from '../../types/uploads'
import { POSITION, useToast } from 'vue-toastification'
import { useTextareaMetrics } from '../../composables/useTextareaMetrics'
import { useSwipePanel } from '../../composables/useSwipePanel'
import { useKeyboardLayout } from '../../composables/useKeyboardLayout'
import type { SendDataFn } from '../../utils/frozenSend'
import { hasCollapseGuard } from '../../utils/keyboardGuardMode'

const props = defineProps<{
  visible: boolean
  paneId: string
  getSendFn: () => SendDataFn | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
  bookmarks: []
  'app-action': [id: string, options: AppActionOptions]
  dismiss: []
}>()

const { settings } = useSettings()
const { t } = useI18n()
const toast = useToast()
const { suggestions, fetchSuggestions, fetchDebounced } = useHistory()
const { selectedPath: globalSelectedPath } = useSelectedPath()
const { uploadFiles, uploadErrorStatus } = useUpload()

const showHistoryPanel = ref(false)
const allSuggestions = ref<import('../../composables/useHistory').SuggestionItem[]>([])
const showFilePicker = ref(false)
const phoneFileInputRef = ref<HTMLInputElement>()
const phoneUploading = ref(false)
const phoneUploadProgress = ref(0)
const phoneUploadLoaded = ref(0)
const phoneUploadTotal = ref(0)
const phoneUploadProcessing = ref(false)
const barRef = ref<HTMLElement>()
const swipeContainerRef = ref<HTMLElement>()
const textInputRef = ref<HTMLTextAreaElement>()
const textInput = ref('')
const textInputFocused = ref(false)
const kbMode = ref<'default' | 'action'>('action')
const inputBuffer = ref('')
let blurTimer: ReturnType<typeof setTimeout> | null = null
let composing = false
let sendLocked = false
let sendGeneration = 0
let componentMounted = false

const {
  resetTextareaMetrics,
  getTextareaMetrics,
  restoreTextInputPadding,
  resetTextInputHeight,
  resizeTextInput,
} = useTextareaMetrics({
  textInputRef,
  barRef,
  updateHeight,
})

const unsubThemeMetrics = onThemeChange(resetTextareaMetrics)
const unsubTextMetrics = onTextChange(resetTextareaMetrics)

const {
  swipeStartX,
  swipeStartY,
  swipeDeltaX,
  swiping,
  swipeTransition,
  swipeTrackStyle,
  onSwipeStart,
  onSwipeMove,
  onSwipeEnd,
  switchMode,
} = useSwipePanel({
  kbMode,
  barRef,
  applyHeight,
  fetchSuggestions,
})

const modState = reactive<ModState>({
  shift: false,
  ctrl: false,
  alt: false,
})

const {
  row1,
  row2,
  row3,
  row4zxcv,
  arrowUp,
  arrowDown,
  arrowLeft,
  arrowRight,
  row5bottom,
  kbswitchAction,
  actionFirstRow,
  actionFollowingRows,
  actionBottom,
  actionBottomRows,
  actionEnter,
  pasteSupported,
  toolbarQuickKeyDefs,
  withActionFooterClass,
  mapActionFooterRow,
} = useKeyboardLayout({ kbMode, settings })

function onTextInputFocus() {
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
  textInputFocused.value = true
  nextTick(resizeTextInput)
}

function onTextInputBlur() {
  if (blurTimer) clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    if (document.activeElement === textInputRef.value) {
      blurTimer = null
      return
    }
    textInputFocused.value = false
    resetTextInputHeight()
    nextTick(updateHeight)
    blurTimer = null
  }, 100)
}

function dismissSystemKeyboard() {
  textInputRef.value?.blur()
  emit('dismiss')
}

function onCompositionStart() {
  composing = true
}

function onCompositionEnd() {
  composing = false
}

function clearSentText() {
  textInput.value = ''
  textInputRef.value?.focus()
  nextTick(resizeTextInput)
}

async function sendTextInput() {
  if (composing || sendLocked) return
  const text = textInput.value
  if (text.includes('\0') || text.includes('\x1b')) return
  const send = props.getSendFn()
  if (!send) return
  if (!text) {
    send('\r')
    return
  }

  const direct =
    !text.includes('\n') &&
    settings.quick_send_threshold > 0 &&
    text.length <= settings.quick_send_threshold
  if (!direct) {
    send(text)
    clearSentText()
    return
  }

  sendLocked = true
  const generation = ++sendGeneration
  try {
    const textLeg = send(text)
    clearSentText()
    await textLeg
    await new Promise<void>((resolve) => setTimeout(resolve, SPLIT_DELAY_MS))
    if (componentMounted && generation === sendGeneration) send('\r')
  } catch {
    // Rejected text leg: degrade to two-stage (no \r). Transport already logged.
  } finally {
    if (generation === sendGeneration) sendLocked = false
  }
}

function onKeyPress(ch: string) {
  if (sendLocked) return
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

function onAppAction(id: string, options: AppActionOptions) {
  if (sendLocked) return
  emit('app-action', id, options)
}

function onSpecial(sp: string) {
  if (sp === 'shift') modState.shift = !modState.shift
  if (sp === 'ctrl') modState.ctrl = !modState.ctrl
  if (sp === 'alt') modState.alt = !modState.alt
  if (sp === 'kbswitch') {
    swipeTransition.value = true
    kbMode.value = kbMode.value === 'action' ? 'default' : 'action'
    if (kbMode.value === 'default') fetchSuggestions()
    nextTick(applyHeight)
  }
  if (sp === 'bookmarks') {
    emit('bookmarks')
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
    nextTick(() => {
      textInputRef.value?.focus()
      nextTick(resizeTextInput)
    })
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
  allSuggestions.value = allSuggestions.value.filter((s) => s.command !== command)
}

function replaceTextInputRange(start: number, end: number, replacement: string) {
  const el = textInputRef.value
  const caret = start + replacement.length
  textInput.value = textInput.value.slice(0, start) + replacement + textInput.value.slice(end)
  if (el) {
    nextTick(() => {
      el.selectionStart = el.selectionEnd = caret
      el.focus()
      nextTick(resizeTextInput)
    })
  } else {
    nextTick(resizeTextInput)
  }
}

function insertTextAtCaret(text: string) {
  const el = textInputRef.value
  const start = el?.selectionStart ?? textInput.value.length
  const end = el?.selectionEnd ?? start
  replaceTextInputRange(start, end, text)
}

function onFilePickerSelect(path: string) {
  insertTextAtCaret(shellEscapePath(path))
  showFilePicker.value = false
}

function openPhoneFilePicker() {
  if (!phoneUploading.value) phoneFileInputRef.value?.click()
}

function phoneUploadProgressLabel() {
  if (phoneUploadProcessing.value) return t('settings.uploads.processing')
  return `${formatMB(phoneUploadLoaded.value)} / ${formatMB(phoneUploadTotal.value)} MB`
}

function updatePhoneUploadProgress(p: UploadProgress) {
  phoneUploadLoaded.value = p.loaded
  phoneUploadTotal.value = p.total
  const pct = Math.max(0, Math.min(100, Math.round((p.loaded / p.total) * 100)))
  phoneUploadProgress.value = pct
  phoneUploadProcessing.value = pct >= 100
}

function uploadErrorMessage(err: unknown) {
  const status = uploadErrorStatus(err)
  if (status === 413) return t('mobileKb.uploadTooLarge')
  if (status === 507) return t('settings.uploads.toastDiskFull')
  return t('mobileKb.uploadFailed')
}

async function onPhoneFileInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || phoneUploading.value) return

  phoneUploading.value = true
  phoneUploadProgress.value = 0
  phoneUploadLoaded.value = 0
  phoneUploadTotal.value = 0
  phoneUploadProcessing.value = false
  try {
    const data: UploadResponse = await uploadFiles(files, { onProgress: updatePhoneUploadProgress })
    const paths = data.saved ?? []
    if (paths.length) insertTextAtCaret(paths.map(shellEscapePath).join(' '))
    window.dispatchEvent(new CustomEvent('dinotty-upload-status', { detail: data }))
    toast.success(t('mobileKb.uploadDone'), { position: POSITION.BOTTOM_CENTER })
  } catch (err) {
    toast.error(uploadErrorMessage(err), { position: POSITION.BOTTOM_CENTER })
  } finally {
    phoneUploading.value = false
    phoneUploadProgress.value = 0
    phoneUploadLoaded.value = 0
    phoneUploadTotal.value = 0
    phoneUploadProcessing.value = false
    input.value = ''
  }
}

async function onPhonePaste() {
  if (!pasteSupported.value) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) insertTextAtCaret(text)
  } catch {
    // clipboard read may be denied
  }
}

function deleteSelectedOrLogicalLine() {
  const value = textInput.value
  const el = textInputRef.value
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? start
  if (start !== end) {
    replaceTextInputRange(start, end, '')
    return
  }

  const caret = start
  const before = value.slice(0, caret)
  const pathLen = trailingPathDeleteLen(before)
  if (pathLen > 0) {
    replaceTextInputRange(caret - pathLen, caret, '')
    return
  }

  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  // Visual-line delete was considered and deferred; this toolbar uses logical lines.
  if (lineStart < caret) {
    replaceTextInputRange(lineStart, caret, '')
  } else if (caret > 0) {
    replaceTextInputRange(caret - 1, caret, '')
  }
}

let updateHeightRaf = 0
function applyHeight() {
  if (!barRef.value) return
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
function updateHeight() {
  // Debounce via rAF: visualViewport fires both 'resize' and 'scroll' in rapid
  // succession on Windows when the keyboard opens/closes, which would otherwise
  // trigger multiple --mkb-height changes → multiple terminal resizes → chaotic
  // redraws in TUI apps like Codex.
  cancelAnimationFrame(updateHeightRaf)
  updateHeightRaf = requestAnimationFrame(applyHeight)
}

// Viewport listener for system keyboard detection
let naturalVH = 0
let sysKbOpen = false

function onViewportChange() {
  if (!window.visualViewport) return
  const vh = window.visualViewport.height
  if (vh > naturalVH) naturalVH = vh
  const off = window.innerHeight - (window.visualViewport.offsetTop + vh)
  sysKbOpen = naturalVH - vh > 120
  // Set --kb-open: either system keyboard or custom keyboard is visible
  document.documentElement.style.setProperty('--kb-open', sysKbOpen || props.visible ? '1' : '0')
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
  if (textInputFocused.value) resizeTextInput()
  updateHeight()
}

watch(
  () => props.visible,
  (v) => {
    // Keep --kb-open in sync when custom keyboard opens/closes
    document.documentElement.style.setProperty('--kb-open', v || sysKbOpen ? '1' : '0')
    nextTick(applyHeight)
  }
)

watch(globalSelectedPath, () => {
  if (globalSelectedPath.value && props.visible && !hasCollapseGuard(settings.keyboard_guard_mode)) {
    emit('update:visible', false)
  }
})

function onWheelCollapse() {
  if (props.visible) emit('update:visible', false)
}

onMounted(() => {
  componentMounted = true
  fetchSuggestions()
  resetTextInputHeight()

  if (window.visualViewport) {
    naturalVH = window.visualViewport.height
    window.visualViewport.addEventListener('resize', onViewportChange)
    window.visualViewport.addEventListener('scroll', onViewportChange)
    window.addEventListener('orientationchange', onOrientationChange)
  }

  if (barRef.value) {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(roAf)
      roAf = requestAnimationFrame(() => updateHeight())
    })
    resizeObserver.observe(barRef.value)
  }
})

let roAf = 0
let resizeObserver: ResizeObserver | null = null
function onOrientationChange() {
  resetTextareaMetrics()
  setTimeout(() => {
    naturalVH = window.visualViewport!.height
    if (textInputFocused.value) resizeTextInput()
    updateHeight()
  }, 300)
}

onBeforeUnmount(() => {
  componentMounted = false
  if (sendLocked) {
    sendLocked = false
    sendGeneration++
  }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportChange)
    window.visualViewport.removeEventListener('scroll', onViewportChange)
  }
  window.removeEventListener('orientationchange', onOrientationChange)
  resizeObserver?.disconnect()
  unsubThemeMetrics()
  unsubTextMetrics()
  document.documentElement.style.setProperty('--mkb-height', '0px')
  document.documentElement.style.setProperty('--kb-open', '0')
})
</script>

<style scoped>
.mkb-toolbar .mkb-tool-btn {
  flex: 0 0 auto;
  width: auto;
  min-width: 32px;
  padding: 0 8px;
}

.mkb-btn-label {
  font-size: 12px;
  white-space: nowrap;
  margin-left: 5px;
}

.mkb-btn-danger {
  color: #ff9a9a;
  border-color: #5a3a3a;
}

.mkb-upload-progress {
  position: absolute;
  right: 12px;
  bottom: calc(100% + 12vh);
  z-index: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 132px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(22, 22, 24, 0.92);
  color: #d8d8d8;
  font-size: 11px;
  pointer-events: none;
}

.mkb-upload-progress-track {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.mkb-upload-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: #4da3ff;
  transition: width 0.16s ease;
}
</style>

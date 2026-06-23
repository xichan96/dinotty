<template>
  <div
    class="terminal-pane-container"
    @contextmenu.prevent="onContextMenu"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <div ref="wrapperRef" class="terminal-pane"></div>
    <SearchBar v-if="searchVisible && terminal" :terminal="terminal" @close="searchVisible = false" />
  </div>
  <TerminalContextMenu
    :visible="menuVisible"
    :x="menuX"
    :y="menuY"
    :selected-text="menuSelectedText"
    :link-type="linkType"
    :link-target="linkTarget"
    @close="closeMenu"
    @copy="onMenuCopy"
    @paste="onMenuPaste"
    @select-all="onMenuSelectAll"
    @open-file="onMenuOpenFile"
    @open-link="onMenuOpenLink"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { TerminalInstance } from '../../composables/useTerminal'
import SearchBar from './SearchBar.vue'
import TerminalContextMenu from './TerminalContextMenu.vue'

const props = defineProps<{
  paneId: string
}>()

const emit = defineEmits<{
  titleChange: [title: string]
  shellInfo: [shell: string]
  connect: []
  disconnect: []
  fileClick: [path: string]
  previewLink: [url: string]
  linkActivate: []
  input: [data: string]
}>()

const wrapperRef = ref<HTMLElement>()
let terminal: TerminalInstance | null = null
const searchVisible = ref(false)

// Context menu state
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuSelectedText = ref('')

// Long-press state (mobile)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressStartX = 0
let longPressStartY = 0
let longPressFired = false

// Link context menu state
const linkType = ref<'file' | 'link'>()
const linkTarget = ref<string>()

function getTerminal() {
  return terminal
}

function focus() {
  terminal?.focus()
}

function blur() {
  terminal?.blur()
}

function fit() {
  terminal?.fit()
}

function sendData(data: string, force?: boolean) {
  terminal?.sendData(data, force)
}

function setOutputListener(cb: ((data: string) => void) | null) {
  if (terminal) terminal.onRawOutput = cb
}

function toggleSearch() {
  searchVisible.value = !searchVisible.value
}

function onContextMenu(e: MouseEvent) {
  if (!terminal) return
  if (terminal.isMouseModeEnabled()) return
  const text = terminal.getSelection()
  menuSelectedText.value = text
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
  linkType.value = undefined
  linkTarget.value = undefined
}

function onMenuCopy() {
  // copy already handled in TerminalContextMenu
}

async function onMenuPaste(text: string) {
  terminal?.pasteText(text)
}

function onMenuSelectAll() {
  terminal?.selectAll()
}

function onMenuOpenFile(path: string) {
  emit('fileClick', path)
}

function onMenuOpenLink(url: string) {
  emit('previewLink', url)
}

// Mobile long-press to open context menu
function onTouchStart(e: TouchEvent) {
  if (!terminal || terminal.isMouseModeEnabled()) return
  longPressFired = false
  const touch = e.touches[0]
  longPressStartX = touch.clientX
  longPressStartY = touch.clientY
  longPressTimer = setTimeout(() => {
    longPressFired = true
    const text = terminal!.getSelection()
    menuSelectedText.value = text
    menuX.value = longPressStartX
    menuY.value = longPressStartY
    menuVisible.value = true
  }, 500)
}

function onTouchMove(e: TouchEvent) {
  if (longPressTimer && !longPressFired) {
    const touch = e.touches[0]
    if (Math.abs(touch.clientX - longPressStartX) > 10 || Math.abs(touch.clientY - longPressStartY) > 10) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  if (longPressFired) {
    e.preventDefault()
    e.stopPropagation()
    longPressFired = false
  }
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressFired = false
}

onMounted(() => {
  terminal = new TerminalInstance(props.paneId)
  terminal.onTitleChange = (tv) => emit('titleChange', tv)
  terminal.onShellInfo = (s) => emit('shellInfo', s)
  terminal.onConnect = () => emit('connect')
  terminal.onDisconnect = () => emit('disconnect')
  terminal.onInput = (data) => emit('input', data)
  terminal.onFileClick = (path, x, y) => {
    emit('linkActivate')
    linkType.value = 'file'
    linkTarget.value = path
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }
  terminal.onPreviewLink = (url, x, y) => {
    emit('linkActivate')
    linkType.value = 'link'
    linkTarget.value = url
    if (x != null && y != null) {
      menuX.value = x
      menuY.value = y
    }
    menuSelectedText.value = ''
    menuVisible.value = true
  }

  requestAnimationFrame(() => {
    if (wrapperRef.value) {
      terminal!.attach(wrapperRef.value)
    }
  })
})

onBeforeUnmount(() => {
  terminal?.destroy()
  terminal = null
})

defineExpose({ getTerminal, focus, blur, fit, sendData, setOutputListener, toggleSearch })
</script>

<style scoped>
.terminal-pane-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
}
.terminal-pane {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>

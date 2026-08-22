<template>
  <Teleport to="body">
    <!-- Context menu -->
    <div v-if="visible" class="tcm-backdrop" @contextmenu.prevent="close" @pointerdown="close">
      <div class="tcm-menu" :style="menuStyle" role="menu" @contextmenu.prevent @pointerdown.stop>
        <button v-if="linkType === 'file'" class="tcm-item" role="menuitem" @click="onOpenFile">
          <FolderOpen :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxOpenFile') }}</span>
        </button>
        <button v-if="linkType === 'link'" class="tcm-item" role="menuitem" @click="onOpenLink">
          <ExternalLink :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxOpenLink') }}</span>
        </button>
        <div v-if="linkType" class="tcm-sep" />
        <button class="tcm-item" role="menuitem" :disabled="!canCopy" @click="onCopy">
          <Copy :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxCopy') }}</span>
          <span class="tcm-hint">{{ isMac ? '⌘C' : 'Ctrl+C' }}</span>
        </button>
        <button class="tcm-item" role="menuitem" @click="onPaste">
          <ClipboardPaste :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxPaste') }}</span>
          <span class="tcm-hint">{{ isMac ? '⌘V' : 'Ctrl+V' }}</span>
        </button>
        <div class="tcm-sep" />
        <button class="tcm-item" role="menuitem" :disabled="!hasSelection" @click="onBookmark">
          <Bookmark :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxBookmark') }}</span>
          <span class="tcm-hint">{{ isMac ? '⌘⇧B' : 'Ctrl+Shift+B' }}</span>
        </button>
        <button class="tcm-item" role="menuitem" @click="onSelectAll">
          <TextSelect :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxSelectAll') }}</span>
          <span class="tcm-hint">{{ isMac ? '⌘A' : 'Ctrl+A' }}</span>
        </button>
        <div class="tcm-sep" />
        <button class="tcm-item" role="menuitem" @click="onSplitRight">
          <Columns2 :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxSplitRight') }}</span>
          <span class="tcm-hint">{{ shortcutHint('splitHorizontal') }}</span>
        </button>
        <button class="tcm-item" role="menuitem" @click="onSplitDown">
          <Rows2 :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxSplitDown') }}</span>
          <span class="tcm-hint">{{ shortcutHint('splitVertical') }}</span>
        </button>
        <button class="tcm-item" role="menuitem" @click="onBroadcast">
          <Radio :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxBroadcast') }}</span>
          <span class="tcm-hint">{{ shortcutHint('toggleBroadcast') }}</span>
        </button>
        <template v-if="isSsh">
          <div class="tcm-sep" />
          <button class="tcm-item" role="menuitem" @click="onNewLocalTerminal">
            <Monitor :size="12" class="tcm-icon" />
            <span class="tcm-label">{{ t('terminal.ctxNewLocalTerminal') }}</span>
          </button>
        </template>
        <div class="tcm-sep" />
        <button class="tcm-item" role="menuitem" @click="onCopyPaneId">
          <ClipboardCopy :size="12" class="tcm-icon" />
          <span class="tcm-label">{{ t('terminal.ctxCopyPaneId') }}</span>
        </button>
      </div>
    </div>

    <!-- Bookmark save dialog -->
    <div v-if="bookmarkDialogVisible" class="tcm-backdrop" @pointerdown="closeBookmarkDialog">
      <div class="tcm-dialog" @pointerdown.stop>
        <div class="tcm-dialog-header">
          <span class="tcm-dialog-title">{{ t('terminal.ctxSaveBookmark') }}</span>
          <button class="tcm-dialog-close" @click="closeBookmarkDialog">✕</button>
        </div>
        <div class="tcm-dialog-body">
          <label class="tcm-field">
            <span class="tcm-field-label">{{ t('terminal.ctxName') }}</span>
            <input
              ref="nameInputRef"
              v-model="bookmarkName"
              class="tcm-input"
              :placeholder="t('terminal.ctxName')"
              @keydown.enter="commandInputRef?.focus()"
            />
          </label>
          <label class="tcm-field">
            <span class="tcm-field-label">{{ t('terminal.ctxCommand') }}</span>
            <textarea
              ref="commandInputRef"
              v-model="bookmarkCommand"
              class="tcm-textarea"
              :placeholder="t('terminal.ctxCommand')"
              rows="3"
              @keydown.meta.enter="saveBookmark"
              @keydown.ctrl.enter="saveBookmark"
            />
          </label>
        </div>
        <div class="tcm-dialog-footer">
          <button class="tcm-btn tcm-btn-ghost" @click="closeBookmarkDialog">
            {{ t('terminal.cancel') }}
          </button>
          <button
            class="tcm-btn tcm-btn-primary"
            :disabled="!bookmarkCommand.trim()"
            @click="saveBookmark"
          >
            {{ t('terminal.ctxSave') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import {
  Copy,
  ClipboardCopy,
  ClipboardPaste,
  Bookmark,
  TextSelect,
  FolderOpen,
  ExternalLink,
  Columns2,
  Rows2,
  Radio,
  Monitor,
} from 'lucide-vue-next'
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useKeybindings } from '../../composables/useKeybindings'
import { copyToClipboard } from '../../utils/clipboard'
import { randomId } from '../../utils/id'
import { useToast } from 'vue-toastification'
import { resolveResponsiveToastPosition } from '../../utils/toastPosition'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  selectedText: string
  linkType?: 'file' | 'link'
  linkTarget?: string
  paneId: string
  isSsh?: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: []
  paste: []
  selectAll: []
  openFile: [path: string]
  openLink: [url: string]
  splitHorizontal: []
  splitVertical: []
  toggleBroadcast: []
  newLocalTerminal: []
}>()

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

const { t } = useI18n()
const { settings, saveSettings } = useSettings()
const { getBinding, formatBinding } = useKeybindings()
const toast = useToast()

function shortcutHint(id: string): string {
  return formatBinding(getBinding(id)).join('')
}

const bookmarkDialogVisible = ref(false)
const bookmarkName = ref('')
const bookmarkCommand = ref('')
const nameInputRef = ref<HTMLInputElement>()
const commandInputRef = ref<HTMLTextAreaElement>()

const hasSelection = computed(() => props.selectedText.length > 0)
const canCopy = computed(() => hasSelection.value || !!props.linkTarget)

const menuStyle = computed(() => {
  const MENU_WIDTH = 200
  const BASE_HEIGHT = 335
  const LINK_ITEM_HEIGHT = 36
  const SSH_ITEM_HEIGHT = 36 + 9 // button + separator
  const SEP_HEIGHT = 9
  const menuHeight =
    BASE_HEIGHT +
    (props.linkType ? LINK_ITEM_HEIGHT + SEP_HEIGHT : 0) +
    (props.isSsh ? SSH_ITEM_HEIGHT : 0)
  const PAD = 8
  let x = props.x
  let y = props.y
  if (x + MENU_WIDTH > window.innerWidth - PAD) x = window.innerWidth - MENU_WIDTH - PAD
  if (y + menuHeight > window.innerHeight - PAD) y = window.innerHeight - menuHeight - PAD
  if (x < PAD) x = PAD
  if (y < PAD) y = PAD
  return { left: `${x}px`, top: `${y}px` }
})

function close() {
  emit('close')
}

function onCopy() {
  const text = props.selectedText || props.linkTarget
  if (!text) return
  copyToClipboard(text)
  emit('copy')
  close()
}

function onCopyPaneId() {
  void copyToClipboard(props.paneId)
  toast.success(t('overview.paneIdCopied'), { position: resolveResponsiveToastPosition() })
  close()
}

function onPaste() {
  emit('paste')
  close()
}

function onBookmark() {
  if (!hasSelection.value) return
  const text = props.selectedText.trim()
  bookmarkName.value = text.length > 30 ? text.slice(0, 30) + '...' : text
  bookmarkCommand.value = text
  bookmarkDialogVisible.value = true
  close()
  nextTick(() => nameInputRef.value?.select())
}

function closeBookmarkDialog() {
  bookmarkDialogVisible.value = false
}

function saveBookmark() {
  const cmd = bookmarkCommand.value.trim()
  if (!cmd) return
  settings.bookmarks.push({
    id: randomId(),
    name: bookmarkName.value.trim() || cmd.slice(0, 30),
    command: cmd,
    group: null,
  })
  saveSettings()
  closeBookmarkDialog()
}

function onSelectAll() {
  emit('selectAll')
  close()
}

function onOpenFile() {
  if (props.linkTarget) emit('openFile', props.linkTarget)
  close()
}

function onOpenLink() {
  if (props.linkTarget) emit('openLink', props.linkTarget)
  close()
}

function onSplitRight() {
  emit('splitHorizontal')
  close()
}

function onSplitDown() {
  emit('splitVertical')
  close()
}

function onBroadcast() {
  emit('toggleBroadcast')
  close()
}

function onNewLocalTerminal() {
  emit('newLocalTerminal')
  close()
}
</script>

<style scoped>
.tcm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}

.tcm-menu {
  position: fixed;
  width: 200px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 100001;
}

.tcm-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: none;
  color: var(--fg, #cccccc);
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  gap: 6px;
}
.tcm-item:hover:not(:disabled) {
  background: var(--bg-hover);
}
.tcm-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.tcm-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #888);
  flex-shrink: 0;
}
.tcm-label {
  flex: 1;
  text-align: left;
}
.tcm-hint {
  font-size: 11px;
  color: var(--fg-muted, #888);
  font-family: var(--font-mono, monospace);
  margin-left: auto;
}

.tcm-sep {
  height: 1px;
  background: var(--border);
  margin: 3px 4px;
}

/* Bookmark dialog */
.tcm-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 380px;
  max-width: 90vw;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  z-index: 100001;
}

.tcm-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.tcm-dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright, #e0e0e0);
}
.tcm-dialog-close {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--fg-muted, #888);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}
.tcm-dialog-close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.tcm-dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tcm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tcm-field-label {
  font-size: 12px;
  color: var(--fg-muted, #888);
}

.tcm-input,
.tcm-textarea {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg-bright, #e0e0e0);
  padding: 6px 8px;
  font-size: 13px;
  font-family: var(--font-mono, monospace);
  outline: none;
}
.tcm-input:focus,
.tcm-textarea:focus {
  border-color: var(--accent, #007acc);
}
.tcm-textarea {
  resize: vertical;
  min-height: 60px;
}

.tcm-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.tcm-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.tcm-btn-ghost {
  background: none;
  color: var(--fg-muted, #888);
}
.tcm-btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.tcm-btn-primary {
  background: var(--accent, #007acc);
  color: #fff;
}
.tcm-btn-primary:hover:not(:disabled) {
  filter: brightness(0.85);
}
.tcm-btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>

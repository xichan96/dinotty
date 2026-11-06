<template>
  <Teleport to="body">
    <div
      v-if="menu.contextMenu.value && visible"
      class="tree-ctx-backdrop"
      @mousedown="menu.closeContextMenu"
      @touchstart="menu.closeContextMenu"
    ></div>
    <div
      v-if="menu.contextMenu.value && visible"
      :ref="menu.setMenuEl"
      class="tree-ctx-menu"
      :class="{ 'tree-ctx-menu--bottom': narrow }"
      role="menu"
      :style="menu.contextMenuStyle.value"
      @keydown="menu.onMenuKeydown"
      @mousedown.stop
      @touchstart.stop
    >
      <button type="button" class="tree-ctx-item" role="menuitem" @click="menu.ctxNewFile">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFile') }}</span>
      </button>
      <button type="button" class="tree-ctx-item" role="menuitem" @click="menu.ctxNewFolder">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFolder') }}</span>
      </button>
      <!-- Blank-area menu: only the three creation actions, no selection fallback. -->
      <button
        v-if="!menu.contextMenu.value?.rel"
        type="button"
        class="tree-ctx-item"
        role="menuitem"
        @click="menu.ctxUpload"
      >
        <span class="tree-ctx-label">{{ t('filePreview.ctxUpload') }}</span>
      </button>
      <template v-if="menu.contextMenu.value?.rel">
        <div class="tree-ctx-sep" />
        <button
          v-if="!menu.contextMenu.value?.isDir"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="openToSide"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxOpenToSide') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button type="button" class="tree-ctx-item" role="menuitem" @click="menu.ctxRename">
          <span class="tree-ctx-label">{{ t('filePreview.ctxRename') }}</span>
          <span class="tree-ctx-kbd" aria-hidden="true">F2</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          data-testid="tree-context-move"
          role="menuitem"
          @click="menu.ctxMove"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxMoveTo') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button type="button" class="tree-ctx-item" role="menuitem" @click="menu.ctxCopyPath">
          <span class="tree-ctx-label">{{ t('filePreview.ctxCopyPath') }}</span>
        </button>
        <button
          v-if="!menu.isRemote.value"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="menu.ctxReveal"
        >
          <span class="tree-ctx-label">{{ t(revealLabelKey) }}</span>
        </button>
        <button
          v-if="menu.canRunCode.value"
          type="button"
          class="tree-ctx-item"
          data-testid="tree-context-run-code"
          role="menuitem"
          @click="menu.ctxRunCode"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxRunCode') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="menu.ctxInsertToTerminal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxInsertToTerminal') }}</span>
        </button>
        <button type="button" class="tree-ctx-item" role="menuitem" @click="menu.ctxUpload">
          <span class="tree-ctx-label">{{ t('filePreview.ctxUpload') }}</span>
        </button>
        <button
          v-if="!menu.contextMenu.value?.isDir"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="menu.ctxDownload"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDownload') }}</span>
        </button>
        <button type="button" class="tree-ctx-item" role="menuitem" @click="toggleBookmark">
          <span class="tree-ctx-label">{{
            isBookmarked ? t('fileBookmark.removeFrom') : t('fileBookmark.addTo')
          }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item tree-ctx-item-danger"
          role="menuitem"
          @click="menu.ctxDelete"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDelete') }}</span>
          <span class="tree-ctx-kbd" aria-hidden="true">{{ deleteKbdLabel }}</span>
        </button>
      </template>
    </div>
  </Teleport>
  <ConfirmModal
    :visible="!!menu.moveConfirm.value"
    :title="t('filePreview.moveTitle')"
    :message="t('filePreview.moveConfirmMsg')"
    :confirm-text="t('filePreview.moveTitle')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="menu.onMoveConfirm"
    @cancel="menu.onMoveCancel"
  />
  <ConfirmModal
    :visible="!!menu.deleteConfirm.value"
    :title="t('filePreview.ctxDelete')"
    :message="deleteMessage"
    :confirm-text="t('filePreview.ctxDelete')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="menu.executeDelete"
    @cancel="menu.cancelDelete"
  />
  <MoveToDialog
    :visible="!!menu.moveSource.value"
    :source-rel="menu.moveSource.value?.rel ?? ''"
    :is-dir="menu.moveSource.value?.isDir ?? false"
    :pane-id="paneId"
    :fetch-dirs="fetchDirs"
    :move="
      async (src, dest) => {
        await menu.moveTo(src, dest)
      }
    "
    @close="menu.closeMoveTo"
  />
  <SelectionToolbar :selected-text="''" :anchor-rect="null" @dismiss="() => {}" />
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import type { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import { revealInFileManagerKey } from '../../utils/clientPlatform'
import type { DirEntry } from './TreeRows'
import ConfirmModal from '../ui/ConfirmModal.vue'
import MoveToDialog from './MoveToDialog.vue'
import SelectionToolbar from './SelectionToolbar.vue'

defineProps<{
  visible: boolean
  narrow: boolean
  paneId: string
  menu: ReturnType<typeof useTreeContextMenu>
  isBookmarked: boolean
  deleteMessage: string
  deleteKbdLabel: string
  fetchDirs: (rel: string) => Promise<DirEntry[]>
  toggleBookmark: () => void
  openToSide: () => void
}>()

const { t } = useI18n()
const revealLabelKey = revealInFileManagerKey()
</script>

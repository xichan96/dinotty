<template>
  <div class="srv-mgr-list">
    <div ref="scrollEl" class="srv-mgr-list-scroll">
      <!-- The device we are running on. It is synthesized, never part of the
           stored roster, and cannot be edited or removed - so it is a fixed
           row rather than a draft, and the structural absence of a delete
           button is the whole guarantee. -->
      <div class="srv-mgr-row srv-mgr-row--local" :class="{ selected: !selectedId }">
        <span class="srv-mgr-dot on" />
        <span class="srv-mgr-row-main">
          <span class="srv-mgr-row-name">{{ t('server.local') }}</span>
          <span class="srv-mgr-row-sub">{{ localSubtitle }}</span>
        </span>
      </div>

      <div
        v-for="(draft, index) in drafts"
        :key="draft.id"
        class="srv-mgr-row"
        :class="{
          selected: draft.id === selectedId,
          'drag-over-top': dropTarget === draft.id && dropPos === 'top',
          'drag-over-bottom': dropTarget === draft.id && dropPos === 'bottom',
          dragging: dragId === draft.id,
        }"
        :draggable="!isMobile"
        @dragstart="onDragStart(draft.id, $event)"
        @dragover.prevent="onDragOver(draft.id, $event)"
        @dragleave="onDragLeave(draft.id)"
        @drop.prevent="onDrop(draft.id)"
        @dragend="onDragEnd"
        @click="$emit('select', draft.id)"
      >
        <span v-if="!isMobile" class="srv-mgr-grip">
          <GripVertical :size="13" />
        </span>
        <span class="srv-mgr-dot" :class="dotClass(draft)" />
        <span class="srv-mgr-row-main">
          <span class="srv-mgr-row-name">{{ draft.name || draft.url || t('server.newName') }}</span>
          <span class="srv-mgr-row-sub">{{ draft.url }}</span>
        </span>
        <span v-if="draft.id === currentId" class="srv-mgr-tag">{{ t('server.statusCurrent') }}</span>
        <!-- Only the border colour distinguishes it otherwise, which is no use
             to anyone who cannot see it. -->
        <span v-else-if="!draftWillHaveToken(draft)" class="srv-mgr-tag warn">
          {{ t('server.statusNoToken') }}
        </span>
      </div>

      <p v-if="!drafts.length" class="srv-mgr-empty">{{ t('server.empty') }}</p>
    </div>

    <div class="srv-mgr-list-actions">
      <!-- On touch there is no HTML5 drag, so reordering gets explicit
           buttons instead of silently not working. -->
      <template v-if="isMobile">
        <button
          class="srv-mgr-icon-btn"
          :disabled="!canMove(-1)"
          :title="t('server.moveUp')"
          @click="$emit('move', -1)"
        >
          <ArrowUp :size="14" />
        </button>
        <button
          class="srv-mgr-icon-btn"
          :disabled="!canMove(1)"
          :title="t('server.moveDown')"
          @click="$emit('move', 1)"
        >
          <ArrowDown :size="14" />
        </button>
      </template>
      <button class="srv-mgr-add" @click="$emit('add')">
        <Plus :size="13" />
        <span>{{ t('server.add') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { draftWillHaveToken, type RemoteServerDraft } from '../../composables/useRemoteServerAdmin'

const props = defineProps<{
  drafts: RemoteServerDraft[]
  selectedId: string | null
  currentId: string
  isMobile: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  move: [delta: number]
  reorder: [fromId: string, toId: string, position: 'top' | 'bottom']
}>()

const { t } = useI18n()
const localSubtitle = location.host

const dragId = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropPos = ref<'top' | 'bottom'>('bottom')

/** Disabled at either end, so the buttons never move a row out of the list. */
function canMove(delta: number): boolean {
  const i = props.drafts.findIndex((d) => d.id === props.selectedId)
  return i >= 0 && i + delta >= 0 && i + delta < props.drafts.length
}

function dotClass(draft: RemoteServerDraft): string {
  if (draft.id === props.currentId) return 'on'
  return draftWillHaveToken(draft) ? 'idle' : 'warn'
}

// ── Native drag reordering ──────────────────────────────────────
//
// Same approach as the SSH host list: a drop lands above or below the row it
// was released on, decided by which half of that row the pointer was in.
// Touch never fires these events at all, which is why `isMobile` swaps in the
// move buttons above.

function onDragStart(id: string, event: DragEvent) {
  dragId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(id: string, event: DragEvent) {
  if (!dragId.value || dragId.value === id) return
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dropTarget.value = id
  dropPos.value = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
}

function onDragLeave(id: string) {
  if (dropTarget.value === id) dropTarget.value = null
}

function onDrop(id: string) {
  const from = dragId.value
  if (from && from !== id) emit('reorder', from, id, dropPos.value)
  onDragEnd()
}

function onDragEnd() {
  dragId.value = null
  dropTarget.value = null
}
</script>

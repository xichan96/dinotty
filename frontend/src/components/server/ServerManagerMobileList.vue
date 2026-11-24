<template>
  <div class="srv-mlist">
    <div ref="scrollEl" class="srv-mlist-scroll">
      <template v-if="mode === 'list'">
        <!-- The device we are running on: synthesized, fixed, never saved. -->
        <div class="srv-mgr-row srv-mgr-row--local srv-mlist-row">
          <span class="srv-mgr-dot on" />
          <span class="srv-mgr-row-main">
            <span class="srv-mgr-row-name">{{ t('server.local') }}</span>
            <span class="srv-mgr-row-sub">{{ localSubtitle }}</span>
          </span>
          <span class="srv-mgr-tag">{{ t('server.builtin') }}</span>
        </div>

        <button
          v-for="draft in drafts"
          :key="draft.id"
          class="srv-mgr-row srv-mlist-row srv-mlist-row--tap"
          type="button"
          :data-srv-id="draft.id"
          @click="$emit('select', draft.id)"
        >
          <span class="srv-mgr-dot" :class="dotClass(draft)" />
          <span class="srv-mgr-row-main">
            <span class="srv-mgr-row-name">
              {{ draft.name || draft.url || t('server.newName') }}
            </span>
            <span class="srv-mgr-row-sub">{{ draft.url }}</span>
          </span>
          <span v-if="draft.id === currentId" class="srv-mgr-tag">
            {{ t('server.statusCurrent') }}
          </span>
          <span v-else-if="!draftWillHaveToken(draft)" class="srv-mgr-tag warn">
            {{ t('server.statusNoToken') }}
          </span>
          <ChevronRight :size="16" class="srv-mlist-chevron" />
        </button>

        <p v-if="!drafts.length" class="srv-mgr-empty">{{ t('server.empty') }}</p>

        <button class="srv-mlist-add" type="button" @click="$emit('add')">
          <Plus :size="14" />
          <span>{{ t('server.add') }}</span>
        </button>
      </template>

      <template v-else>
        <div
          v-for="(draft, index) in drafts"
          :key="draft.id"
          class="srv-mgr-row srv-mlist-row srv-mlist-row--reorder"
          :class="{
            dragging: draft.id === draggingId,
            'drag-over-top': draft.id === dragOverId && dragOverPos === 'before',
            'drag-over-bottom': draft.id === dragOverId && dragOverPos === 'after',
          }"
          :data-srv-reorder-id="draft.id"
        >
          <span
            class="srv-mlist-grip"
            role="button"
            tabindex="0"
            :aria-label="t('server.reorder')"
            @pointerdown="onDragPointerDown($event, draft.id)"
            @keydown.up.prevent="$emit('move', draft.id, -1)"
            @keydown.down.prevent="$emit('move', draft.id, 1)"
          >
            <GripVertical :size="16" />
          </span>
          <span class="srv-mgr-dot" :class="dotClass(draft)" />
          <span class="srv-mgr-row-main">
            <span class="srv-mgr-row-name">
              {{ draft.name || draft.url || t('server.newName') }}
            </span>
            <span class="srv-mgr-row-sub">{{ draft.url }}</span>
          </span>
          <button
            class="srv-mlist-move"
            type="button"
            :disabled="index === 0"
            :aria-label="t('server.moveUp')"
            @click="$emit('move', draft.id, -1)"
          >
            <ArrowUp :size="15" />
          </button>
          <button
            class="srv-mlist-move"
            type="button"
            :disabled="index === drafts.length - 1"
            :aria-label="t('server.moveDown')"
            @click="$emit('move', draft.id, 1)"
          >
            <ArrowDown :size="15" />
          </button>
        </div>

        <p v-if="!drafts.length" class="srv-mgr-empty">{{ t('server.empty') }}</p>
        <p v-else class="srv-mlist-hint">{{ t('server.reorderHint') }}</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, Plus } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { draftWillHaveToken, type RemoteServerDraft } from '../../composables/useRemoteServerAdmin'

const props = defineProps<{
  drafts: RemoteServerDraft[]
  currentId: string
  mode: 'list' | 'reorder'
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  reorder: [fromId: string, toId: string, position: 'top' | 'bottom']
  move: [id: string, delta: number]
}>()

const { t } = useI18n()
const localSubtitle = location.host

const scrollEl = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dragOverPos = ref<'before' | 'after' | null>(null)

function dotClass(draft: RemoteServerDraft): string {
  if (draft.id === props.currentId) return 'on'
  return draftWillHaveToken(draft) ? 'idle' : 'warn'
}

// ── Drag reordering ─────────────────────────────────────────────
//
// Native HTML5 drag never fires on touch, which is why the desktop list is
// gated on `isMobile` and this list uses pointer events instead. The up/down
// buttons stay as the keyboard and precise-adjustment path.

function onDragPointerDown(e: PointerEvent, id: string) {
  if (e.button !== undefined && e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  draggingId.value = id
  dragOverId.value = null
  dragOverPos.value = null

  window.addEventListener('pointermove', onDragPointerMove)
  window.addEventListener('pointerup', onDragPointerUp)
  window.addEventListener('pointercancel', cleanupDrag)
}

function onDragPointerMove(e: PointerEvent) {
  if (!draggingId.value) return
  e.preventDefault()

  const list = scrollEl.value
  if (list) {
    const rect = list.getBoundingClientRect()
    if (e.clientY < rect.top + 52) list.scrollTop -= 12
    else if (e.clientY > rect.bottom - 52) list.scrollTop += 12
  }

  const hit =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(e.clientX, e.clientY)
      : null
  const row = hit?.closest?.('[data-srv-reorder-id]') as HTMLElement | null
  const toId = row?.dataset.srvReorderId
  if (!row || !toId || toId === draggingId.value) {
    dragOverId.value = null
    dragOverPos.value = null
    return
  }
  const rect = row.getBoundingClientRect()
  dragOverId.value = toId
  dragOverPos.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function onDragPointerUp() {
  const fromId = draggingId.value
  const toId = dragOverId.value
  const pos = dragOverPos.value
  cleanupDrag()
  if (!fromId || !toId || fromId === toId || !pos) return
  emit('reorder', fromId, toId, pos === 'before' ? 'top' : 'bottom')
}

function cleanupDrag() {
  draggingId.value = null
  dragOverId.value = null
  dragOverPos.value = null
  window.removeEventListener('pointermove', onDragPointerMove)
  window.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('pointercancel', cleanupDrag)
}
</script>

<style scoped>
.srv-mlist {
  display: flex;
  flex: 1;
  min-height: 0;
}

.srv-mlist-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0 14px;
  overscroll-behavior: contain;
}

.srv-mlist-row {
  gap: 11px;
  min-height: 58px;
  padding: 8px 16px;
}

.srv-mlist-row--tap {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.srv-mlist-row--tap:active {
  background: var(--bg-hover);
}

.srv-mlist-chevron {
  flex: 0 0 auto;
  color: var(--text-muted, #888);
}

.srv-mlist-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: calc(100% - 24px);
  height: 46px;
  margin: 8px 12px 0;
  border: 1px dashed var(--border);
  border-radius: 11px;
  background: transparent;
  color: var(--text-muted, #888);
  font: inherit;
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
}
.srv-mlist-add:active {
  border-color: var(--accent);
  background: var(--bg-hover);
  color: var(--fg);
}

/* ── Reorder mode ────────────────────────────────────────────── */

.srv-mlist-row--reorder {
  gap: 8px;
  padding-left: 6px;
}
.srv-mlist-row--reorder.dragging {
  background: var(--bg-hover);
  opacity: 0.6;
  border-radius: 10px;
}
.srv-mlist-row--reorder.drag-over-top {
  box-shadow: inset 0 2px 0 var(--fg-muted);
}
.srv-mlist-row--reorder.drag-over-bottom {
  box-shadow: inset 0 -2px 0 var(--fg-muted);
}

.srv-mlist-grip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 44px;
  border-radius: 9px;
  color: var(--text-muted, #888);
  touch-action: none;
  cursor: grab;
}
.srv-mlist-grip:active {
  background: var(--bg-hover);
  color: var(--fg);
  cursor: grabbing;
}
.srv-mlist-grip:focus-visible {
  outline: 1px solid var(--fg-muted);
  outline-offset: -4px;
}

.srv-mlist-move {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 44px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted, #888);
  -webkit-tap-highlight-color: transparent;
}
.srv-mlist-move:active:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg);
}
.srv-mlist-move:disabled {
  opacity: 0.3;
}

.srv-mlist-hint {
  margin: 10px 16px 0;
  color: var(--text-muted, #888);
  font-size: 11px;
  line-height: 1.5;
}
</style>

<template>
  <BaseDialog
    :visible="managerOpen"
    :title="t('server.managerTitle')"
    size="xl"
    dialog-class="srv-mgr-dialog"
    :variant="isMobile ? 'bottom-sheet' : 'modal'"
    @close="requestClose"
  >
    <div class="srv-mgr-shell">
      <p v-if="putError" class="srv-mgr-put-error">
        <TriangleAlert :size="13" />
        <span>{{ putError.message }}</span>
      </p>

      <div class="srv-mgr-body">
        <ServerManagerList
          :drafts="drafts"
          :selected-id="selectedId"
          :current-id="currentId"
          :is-mobile="isMobile"
          @select="selectedId = $event"
          @add="onAdd"
          @move="onMove"
          @reorder="onReorder"
        />

        <ServerEditForm
          :draft="selected"
          :testing="isTesting"
          :result="selectedResult"
          @edit="onDraftEdited"
          @test="onTest"
          @request-delete="onRequestDelete"
        />
      </div>
    </div>

    <template #footer>
      <button class="dialog-btn" :disabled="saving" @click="requestClose">
        {{ t('server.cancel') }}
      </button>
      <button class="dialog-btn dialog-btn--primary" :disabled="!canSave" @click="onSave">
        <span v-if="saving" class="srv-mgr-spin" />
        {{ t('server.save') }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'vue-toastification'
import { TriangleAlert } from 'lucide-vue-next'
import BaseDialog from '../ui/BaseDialog.vue'
import ServerEditForm from './ServerEditForm.vue'
import ServerManagerList from './ServerManagerList.vue'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { useIsMobile } from '../../composables/useIsMobile'
import { LOCAL_SERVER_ID, activeServerId, switchServer } from '../../composables/activeServer'
import { useRemoteServers } from '../../composables/useRemoteServers'
import {
  closeServerManager,
  draftFromEntry,
  managerOpen,
  newDraft,
  omitKey,
  probeRemoteServer,
  putRemoteServers,
  serializeDraft,
  type ProbeRequest,
  type ProbeResult,
  type RemoteServerDraft,
} from '../../composables/useRemoteServerAdmin'

const { t } = useI18n()
const toast = useToast()
const { isMobile } = useIsMobile()
const { servers, currentId, refreshRemoteServers } = useRemoteServers()

const drafts = ref<RemoteServerDraft[]>([])
const selectedId = ref<string | null>(null)
/** The saved state, so "are there unsaved edits" is a comparison rather than a
 *  flag every mutation has to remember to set. */
const baseline = ref('')
const busyOps = ref<Set<string>>(new Set())
const results = ref<Record<string, ProbeResult>>({})
const putError = ref<{ message: string; serverId: string | null } | null>(null)

const selected = computed(() => drafts.value.find((d) => d.id === selectedId.value) ?? null)
const selectedResult = computed(() =>
  selectedId.value ? (results.value[selectedId.value] ?? null) : null
)
const isTesting = computed(() => selectedId.value !== null && hasBusy(testKey(selectedId.value)))
const saving = computed(() => hasBusy(SAVE_KEY))

const canSave = computed(
  () => drafts.value.length === 0 || drafts.value.every((d) => d.url.trim() !== '')
)

const snapshot = () => JSON.stringify(drafts.value.map(serializeDraft))
const isDirty = computed(() => snapshot() !== baseline.value)

function hasBusy(key: string): boolean {
  return busyOps.value.has(key)
}

function setBusy(key: string, busy: boolean) {
  const next = new Set(busyOps.value)
  if (busy) next.add(key)
  else next.delete(key)
  busyOps.value = next
}

const testKey = (id: string) => `test:${id}`
const SAVE_KEY = 'save'

// ── Loading ─────────────────────────────────────────────────────
//
// Drafts are rebuilt from the shared roster every time the dialog opens. The
// roster carries `has_token` but never a token, so a draft starts with nothing
// typed - which is exactly the state `serializeDraft` reads as "keep".

watch(
  managerOpen,
  (open) => {
    if (!open) return
    putError.value = null
    results.value = {}
    busyOps.value = new Set()
    drafts.value = servers.value.filter((s) => !s.local).map(draftFromEntry)
    selectedId.value = drafts.value[0]?.id ?? null
    baseline.value = snapshot()
    // Pick up a roster change made on another device while we were closed. The
    // drafts above are a one-time copy, so the re-read that lands afterwards
    // cannot clobber anything the user has typed since.
    void refreshRemoteServers()
  },
  { immediate: true }
)

// ── Editing ─────────────────────────────────────────────────────

function onAdd() {
  const draft = newDraft()
  drafts.value = [...drafts.value, draft]
  selectedId.value = draft.id
}

function onReorder(fromId: string, toId: string, position: 'top' | 'bottom') {
  const from = drafts.value.findIndex((d) => d.id === fromId)
  const to = drafts.value.findIndex((d) => d.id === toId)
  if (from < 0 || to < 0 || from === to) return

  const next = [...drafts.value]
  const [moved] = next.splice(from, 1)
  // The target index shifts left once the dragged row is removed.
  const target = next.findIndex((d) => d.id === toId)
  next.splice(position === 'top' ? target : target + 1, 0, moved)
  drafts.value = next
}

function onMove(delta: number) {
  const from = drafts.value.findIndex((d) => d.id === selectedId.value)
  const to = from + delta
  if (from < 0 || to < 0 || to >= drafts.value.length) return
  const next = [...drafts.value]
  ;[next[from], next[to]] = [next[to], next[from]]
  drafts.value = next
}

/** Any edit invalidates the last probe: the result describes a url/token pair
 *  that no longer exists. */
function onDraftEdited() {
  if (!selectedId.value) return
  results.value = omitKey(results.value, selectedId.value)
}

async function onRequestDelete() {
  const draft = selected.value
  if (!draft) return
  // Pulling the row we are *on* out from under ourselves would leave
  // `relayPrefix()` pointing at `/__srv/<gone>`. The save already switches back
  // to local first, but say so here rather than surprising the user later.
  const inUse = draft.id === activeServerId()
  const ok = await uiConfirm(
    t(inUse ? 'server.confirmDeleteActive' : 'server.confirmDelete', {
      name: draft.name || draft.url || draft.id,
    }),
    {
      title: t('server.delete'),
      confirmText: t('server.delete'),
      cancelText: t('server.cancel'),
      danger: true,
    }
  )
  if (!ok) return

  drafts.value = drafts.value.filter((d) => d.id !== draft.id)
  selectedId.value = drafts.value[0]?.id ?? null
}

// ── Test connection ─────────────────────────────────────────────

function storedUrl(id: string): string | undefined {
  return servers.value.find((s) => s.id === id)?.url
}

/**
 * Which probe form to use.
 *
 * The by-id form makes the hub use *its* stored url and token, so it is only
 * valid while the row still describes the stored entry. Change the address and
 * the hub would probe the old host and report on a server the user is no longer
 * looking at - so anything touched falls back to sending the form's own values.
 */
function probeRequestFor(draft: RemoteServerDraft): ProbeRequest {
  const stored = storedUrl(draft.id)
  const untouched =
    stored !== undefined &&
    draft.url.trim() === stored &&
    !draft.tokenDirty &&
    !draft.tokenCleared
  if (untouched) return { kind: 'entry', id: draft.id }
  return {
    kind: 'draft',
    url: draft.url.trim(),
    token: draft.tokenDirty && draft.tokenInput ? draft.tokenInput : undefined,
  }
}

async function onTest() {
  const draft = selected.value
  if (!draft) return
  const key = testKey(draft.id)
  if (hasBusy(key)) return
  setBusy(key, true)
  onDraftEdited()
  try {
    const result = await probeRemoteServer(probeRequestFor(draft))
    // A switch to another row while the probe was in flight must not paint its
    // answer onto that row's form.
    results.value = { ...results.value, [draft.id]: result }
  } finally {
    setBusy(key, false)
  }
}

// ── Saving ──────────────────────────────────────────────────────

async function onSave() {
  if (!canSave.value || saving.value) return
  putError.value = null
  setBusy(SAVE_KEY, true)
  try {
    // Removing the server we are on leaves the relay prefix pointing at an id
    // no server answers to, so step back to local *before* the roster loses it.
    // Checked against the submitted list rather than against "what was
    // deleted", which also repairs a roster that already lost the active id
    // some other way.
    const active = activeServerId()
    if (active !== LOCAL_SERVER_ID && !drafts.value.some((d) => d.id === active)) {
      const switched = await switchServer(LOCAL_SERVER_ID)
      if (!switched.ok) {
        putError.value = { message: t('server.switchFailed'), serverId: null }
        return
      }
    }

    const result = await putRemoteServers(drafts.value)
    if (!result.ok) {
      putError.value = { message: result.error, serverId: result.serverId }
      // Point at the row the hub rejected, so the message and the field it is
      // about are on screen together.
      if (result.serverId) selectedId.value = result.serverId
      return
    }

    baseline.value = snapshot()
    if (result.refreshed) toast.success(t('server.saved'))
    else toast.warning(t('server.savedRefreshFailed'))
    closeServerManager()
  } finally {
    setBusy(SAVE_KEY, false)
  }
}

async function requestClose() {
  if (isDirty.value) {
    const ok = await uiConfirm(t('server.closeUnsaved'), {
      title: t('server.managerTitle'),
      confirmText: t('server.discard'),
      cancelText: t('server.cancel'),
      danger: true,
    })
    if (!ok) return
  }
  closeServerManager()
}
</script>

<style>
/* Not scoped: these style the BaseDialog root (via `dialogClass`) and its
   teleported contents. Every class is `srv-mgr-`-prefixed, so there is nothing
   here that could reach another component. */
.srv-mgr-dialog .dialog-body {
  padding: 0;
}
/* The sheet needs its own limits: `--xl`'s `max-width: 94vw` would otherwise
   beat the variant's `width: 100%` and leave the sheet wider than the
   backdrop's inset, and a phone has more vertical room to give. */
.srv-mgr-dialog.dialog--bottom-sheet {
  max-width: none;
  max-height: 88vh;
}

.srv-mgr-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.srv-mgr-body {
  flex: 1;
  min-height: 280px;
  display: flex;
}

.srv-mgr-put-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--color-red, #dc2626) 12%, transparent);
  color: var(--color-red, #dc2626);
  font-size: 12px;
  line-height: 1.4;
}

/* ── List ─────────────────────────────────────────────────────── */

.srv-mgr-list {
  width: 180px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.srv-mgr-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0;
}
.srv-mgr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  box-sizing: border-box;
  padding: 4px 8px;
  border-left: 3px solid transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.srv-mgr-row:hover {
  background: var(--bg-hover);
}
.srv-mgr-row.selected {
  background: var(--bg-surface-hover);
  border-left-color: var(--accent);
}
.srv-mgr-row--local {
  cursor: default;
  color: var(--text-muted, #888);
}
.srv-mgr-row.dragging {
  opacity: 0.5;
}
.srv-mgr-row.drag-over-top {
  box-shadow: inset 0 2px 0 var(--accent);
}
.srv-mgr-row.drag-over-bottom {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.srv-mgr-grip {
  display: flex;
  flex-shrink: 0;
  color: var(--text-muted, #888);
  cursor: grab;
}
.srv-mgr-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.srv-mgr-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.srv-mgr-row-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  line-height: 1.3;
  color: var(--text-muted, #888);
}
.srv-mgr-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted, #888);
}
.srv-mgr-dot.on {
  background: var(--accent);
}
.srv-mgr-dot.idle {
  background: var(--text-muted, #888);
}
.srv-mgr-dot.warn {
  background: #d97706;
}
.srv-mgr-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-muted, #888);
}
.srv-mgr-tag.warn {
  border-color: #d97706;
  color: #d97706;
}
.srv-mgr-empty {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: var(--text-muted, #888);
}
.srv-mgr-list-actions {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
}
.srv-mgr-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.srv-mgr-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.srv-mgr-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.srv-mgr-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── Form ─────────────────────────────────────────────────────── */

.srv-mgr-form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  overflow-y: auto;
}
.srv-mgr-form-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #888);
}
.srv-mgr-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.srv-mgr-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #888);
}
.srv-mgr-input {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.srv-mgr-input--mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
.srv-mgr-input:focus {
  outline: none;
  border-color: var(--accent);
}
.srv-mgr-input:disabled {
  opacity: 0.5;
}
.srv-mgr-badge {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-muted, #888);
}
.srv-mgr-badge.warn {
  border-color: #d97706;
  color: #d97706;
}
.srv-mgr-token-row {
  display: flex;
  gap: 6px;
}
.srv-mgr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.srv-mgr-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.srv-mgr-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.srv-mgr-btn--danger {
  color: var(--color-red, #dc2626);
}
.srv-mgr-btn--danger:hover:not(:disabled) {
  border-color: var(--color-red, #dc2626);
  color: var(--color-red, #dc2626);
}
.srv-mgr-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: #d97706;
}
.srv-mgr-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #888);
}
.srv-mgr-test {
  display: flex;
  gap: 8px;
}
.srv-mgr-result {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
}
.srv-mgr-result.ok {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
}
.srv-mgr-result.bad {
  border-color: var(--color-red, #dc2626);
}
.srv-mgr-result-line {
  display: flex;
  align-items: center;
  gap: 5px;
}
.srv-mgr-result-line.ok {
  color: var(--accent);
}
.srv-mgr-result-line.bad {
  color: var(--color-red, #dc2626);
}
.srv-mgr-result-line.warn {
  color: #d97706;
}
.srv-mgr-result-line.muted {
  color: var(--text-muted, #888);
}
.srv-mgr-spin {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  border: 2px solid var(--text-muted, #888);
  border-top-color: transparent;
  border-radius: 50%;
  animation: srv-mgr-spin 0.6s linear infinite;
}
@keyframes srv-mgr-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Mobile ───────────────────────────────────────────────────── */

@media (max-width: 600px) {
  .srv-mgr-body {
    flex-direction: column;
  }
  /* The list shares the sheet with the form, so cap it rather than letting a
     long roster push the fields off-screen. */
  .srv-mgr-list {
    width: 100%;
    min-width: 0;
    max-height: 38%;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .srv-mgr-row {
    min-height: 48px;
  }
  .srv-mgr-input,
  .srv-mgr-btn {
    height: 40px;
  }
}
</style>

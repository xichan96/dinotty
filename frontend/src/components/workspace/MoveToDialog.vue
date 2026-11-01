<script lang="ts">
import type { DirEntry } from './TreeRows'

/** Pure path helpers live outside <script setup> so tests can import them. */

export function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

export function sourceParentDir(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

/** True when `rel` is `sourceRel` itself or lies inside it — a directory
 *  cannot be moved into itself or one of its descendants. */
export function isWithinSource(rel: string, sourceRel: string): boolean {
  if (!sourceRel) return false
  return rel === sourceRel || rel.startsWith(`${sourceRel}/`)
}

/** Subdirectories of `baseRel`, minus the moved directory and its subtree. */
export function movableChildDirs(
  entries: DirEntry[],
  baseRel: string,
  sourceRel: string
): { rel: string; name: string }[] {
  return entries
    .filter((entry) => entry.is_dir)
    .map((entry) => ({ rel: joinRel(baseRel, entry.name), name: entry.name }))
    .filter((entry) => !isWithinSource(entry.rel, sourceRel))
}

/** A destination is valid unless it is the current parent (no-op) or inside
 *  the entry being moved. */
export function canMoveInto(dirRel: string, sourceRel: string): boolean {
  return dirRel !== sourceParentDir(sourceRel) && !isWithinSource(dirRel, sourceRel)
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CornerLeftUp, Folder } from 'lucide-vue-next'
import BaseDialog from '../ui/BaseDialog.vue'
import { useI18n } from '../../composables/useI18n'
import {
  asWorkspaceError,
  workspaceErrorKind,
  type WorkspaceError,
} from '../../composables/useFileWorkspaceBoot'

const props = defineProps<{
  visible: boolean
  /** Workspace-relative path of the entry being moved. */
  sourceRel: string
  isDir: boolean
  /** Pane the listings (and the move itself) belong to. */
  paneId: string
  fetchDirs: (rel: string) => Promise<DirEntry[]>
  move: (src: string, destDir: string) => Promise<void>
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const currentDir = ref('')
const dirs = ref<{ rel: string; name: string }[]>([])
const loading = ref(false)
const listError = ref<WorkspaceError | null>(null)
const moving = ref(false)
const moveError = ref<WorkspaceError | null>(null)
/** Ignore responses from a directory the user has already navigated away from. */
let loadSeq = 0

const crumbs = computed(() => {
  let acc = ''
  return currentDir.value
    .split('/')
    .filter(Boolean)
    .map((name) => {
      acc = acc ? `${acc}/${name}` : name
      return { name, rel: acc }
    })
})

const sameParent = computed(() => currentDir.value === sourceParentDir(props.sourceRel))
const canConfirm = computed(
  () =>
    !moving.value &&
    !loading.value &&
    !!props.sourceRel &&
    canMoveInto(currentDir.value, props.sourceRel)
)

function listErrorText(err: WorkspaceError | null): string {
  switch (workspaceErrorKind(err)) {
    case 'forbidden':
      return t('filePreview.errPermission')
    case 'notFound':
      return t('filePreview.errNotFound')
    case 'network':
      return t('filePreview.errNetwork')
    default:
      return t('filePreview.errUnknown')
  }
}

function moveErrorText(err: WorkspaceError | null): string {
  switch (workspaceErrorKind(err)) {
    case 'forbidden':
      return t('filePreview.errPermission')
    case 'notFound':
      return t('filePreview.errNotFound')
    case 'network':
      return t('filePreview.errNetwork')
    case 'conflict':
      return props.isDir ? t('filePreview.errFolderExists') : t('filePreview.errFileExists')
    default:
      return t('filePreview.moveFailed')
  }
}

async function loadDirs(rel: string) {
  const seq = ++loadSeq
  loading.value = true
  listError.value = null
  dirs.value = []
  try {
    const entries = await props.fetchDirs(rel)
    if (seq !== loadSeq) return
    dirs.value = movableChildDirs(entries, rel, props.sourceRel)
  } catch (e) {
    if (seq !== loadSeq) return
    listError.value = asWorkspaceError(e)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** Each open starts at the workspace root; the picker never remembers a
 *  destination from a previous move. */
function reset() {
  loadSeq += 1
  currentDir.value = ''
  dirs.value = []
  listError.value = null
  moveError.value = null
  moving.value = false
  void loadDirs('')
}

function navigate(rel: string) {
  if (moving.value || rel === currentDir.value) return
  currentDir.value = rel
  moveError.value = null
  void loadDirs(rel)
}

function goUp() {
  navigate(sourceParentDir(currentDir.value))
}

function retry() {
  void loadDirs(currentDir.value)
}

function onClose() {
  if (moving.value) return
  emit('close')
}

async function confirmMove() {
  if (!canConfirm.value) return
  moving.value = true
  moveError.value = null
  try {
    await props.move(props.sourceRel, currentDir.value)
    emit('close')
  } catch (e) {
    moveError.value = asWorkspaceError(e)
  } finally {
    moving.value = false
  }
}

// Every open (and any pane/entry change while open) starts a fresh picker.
watch(
  () => [props.visible, props.paneId, props.sourceRel] as const,
  ([visible]) => {
    if (visible) reset()
  },
  { immediate: true }
)
</script>

<template>
  <BaseDialog
    :visible="visible"
    :title="t('filePreview.moveTitle')"
    size="md"
    :close-label="t('filePreview.cancel')"
    @close="onClose"
  >
    <div class="move-to">
      <div class="move-to-path">
        <button
          type="button"
          class="move-to-up"
          :disabled="!currentDir || moving"
          @click="goUp"
        >
          <CornerLeftUp :size="16" aria-hidden="true" />
          <span>{{ t('filePreview.moveUp') }}</span>
        </button>
        <nav class="move-to-crumbs" :aria-label="t('filePreview.moveToAriaLabel')">
          <button
            type="button"
            class="move-to-crumb"
            :class="{ 'move-to-crumb--current': currentDir === '' }"
            :aria-current="currentDir === '' ? 'location' : undefined"
            @click="navigate('')"
          >
            {{ t('filePreview.moveToRoot') }}
          </button>
          <template v-for="crumb in crumbs" :key="crumb.rel">
            <span class="move-to-crumb-sep" aria-hidden="true">/</span>
            <button
              type="button"
              class="move-to-crumb"
              :class="{ 'move-to-crumb--current': crumb.rel === currentDir }"
              :aria-current="crumb.rel === currentDir ? 'location' : undefined"
              @click="navigate(crumb.rel)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>
      </div>

      <div class="move-to-list" role="list" :aria-busy="loading">
        <div v-if="loading" class="move-to-note">{{ t('filePreview.loading') }}</div>
        <div v-else-if="listError" class="move-to-note move-to-note--error" role="alert">
          <span>{{ listErrorText(listError) }}</span>
          <button type="button" class="move-to-retry" @click="retry">
            {{ t('filePreview.retry') }}
          </button>
        </div>
        <div v-else-if="!dirs.length" class="move-to-note">
          {{ t('filePreview.moveToEmpty') }}
        </div>
        <button
          v-for="dir in dirs"
          :key="dir.rel"
          type="button"
          class="move-to-item"
          role="listitem"
          :disabled="moving"
          @click="navigate(dir.rel)"
        >
          <Folder :size="16" aria-hidden="true" />
          <span class="move-to-item-name">{{ dir.name }}</span>
        </button>
      </div>

      <p v-if="moveError" class="move-to-error" role="alert">{{ moveErrorText(moveError) }}</p>
      <p v-else-if="sameParent" class="move-to-hint">
        {{ t('filePreview.moveToSameDir') }}
      </p>
    </div>
    <template #footer>
      <button type="button" class="dialog-btn move-to-btn" @click="onClose">
        {{ t('filePreview.cancel') }}
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--primary move-to-btn"
        :disabled="!canConfirm"
        @click="confirmMove"
      >
        {{ moving ? t('filePreview.moving') : t('filePreview.moveHere') }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.move-to {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.move-to-path {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.move-to-up {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg-muted);
  font-size: 12px;
}

.move-to-up:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg);
}

.move-to-up:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.move-to-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
}

.move-to-crumb {
  min-height: 40px;
  padding: 0 6px;
  border-radius: var(--radius);
  color: var(--fg-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-to-crumb:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.move-to-crumb--current {
  color: var(--fg-bright);
  font-weight: 600;
}

.move-to-crumb-sep {
  color: var(--fg-muted);
  opacity: 0.6;
}

.move-to-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 160px;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px;
}

.move-to-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--fg);
  font-size: 13px;
  text-align: left;
}

.move-to-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.move-to-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.move-to-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-to-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  padding: 12px;
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
}

.move-to-note--error {
  color: var(--color-red, var(--fg));
}

.move-to-retry {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg);
  font-size: 12px;
}

.move-to-error {
  margin: 0;
  color: var(--color-red, var(--fg));
  font-size: 12px;
}

.move-to-hint {
  margin: 0;
  color: var(--fg-muted);
  font-size: 12px;
}

.move-to-btn {
  min-height: 40px;
}
</style>

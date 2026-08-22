<template>
  <Teleport to="body">
    <div v-if="visible" class="fp-overlay" @click.self="close">
      <div class="fp-modal">
        <div class="fp-header">
          <button v-if="free" class="fp-up-btn" type="button" @click="navigateUp">Up</button>
          <div class="fp-breadcrumb">
            <span class="fp-crumb-home" @click="navigateTo('')">{{ cwdLabel || '/' }}</span>
          </div>
          <button class="fp-close-btn" @click="close"><X :size="18" /></button>
        </div>
        <div class="fp-body tree-host">
          <div v-if="!childCache['']" class="fp-loading">Loading...</div>
          <TreeRows
            v-else
            :pane-id="paneId"
            :depth="0"
            rel-path=""
            :workspace-root="cwdLabel"
            :cache="childCache"
            :expanded="expanded"
            :git-status="{}"
            @toggle="onToggle"
            @select-file="onSelectFile"
            @select-dir="onSelectDir"
          />
        </div>
        <div v-if="selectedPath" class="fp-selection">
          <span class="fp-selection-label">{{ selectedName }}</span>
        </div>
        <div class="fp-footer">
          <button class="fp-confirm-btn" :disabled="!selectedPath" @click="confirmSelection">
            Confirm
          </button>
          <button class="fp-cancel-btn" @click="close">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { TreeRows, absJoinWorkspaceRoot } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'

const props = withDefaults(
  defineProps<{
    visible: boolean
    paneId: string
    root?: string
    free?: boolean
  }>(),
  {
    root: '/',
    free: false,
  }
)

const emit = defineEmits<{
  'update:visible': [val: boolean]
  select: [path: string]
}>()

const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const selectedPath = ref<string>('')
const selectedName = ref<string>('')
const browseRoot = ref(props.root)

async function fetchList(rel: string) {
  const { authFetch, apiUrl } = await import('../../composables/apiBase')
  const path = props.free
    ? rel
      ? absJoinWorkspaceRoot(cwdLabel.value || browseRoot.value, rel)
      : browseRoot.value
    : rel
  const q = new URLSearchParams({ pane_id: props.paneId, path, root: props.root })
  if (props.free) q.set('free', 'true')
  try {
    const res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
    if (res.ok) {
      const data = await res.json()
      if (!props.free || rel === '') cwdLabel.value = data.cwd || ''
      childCache.value[rel] = data.entries || []
    } else if (props.free && rel === '' && browseRoot.value !== '/') {
      console.warn('[FilePickerModal] Failed to browse configured root; falling back to /')
      browseRoot.value = '/'
      cwdLabel.value = ''
      await fetchList('')
      return
    } else if (rel === '') {
      cwdLabel.value = ''
      childCache.value = {}
    }
  } catch {
    if (props.free && rel === '' && browseRoot.value !== '/') {
      console.warn('[FilePickerModal] Failed to browse configured root; falling back to /')
      browseRoot.value = '/'
      cwdLabel.value = ''
      await fetchList('')
      return
    }
    if (rel === '') {
      cwdLabel.value = ''
      childCache.value = {}
    }
  }
}

function navigateTo(rel: string) {
  expanded.value = new Set()
  childCache.value = {}
  fetchList(rel)
}

function navigateUp() {
  const current = cwdLabel.value || browseRoot.value
  const normalized = current.replace(/[\\/]+$/, '')
  let parent = normalized.replace(/[\\/][^\\/]*$/, '')
  if (!parent) parent = /^[A-Za-z]:/.test(normalized) ? `${normalized.slice(0, 2)}\\` : '/'
  if (parent === current) return
  browseRoot.value = parent
  selectedPath.value = ''
  selectedName.value = ''
  navigateTo('')
}

function onToggle(rel: string) {
  const exp = expanded.value
  if (exp.has(rel)) {
    exp.delete(rel)
  } else {
    exp.add(rel)
    if (!(rel in childCache.value)) {
      fetchList(rel)
    }
  }
}

function onSelectFile(rel: string) {
  selectedPath.value = absJoinWorkspaceRoot(cwdLabel.value, rel)
  selectedName.value = rel.split('/').pop() || rel
}

function onSelectDir(rel: string) {
  selectedPath.value = absJoinWorkspaceRoot(cwdLabel.value, rel)
  selectedName.value = (rel.split('/').pop() || rel) + '/'
}

function confirmSelection() {
  if (selectedPath.value) {
    emit('select', selectedPath.value)
    close()
  }
}

function close() {
  emit('update:visible', false)
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      browseRoot.value = props.root
      expanded.value = new Set()
      childCache.value = {}
      selectedPath.value = ''
      selectedName.value = ''
      fetchList('')
    }
  }
)
</script>

<style>
@import '../../styles/tree-rows.css';
</style>

<style scoped>
.fp-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.fp-modal {
  width: 100%;
  max-width: 480px;
  max-height: 60vh;
  background: var(--bg-surface);
  border-radius: var(--radius) var(--radius) 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fp-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.fp-breadcrumb {
  flex: 1;
  font-size: 13px;
  color: var(--fg);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fp-crumb-home {
  color: var(--accent);
  cursor: pointer;
}

.fp-crumb-home:hover {
  text-decoration: underline;
}

.fp-close-btn {
  background: none;
  border: none;
  color: var(--fg-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.fp-up-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  cursor: pointer;
  padding: 4px 8px;
}

.fp-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.fp-loading {
  text-align: center;
  color: var(--fg-muted);
  padding: 24px;
  font-size: 14px;
}

.fp-selection {
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--accent);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fp-footer {
  padding: 8px 16px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: center;
  gap: 12px;
}

.fp-confirm-btn {
  background: var(--accent);
  border: none;
  color: var(--bg);
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.fp-confirm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fp-confirm-btn:not(:disabled):active {
  background: var(--accent-hover);
}

.fp-cancel-btn {
  background: var(--bg-input);
  border: none;
  color: var(--fg);
  padding: 8px 24px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.fp-cancel-btn:active {
  background: var(--border);
}
</style>

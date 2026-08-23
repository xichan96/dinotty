<template>
  <BaseDialog
    :visible="visible"
    :title="t('palette.applyTemplate')"
    width="min(860px, 96vw)"
    dialog-class="tp-dialog"
    @close="$emit('close')"
  >
    <div class="tp-body">
      <div class="tp-list-col">
        <div class="tp-scope-row">
          <button
            type="button"
            :class="['tp-scope-btn', { active: scope === 'workspace' }]"
            :disabled="!workspaceId"
            @click="switchScope('workspace')"
          >
            {{ t('template.scopeWorkspace') }}
          </button>
          <button
            type="button"
            :class="['tp-scope-btn', { active: scope === 'global' }]"
            @click="switchScope('global')"
          >
            {{ t('template.scopeGlobal') }}
          </button>
        </div>

        <div v-if="loading" class="tp-empty">{{ t('filePreview.loading') }}</div>
        <div v-else-if="error" class="tp-error">{{ error }}</div>
        <div v-else-if="templates.length === 0" class="tp-empty">
          {{ t('template.pickerEmpty') }}
        </div>
        <div v-else class="tp-list">
          <div
            v-for="tpl in templates"
            :key="tpl.id"
            role="button"
            tabindex="0"
            :class="['tp-item', { selected: tpl.id === selectedId }]"
            @click="selectedId = tpl.id"
            @dblclick="onApply"
            @keydown.enter.prevent="selectedId = tpl.id"
            @keydown.space.prevent="selectedId = tpl.id"
          >
            <div class="tp-item-main">
              <div class="tp-item-name">{{ tpl.name }}</div>
              <div class="tp-item-meta">
                <span>{{ formatTime(tpl.updated_at) }}</span>
              </div>
            </div>
            <button
              type="button"
              class="tp-item-delete"
              :title="t('template.delete')"
              @click.stop="promptDelete(tpl)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>

      <div class="tp-preview-col">
        <div v-if="!selectedId" class="tp-preview-empty">{{ t('template.previewEmpty') }}</div>
        <div v-else-if="previewLoading" class="tp-preview-empty">
          {{ t('filePreview.loading') }}
        </div>
        <div v-else-if="previewError" class="tp-preview-error">{{ previewError }}</div>
        <TemplateLayoutPreview v-else-if="selectedTemplate" :layout="selectedTemplate.layout" />
      </div>
    </div>
    <template #footer>
      <button class="dialog-btn" @click="$emit('close')">
        {{ t('confirm.closeWindowCancel') }}
      </button>
      <button class="dialog-btn dialog-btn--primary" :disabled="!selectedId" @click="onApply">
        {{ t('template.apply') }}
      </button>
    </template>
  </BaseDialog>

  <ConfirmModal
    :visible="deleteConfirmVisible"
    :title="t('template.deleteTitle')"
    :message="deleteConfirmMessage"
    :confirm-text="t('template.deleteConfirm')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="onDeleteConfirmed"
    @cancel="deleteConfirmVisible = false"
  />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import {
  apiListTemplates,
  apiGetTemplate,
  apiDeleteTemplate,
} from '../../composables/useTemplateApi'
import TemplateLayoutPreview from './TemplateLayoutPreview.vue'
import ConfirmModal from './ConfirmModal.vue'
import BaseDialog from './BaseDialog.vue'
import type { TemplateScope, TemplateIndexEntry } from '../../types/template'
import type { LayoutTemplate } from '../../types/template'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  workspaceId?: string | null
}>()

const emit = defineEmits<{
  close: []
  apply: [templateId: string, scope: TemplateScope, workspaceId?: string]
}>()

const scope = ref<TemplateScope>('workspace')
const templates = ref<TemplateIndexEntry[]>([])
const selectedId = ref<string | null>(null)
const selectedTemplate = ref<LayoutTemplate | null>(null)
const loading = ref(false)
const error = ref('')
const previewLoading = ref(false)
const previewError = ref('')

const deleteConfirmVisible = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteTargetName = ref('')
const deleteConfirmMessage = computed(() =>
  deleteTargetName.value
    ? t('template.deleteMessage').replace('{name}', deleteTargetName.value)
    : t('template.deleteMessage').replace('{name}', '')
)

function switchScope(s: TemplateScope) {
  if (s === 'workspace' && !props.workspaceId) return
  scope.value = s
}

function currentQuery() {
  return {
    scope: scope.value,
    workspace_id: scope.value === 'workspace' ? props.workspaceId || undefined : undefined,
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const result = await apiListTemplates(currentQuery())
    templates.value = result.templates || []
    selectedId.value = templates.value[0]?.id || null
    if (selectedId.value) {
      await loadPreview(selectedId.value)
    } else {
      selectedTemplate.value = null
    }
  } catch (e: unknown) {
    error.value = errorMessage(e)
    templates.value = []
    selectedId.value = null
    selectedTemplate.value = null
  } finally {
    loading.value = false
  }
}

async function loadPreview(id: string) {
  previewLoading.value = true
  previewError.value = ''
  try {
    selectedTemplate.value = await apiGetTemplate(id, currentQuery())
  } catch (e: unknown) {
    previewError.value = errorMessage(e) || t('template.previewError')
    selectedTemplate.value = null
  } finally {
    previewLoading.value = false
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Failed'
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function onApply() {
  if (!selectedId.value) return
  emit(
    'apply',
    selectedId.value,
    scope.value,
    scope.value === 'workspace' ? props.workspaceId || undefined : undefined
  )
  emit('close')
}

function promptDelete(tpl: TemplateIndexEntry) {
  deleteTargetId.value = tpl.id
  deleteTargetName.value = tpl.name
  deleteConfirmVisible.value = true
}

async function onDeleteConfirmed() {
  const id = deleteTargetId.value
  if (!id) return
  deleteConfirmVisible.value = false
  try {
    await apiDeleteTemplate(id, currentQuery())
    if (selectedId.value === id) {
      selectedId.value = null
      selectedTemplate.value = null
    }
    await loadList()
  } catch (e: unknown) {
    error.value = errorMessage(e)
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      scope.value = props.workspaceId ? 'workspace' : 'global'
      selectedId.value = null
      selectedTemplate.value = null
      error.value = ''
      previewError.value = ''
      loadList()
    }
  }
)

watch(
  () => scope.value,
  () => {
    if (props.visible) loadList()
  }
)

watch(
  () => selectedId.value,
  (id) => {
    if (id && props.visible && !loading.value) {
      loadPreview(id)
    }
  }
)
</script>

<style scoped>
.tp-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  gap: 16px;
  min-height: 0;
}
.tp-list-col {
  flex: 0 0 240px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.tp-preview-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--border);
  padding-left: 16px;
  display: flex;
  flex-direction: column;
}
.tp-scope-row {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}
.tp-scope-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.tp-scope-btn.active {
  background: var(--accent);
  color: var(--fg-inverse);
}
.tp-scope-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tp-scope-btn:not(.active):not(:disabled):hover {
  background: var(--bg-hover);
}
.tp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.tp-item {
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.tp-item:hover {
  border-color: var(--accent);
}
.tp-item.selected {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.tp-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tp-item-name {
  font-size: 13px;
  color: var(--fg-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-item-meta {
  font-size: 11px;
  color: var(--fg-muted);
}
.tp-item-delete {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.6;
}
.tp-item:hover .tp-item-delete {
  opacity: 1;
}
.tp-item-delete:hover {
  background: var(--bg-hover);
  color: var(--color-red);
}
.tp-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--fg-muted);
  flex: 1;
}
.tp-error {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-red);
  border: 1px solid var(--color-red);
  border-radius: var(--radius);
}
.tp-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--fg-muted);
}
.tp-preview-error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-red);
  text-align: center;
  padding: 8px;
}
</style>

<style>
/* Mobile: template picker goes full-screen (unscoped - .tp-dialog lives in BaseDialog) */
@media (max-width: 640px) {
  .tp-dialog.dialog {
    width: 100vw;
    max-width: 100vw;
    max-height: 100dvh;
    border-radius: 0;
    border: none;
  }
  .tp-dialog .tp-body {
    flex-direction: column;
  }
  .tp-dialog .tp-list-col {
    flex: 0 0 auto;
    max-height: 40%;
  }
  .tp-dialog .tp-preview-col {
    border-left: none;
    border-top: 1px solid var(--border);
    padding-left: 0;
    padding-top: 12px;
    flex: 1;
  }
}
</style>

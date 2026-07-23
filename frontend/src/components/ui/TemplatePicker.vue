<template>
  <Teleport to="body">
    <div v-if="visible" class="tp-backdrop" @click.self="$emit('close')">
      <div class="tp-modal">
        <div class="tp-header">
          <span class="tp-title">{{ t('palette.applyTemplate') }}</span>
          <button class="tp-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="tp-body">
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
          <div v-else-if="templates.length === 0" class="tp-empty">{{ t('template.pickerEmpty') }}</div>
          <div v-else class="tp-list">
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              type="button"
              :class="['tp-item', { selected: tpl.id === selectedId }]"
              @click="selectedId = tpl.id"
              @dblclick="onApply"
            >
              <div class="tp-item-name">{{ tpl.name }}</div>
              <div class="tp-item-meta">
                <span>{{ formatTime(tpl.updated_at) }}</span>
              </div>
            </button>
          </div>
        </div>
        <div class="tp-footer">
          <button class="tp-btn cancel" @click="$emit('close')">{{ t('confirm.closeWindowCancel') }}</button>
          <button
            class="tp-btn primary"
            :disabled="!selectedId"
            @click="onApply"
          >
            {{ t('template.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { apiListTemplates } from '../../composables/useTemplateApi'
import type { TemplateScope, TemplateIndexEntry } from '../../types/template'

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
const loading = ref(false)
const error = ref('')

function switchScope(s: TemplateScope) {
  if (s === 'workspace' && !props.workspaceId) return
  scope.value = s
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const result = await apiListTemplates({
      scope: scope.value,
      workspace_id: scope.value === 'workspace' ? (props.workspaceId || undefined) : undefined,
    })
    templates.value = result.templates || []
    selectedId.value = templates.value[0]?.id || null
  } catch (e: any) {
    error.value = e?.message || 'Failed'
    templates.value = []
    selectedId.value = null
  } finally {
    loading.value = false
  }
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
    scope.value === 'workspace' ? (props.workspaceId || undefined) : undefined,
  )
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      scope.value = props.workspaceId ? 'workspace' : 'global'
      selectedId.value = null
      error.value = ''
      loadList()
    }
  },
)

watch(
  () => scope.value,
  () => {
    if (props.visible) loadList()
  },
)
</script>

<style scoped>
.tp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tp-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 480px;
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.tp-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}
.tp-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
}
.tp-close:hover {
  background: var(--bg-hover);
}
.tp-body {
  padding: 12px 16px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tp-scope-row {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.tp-scope-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tp-scope-btn.active {
  background: var(--accent);
  color: #fff;
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
  min-height: 120px;
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
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s, background 0.15s;
}
.tp-item:hover {
  border-color: var(--accent);
}
.tp-item.selected {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.tp-item-name {
  font-size: 13px;
  color: var(--fg-bright);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-item-meta {
  font-size: 11px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.tp-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--fg-muted);
}
.tp-error {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-red, #ef4444);
  border: 1px solid var(--color-red, #ef4444);
  border-radius: 4px;
}
.tp-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}
.tp-btn {
  padding: 6px 16px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: var(--fg-muted);
  background: none;
}
.tp-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.tp-btn.primary {
  background: var(--accent);
  color: #fff;
}
.tp-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tp-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

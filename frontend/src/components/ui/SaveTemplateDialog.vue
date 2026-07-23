<template>
  <Teleport to="body">
    <div v-if="visible" class="st-backdrop" @click.self="$emit('close')">
      <div class="st-modal">
        <div class="st-header">
          <span class="st-title">{{ t('template.dialogTitleSave') }}</span>
          <button class="st-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="st-body">
          <label class="st-label">{{ t('template.nameLabel') }}</label>
          <input
            ref="nameInput"
            v-model="name"
            class="st-input"
            :placeholder="t('template.namePlaceholder')"
            @keydown.enter="onSubmit"
          />

          <label class="st-label">{{ t('template.scopeLabel') }}</label>
          <div class="st-scope-row">
            <button
              type="button"
              :class="['st-scope-btn', { active: scope === 'workspace' }]"
              :disabled="!activeWorkspaceId"
              @click="scope = 'workspace'"
            >
              {{ t('template.scopeWorkspace') }}
            </button>
            <button
              type="button"
              :class="['st-scope-btn', { active: scope === 'global' }]"
              @click="scope = 'global'"
            >
              {{ t('template.scopeGlobal') }}
            </button>
          </div>
          <p class="st-scope-hint">
            {{ scope === 'workspace' ? t('template.scopeWorkspaceHint') : t('template.scopeGlobalHint') }}
          </p>

          <label class="st-label">{{ t('template.panesLabel') }}</label>
          <div v-if="leaves.length === 0" class="st-empty">—</div>
          <div v-for="(leaf, idx) in leaves" :key="leaf.paneId" class="st-pane-card">
            <div class="st-pane-header">
              <span class="st-pane-kind">{{ kindLabel(leaf) }}</span>
              <span class="st-pane-index">#{{ idx + 1 }}</span>
            </div>
            <label class="st-sublabel">{{ t('template.fieldTitle') }}</label>
            <input
              v-model="overrides[leaf.paneId].title"
              class="st-input"
              :placeholder="leaf.title || ''"
            />
            <template v-if="paneKind(leaf) === 'terminal'">
              <label class="st-sublabel">{{ t('template.fieldCwd') }}</label>
              <input
                v-model="overrides[leaf.paneId].cwd"
                class="st-input"
                :placeholder="leaf.cwd || ''"
              />
              <label class="st-sublabel">{{ t('template.fieldStartupCommand') }}</label>
              <input
                v-model="overrides[leaf.paneId].startup_command"
                class="st-input"
                :placeholder="leaf.startup_command || ''"
              />
            </template>
            <template v-else-if="paneKind(leaf) === 'files'">
              <label class="st-sublabel">{{ t('template.fieldPath') }}</label>
              <input
                v-model="overrides[leaf.paneId].path"
                class="st-input"
                :placeholder="leaf.path || ''"
              />
            </template>
            <template v-else-if="paneKind(leaf) === 'web'">
              <label class="st-sublabel">{{ t('template.fieldUrl') }}</label>
              <input
                v-model="overrides[leaf.paneId].url"
                class="st-input"
                :placeholder="leaf.url || ''"
              />
            </template>
          </div>
          <p v-if="error" class="st-error">{{ error }}</p>
        </div>
        <div class="st-footer">
          <button class="st-btn cancel" @click="$emit('close')">{{ t('confirm.closeWindowCancel') }}</button>
          <button class="st-btn primary" :disabled="!canSubmit" @click="onSubmit">
            {{ t('template.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { apiCreateTemplate } from '../../composables/useTemplateApi'
import { getAllLeaves, paneKind } from '../../types/pane'
import type { PaneLayout, LeafPane } from '../../types/pane'
import type { TemplateScope, PaneOverride } from '../../types/template'

/** Layout leaves may carry `cwd` / `startup_command` fields when they were
 *  saved from a template (the source-tab runtime state doesn't track cwd
 *  per-leaf, but templates do). */
interface TemplateableLeaf extends LeafPane {
  cwd?: string
  startup_command?: string
}

const { t } = useI18n()
const { activeWorkspaceId } = useWorkspaces()

const props = defineProps<{
  visible: boolean
  sourceTabId: string
  sourceLayout: PaneLayout | null
}>()

const emit = defineEmits<{
  close: []
  saved: [templateId: string]
}>()

const name = ref('')
const scope = ref<TemplateScope>('workspace')
const error = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const overrides = reactive<Record<string, PaneOverride>>({})

const leaves = computed<TemplateableLeaf[]>(() =>
  props.sourceLayout ? (getAllLeaves(props.sourceLayout) as TemplateableLeaf[]) : []
)

const canSubmit = computed(() => !!name.value.trim() && !!props.sourceTabId)

function ensureOverrides() {
  for (const leaf of leaves.value) {
    if (!overrides[leaf.paneId]) {
      overrides[leaf.paneId] = {
        title: leaf.title || '',
        cwd: paneKind(leaf) === 'terminal' ? (leaf.cwd || '') : undefined,
        startup_command: paneKind(leaf) === 'terminal' ? (leaf.startup_command || '') : undefined,
        path: paneKind(leaf) === 'files' ? (leaf.path || '') : undefined,
        url: paneKind(leaf) === 'web' ? (leaf.url || '') : undefined,
      }
    }
  }
}

function kindLabel(leaf: LeafPane): string {
  const k = paneKind(leaf)
  if (k === 'terminal') return t('template.terminalPane')
  if (k === 'plugin') return t('template.pluginPane')
  if (k === 'files') return t('template.filesPane')
  if (k === 'web') return t('template.webPane')
  return k
}

function buildOverrides(): Record<string, PaneOverride> {
  const out: Record<string, PaneOverride> = {}
  for (const leaf of leaves.value) {
    const o = overrides[leaf.paneId] || {}
    const cleaned: PaneOverride = {}
    if (o.title && o.title.trim() && o.title !== leaf.title) cleaned.title = o.title.trim()
    if (paneKind(leaf) === 'terminal') {
      if (o.cwd && o.cwd.trim() && o.cwd !== (leaf.cwd || '')) cleaned.cwd = o.cwd.trim()
      if (o.startup_command && o.startup_command.trim() && o.startup_command !== (leaf.startup_command || ''))
        cleaned.startup_command = o.startup_command.trim()
    }
    if (paneKind(leaf) === 'files' && o.path && o.path.trim() && o.path !== (leaf.path || '')) {
      cleaned.path = o.path.trim()
    }
    if (paneKind(leaf) === 'web' && o.url && o.url.trim() && o.url !== (leaf.url || '')) {
      cleaned.url = o.url.trim()
    }
    out[leaf.paneId] = cleaned
  }
  return out
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      name.value = ''
      scope.value = activeWorkspaceId.value ? 'workspace' : 'global'
      error.value = ''
      for (const k of Object.keys(overrides)) delete overrides[k]
      ensureOverrides()
      nextTick(() => nameInput.value?.focus())
    }
  },
)

async function onSubmit() {
  if (!canSubmit.value) return
  error.value = ''
  try {
    const finalScope: TemplateScope = scope.value === 'workspace' && activeWorkspaceId.value
      ? 'workspace'
      : 'global'
    const { template_id } = await apiCreateTemplate({
      name: name.value.trim(),
      scope: finalScope,
      workspace_id: finalScope === 'workspace' ? activeWorkspaceId.value! : undefined,
      source_tab_id: props.sourceTabId,
      pane_overrides: buildOverrides(),
    })
    emit('saved', template_id)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Failed'
  }
}
</script>

<style scoped>
.st-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.st-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 480px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.st-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.st-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}
.st-close {
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
.st-close:hover {
  background: var(--bg-hover);
}
.st-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
}
.st-label {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 4px;
}
.st-sublabel {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 4px;
  margin-bottom: 0;
}
.st-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
  box-sizing: border-box;
  width: 100%;
}
.st-input:focus {
  border-color: var(--accent);
}
.st-scope-row {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.st-scope-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.st-scope-btn.active {
  background: var(--accent);
  color: #fff;
}
.st-scope-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.st-scope-btn:not(.active):not(:disabled):hover {
  background: var(--bg-hover);
}
.st-scope-hint {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--fg-muted);
}
.st-empty {
  font-size: 12px;
  color: var(--fg-muted);
  padding: 8px 0;
}
.st-pane-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg);
}
.st-pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.st-pane-kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.st-pane-index {
  font-size: 11px;
  color: var(--fg-muted);
}
.st-error {
  font-size: 12px;
  color: var(--color-red, #ef4444);
  margin: 2px 0 0;
}
.st-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}
.st-btn {
  padding: 6px 16px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: var(--fg-muted);
  background: none;
}
.st-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.st-btn.primary {
  background: var(--accent);
  color: #fff;
}
.st-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.st-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

<template>
  <section class="git-configuration-section" :aria-label="t('gitPanel.gitConfiguration')">
    <button
      type="button"
      data-testid="git-configuration-heading"
      class="git-configuration-heading"
      @click="expanded = !expanded"
    >
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <Settings2 :size="13" />
      <span>{{ t('gitPanel.gitConfiguration') }}</span>
    </button>

    <template v-if="expanded">
      <p v-if="errorMessage" class="git-configuration-message error" role="alert">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="git-configuration-message success" role="status">
        {{ statusMessage }}
      </p>

      <div class="git-configuration-scope" role="group" :aria-label="t('gitPanel.configScope')">
        <button
          type="button"
          :class="{ active: selectedScope === 'local' }"
          :aria-pressed="selectedScope === 'local'"
          @click="selectScope('local')"
        >
          {{ t('gitPanel.repositoryScope') }}
        </button>
        <button
          type="button"
          :class="{ active: selectedScope === 'global' }"
          :aria-pressed="selectedScope === 'global'"
          @click="selectScope('global')"
        >
          {{ t('gitPanel.globalScope') }}
        </button>
      </div>

      <div class="git-configuration-form">
        <label>
          <span>{{ t('gitPanel.userName') }}</span>
          <input
            v-model="editingConfiguration.userName"
            data-testid="git-config-user-name"
            type="text"
          />
        </label>
        <label>
          <span>{{ t('gitPanel.userEmail') }}</span>
          <input
            v-model="editingConfiguration.userEmail"
            data-testid="git-config-user-email"
            type="text"
          />
        </label>
        <label>
          <span>{{ t('gitPanel.credentialHelper') }}</span>
          <input
            v-model="editingConfiguration.credentialHelper"
            data-testid="git-config-credential-helper"
            type="text"
            list="git-credential-helper-options"
          />
          <datalist id="git-credential-helper-options">
            <option value="manager-core"></option>
            <option value="manager"></option>
            <option value="store"></option>
            <option value="cache"></option>
            <option value="wincred"></option>
          </datalist>
        </label>
        <label>
          <span>{{ t('gitPanel.defaultBranch') }}</span>
          <input
            v-model="editingConfiguration.defaultBranch"
            data-testid="git-config-default-branch"
            type="text"
          />
        </label>
        <label class="git-configuration-toggle">
          <input v-model="editingConfiguration.gpgSign" type="checkbox" />
          <span>{{ t('gitPanel.signCommits') }}</span>
        </label>
        <label>
          <span>{{ t('gitPanel.signingKey') }}</span>
          <input
            v-model="editingConfiguration.signingKey"
            data-testid="git-config-signing-key"
            type="text"
          />
        </label>
        <button
          type="button"
          data-testid="git-config-save"
          class="git-configuration-save"
          :disabled="busy || loading"
          @click="saveConfiguration"
        >
          <Save :size="13" />
          <span>{{ t('gitPanel.saveConfiguration') }}</span>
        </button>
      </div>

      <div class="git-diagnostics">
        <div class="git-diagnostics-heading">
          <h3>{{ t('gitPanel.toolDiagnostics') }}</h3>
          <button
            type="button"
            :title="t('gitPanel.refreshDiagnostics')"
            :aria-label="t('gitPanel.refreshDiagnostics')"
            :disabled="diagnosticsLoading"
            @click="loadDiagnostics"
          >
            <RefreshCw :size="12" :class="{ spin: diagnosticsLoading }" />
          </button>
        </div>
        <div class="git-diagnostic-grid">
          <div
            v-for="tool in diagnosticTools"
            :key="tool.name"
            data-testid="git-diagnostic-tool"
            class="git-diagnostic-tool"
          >
            <CircleCheck v-if="tool.available" :size="12" class="available" />
            <CircleX v-else :size="12" class="missing" />
            <strong>{{ tool.name }}</strong>
            <span :title="tool.version">{{ tool.version || t('gitPanel.notInstalled') }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ChevronDown, CircleCheck, CircleX, RefreshCw, Save, Settings2 } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'

type GitConfigScope = 'local' | 'global'

interface GitConfigurationValues {
  userName: string
  userEmail: string
  credentialHelper: string
  defaultBranch: string
  gpgSign: boolean
  signingKey: string
}

interface GitDiagnosticTool {
  name: string
  available: boolean
  version: string
}

const props = defineProps<{
  paneId: string
  repository?: string
}>()

const { t } = useI18n()
const expanded = ref(false)
const selectedScope = ref<GitConfigScope>('local')
const localConfiguration = reactive(createEmptyConfiguration())
const globalConfiguration = reactive(createEmptyConfiguration())
const editingConfiguration = reactive(createEmptyConfiguration())
const diagnosticTools = ref<GitDiagnosticTool[]>([])
const loading = ref(false)
const diagnosticsLoading = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')

function createEmptyConfiguration(): GitConfigurationValues {
  // 步骤1：用固定字段建立空配置，避免动态键进入保存请求。
  return {
    userName: '',
    userEmail: '',
    credentialHelper: '',
    defaultBranch: '',
    gpgSign: false,
    signingKey: '',
  }
}

function assignConfiguration(
  target: GitConfigurationValues,
  source: Record<string, unknown>
): void {
  // 步骤1：逐字段转换后端配置，拒绝把未知响应字段带入界面状态。
  target.userName = String(source.user_name || '')
  target.userEmail = String(source.user_email || '')
  target.credentialHelper = String(source.credential_helper || '')
  target.defaultBranch = String(source.default_branch || '')
  target.gpgSign = source.gpg_sign === true
  target.signingKey = String(source.signing_key || '')
}

function copyConfiguration(target: GitConfigurationValues, source: GitConfigurationValues): void {
  // 步骤1：切换作用域时复制一份可编辑值，不直接修改已加载的基线。
  target.userName = source.userName
  target.userEmail = source.userEmail
  target.credentialHelper = source.credentialHelper
  target.defaultBranch = source.defaultBranch
  target.gpgSign = source.gpgSign
  target.signingKey = source.signingKey
}

function buildQuery(): URLSearchParams {
  // 步骤1：所有配置与诊断接口都绑定当前仓库。
  const query = new URLSearchParams({ pane_id: props.paneId })
  appendGitRepository(query, props.repository)
  return query
}

async function loadConfiguration(): Promise<void> {
  // 步骤1：同时读取仓库级和全局配置。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-config?${buildQuery()}`))
    const result = await response.json().catch(function emptyGitConfigurationResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.configurationFailed'))
      return
    }
    assignConfiguration(localConfiguration, result.local || {})
    assignConfiguration(globalConfiguration, result.global || {})
    selectScope(selectedScope.value)
  } catch {
    errorMessage.value = t('gitPanel.configurationFailed')
  } finally {
    loading.value = false
  }
}

async function loadDiagnostics(): Promise<void> {
  // 步骤1：读取工具版本状态，不请求任何凭据内容。
  diagnosticsLoading.value = true
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-diagnostics?${buildQuery()}`))
    const result = await response.json().catch(function emptyGitDiagnosticsResult() {
      return {}
    })
    const nextTools: GitDiagnosticTool[] = []
    if (response.ok && Array.isArray(result.tools)) {
      for (const rawTool of result.tools) {
        if (!rawTool || typeof rawTool !== 'object') continue
        const tool = rawTool as Record<string, unknown>
        nextTools.push({
          name: String(tool.name || ''),
          available: tool.available === true,
          version: String(tool.version || ''),
        })
      }
    }
    diagnosticTools.value = nextTools
  } finally {
    diagnosticsLoading.value = false
  }
}

function selectScope(scope: GitConfigScope): void {
  // 步骤1：保存明确作用域并载入对应可编辑配置。
  selectedScope.value = scope
  if (scope === 'local') {
    copyConfiguration(editingConfiguration, localConfiguration)
  } else {
    copyConfiguration(editingConfiguration, globalConfiguration)
  }
}

async function saveConfiguration(): Promise<void> {
  // 步骤1：只发送六个白名单配置字段和明确作用域。
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-config-update?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: selectedScope.value,
        user_name: editingConfiguration.userName.trim(),
        user_email: editingConfiguration.userEmail.trim(),
        credential_helper: editingConfiguration.credentialHelper.trim(),
        default_branch: editingConfiguration.defaultBranch.trim(),
        gpg_sign: editingConfiguration.gpgSign,
        signing_key: editingConfiguration.signingKey.trim(),
      }),
    })
    const result = await response.json().catch(function emptyGitConfigurationSaveResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.configurationFailed'))
      return
    }
    statusMessage.value = t('gitPanel.configurationSaved')
    await loadConfiguration()
  } catch {
    errorMessage.value = t('gitPanel.configurationFailed')
  } finally {
    busy.value = false
  }
}

watch(
  function watchConfigurationRepository() {
    return [props.paneId, props.repository]
  },
  function reloadConfigurationRepository() {
    void loadConfiguration()
    void loadDiagnostics()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-configuration-section {
  border-bottom: 1px solid var(--border);
}

.git-configuration-heading {
  width: 100%;
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  color: var(--fg-bright);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
}

.git-configuration-heading:hover,
.git-configuration-heading:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-configuration-heading svg:first-child {
  transition: transform 0.15s ease;
}

.git-configuration-heading svg.collapsed {
  transform: rotate(-90deg);
}

.git-configuration-message {
  margin: 0;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  font-size: 9px;
}

.git-configuration-message.error {
  color: var(--color-red, #e06c75);
}

.git-configuration-message.success {
  color: var(--color-green, #62b478);
}

.git-configuration-scope {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 7px 7px 0;
}

.git-configuration-scope button {
  min-height: 26px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: var(--bg);
  cursor: pointer;
  font-size: 9px;
}

.git-configuration-scope button.active {
  border-color: var(--accent);
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-configuration-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  padding: 7px;
}

.git-configuration-form label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-configuration-form input[type='text'] {
  min-width: 0;
  height: 27px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  outline: none;
  font-size: 9px;
}

.git-configuration-form input:focus {
  border-color: var(--accent);
}

.git-configuration-toggle {
  flex-direction: row !important;
  align-items: center;
  align-self: end;
  min-height: 27px;
}

.git-configuration-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.git-configuration-save {
  min-height: 27px;
  align-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 9px;
}

.git-configuration-save:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.git-configuration-save:disabled {
  cursor: default;
  opacity: 0.45;
}

.git-diagnostics {
  padding: 7px;
  border-top: 1px solid var(--border);
}

.git-diagnostics-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.git-diagnostics-heading h3 {
  margin: 0;
  color: var(--fg-muted);
  font-size: 9px;
  text-transform: uppercase;
}

.git-diagnostics-heading button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-diagnostics-heading button:hover:not(:disabled) {
  color: var(--fg);
  background: var(--bg-hover);
}

.git-diagnostic-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.git-diagnostic-tool {
  min-width: 0;
  min-height: 28px;
  display: grid;
  grid-template-columns: 14px 34px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg);
  font-size: 8px;
}

.git-diagnostic-tool strong {
  color: var(--fg-bright);
}

.git-diagnostic-tool span {
  overflow: hidden;
  color: var(--fg-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-diagnostic-tool .available {
  color: var(--color-green, #62b478);
}

.git-diagnostic-tool .missing {
  color: var(--color-red, #e06c75);
}

.spin {
  animation: git-diagnostic-spin 0.8s linear infinite;
}

@keyframes git-diagnostic-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .git-configuration-form,
  .git-diagnostic-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .git-configuration-heading svg:first-child {
    transition: none;
  }

  .spin {
    animation: none;
  }
}
</style>

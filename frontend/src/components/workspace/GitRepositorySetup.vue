<template>
  <section class="git-repository-setup" :aria-label="t('gitPanel.setupRepository')">
    <div class="git-setup-state">
      <GitBranch :size="22" aria-hidden="true" />
      <span>{{ t('gitPanel.notRepository') }}</span>
    </div>

    <div class="git-setup-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        data-testid="git-setup-init-tab"
        :aria-selected="setupMode === 'initialize'"
        :class="{ active: setupMode === 'initialize' }"
        :disabled="busy"
        @click="setupMode = 'initialize'"
      >
        {{ t('gitPanel.initializeRepository') }}
      </button>
      <button
        type="button"
        role="tab"
        data-testid="git-setup-clone-tab"
        :aria-selected="setupMode === 'clone'"
        :class="{ active: setupMode === 'clone' }"
        :disabled="busy"
        @click="setupMode = 'clone'"
      >
        {{ t('gitPanel.cloneRepository') }}
      </button>
    </div>

    <form
      v-if="setupMode === 'initialize'"
      class="git-setup-form"
      @submit.prevent="initializeRepository"
    >
      <label>
        <span>{{ t('gitPanel.initialBranch') }}</span>
        <input
          v-model="initialBranch"
          data-testid="git-init-branch"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <button
        type="button"
        data-testid="git-init-button"
        class="git-setup-primary"
        :disabled="busy || !initialBranch.trim()"
        @click="initializeRepository"
      >
        <LoaderCircle v-if="busy" :size="14" class="spinning" />
        <GitBranchPlus v-else :size="14" />
        <span>{{ t('gitPanel.initializeRepository') }}</span>
      </button>
    </form>

    <form v-else class="git-setup-form" @submit.prevent="cloneRepository">
      <label>
        <span>{{ t('gitPanel.repositoryUrl') }}</span>
        <input
          v-model="cloneUrl"
          data-testid="git-clone-url"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://example.com/team/project.git"
        />
      </label>
      <label>
        <span>{{ t('gitPanel.cloneDirectory') }}</span>
        <input
          v-model="cloneDirectory"
          data-testid="git-clone-directory"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="project"
        />
      </label>
      <button
        type="button"
        data-testid="git-clone-button"
        class="git-setup-primary"
        :disabled="busy || !cloneUrl.trim() || !cloneDirectory.trim()"
        @click="cloneRepository"
      >
        <LoaderCircle v-if="busy" :size="14" class="spinning" />
        <Download v-else :size="14" />
        <span>{{ t('gitPanel.cloneRepository') }}</span>
      </button>
    </form>

    <p v-if="errorMessage" class="git-setup-error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Download, GitBranch, GitBranchPlus, LoaderCircle } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  paneId: string
}>()

const emit = defineEmits<{
  'repository-created': [repository: string]
}>()

const { t } = useI18n()
const setupMode = ref<'initialize' | 'clone'>('initialize')
const initialBranch = ref('main')
const cloneUrl = ref('')
const cloneDirectory = ref('')
const busy = ref(false)
const errorMessage = ref('')

async function postRepositorySetup(
  endpoint: 'git-init' | 'git-clone',
  body: Record<string, string>,
  fallbackRepository: string
): Promise<void> {
  // 步骤1：向当前文件导航工作区发送仓库创建请求。
  busy.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(function emptyRepositorySetupResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.repositorySetupFailed')
      return
    }

    // 步骤2：把后端确认的相对路径交给导航层重新扫描并选中。
    const repository =
      typeof result.repository === 'string' ? result.repository : fallbackRepository
    emit('repository-created', repository)
  } catch {
    errorMessage.value = t('gitPanel.repositorySetupFailed')
  } finally {
    busy.value = false
  }
}

async function initializeRepository(): Promise<void> {
  // 步骤1：使用输入的初始分支初始化当前工作区根目录。
  const branch = initialBranch.value.trim()
  if (!branch) return
  await postRepositorySetup('git-init', { initial_branch: branch }, '')
}

async function cloneRepository(): Promise<void> {
  // 步骤1：把远程仓库克隆到用户指定的工作区直属子目录。
  const url = cloneUrl.value.trim()
  const directory = cloneDirectory.value.trim()
  if (!url || !directory) return
  await postRepositorySetup('git-clone', { url, directory }, directory)
}
</script>

<style scoped>
.git-repository-setup {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.git-setup-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 12px 16px;
  color: var(--fg-muted);
  font-size: 11px;
  text-align: center;
}

.git-setup-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 0 8px;
  border: 1px solid var(--border);
}

.git-setup-tabs button {
  min-height: 29px;
  border: 0;
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 10px;
  cursor: pointer;
}

.git-setup-tabs button + button {
  border-left: 1px solid var(--border);
}

.git-setup-tabs button.active {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-setup-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px 8px;
}

.git-setup-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-setup-form input {
  width: 100%;
  min-width: 0;
  min-height: 29px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 7px;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 10px;
}

.git-setup-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 31px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  color: var(--button-fg, #fff);
  background: var(--accent);
  font-size: 10px;
  cursor: pointer;
}

.git-setup-primary:disabled,
.git-setup-tabs button:disabled {
  opacity: 0.55;
  cursor: default;
}

.git-setup-error {
  margin: 0 8px 10px;
  color: var(--error, #e06c75);
  font-size: 10px;
  white-space: pre-wrap;
}

.spinning {
  animation: git-setup-spin 0.8s linear infinite;
}

@keyframes git-setup-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<template>
  <div>
    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.group.interface') }}</h3>

      <section class="settings-section">
        <h3>{{ t('settings.language') }}</h3>
        <div class="settings-row">
          <select
            v-model="settings.locale"
            class="shortcut-input"
            style="flex: 1"
            @change="saveSettings()"
          >
            <option value="zh">{{ t('settings.lang.zh') }}</option>
            <option value="en">{{ t('settings.lang.en') }}</option>
          </select>
        </div>
      </section>

      <section class="settings-section">
        <h3>{{ t('settings.panelPosition') }}</h3>
        <div class="settings-row">
          <select
            v-model="settings.panel_position"
            class="shortcut-input"
            style="flex: 1"
            @change="saveSettings()"
          >
            <option value="auto">{{ t('settings.panelPos.auto') }}</option>
            <option value="left">{{ t('settings.panelPos.left') }}</option>
            <option value="right">{{ t('settings.panelPos.right') }}</option>
            <option value="top">{{ t('settings.panelPos.top') }}</option>
            <option value="bottom">{{ t('settings.panelPos.bottom') }}</option>
          </select>
        </div>
        <p class="settings-hint">{{ t('settings.panelPositionHint') }}</p>
      </section>

      <section class="settings-section">
        <h3>{{ t('settings.virtualKeyboard') }}</h3>
        <div class="settings-row">
          <label>{{ t('settings.virtualKeyboard.show') }}</label>
          <label class="toggle">
            <input
              type="checkbox"
              v-model="settings.show_virtual_keyboard"
              @change="saveSettings()"
            />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint">{{ t('settings.virtualKeyboard.hint') }}</p>
      </section>

      <section class="settings-section">
        <h3>{{ t('settings.workspaceBadge') }}</h3>
        <SegmentedControl
          class="ws-badge-control"
          data-setting="workspace-badge-mode"
          :model-value="wsBadgeEffective.mode"
          :options="wsBadgeModeOptions"
          :aria-label="t('settings.workspaceBadge.mode')"
          @update:model-value="onWsBadgeModeChange"
        />
        <p class="settings-hint">{{ t('settings.workspaceBadge.hint') }}</p>
      </section>
    </div>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.group.security') }}</h3>

      <section class="settings-section">
        <h3>{{ t('settings.accessUrl') }}</h3>
        <div class="access-url-row">
          <div class="access-url-display">
            <span class="access-url-text">{{ accessUrl }}</span>
            <button class="access-url-copy" @click="copyAccessUrl" :title="t('settings.copyUrl')">
              {{ copied ? '✓' : '⧉' }}
            </button>
          </div>
          <div v-if="accessUrl" class="qr-code-wrap">
            <canvas ref="qrCanvasRef"></canvas>
          </div>
          <p class="settings-hint">{{ t('settings.accessUrlHint') }}</p>
        </div>
      </section>

      <section class="settings-section">
        <h3>{{ t('settings.token') }}</h3>
        <div class="token-row">
          <input
            ref="tokenInputRef"
            :type="tokenVisible ? 'text' : 'password'"
            :value="tokenEditing ? customToken : currentToken"
            :readonly="!tokenEditing"
            class="token-input"
            :placeholder="tokenEditing ? t('settings.token.custom') : ''"
            @input="customToken = ($event.target as HTMLInputElement).value"
          />
          <button
            class="icon-btn"
            @click="tokenVisible = !tokenVisible"
            :title="tokenVisible ? t('settings.token.hide') : t('settings.token.show')"
          >
            <EyeOff v-if="tokenVisible" :size="14" /><Eye v-else :size="14" />
          </button>
          <template v-if="!tokenEditing">
            <button class="icon-btn" @click="copyToken" :title="t('settings.token.copy')">
              <Check v-if="tokenCopied" :size="14" /><Copy v-else :size="14" />
            </button>
            <button class="icon-btn" @click="startEditToken" :title="t('settings.token.edit')">
              <Pencil :size="14" />
            </button>
            <button
              class="icon-btn danger"
              @click="regenerateToken"
              :title="t('settings.token.regenerate')"
            >
              <RefreshCw :size="14" />
            </button>
          </template>
          <template v-else>
            <button
              class="icon-btn"
              @click="saveToken"
              :disabled="customToken.trim().length < 8 || tokenSaving"
              :title="t('settings.token.save')"
            >
              <Save :size="14" />
            </button>
            <button class="icon-btn" @click="cancelEditToken" :title="t('settings.token.cancel')">
              <X :size="14" />
            </button>
          </template>
        </div>
        <p class="settings-hint">{{ t('settings.token.hint') }}</p>
        <p v-if="tokenError" class="token-error">{{ tokenError }}</p>
      </section>

      <CollapsibleSection :title="t('settings.group.advancedSecurity')" level="section">
      <section class="settings-section">
        <h3>{{ t('settings.ipWhitelist') }}</h3>
        <div v-for="(ip, idx) in settings.ip_whitelist" :key="idx" class="ip-row">
          <span class="ip-text">{{ ip }}</span>
          <button class="icon-btn danger" @click="removeIp(idx)">✕</button>
        </div>
        <div class="ip-row" style="margin-top: 8px">
          <input
            v-model="newIp"
            type="text"
            class="token-input"
            :placeholder="t('settings.ipWhitelist.placeholder')"
            @keydown.enter="addIp"
          />
          <button class="icon-btn" @click="addIp">{{ t('settings.ipWhitelist.add') }}</button>
        </div>
        <p class="settings-hint">{{ t('settings.ipWhitelist.hint') }}</p>
      </section>

      <section class="settings-section">
        <h3>{{ t('security.authConfig') }}</h3>

        <div class="settings-row">
          <label>{{ t('security.lockoutStrategy') }}</label>
          <select v-model="settings.auth.lockout_strategy" @change="saveSettings()">
            <option value="ip">IP</option>
            <option value="global">Global</option>
            <option value="off">Off</option>
          </select>
        </div>

        <template v-if="settings.auth.lockout_strategy === 'ip'">
          <div class="settings-row">
            <label>{{ t('security.lockoutMaxFailures') }}</label>
            <input
              type="number"
              v-model.number="settings.auth.lockout_max_failures"
              @change="saveSettings()"
              min="1"
              max="100"
              class="settings-input-number"
            />
          </div>
          <div class="settings-row">
            <label>{{ t('security.lockoutSecs') }}</label>
            <input
              type="number"
              v-model.number="settings.auth.lockout_secs"
              @change="saveSettings()"
              min="10"
              max="3600"
              class="settings-input-number"
            />
          </div>
        </template>

        <template v-if="settings.auth.lockout_strategy === 'global'">
          <div class="settings-row">
            <label>{{ t('security.globalLockoutMaxFailures') }}</label>
            <input
              type="number"
              v-model.number="settings.auth.global_lockout_max_failures"
              @change="saveSettings()"
              min="1"
              max="1000"
              class="settings-input-number"
            />
          </div>
          <div class="settings-row">
            <label>{{ t('security.globalLockoutSecs') }}</label>
            <input
              type="number"
              v-model.number="settings.auth.global_lockout_secs"
              @change="saveSettings()"
              min="10"
              max="86400"
              class="settings-input-number"
            />
          </div>
        </template>

        <div class="settings-row" style="margin-top: 8px">
          <label>{{ t('security.allowedOrigins') }}</label>
        </div>
        <textarea
          class="config-textarea"
          :value="settings.auth.allowed_origins.join('\n')"
          @input="onAllowedOriginsInput"
          :placeholder="t('security.allowedOriginsPlaceholder')"
          rows="3"
        ></textarea>
        <p class="settings-hint">{{ t('security.allowedOriginsHint') }}</p>

        <div class="settings-row" style="margin-top: 8px">
          <label>{{ t('security.trustedProxies') }}</label>
        </div>
        <textarea
          class="config-textarea"
          :value="settings.auth.trusted_proxies.join('\n')"
          @input="onTrustedProxiesInput"
          :placeholder="t('security.trustedProxiesPlaceholder')"
          rows="3"
        ></textarea>
        <p class="settings-hint">{{ t('security.trustedProxiesHint') }}</p>

        <div class="settings-row" style="margin-top: 8px">
          <label>{{ t('security.previewAllowExternal') }}</label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.preview.allow_external" @change="saveSettings()" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint">{{ t('security.previewAllowExternalHint') }}</p>
      </section>
      </CollapsibleSection>
    </div>

    <CollapsibleSection :title="t('settings.group.filesFolders')" level="group">
      <section class="settings-section">
        <div class="settings-row">
          <label>{{ t('settings.uploads.defaultDir') }}</label>
          <div class="upload-dir-control">
            <input
              v-model="settings.default_base_dir"
              class="shortcut-input upload-dir-input"
              placeholder="/Users/me/projects"
              @change="saveSettings()"
            />
            <button
              v-if="isTauri()"
              class="icon-btn"
              type="button"
              @click="pickDefaultBaseDir"
            >
              <FolderOpen :size="14" />
              {{ t('settings.uploads.pickDir') }}
            </button>
          </div>
        </div>
        <div class="settings-row">
          <label>{{ t('settings.workspace.defaultRoot') }}</label>
          <div class="upload-dir-control">
            <input
              v-model="settings.default_workspace_root"
              class="shortcut-input upload-dir-input"
              placeholder="/Users/me/projects"
              @change="saveSettings()"
            />
            <button
              v-if="isTauri()"
              class="icon-btn"
              type="button"
              @click="pickDefaultWorkspaceRoot"
            >
              <FolderOpen :size="14" />
              {{ t('settings.uploads.pickDir') }}
            </button>
          </div>
        </div>
        <p class="settings-hint">{{ t('settings.workspace.defaultRootHint') }}</p>
        <div class="settings-row">
          <label>{{ t('settings.uploads.dir') }}</label>
          <div class="upload-dir-control">
            <input
              v-model="settings.upload_dir"
              class="shortcut-input upload-dir-input"
              data-testid="upload-dir-input"
              :placeholder="uploadDirPlaceholder"
              @change="onUploadSettingsChange"
              @blur="refreshUploadStatus"
            />
            <button
              v-if="isTauri()"
              class="icon-btn"
              type="button"
              @click="pickUploadDir"
              :disabled="!!uploadBusy"
            >
              <FolderOpen :size="14" />
              {{ t('settings.uploads.pickDir') }}
            </button>
          </div>
        </div>
        <p v-if="uploadDirError" class="settings-error" data-testid="upload-dir-error">
          {{ uploadDirError }}
        </p>
        <div class="settings-row">
          <label>{{ t('settings.uploads.capMb') }}</label>
          <input
            v-model.number="settings.upload_cap_mb"
            type="number"
            min="0"
            class="shortcut-input upload-number-input"
            @change="onUploadSettingsChange"
          />
        </div>
        <div class="settings-row">
          <label>{{ t('settings.uploads.fileCapMb') }}</label>
          <input
            v-model.number="settings.upload_file_cap_mb"
            type="number"
            min="0"
            class="shortcut-input upload-number-input"
            @change="onUploadSettingsChange"
          />
        </div>
        <p class="settings-hint">{{ t('settings.uploads.fileCapUnlimited') }}</p>
        <div class="settings-row">
          <label>{{ t('settings.uploads.capCount') }}</label>
          <input
            v-model.number="settings.upload_cap_count"
            type="number"
            min="0"
            class="shortcut-input upload-number-input"
            @change="onUploadSettingsChange"
          />
        </div>
        <div class="upload-actions">
          <button
            class="icon-btn"
            data-testid="restore-upload-default"
            @click="restoreDefaultUploadDir"
            :disabled="!!uploadBusy"
          >
            <RefreshCw :size="14" />
            {{ t('settings.uploads.restoreDefault') }}
          </button>
          <button class="icon-btn danger" @click="clearUploads" :disabled="!!uploadBusy">
            {{
              uploadBusy === 'clear' ? t('settings.uploads.clearing') : t('settings.uploads.clear')
            }}
          </button>
          <button
            v-if="uploadStatus.foreign"
            class="icon-btn"
            @click="adoptUploads"
            :disabled="!!uploadBusy"
          >
            {{
              uploadBusy === 'adopt' ? t('settings.uploads.adopting') : t('settings.uploads.adopt')
            }}
          </button>
        </div>
        <p class="settings-hint">{{ t('settings.uploads.hint') }}</p>
        <p v-if="!uploadDirError" class="settings-hint">{{ uploadStatusLabel }}</p>
      </section>
    </CollapsibleSection>

    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.group.behavior') }}</h3>

      <section class="settings-section">
        <h3>{{ t('settings.monitor') }}</h3>
        <div class="settings-row">
          <label>{{ t('settings.monitor.enabled') }}</label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.monitor.enabled" @change="saveSettings()" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
      </section>

      <section class="settings-section">
        <h3>{{ t('settings.behavior') }}</h3>
        <div class="settings-row">
          <label>{{ t('settings.confirmBeforeCloseTab') }}</label>
          <label class="toggle">
            <input
              type="checkbox"
              v-model="settings.confirm_before_close_tab"
              @change="saveSettings()"
              data-setting="confirm-before-close-tab"
            />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint" data-hint="confirm-before-close-tab">
          {{ t('settings.confirmBeforeCloseTabHint') }}
        </p>
        <div class="settings-row">
          <label>{{ t('settings.spaceConfirmsDialogs') }}</label>
          <label class="toggle">
            <input
              type="checkbox"
              v-model="settings.space_confirms_dialogs"
              @change="saveSettings()"
              data-setting="space-confirms-dialogs"
            />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint" data-hint="space-confirms-dialogs">
          {{ t('settings.spaceConfirmsDialogsHint') }}
        </p>
      </section>
    </div>

    <CollapsibleSection :title="t('settings.log')" level="group">
      <section class="settings-section">
        <div class="settings-row">
          <label>{{ t('settings.log.enabled') }}</label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.log.enabled" @change="saveSettings()" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint">{{ t('settings.log.hint') }}</p>

        <template v-if="settings.log.enabled">
          <div class="settings-row" style="margin-top: 12px">
            <label>{{ t('settings.log.path') }}</label>
            <input
              v-model="settings.log.path"
              class="shortcut-input"
              :placeholder="t('settings.log.pathHint')"
              @change="saveSettings()"
            />
          </div>
          <div class="settings-row" style="margin-top: 8px">
            <label>{{ t('settings.log.maxSize') }}</label>
            <input
              v-model.number="settings.log.max_size_mb"
              type="number"
              class="shortcut-input"
              min="1"
              max="500"
              @change="saveSettings()"
            />
          </div>
          <div style="margin-top: 12px">
            <button class="icon-btn" @click="viewLog">{{ t('settings.log.view') }}</button>
          </div>
        </template>
      </section>
    </CollapsibleSection>

    <!-- Log Viewer Modal -->
    <div v-if="logModalVisible" class="log-modal-overlay" @click.self="logModalVisible = false">
      <div class="log-modal">
        <div class="log-modal-header">
          <h3>{{ t('settings.log.viewTitle') }}</h3>
          <div class="log-modal-actions">
            <button class="icon-btn" @click="refreshLog">{{ t('settings.log.refresh') }}</button>
            <button class="icon-btn" @click="logModalVisible = false">
              {{ t('settings.log.close') }}
            </button>
          </div>
        </div>
        <pre class="log-content">{{
          logLoading ? t('settings.log.loading') : logContent || t('settings.log.noLog')
        }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import QRCode from 'qrcode'
import { Eye, EyeOff, Copy, Check, Pencil, RefreshCw, Save, X, FolderOpen } from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { useSettings } from '../../composables/useSettings'
import type { WorkspaceBadgeMode } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { useIsMobile } from '../../composables/useIsMobile'
import { resolveWorkspaceBadgeMode } from '../../composables/useWorkspaceBadgeMode'
import { uiConfirm } from '../../composables/useConfirm'
import CollapsibleSection from './CollapsibleSection.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import { copyToClipboard } from '../../utils/clipboard'
import { useToast } from 'vue-toastification'
import { isTauri } from '../../composables/useTransport'
import {
  apiUrl,
  authFetch,
  getAuthToken,
  setAuthToken,
  getApiBase,
  fetchServerToken,
} from '../../composables/apiBase'
import type { UploadResponse } from '../../types/uploads'

const emit = defineEmits<{ 'token-changed': [] }>()
const { settings, saveSettings } = useSettings()
const { t } = useI18n()
const { isMobile } = useIsMobile()
const toast = useToast()

const wsBadgeEffective = computed(() =>
  resolveWorkspaceBadgeMode(settings.workspace_badge_mode, isMobile.value)
)
const wsBadgeModeOptions = computed(() => [
  { value: 'off', label: t('settings.workspaceBadge.mode.off') },
  { value: 'tab', label: t('settings.workspaceBadge.mode.tab') },
  { value: 'icon', label: t('settings.workspaceBadge.mode.icon') },
  { value: 'both', label: t('settings.workspaceBadge.mode.both') },
])

function onWsBadgeModeChange(value: string) {
  settings.workspace_badge_mode = value as WorkspaceBadgeMode
  saveSettings()
}

const accessUrl = ref('')
const logModalVisible = ref(false)
const logContent = ref('')
const logLoading = ref(false)
const copied = ref(false)
const qrCanvasRef = ref<HTMLCanvasElement | null>(null)
const currentToken = ref('')
const uploadBusy = ref<'' | 'status' | 'clear' | 'adopt'>('')
const uploadStatus = ref({ managed: false, foreign: false, empty: true })
const uploadDirError = ref('')

const uploadStatusLabel = computed(() => {
  if (uploadStatus.value.foreign) return t('settings.uploads.statusForeign')
  if (uploadStatus.value.managed) return t('settings.uploads.statusManaged')
  return t('settings.uploads.statusUnknown')
})

const uploadDirPlaceholder = computed(() => {
  const platform = (navigator.platform || '').toLowerCase()
  const userAgent = (navigator.userAgent || '').toLowerCase()
  if (platform.startsWith('win') || userAgent.includes('windows')) return '%TEMP%\\dinotty'
  if (platform.includes('mac') || userAgent.includes('mac os')) return '$TMPDIR/dinotty'
  return '/tmp/dinotty'
})

function setUploadStatus(data: UploadResponse) {
  uploadDirError.value = ''
  uploadStatus.value = {
    managed: !!data.managed,
    foreign: !!data.foreign,
    empty: !!data.empty,
  }
}

function errorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined
  const status = Number((err as { status: unknown }).status)
  return Number.isFinite(status) ? status : undefined
}

async function postUploadsStatus() {
  const res = await authFetch(apiUrl('/api/uploads'), { method: 'GET' })
  if (!res.ok) throw { status: res.status }
  return (await res.json()) as UploadResponse
}

async function refreshUploadStatus() {
  if (uploadBusy.value) return
  uploadBusy.value = 'status'
  try {
    setUploadStatus(await postUploadsStatus())
    uploadDirError.value = ''
  } catch (err) {
    uploadDirError.value = errorStatus(err) === 400 ? t('settings.uploads.dirInvalid') : ''
    uploadStatus.value = { managed: false, foreign: false, empty: true }
  } finally {
    uploadBusy.value = ''
  }
}

async function onUploadSettingsChange() {
  if (!Number.isFinite(settings.upload_cap_mb as number)) settings.upload_cap_mb = 0
  if (!Number.isFinite(settings.upload_file_cap_mb as number)) settings.upload_file_cap_mb = 0
  if (!Number.isFinite(settings.upload_cap_count as number)) settings.upload_cap_count = 0
  await saveSettings()
  await refreshUploadStatus()
}

async function pickUploadDir() {
  try {
    const dir = await invoke<string | null>('pick_upload_dir')
    if (!dir) return
    settings.upload_dir = dir
    await onUploadSettingsChange()
  } catch {
    uploadDirError.value = t('settings.uploads.dirInvalid')
  }
}

async function pickDefaultBaseDir() {
  const dir = await invoke<string | null>('pick_workspace_dir', { base: settings.default_base_dir || undefined })
  if (!dir) return
  settings.default_base_dir = dir
  await saveSettings()
}

async function pickDefaultWorkspaceRoot() {
  const dir = await invoke<string | null>('pick_workspace_dir', { base: settings.default_workspace_root || undefined })
  if (!dir) return
  settings.default_workspace_root = dir
  await saveSettings()
}

async function restoreDefaultUploadDir() {
  try {
    const res = await authFetch(apiUrl('/api/uploads/default-dir'), { method: 'GET' })
    if (!res.ok) throw new Error(`default upload dir failed: ${res.status}`)
    const data = (await res.json()) as { default_dir?: string }
    if (!data.default_dir) return
    settings.upload_dir = data.default_dir
    await onUploadSettingsChange()
  } catch {
    uploadDirError.value = t('settings.uploads.dirInvalid')
  }
}

async function clearUploads() {
  uploadBusy.value = 'clear'
  try {
    const res = await authFetch(apiUrl('/api/uploads/clear'), { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setUploadStatus((await res.json()) as UploadResponse)
    toast.success(t('settings.uploads.clearDone'))
  } catch {
    toast.error(t('settings.uploads.clearFailed'))
    uploadBusy.value = ''
    await refreshUploadStatus()
  } finally {
    uploadBusy.value = ''
  }
}

async function adoptUploads() {
  uploadBusy.value = 'adopt'
  try {
    const res = await authFetch(apiUrl('/api/uploads/adopt'), { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setUploadStatus((await res.json()) as UploadResponse)
    toast.success(t('settings.uploads.adoptDone'))
  } catch {
    toast.error(t('settings.uploads.adoptFailed'))
    uploadBusy.value = ''
    await refreshUploadStatus()
  } finally {
    uploadBusy.value = ''
  }
}

function onUploadStatusEvent(ev: Event) {
  setUploadStatus((ev as CustomEvent<UploadResponse>).detail ?? {})
}

watch([accessUrl, qrCanvasRef], ([url, canvas]) => {
  if (url && canvas) {
    QRCode.toCanvas(canvas, url, {
      width: 160,
      margin: 2,
      color: { dark: '#C7C7C7', light: '#00000000' },
    })
  }
})

async function fetchAccessUrl() {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/info'))
    const info = await res.json()
    accessUrl.value = `http://${info.lan_ip}:${info.port}`
  } catch {
    const { hostname } = window.location
    const host = hostname === 'localhost' ? '127.0.0.1' : hostname
    const port = window.location.port
    accessUrl.value = `http://${host}${port ? ':' + port : ''}`
  }
}

async function refreshAccessUrlAndQr() {
  await fetchAccessUrl()
}

onMounted(async () => {
  await fetchAccessUrl()
  currentToken.value = (await fetchServerToken()) || getAuthToken()
  await refreshUploadStatus()
})

// Re-fetch IP when network changes (e.g. WiFi switch)
function onNetworkChange() {
  refreshAccessUrlAndQr()
}

// Also refresh when user comes back to the tab (handles seamless WiFi switches)
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshAccessUrlAndQr()
  }
}

onMounted(() => {
  window.addEventListener('online', onNetworkChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('dinotty-upload-status', onUploadStatusEvent)
})
onUnmounted(() => {
  window.removeEventListener('online', onNetworkChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('dinotty-upload-status', onUploadStatusEvent)
})

async function copyAccessUrl() {
  await copyToClipboard(accessUrl.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

// Token management
const tokenVisible = ref(false)
const tokenCopied = ref(false)
const customToken = ref('')
const tokenSaving = ref(false)
const tokenError = ref('')
const tokenEditing = ref(false)
const tokenInputRef = ref<HTMLInputElement | null>(null)

async function copyToken() {
  await copyToClipboard(currentToken.value)
  tokenCopied.value = true
  setTimeout(() => {
    tokenCopied.value = false
  }, 2000)
}

function startEditToken() {
  customToken.value = ''
  tokenEditing.value = true
  tokenError.value = ''
  nextTick(() => tokenInputRef.value?.focus())
}

function cancelEditToken() {
  customToken.value = ''
  tokenEditing.value = false
  tokenError.value = ''
}

async function saveToken() {
  const val = customToken.value.trim()
  if (val.length < 8) return
  await applyNewToken(val)
  tokenEditing.value = false
  customToken.value = ''
}

async function regenerateToken() {
  if (!(await uiConfirm(t('settings.token.confirmRegenerate'), {
    title: t('settings.token.regenerate'),
    confirmText: t('settings.token.regenerate'),
    cancelText: t('filePreview.cancel'),
  }))) return
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  const token = Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  await applyNewToken(token)
}

async function applyNewToken(token: string) {
  tokenSaving.value = true
  tokenError.value = ''
  try {
    const res = await authFetch(apiUrl('/api/token'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) {
      setAuthToken(token)
      emit('token-changed')
    } else {
      tokenError.value = t('settings.token.saveFailed')
    }
  } catch {
    tokenError.value = t('settings.token.saveFailed')
  } finally {
    tokenSaving.value = false
  }
}

// IP whitelist
const newIp = ref('')

function onAllowedOriginsInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  settings.auth.allowed_origins = val.split('\n').map((s) => s.trim()).filter(Boolean)
  saveSettings()
}

function onTrustedProxiesInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  settings.auth.trusted_proxies = val.split('\n').map((s) => s.trim()).filter(Boolean)
  saveSettings()
}

function addIp() {
  const val = newIp.value.trim()
  if (!val) return
  if (!settings.ip_whitelist.includes(val)) {
    settings.ip_whitelist.push(val)
  }
  newIp.value = ''
}

function removeIp(idx: number) {
  settings.ip_whitelist.splice(idx, 1)
}

async function viewLog() {
  logModalVisible.value = true
  await refreshLog()
}

async function refreshLog() {
  logLoading.value = true
  try {
    const res = await authFetch(apiUrl('/api/log'))
    if (res.ok) {
      logContent.value = await res.text()
    } else {
      logContent.value = t('settings.log.noLog')
    }
  } catch {
    logContent.value = t('settings.log.noLog')
  } finally {
    logLoading.value = false
  }
}
</script>

<style scoped>
.token-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.token-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--fg-bright);
  font-size: 13px;
  font-family: monospace;
  outline: none;
  min-width: 0;
}

.token-input:focus {
  border-color: var(--accent);
}

.icon-btn {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.icon-btn:hover {
  background: #3a3a3c;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn.danger {
  color: #f44747;
  border-color: #4a2020;
}

.icon-btn.danger:hover {
  background: #3a1e1e;
}

.ip-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}

.ip-text {
  flex: 1;
  font-size: 13px;
  color: #c8c8c8;
  font-family: monospace;
  padding: 4px 2px;
}

.upload-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 10px 0 6px;
}

.upload-dir-control {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.upload-dir-input {
  flex: 1;
  min-width: 0;
}

.upload-number-input {
  max-width: 120px;
}

.token-error,
.settings-error {
  color: #f44747;
  font-size: 14px;
  font-weight: 600;
  margin: 4px 0 0;
}

.qr-code-wrap {
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 8px;
}

.qr-code-wrap canvas {
  border-radius: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  padding: 8px;
}

.qr-refresh-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.2s,
    border-color 0.2s;
}

.qr-refresh-btn:hover {
  color: var(--text-primary, #fff);
  border-color: var(--text-secondary, #888);
}

.log-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.log-modal {
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.log-modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-primary, #e8e8e8);
}

.log-modal-actions {
  display: flex;
  gap: 8px;
}

.log-content {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #aaa);
  white-space: pre-wrap;
  word-break: break-all;
}

.config-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  resize: vertical;
}

.settings-input-number {
  width: 80px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  padding: 6px 8px;
  font-size: 12px;
  text-align: center;
}

/* match SettingsPanel .settings-row gap rhythm (10px) removed when the wrapping row was dropped */
.ws-badge-control {
  margin-bottom: 10px;
}
</style>

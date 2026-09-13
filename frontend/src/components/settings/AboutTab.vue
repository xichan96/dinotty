<template>
  <div>
    <div class="settings-group">
      <h3 class="settings-group-title">{{ t('settings.about.title') }}</h3>
      <div class="about-logo-row">
        <img src="/logo.png" alt="Dinotty" class="about-logo" />
        <span class="about-name">Dinotty</span>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.version') }}</label>
        <span class="about-val">{{ info.version || '—' }}</span>
      </div>
      <div class="update-check-row">
        <div class="update-check-status" role="status">
          <span v-if="update.status.value === 'checking'" class="update-check-line">
            <LoaderCircle :size="13" class="spin" />
            {{ t('settings.about.checking') }}
          </span>
          <span v-else-if="update.status.value === 'up_to_date'" class="update-check-line">
            <Check :size="13" />
            {{ t('settings.about.upToDate', { version: `v${update.currentVersion.value}` }) }}
          </span>
          <span v-else-if="update.status.value === 'unavailable'" class="update-check-line failed">
            <AlertTriangle :size="13" />
            {{ t('settings.about.checkFailed') }}
          </span>
          <span v-else-if="update.status.value === 'grace_period'" class="update-check-line">
            <Clock :size="13" />
            {{ t('settings.about.gracePeriod', { version: `v${update.latestVersion.value}` }) }}
          </span>
          <span v-else-if="update.status.value === 'update_available'" class="update-check-line">
            <Sparkles :size="13" />
            {{ t('settings.about.updateAvailable', { version: `v${update.latestVersion.value}` }) }}
          </span>
        </div>
        <button
          class="update-check-button"
          type="button"
          :disabled="update.status.value === 'checking'"
          @click="checkNow"
        >
          <RefreshCw :size="13" :class="{ spin: update.status.value === 'checking' }" />
          {{ t('settings.about.checkForUpdates') }}
        </button>
      </div>
      <div v-if="update.status.value === 'update_available'" class="update-card" role="status">
        <div class="update-card-copy">
          <strong>{{
            t('settings.about.updateAvailable', { version: `v${update.latestVersion.value}` })
          }}</strong>
          <span v-if="update.assetName.value" class="update-asset-line">
            {{ update.assetName.value }}
            <template v-if="update.assetSize.value !== null">
              · {{ formatBytes(update.assetSize.value) }}
            </template>
          </span>
        </div>

        <template v-if="update.downloadStatus.value === 'saving'">
          <p class="update-progress-label">{{ t('settings.about.downloadPreparing') }}</p>
        </template>
        <template v-else-if="update.downloadStatus.value === 'downloading'">
          <div class="update-progress">
            <div class="update-progress-track">
              <div
                class="update-progress-bar"
                :style="{ width: `${update.downloadProgress.value.percent ?? 0}%` }"
              ></div>
            </div>
            <span class="update-progress-label">
              {{
                update.downloadProgress.value.percent === null
                  ? formatBytes(update.downloadProgress.value.downloaded)
                  : t('settings.about.downloading', {
                      percent: String(update.downloadProgress.value.percent),
                    })
              }}
            </span>
            <button class="update-link-button" type="button" @click="update.cancelDownload()">
              {{ t('settings.about.cancelDownload') }}
            </button>
          </div>
        </template>
        <template v-else-if="update.downloadStatus.value === 'done'">
          <p class="update-progress-label">
            {{ t('settings.about.downloadComplete', { path: update.downloadedPath.value }) }}
          </p>
          <div class="update-actions">
            <button class="update-release-button" type="button" @click="revealDownloaded">
              {{ t('settings.about.revealInFolder') }}
            </button>
            <button class="update-release-button" type="button" @click="openDownloaded">
              {{ t('settings.about.openInstaller') }}
            </button>
          </div>
        </template>
        <template v-else>
          <div v-if="canDownloadInApp" class="update-actions">
            <button
              class="update-release-button"
              type="button"
              :disabled="opening"
              @click="update.startDownload()"
            >
              {{ t('settings.about.downloadUpdate') }}
            </button>
          </div>
          <p v-else-if="update.assetUrl.value" class="update-hint">
            {{ t('settings.about.desktopOnlyDownload') }}
          </p>
          <div class="update-actions">
            <button
              class="update-release-button secondary"
              type="button"
              :disabled="opening"
              @click="openRelease"
            >
              {{ t('settings.about.viewRelease') }}
            </button>
          </div>
          <p
            v-for="asset in update.alternateAssets.value"
            :key="asset.url"
            class="update-hint"
          >
            <button class="update-link-button" type="button" @click="openAlternate(asset.url)">
              {{ t('settings.about.alternateDownload', { name: asset.name }) }}
            </button>
          </p>
        </template>

        <p v-if="update.downloadStatus.value === 'cancelled'" class="update-hint">
          {{ t('settings.about.downloadCancelled') }}
        </p>
        <p v-else-if="update.downloadStatus.value === 'error'" class="update-open-error">
          {{ t('settings.about.downloadFailed') }}
        </p>
        <p v-if="openError" class="update-open-error">{{ openError }}</p>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.repository') }}</label>
        <a
          href="https://github.com/xichan96/dinotty"
          target="_blank"
          rel="noopener"
          class="about-link"
        >
          https://github.com/xichan96/dinotty
        </a>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.documentation') }}</label>
        <a
          href="https://xichan96.github.io/dinotty"
          target="_blank"
          rel="noopener"
          class="about-link"
        >
          https://xichan96.github.io/dinotty
        </a>
      </div>
      <div class="settings-row">
        <label>{{ t('settings.about.feedback') }}</label>
        <a
          href="https://github.com/xichan96/dinotty/issues"
          target="_blank"
          rel="noopener"
          class="about-link"
        >
          https://github.com/xichan96/dinotty/issues
        </a>
      </div>
      <div class="settings-row auto-update-row">
        <div class="auto-update-copy">
          <label for="auto-check-updates">{{ t('settings.about.autoCheckUpdates') }}</label>
          <span>{{ t('settings.about.autoCheckUpdatesHint') }}</span>
        </div>
        <label class="toggle" :class="{ disabled: !settingsLoaded }">
          <input
            id="auto-check-updates"
            v-model="settings.auto_check_updates"
            type="checkbox"
            :disabled="!settingsLoaded"
            @change="saveSettings()"
          />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useToast } from 'vue-toastification'
import { AlertTriangle, Check, Clock, LoaderCircle, RefreshCw, Sparkles } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { getIsAppForeground, onAppForegroundGain } from '../../composables/useAppForeground'
import { useSettings } from '../../composables/useSettings'
import { useUpdateCheck } from '../../composables/useUpdateCheck'
import { isTauri } from '../../composables/useTransport'
import { openExternalUrl, openReleaseAssetUrl } from '../../utils/openExternalUrl'

const emit = defineEmits<{
  'open-about': []
}>()

const { t } = useI18n()
const { settings, settingsLoaded, saveSettings } = useSettings()
const update = useUpdateCheck()
const toast = useToast()
const opening = ref(false)
const openError = ref('')

/** The app can only write the installer itself in the desktop shell. */
const canDownloadInApp = computed(() => isTauri() && update.assetUrl.value.length > 0)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function checkNow() {
  void update.recheck()
}

function openAlternate(url: string) {
  void openReleaseAssetUrl(url)
}

function revealDownloaded() {
  void update.revealDownloadedFile()
}

function openDownloaded() {
  void update.openDownloadedFile()
}

const info = ref<{
  version: string
  repo_url: string
}>({
  version: '',
  repo_url: '',
})

async function loadInfo() {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/info'))
    const data = await res.json()
    info.value = {
      version: data.version || '',
      repo_url: data.repo_url || '',
    }
  } catch {
    // ignore
  }
}

async function openRelease() {
  if (opening.value) return
  opening.value = true
  openError.value = ''
  const opened = await openExternalUrl(update.releaseUrl.value)
  if (!opened) openError.value = t('settings.about.openReleaseFailed')
  opening.value = false
}

function showUpdatePromptIfVisible() {
  if (!settings.auto_check_updates || !getIsAppForeground()) return
  const prompt = update.takeAvailablePrompt()
  if (!prompt) return
  toast.info(t('settings.about.updateToast', { version: `v${prompt.latestVersion}` }), {
    timeout: 8000,
    closeOnClick: true,
    toastClassName: 'update-available-toast',
    onClick: () => emit('open-about'),
  })
}

watch(update.status, showUpdatePromptIfVisible, { immediate: true, flush: 'post' })
watch(
  [settingsLoaded, () => settings.auto_check_updates],
  ([loaded, enabled], [wasLoaded, wasEnabled]) => {
    if (!loaded || !enabled) return
    const check = wasLoaded && !wasEnabled ? update.recheck() : update.start()
    void check.then(showUpdatePromptIfVisible)
  },
  { immediate: true }
)

const stopUpdatePromptForeground = onAppForegroundGain(showUpdatePromptIfVisible)

onMounted(() => {
  void loadInfo()
})
onUnmounted(() => {
  stopUpdatePromptForeground()
  update.dispose()
})
</script>

<style scoped>
.about-logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.about-logo {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.about-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--fg-bright);
}
.about-val {
  font-size: 13px;
  color: var(--fg-muted);
}
.about-link {
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}
.about-link:hover {
  text-decoration: underline;
}
.update-check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0 2px;
}
.update-check-status {
  min-width: 0;
  color: var(--fg-muted);
  font-size: 12px;
}
.update-check-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.update-check-line.failed {
  color: var(--danger);
}
.update-check-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg-bright);
  background: var(--bg-input);
  font-size: 12px;
}
.update-check-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-input));
}
.update-check-button:disabled {
  cursor: default;
  opacity: 0.65;
}
.spin {
  animation: about-spin 1s linear infinite;
}
@keyframes about-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
.update-card {
  margin: 12px 0 14px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 8px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 12%, transparent),
      transparent 68%
    ),
    var(--bg-surface);
}
.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.update-asset-line {
  color: var(--fg-muted);
  font-size: 11px;
  word-break: break-all;
}
.update-hint {
  margin: 10px 0 0;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.45;
}
.update-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 11px;
}
.update-progress-track {
  overflow: hidden;
  flex: 1;
  min-width: 120px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-input);
}
.update-progress-bar {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.2s linear;
}
.update-progress-label {
  margin: 10px 0 0;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.45;
  word-break: break-all;
}
.update-progress .update-progress-label {
  margin: 0;
}
.update-link-button {
  padding: 0;
  border: none;
  color: var(--accent);
  background: none;
  font-size: 11px;
  text-decoration: none;
}
.update-link-button:hover {
  text-decoration: underline;
}
.update-card-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.update-card-copy strong {
  color: var(--fg-bright);
  font-size: 13px;
  font-weight: 600;
}
.update-card-copy span {
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}
.update-release-button {
  margin-top: 11px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
  border-radius: 6px;
  color: var(--fg-bright);
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-input));
  font-size: 12px;
  font-weight: 600;
}
.update-release-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 24%, var(--bg-input));
}
.update-release-button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.update-release-button.secondary {
  border-color: var(--border);
  background: var(--bg-input);
  font-weight: 500;
}
.update-open-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 11px;
}
.auto-update-row {
  align-items: flex-start;
  border-top: 1px solid var(--border);
  margin-top: 14px;
  padding-top: 14px;
}
.auto-update-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.auto-update-copy span {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.45;
}
.auto-update-row .toggle {
  margin-top: 1px;
}
.auto-update-row .toggle.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>

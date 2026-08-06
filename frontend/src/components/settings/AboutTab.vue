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
      <div v-if="update.status.value === 'update_available'" class="update-card" role="status">
        <div class="update-card-copy">
          <strong>{{
            t('settings.about.updateAvailable', { version: `v${update.latestVersion.value}` })
          }}</strong>
        </div>
        <button
          class="update-release-button"
          type="button"
          :disabled="opening"
          @click="openRelease"
        >
          {{ t('settings.about.viewRelease') }}
        </button>
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
          href="https://xichan96.github.io/dinotty/"
          target="_blank"
          rel="noopener"
          class="about-link"
        >
          https://xichan96.github.io/dinotty/
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
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useToast } from 'vue-toastification'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { getIsAppForeground, onAppForegroundGain } from '../../composables/useAppForeground'
import { useSettings } from '../../composables/useSettings'
import { useUpdateCheck } from '../../composables/useUpdateCheck'
import { openExternalUrl } from '../../utils/openExternalUrl'

const emit = defineEmits<{
  'open-about': []
}>()

const { t } = useI18n()
const { settings, settingsLoaded, saveSettings } = useSettings()
const update = useUpdateCheck()
const toast = useToast()
const opening = ref(false)
const openError = ref('')

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
  color: var(--accent, #8a8a8a);
  text-decoration: none;
  word-break: break-all;
}
.about-link:hover {
  text-decoration: underline;
}
.update-card {
  margin: 2px 0 14px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--accent, #8a8a8a) 45%, var(--border));
  border-radius: 8px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent, #8a8a8a) 12%, transparent),
      transparent 68%
    ),
    var(--bg-surface);
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
  border: 1px solid color-mix(in srgb, var(--accent, #8a8a8a) 55%, var(--border));
  border-radius: 6px;
  color: var(--fg-bright);
  background: color-mix(in srgb, var(--accent, #8a8a8a) 15%, var(--bg-input));
  font-size: 12px;
  font-weight: 600;
}
.update-release-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #8a8a8a) 24%, var(--bg-input));
}
.update-release-button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.update-open-error {
  margin: 8px 0 0;
  color: var(--danger, #e45d5d);
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

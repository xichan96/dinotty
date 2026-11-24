<template>
  <div class="login-screen">
    <div class="login-card">
      <img src="/logo.png" alt="Dinotty" class="login-logo" />
      <h1 class="login-title">Dinotty</h1>
      <p class="login-subtitle">{{ t('setup.subtitle') }}</p>
      <p class="setup-desc">{{ t('setup.desc') }}</p>
      <form @submit.prevent="onSubmit">
        <div class="setup-input-row">
          <input
            v-model="token"
            type="password"
            class="login-input"
            :placeholder="t('setup.placeholder')"
            autocomplete="new-password"
            autofocus
            @focus="error = ''"
          />
          <button
            type="button"
            class="setup-gen-btn"
            @click="generate"
            :title="t('setup.generate')"
          >
            <RefreshCw :size="14" />
          </button>
        </div>
        <button type="submit" class="login-btn" :disabled="loading || token.trim().length < 8">
          {{ loading ? t('setup.loading') : t('setup.submit') }}
        </button>
      </form>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { validateToken, authFetch, hubApiUrl } from '../composables/apiBase'
import { useI18n } from '../composables/useI18n'
import { RefreshCw } from 'lucide-vue-next'

const emit = defineEmits<{ (e: 'success'): void }>()
const { t } = useI18n()

const token = ref('')
const error = ref('')
const loading = ref(false)

function generate() {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  token.value = Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function onSubmit() {
  const val = token.value.trim()
  if (val.length < 8) {
    error.value = t('setup.tooShort')
    return
  }
  loading.value = true
  error.value = ''
  try {
    // Hub scope: `/api/token` is in the relay's hub-only list and would 403
    // through `/__srv/<id>`.
    const res = await authFetch(hubApiUrl('/api/token'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: val }),
    })
    if (res.ok) {
      // Token saved server-side; now authenticate to get a session cookie.
      const r = await validateToken(val)
      if (r.ok) {
        emit('success')
      } else {
        error.value = t('setup.saveFailed')
      }
    } else {
      error.value = t('setup.saveFailed')
    }
  } catch {
    error.value = t('setup.saveFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100dvh;
  background: var(--bg);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 340px;
  padding: 32px 24px;
}

.login-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.login-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--fg-bright);
  margin: 0;
  font-family:
    'Inter',
    system-ui,
    -apple-system,
    sans-serif;
}

.login-subtitle {
  font-size: 13px;
  color: var(--fg-muted);
  margin: 0;
  text-align: center;
}

.setup-desc {
  font-size: 12px;
  color: var(--fg-muted);
  margin: 0;
  text-align: center;
  line-height: 1.5;
}

.login-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg-bright);
  font-size: 14px;
  font-family: 'Inter', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s;
  margin-top: 8px;
}
.login-input:focus {
  border-color: var(--accent);
}
.login-input::placeholder {
  color: var(--fg-muted);
}

.setup-input-row {
  display: flex;
  gap: 6px;
  align-items: start;
  width: 100%;
}
.setup-input-row .login-input {
  flex: 1;
  margin-top: 8px;
}
.setup-gen-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.setup-gen-btn:hover {
  color: var(--fg-bright);
  border-color: var(--accent);
}

.login-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Inter', system-ui, sans-serif;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s;
}
.login-btn:hover {
  background: var(--accent-hover);
}
.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-error {
  color: #f44747;
  font-size: 12px;
  margin: 4px 0 0;
}
</style>

<template>
  <div class="login-screen">
    <div class="login-card">
      <img src="/logo.png" alt="Dinotty" class="login-logo" />
      <h1 class="login-title">Dinotty</h1>
      <p class="login-subtitle">
        {{ loginMethod === 'verification_code' ? t('login.codeSubtitle') : t('login.subtitle') }}
      </p>

      <form v-if="loginMethod === 'verification_code'" @submit.prevent="onVerifyCode">
        <button
          type="button"
          class="login-btn login-btn--secondary"
          :disabled="sendingCode || codeResendIn > 0"
          @click="onSendCode"
        >
          {{
            sendingCode
              ? t('login.sendingCode')
              : codeResendIn > 0
                ? t('login.resendIn', { seconds: codeResendIn })
                : codeSent
                  ? t('login.resendCode')
                  : t('login.sendCode')
          }}
        </button>
        <input
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          class="login-input"
          :placeholder="t('login.codePlaceholder')"
          autofocus
          :disabled="retryIn > 0"
          @focus="error = ''"
          @input="code = code.replace(/\D/g, '').slice(0, 6)"
        />
        <button
          type="submit"
          class="login-btn"
          :disabled="loading || retryIn > 0 || code.length !== 6"
        >
          {{ loading ? t('login.verifyingCode') : t('login.verifyCode') }}
        </button>
      </form>

      <form v-else @submit.prevent="onSubmitToken">
        <input
          v-model="token"
          type="password"
          class="login-input"
          :placeholder="t('login.placeholder')"
          autocomplete="current-password"
          autofocus
          :disabled="retryIn > 0"
          @focus="error = ''"
        />
        <button type="submit" class="login-btn" :disabled="loading || retryIn > 0">
          {{ loading ? t('login.loading') : t('login.submit') }}
        </button>
      </form>

      <p v-if="info" class="login-info">{{ info }}</p>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  validateToken,
  validateCode,
  requestCode,
  checkTokenConfigured,
} from '../composables/apiBase'
import { useI18n } from '../composables/useI18n'

const emit = defineEmits<{ (e: 'success'): void }>()
const { t } = useI18n()

const loginMethod = ref<'token' | 'verification_code'>('token')
const token = ref('')
const code = ref('')
const error = ref('')
const info = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const codeSent = ref(false)
const retryIn = ref(0)
const codeResendIn = ref(0)
let requestId = ''
let lockdownTimer: number | undefined
let resendTimer: number | undefined

function clearLockdown() {
  if (lockdownTimer !== undefined) {
    window.clearInterval(lockdownTimer)
    lockdownTimer = undefined
  }
  retryIn.value = 0
}

function clearResendTimer() {
  if (resendTimer !== undefined) {
    window.clearInterval(resendTimer)
    resendTimer = undefined
  }
  codeResendIn.value = 0
}

function startLockdown(seconds: number) {
  clearLockdown()
  retryIn.value = seconds
  error.value = t('login.locked', { seconds })
  lockdownTimer = window.setInterval(() => {
    retryIn.value -= 1
    if (retryIn.value <= 0) {
      clearLockdown()
      error.value = ''
      return
    }
    error.value = t('login.locked', { seconds: retryIn.value })
  }, 1000)
}

function startResendCountdown(seconds: number) {
  clearResendTimer()
  codeResendIn.value = seconds
  resendTimer = window.setInterval(() => {
    codeResendIn.value -= 1
    if (codeResendIn.value <= 0) {
      clearResendTimer()
    }
  }, 1000)
}

async function onSubmitToken() {
  const val = token.value.trim()
  if (!val) {
    error.value = t('login.empty')
    return
  }
  loading.value = true
  error.value = ''
  info.value = ''
  const r = await validateToken(val)
  loading.value = false
  if (r.ok) {
    emit('success')
    return
  }
  if (r.reason === 'locked') {
    startLockdown(r.retryAfter ?? 60)
  } else {
    error.value = t('login.invalid')
  }
}

async function onSendCode() {
  sendingCode.value = true
  error.value = ''
  info.value = ''
  const r = await requestCode()
  sendingCode.value = false
  if (r.ok) {
    requestId = r.requestId
    codeSent.value = true
    info.value = t('login.codeSent')
    // Rate-limit the resend button: matches the backend's per-IP 5/min cap.
    startResendCountdown(60)
  } else if (r.reason === 'rate_limited') {
    error.value = t('login.codeRateLimited')
    startResendCountdown(r.retryAfter ?? 60)
  } else {
    error.value = t('login.codeRateLimited')
  }
}

async function onVerifyCode() {
  const val = code.value.trim()
  if (val.length !== 6) {
    error.value = t('login.codeEmpty')
    return
  }
  if (!requestId) {
    error.value = t('login.codeNotFound')
    return
  }
  loading.value = true
  error.value = ''
  info.value = ''
  const r = await validateCode(requestId, val)
  loading.value = false
  if (r.ok) {
    emit('success')
    return
  }
  switch (r.reason) {
    case 'locked':
      startLockdown(r.retryAfter ?? 60)
      break
    case 'expired':
      error.value = t('login.codeExpired')
      code.value = ''
      break
    case 'consumed':
      error.value = t('login.codeConsumed')
      code.value = ''
      break
    case 'not_found':
      error.value = t('login.codeNotFound')
      requestId = ''
      code.value = ''
      break
    case 'too_many_attempts':
      error.value = t('login.codeTooManyAttempts')
      code.value = ''
      requestId = ''
      break
    case 'method_mismatch':
      error.value = t('login.codeMethodMismatch')
      break
    default:
      error.value = t('login.codeInvalid')
  }
}

onMounted(async () => {
  const cfg = await checkTokenConfigured()
  if (cfg.loginMethod === 'verification_code') {
    loginMethod.value = 'verification_code'
  }
})

onBeforeUnmount(() => {
  clearLockdown()
  clearResendTimer()
})
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
  letter-spacing: 0.4em;
  text-align: center;
}
.login-input:focus {
  border-color: var(--accent);
}
.login-input::placeholder {
  color: var(--fg-muted);
  letter-spacing: normal;
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

.login-btn--secondary {
  background: var(--bg-input);
  color: var(--fg-bright);
  border: 1px solid var(--border);
}
.login-btn--secondary:hover {
  background: var(--bg-elevated);
}

.login-error {
  color: #f44747;
  font-size: 12px;
  margin: 4px 0 0;
  text-align: center;
}

.login-info {
  color: var(--fg-muted);
  font-size: 12px;
  margin: 4px 0 0;
  text-align: center;
}
</style>

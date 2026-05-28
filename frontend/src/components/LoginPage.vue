<template>
  <div class="login-screen">
    <div class="login-card">
      <img src="/logo.png" alt="Dinotty" class="login-logo" />
      <h1 class="login-title">Dinotty</h1>
      <p class="login-subtitle">{{ t('login.subtitle') }}</p>
      <form @submit.prevent="onSubmit">
        <input
          v-model="token"
          type="password"
          class="login-input"
          :placeholder="t('login.placeholder')"
          autocomplete="current-password"
          autofocus
          @focus="error = ''"
        />
        <button type="submit" class="login-btn" :disabled="loading">
          {{ loading ? t('login.loading') : t('login.submit') }}
        </button>
      </form>
      <p v-if="error" class="login-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { setAuthToken, validateToken } from '../composables/apiBase'
import { useI18n } from '../composables/useI18n'

const emit = defineEmits<{ (e: 'success'): void }>()
const { t } = useI18n()

const token = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  const val = token.value.trim()
  if (!val) {
    error.value = t('login.empty')
    return
  }
  loading.value = true
  error.value = ''
  const ok = await validateToken(val)
  loading.value = false
  if (ok) {
    setAuthToken(val)
    emit('success')
  } else {
    error.value = t('login.invalid')
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
  background: #1E1E1E;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
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
  color: #E8E8E8;
  margin: 0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

.login-subtitle {
  font-size: 13px;
  color: #858585;
  margin: 0;
  text-align: center;
}

.login-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #3C3C3C;
  border-radius: 6px;
  background: #2A2A2C;
  color: #E8E8E8;
  font-size: 14px;
  font-family: 'Inter', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s;
  margin-top: 8px;
}
.login-input:focus {
  border-color: #007AFF;
}
.login-input::placeholder {
  color: #666;
}

.login-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: #007AFF;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Inter', system-ui, sans-serif;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s;
}
.login-btn:hover {
  background: #3395FF;
}
.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-error {
  color: #F44747;
  font-size: 12px;
  margin: 4px 0 0;
}
</style>

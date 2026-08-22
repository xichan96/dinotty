<template>
  <BaseDialog :visible="true" :title="t('ssh.connect')" size="sm" @close="$emit('close')">
    <div class="ssh-pw-body">
      <div class="ssh-pw-target">{{ username }}@{{ host }}:{{ port }}</div>

      <div class="ssh-pw-field">
        <label>{{ t('ssh.password') }}</label>
        <input
          ref="pwInput"
          v-model="password"
          type="password"
          class="ssh-pw-input"
          autofocus
          @keydown.enter="onConnect"
        />
      </div>

      <div v-if="error" class="ssh-pw-error">{{ error }}</div>
    </div>

    <template #footer>
      <button class="dialog-btn" @click="$emit('close')">{{ t('ssh.cancel') }}</button>
      <button class="dialog-btn dialog-btn--primary" :disabled="connecting" @click="onConnect">
        {{ connecting ? t('ssh.connecting') : t('ssh.connect') }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import BaseDialog from '../ui/BaseDialog.vue'

const { t } = useI18n()

const props = defineProps<{
  host: string
  port: number
  username: string
  name?: string
}>()

const emit = defineEmits<{
  connect: [password: string]
  close: []
}>()

const password = ref('')
const error = ref('')
const connecting = ref(false)
const pwInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  nextTick(() => pwInput.value?.focus())
})

function onConnect() {
  if (connecting.value) return
  if (!password.value) {
    error.value = t('ssh.errorPassword')
    return
  }
  connecting.value = true
  error.value = ''
  emit('connect', password.value)
}
</script>

<style scoped>
.ssh-pw-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ssh-pw-target {
  font-size: 13px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.ssh-pw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ssh-pw-field label {
  font-size: 12px;
  color: var(--fg-muted);
  font-weight: 500;
}
.ssh-pw-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.ssh-pw-input:focus {
  border-color: var(--accent);
}

.ssh-pw-error {
  color: var(--color-red);
  font-size: 12px;
}
</style>

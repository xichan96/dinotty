<template>
  <BaseDialog :visible="true" :title="t('ssh.authRequired')" size="sm" @close="onCancel">
    <p class="ssh-auth-host">{{ host }}</p>
    <div v-for="(p, i) in prompts" :key="i" class="ssh-auth-field">
      <label>{{ p.prompt }}</label>
      <input
        :ref="
          (el) => {
            if (el && i === 0) (el as HTMLInputElement).focus()
          }
        "
        v-model="responses[i]"
        :type="p.echo ? 'text' : 'password'"
        @keydown.enter="onSubmit"
      />
    </div>
    <template #footer>
      <button class="dialog-btn" @click="onCancel">{{ t('ssh.cancel') }}</button>
      <button class="dialog-btn dialog-btn--primary" @click="onSubmit">
        {{ t('ssh.submit') }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import BaseDialog from '../ui/BaseDialog.vue'

const props = defineProps<{
  host: string
  prompts: Array<{ prompt: string; echo: boolean }>
}>()

const emit = defineEmits<{
  submit: [responses: string[]]
  cancel: []
}>()

const { t } = useI18n()
const responses = ref<string[]>(props.prompts.map(() => ''))

watch(
  () => props.prompts,
  (newPrompts) => {
    responses.value = newPrompts.map(() => '')
  },
  { immediate: true }
)

function onSubmit() {
  emit('submit', [...responses.value])
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.ssh-auth-host {
  font-size: 12px;
  color: var(--fg-muted);
  margin: 0 0 12px;
  font-family: var(--font-mono);
}

.ssh-auth-field {
  margin-bottom: 12px;
}

.ssh-auth-field label {
  display: block;
  font-size: 12px;
  color: var(--fg-muted);
  margin-bottom: 4px;
}

.ssh-auth-field input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 13px;
  font-family: var(--font-mono);
  box-sizing: border-box;
}

.ssh-auth-field input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>

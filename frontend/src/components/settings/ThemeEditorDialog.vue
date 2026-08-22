<template>
  <BaseDialog
    :visible="open"
    :title="t('settings.theme.editorTitle')"
    size="xl"
    @close="emit('cancel')"
  >
    <div class="theme-editor-body">
      <label class="theme-editor-name">
        <span>{{ t('settings.theme.name') }}</span>
        <input v-model="name" type="text" />
      </label>

      <div class="custom-colors-grid">
        <label class="color-field">
          <span>{{ t('settings.color.fg') }}</span>
          <div class="color-input-wrap">
            <input v-model="draft.foreground" type="color" />
            <span class="color-hex">{{ draft.foreground }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.bg') }}</span>
          <div class="color-input-wrap">
            <input v-model="draft.background" type="color" />
            <span class="color-hex">{{ draft.background }}</span>
          </div>
        </label>
        <label class="color-field">
          <span>{{ t('settings.color.cursor') }}</span>
          <div class="color-input-wrap">
            <input v-model="draft.cursor" type="color" />
            <span class="color-hex">{{ draft.cursor }}</span>
          </div>
        </label>
      </div>

      <div class="theme-editor-ansi-title">{{ t('settings.color.ansi') }}</div>
      <div class="ansi-grid">
        <label v-for="(label, index) in ANSI_NAMES" :key="label" class="ansi-field">
          <span class="ansi-label">{{ label }}</span>
          <input v-model="draft.ansi[index]" type="color" />
        </label>
      </div>
    </div>

    <template #footer>
      <button type="button" class="dialog-btn" @click="emit('cancel')">
        {{ t('settings.theme.cancel') }}
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--primary"
        :disabled="!name.trim()"
        @click="saveAsNew"
      >
        {{ t('settings.theme.saveAsNew') }}
      </button>
      <button
        v-if="canSaveChanges"
        type="button"
        class="dialog-btn dialog-btn--primary"
        :disabled="!name.trim()"
        @click="saveChanges"
      >
        {{ t('settings.theme.saveChanges') }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { buildCustomThemeColors, type ThemeColors } from '../../composables/useDeviceThemeSelection'
import { applyThemeToDOM } from '../../themes'
import BaseDialog from '../ui/BaseDialog.vue'

const props = defineProps<{
  open: boolean
  initialColors: ThemeColors
  initialName: string
  canSaveChanges: boolean
}>()

const emit = defineEmits<{
  'save-as-new': [colors: ThemeColors, name: string]
  'save-changes': [colors: ThemeColors]
  cancel: []
}>()

const { t } = useI18n()

const ANSI_NAMES = [
  'Black',
  'Red',
  'Green',
  'Yellow',
  'Blue',
  'Magenta',
  'Cyan',
  'White',
  'Bright Black',
  'Bright Red',
  'Bright Green',
  'Bright Yellow',
  'Bright Blue',
  'Bright Magenta',
  'Bright Cyan',
  'Bright White',
]

function cloneColors(colors: ThemeColors): ThemeColors {
  return {
    foreground: colors.foreground,
    background: colors.background,
    cursor: colors.cursor,
    ansi: Array.from({ length: 16 }, (_, index) => colors.ansi[index] ?? '#000000'),
  }
}

const draft = reactive<ThemeColors>(cloneColors(props.initialColors))
const name = ref(props.initialName)

function resetDraft() {
  const next = cloneColors(props.initialColors)
  draft.foreground = next.foreground
  draft.background = next.background
  draft.cursor = next.cursor
  draft.ansi.splice(0, draft.ansi.length, ...next.ansi)
  name.value = props.initialName
}

function draftSnapshot(): ThemeColors {
  return cloneColors(draft)
}

watch(
  () => props.open,
  (open) => {
    if (open) resetDraft()
  }
)

watch(() => props.initialColors, resetDraft, { deep: true })

watch(
  draft,
  () => {
    if (!props.open) return
    applyThemeToDOM({
      name: 'draft',
      label: '',
      colors: buildCustomThemeColors({
        uuid: 'draft',
        name: 'draft',
        colors: draftSnapshot(),
      }),
    })
  },
  { deep: true, flush: 'sync' }
)

function saveAsNew() {
  emit('save-as-new', draftSnapshot(), name.value.trim())
}

function saveChanges() {
  emit('save-changes', draftSnapshot())
}
</script>

<style scoped>
.theme-editor-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.theme-editor-name {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--fg-muted);
  font-size: 12px;
}

.theme-editor-name input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
  color: inherit;
  background: var(--bg-input);
  font: inherit;
}

.theme-editor-name input:focus {
  border-color: var(--accent);
}

.theme-editor-ansi-title {
  color: var(--fg-muted);
  font-size: 12px;
}
</style>

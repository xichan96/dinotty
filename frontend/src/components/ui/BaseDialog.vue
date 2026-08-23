<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="dialog-backdrop"
      :style="{ zIndex: `calc(var(--z-dialog) + ${depth})` }"
      @click.self="onBackdrop"
    >
      <section
        ref="rootEl"
        class="dialog"
        :class="[
          `dialog--${size}`,
          dialogClass,
          { 'dialog--bottom-sheet': variant === 'bottom-sheet' },
        ]"
        :style="width ? { width, maxWidth: 'none' } : undefined"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
      >
        <header v-if="title || closable || $slots['header-extra']" class="dialog-header">
          <span v-if="title" class="dialog-title">{{ title }}</span>
          <slot name="header-extra" />
          <button
            v-if="closable"
            type="button"
            class="dialog-close"
            :aria-label="resolvedCloseLabel"
            @click="emit('close')"
          >
            <X :size="16" />
          </button>
        </header>
        <div class="dialog-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="dialog-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useDialogStack } from '../../composables/useDialogStack'
import { useI18n } from '../../composables/useI18n'
import '../../styles/dialog.css'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    width?: string
    dialogClass?: string
    variant?: 'modal' | 'bottom-sheet'
    closable?: boolean
    closeOnBackdrop?: boolean
    closeOnEscape?: boolean
    closeLabel?: string
  }>(),
  {
    title: '',
    size: 'sm',
    width: undefined,
    dialogClass: undefined,
    variant: 'modal',
    closable: true,
    closeOnBackdrop: true,
    closeOnEscape: true,
    closeLabel: undefined,
  }
)

const emit = defineEmits<{
  close: []
  keydown: [event: KeyboardEvent]
}>()

const { t } = useI18n()
const rootEl = ref<HTMLElement | null>(null)
const { depth, isTop } = useDialogStack(() => props.visible)
const resolvedCloseLabel = computed(() => props.closeLabel ?? t('dialog.close'))

function onBackdrop() {
  if (props.closeOnBackdrop) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (!props.visible || !isTop()) return
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') return
  if (e.key === 'Escape' && props.closeOnEscape) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  emit('keydown', e)
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))

defineExpose({ rootEl })
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: var(--dialog-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  max-width: 94vw;
  width: 90vw;
  overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--dialog-shadow);
}

.dialog--sm {
  max-width: 380px;
}

.dialog--md {
  max-width: 440px;
}

.dialog--lg {
  max-width: 520px;
}

.dialog--xl {
  max-width: min(680px, 94vw);
}

.dialog--bottom-sheet {
  align-self: flex-end;
  max-height: 60vh;
  width: 100%;
  border-radius: var(--radius) var(--radius) 0 0;
  border-bottom: none;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px 0;
}

.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}

.dialog-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  transition: background 0.15s;
}

.dialog-close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.dialog-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 10px 16px;
}

.dialog-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}
</style>

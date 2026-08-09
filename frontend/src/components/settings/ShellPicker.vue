<template>
  <div ref="rootRef" class="shell-picker">
    <button
      ref="triggerRef"
      type="button"
      class="shell-trigger shortcut-input"
      aria-haspopup="listbox"
      :aria-expanded="open"
      aria-controls="shell-picker-listbox"
      :aria-label="t('settings.shellPicker.label')"
      data-testid="shell-picker-trigger"
      @click="toggle"
      @keydown.down.prevent="openPicker"
      @keydown.up.prevent="openPicker"
      @keydown.esc.prevent="closePicker()"
    >
      <span class="shell-trigger-copy">
        <span>{{ currentLabel }}</span>
        <small v-if="currentDetail">{{ currentDetail }}</small>
      </span>
      <ChevronDown :size="16" :class="{ rotated: open }" />
    </button>

    <div v-if="open" class="shell-popover">
      <div
        v-if="loading"
        id="shell-picker-listbox"
        class="shell-state"
        role="status"
        aria-live="polite"
      >
        <LoaderCircle :size="17" class="spin" />
        {{ t('settings.shellProbe.loading') }}
      </div>

      <div
        v-else-if="error"
        id="shell-picker-listbox"
        class="shell-state shell-error"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle :size="17" />
        <span>{{ t('settings.shellProbe.failed') }}</span>
        <button type="button" class="retry-button" @click="probe">
          <RefreshCw :size="14" /> {{ t('settings.shellProbe.retry') }}
        </button>
      </div>

      <div v-else-if="response" class="shell-results">
        <div
          v-if="response.current_selection.status !== 'available'"
          class="selection-warning"
          aria-live="polite"
        >
          <AlertTriangle :size="15" />
          <span>{{ selectionStatusText }}</span>
        </div>

        <div
          id="shell-picker-listbox"
          ref="listboxRef"
          class="shell-listbox"
          role="listbox"
          tabindex="0"
          :aria-activedescendant="activeOptionId"
          @keydown="onListboxKeydown"
        >
          <template v-for="(option, index) in options" :key="option.key">
            <button
              :id="optionId(index)"
              type="button"
              class="shell-option"
              :class="{ active: index === activeIndex, selected: option.key === selectedKey }"
              role="option"
              :aria-selected="option.key === selectedKey"
              tabindex="-1"
              @mouseenter="activeIndex = index"
              @click="selectOption(option)"
            >
              <span class="option-main">
                <span>{{ option.label }}</span>
                <small v-if="option.detail">{{ option.detail }}</small>
              </span>
              <Check v-if="option.key === selectedKey" :size="15" />
            </button>
          </template>
        </div>

        <div v-if="response.warnings.length" class="probe-warnings" aria-live="polite">
          {{ response.warnings.map(warningLabel).join(' · ') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AlertTriangle, Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'

interface DetectedShell {
  kind: string
  program: string
  distro: string | null
}

interface ShellProbeResponse {
  platform: string
  default_shell: DetectedShell
  current_selection: {
    kind: string
    distro: string | null
    status: 'available' | 'unavailable' | 'unknown'
    reason: string | null
  }
  shells: DetectedShell[]
  warnings: string[]
}

interface PickerOption {
  key: string
  kind: string
  distro: string | null
  label: string
  detail?: string
}

const props = defineProps<{ kind: string; distro: string | null }>()
const emit = defineEmits<{
  select: [selection: { kind: string; distro: string | null }]
}>()
const { t } = useI18n()

const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const listboxRef = ref<HTMLElement | null>(null)
const open = ref(false)
const loading = ref(false)
const error = ref(false)
const response = ref<ShellProbeResponse | null>(null)
const activeIndex = ref(0)
let controller: AbortController | null = null
let requestId = 0

const selectedKey = computed(() => optionKey(props.kind || 'auto', props.distro))
const currentLabel = computed(() => {
  if (props.kind === 'wsl') {
    return props.distro ? `${props.distro}(WSL)` : t('settings.shellKind.wslDefault')
  }
  return t(`settings.shellKind.${props.kind || 'auto'}`)
})
const currentDetail = computed(() => {
  if (!response.value || props.kind !== 'auto') return ''
  return response.value.default_shell.program
})

const options = computed<PickerOption[]>(() => {
  if (!response.value) return []
  const result: PickerOption[] = [
    {
      key: optionKey('auto', null),
      kind: 'auto',
      distro: null,
      label: t('settings.shellKind.auto'),
      detail: response.value.default_shell.program,
    },
  ]
  for (const shell of response.value.shells.filter((item) => item.kind !== 'wsl')) {
    result.push({
      key: optionKey(shell.kind, null),
      kind: shell.kind,
      distro: null,
      label: t(`settings.shellKind.${shell.kind}`),
      detail: shell.program,
    })
  }
  for (const shell of response.value.shells.filter((item) => item.kind === 'wsl')) {
    if (!shell.distro || isInternalWslDistro(shell.distro)) continue
    result.push({
      key: optionKey('wsl', shell.distro),
      kind: 'wsl',
      distro: shell.distro,
      label: `${shell.distro}(WSL)`,
    })
  }
  result.push({
    key: optionKey('custom', null),
    kind: 'custom',
    distro: null,
    label: t('settings.shellKind.custom'),
  })
  return result
})

const activeOptionId = computed(() =>
  options.value.length ? optionId(Math.min(activeIndex.value, options.value.length - 1)) : undefined
)
const selectionStatusText = computed(() => {
  if (!response.value) return ''
  const selection = response.value.current_selection
  const state =
    selection.status === 'unknown'
      ? t('settings.shellProbe.unknown')
      : t('settings.shellProbe.unavailable')
  return selection.reason ? `${state}: ${reasonLabel(selection.reason)}` : state
})

function optionKey(kind: string, distro: string | null) {
  return `${kind}:${distro ?? ''}`
}

function isInternalWslDistro(distro: string) {
  const normalized = distro.toLowerCase()
  return (
    normalized === 'docker-desktop' ||
    normalized.startsWith('docker-desktop-') ||
    normalized === 'rancher-desktop' ||
    normalized.startsWith('rancher-desktop-') ||
    normalized.startsWith('podman-machine-')
  )
}

function optionId(index: number) {
  return `shell-picker-option-${index}`
}

function reasonLabel(reason: string) {
  const translated = t(`settings.shellProbe.reason.${reason}`)
  return translated.startsWith('settings.shellProbe.reason.') ? reason : translated
}

function warningLabel(warning: string) {
  const translated = t(`settings.shellProbe.warning.${warning}`)
  return translated.startsWith('settings.shellProbe.warning.') ? warning : translated
}

function openPicker() {
  if (open.value) return
  open.value = true
  activeIndex.value = Math.max(
    0,
    options.value.findIndex((option) => option.key === selectedKey.value)
  )
  void probe()
}

function closePicker(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  controller?.abort()
  controller = null
  requestId += 1
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus())
}

function toggle() {
  if (open.value) closePicker(false)
  else openPicker()
}

async function probe() {
  controller?.abort()
  const currentRequest = ++requestId
  const requestController = new AbortController()
  controller = requestController
  loading.value = true
  error.value = false
  response.value = null
  try {
    await getApiBase()
    const result = await authFetch(apiUrl('/api/shells'), { signal: requestController.signal })
    if (!result.ok) throw new Error(`shell probe failed: ${result.status}`)
    const data = (await result.json()) as ShellProbeResponse
    if (currentRequest !== requestId || !open.value) return
    response.value = data
    activeIndex.value = Math.max(
      0,
      options.value.findIndex((option) => option.key === selectedKey.value)
    )
    await nextTick()
    listboxRef.value?.focus()
  } catch (probeError) {
    if (currentRequest !== requestId || !open.value) return
    if (probeError instanceof DOMException && probeError.name === 'AbortError') return
    error.value = true
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

function selectOption(option: PickerOption) {
  emit('select', { kind: option.kind, distro: option.distro })
  closePicker()
}

function onListboxKeydown(event: KeyboardEvent) {
  if (!options.value.length) return
  if (event.key === 'ArrowDown') activeIndex.value = (activeIndex.value + 1) % options.value.length
  else if (event.key === 'ArrowUp') {
    activeIndex.value = (activeIndex.value - 1 + options.value.length) % options.value.length
  } else if (event.key === 'Home') activeIndex.value = 0
  else if (event.key === 'End') activeIndex.value = options.value.length - 1
  else if (event.key === 'Enter' || event.key === ' ') {
    selectOption(options.value[activeIndex.value]!)
  } else if (event.key === 'Escape') closePicker()
  else return
  event.preventDefault()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (open.value && !rootRef.value?.contains(event.target as Node)) closePicker(false)
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  controller?.abort()
  requestId += 1
})
</script>

<style scoped>
.shell-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.shell-trigger {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.shell-trigger-copy,
.option-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.shell-trigger-copy small,
.option-main small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-trigger svg {
  flex: 0 0 auto;
  transition: transform 160ms ease;
}

.shell-trigger svg.rotated {
  transform: rotate(180deg);
}

.shell-popover {
  position: absolute;
  z-index: 80;
  top: calc(100% + 7px);
  left: 0;
  width: min(100%, 520px);
  min-width: 280px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 12px;
  background: var(--bg-surface, #252526);
  box-shadow: 0 18px 50px color-mix(in srgb, #000 34%, transparent);
}

.shell-state,
.selection-warning,
.probe-warnings {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 14px;
  color: var(--text-secondary);
  font-size: 12px;
}

.shell-error,
.selection-warning {
  color: var(--warning, #d9a441);
}

.retry-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  border: 0;
  color: var(--accent);
  background: transparent;
  cursor: pointer;
}

.shell-listbox {
  max-height: 320px;
  overflow: auto;
  padding: 6px;
  outline: none;
}

.shell-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--text-primary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.shell-option.active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.shell-option.selected {
  color: var(--accent);
}

.probe-warnings {
  border-top: 1px solid var(--border);
}

.spin {
  animation: shell-spin 0.9s linear infinite;
}

@keyframes shell-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

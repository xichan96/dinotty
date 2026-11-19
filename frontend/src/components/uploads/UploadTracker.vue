<template>
  <div v-if="tasks.length" class="upload-status-wrap">
    <button
      class="upload-status"
      :class="statusClass"
      type="button"
      :title="t('uploadTracker.title')"
      :aria-label="t('uploadTracker.title')"
      :aria-expanded="expanded"
      aria-haspopup="true"
      @click="expanded = !expanded"
    >
      <CloudUpload :size="13" :stroke-width="1.75" class="status-icon" />
      <span class="status-value">{{ activeCount ? `${aggregatePercent}%` : tasks.length }}</span>
    </button>

    <section v-if="expanded" class="tracker-panel" :aria-label="t('uploadTracker.title')">
      <header class="panel-head">
        <CloudUpload
          :size="14"
          :stroke-width="1.75"
          class="head-icon"
          :class="{ busy: activeCount > 0 }"
        />
        <h2 class="panel-title">{{ t('uploadTracker.title') }}</h2>
        <span v-if="activeCount" class="head-count">{{ activeCount }}</span>
        <button
          class="icon-button"
          type="button"
          :title="t('uploadTracker.collapse')"
          :aria-label="t('uploadTracker.collapse')"
          @click="expanded = false"
        >
          <ChevronDown :size="14" :stroke-width="1.75" />
        </button>
      </header>

      <div v-if="activeCount" class="aggregate">
        <div class="aggregate-meta">
          <span class="aggregate-label">{{ t('uploadTracker.inProgress') }}</span>
          <span class="aggregate-value">{{ aggregatePercent }}%</span>
        </div>
        <div class="aggregate-track">
          <div class="aggregate-fill" :style="{ width: `${aggregatePercent}%` }"></div>
        </div>
      </div>

      <ul class="upload-list">
        <li v-for="task in tasks" :key="task.id" class="upload-row" :class="`is-${task.status}`">
          <div class="row-top">
            <span class="row-icon" :class="`is-${task.status}`">
              <LoaderCircle
                v-if="task.status === 'uploading' || task.status === 'processing'"
                :size="13"
                :stroke-width="2"
                class="spinner"
              />
              <Check v-else-if="task.status === 'done'" :size="13" :stroke-width="2" />
              <CircleAlert v-else-if="task.status === 'failed'" :size="13" :stroke-width="2" />
              <Upload v-else :size="13" :stroke-width="2" />
            </span>
            <span class="row-name" :title="task.name">{{ task.name }}</span>
            <button
              v-if="task.finishedAt"
              class="icon-button row-dismiss"
              type="button"
              :title="t('uploadTracker.dismiss')"
              :aria-label="t('uploadTracker.dismiss')"
              @click="dismissTask(task.id)"
            >
              <X :size="13" :stroke-width="1.75" />
            </button>
          </div>

          <div
            class="row-meter"
            role="progressbar"
            :aria-label="task.name"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="progressPercent(task)"
          >
            <div class="row-meter-fill" :style="{ width: `${progressPercent(task)}%` }"></div>
          </div>

          <div class="row-bottom">
            <span class="row-status" :class="`is-${task.status}`">
              <template v-if="task.status === 'queued'">{{ t('uploadTracker.queued') }}</template>
              <template v-else-if="task.status === 'processing'">
                {{ t('settings.uploads.processing') }}
              </template>
              <template v-else-if="task.status === 'done'">{{ t('uploadTracker.done') }}</template>
              <template v-else-if="task.status === 'failed'">{{ t('uploadTracker.failed') }}</template>
              <template v-else>{{ formatMB(task.loaded) }} / {{ formatMB(task.total) }} MB</template>
            </span>
            <span v-if="task.status === 'uploading'" class="row-percent">
              {{ progressPercent(task) }}%
            </span>
          </div>
          <p v-if="task.error" class="row-error">{{ task.error }}</p>
        </li>
      </ul>

      <footer v-if="hasFinished" class="panel-foot">
        <button class="clear-button" type="button" @click="clearFinished">
          <Trash2 :size="12" :stroke-width="1.75" />
          {{ t('uploadTracker.clearFinished') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  ChevronDown,
  CircleAlert,
  CloudUpload,
  LoaderCircle,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { formatMB } from '../../composables/useUpload'
import { useUploadTracker, type UploadTask } from '../../composables/useUploadTracker'

const { t } = useI18n()
const { tasks, activeCount, hasFinished, dismissTask, clearFinished } = useUploadTracker()

// The bar shows the live number; the panel is opened on demand so it does not
// sit over the terminal while a transfer runs.
const expanded = ref(false)

const statusClass = computed(() => {
  if (tasks.value.some((t) => t.status === 'failed')) return 'is-failed'
  if (activeCount.value) return 'is-active'
  return 'is-done'
})

// One meter for the whole batch, one meter per file. The batch meter is the
// single place that shows overall transfer progress, so no other surface has
// to repeat it.
const aggregatePercent = computed(() => {
  const active = tasks.value.filter((t) => !t.finishedAt && t.total > 0)
  const total = active.reduce((sum, t) => sum + t.total, 0)
  if (!total) return 0
  const loaded = active.reduce((sum, t) => sum + Math.min(t.loaded, t.total), 0)
  return Math.min(100, Math.round((loaded / total) * 100))
})

function progressPercent(task: UploadTask): number {
  if (task.status === 'done') return 100
  if (task.status === 'queued') return 0
  if (task.total <= 0) return task.status === 'processing' ? 100 : 0
  return Math.max(0, Math.min(100, Math.round((task.loaded / task.total) * 100)))
}
</script>

<style scoped>
/* Lives inside the status bar as one more metric, pinned to the far right. */
.upload-status-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 24px;
  flex-shrink: 0;
  font-family: var(--font-ui);
  font-size: 12px;
}

.upload-status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 5px;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.upload-status:hover {
  background: var(--bg-hover);
  color: var(--fg-bright);
}

.upload-status.is-active {
  color: var(--accent);
}

.upload-status.is-failed {
  color: var(--danger);
}

.upload-status:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}

.status-value {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* Opens upward from the bar, using the same shell as the notification panel. */
.tracker-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  width: min(320px, calc(100vw - 24px));
  max-height: min(440px, calc(100vh - 90px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--dialog-shadow);
  z-index: 30;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--divider);
  flex-shrink: 0;
}

.panel-title {
  margin: 0;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.head-icon {
  color: var(--fg-muted);
}

.head-icon.busy {
  color: var(--accent);
}

.panel-head .head-count {
  margin-right: auto;
}

.head-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}

/* Overall transfer sits above the individual rows: same language, one step
   stronger, so the batch reads at a glance without a second floating bar. */
.aggregate {
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-hover);
  flex-shrink: 0;
}

.aggregate-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}

.aggregate-label {
  color: var(--fg-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.aggregate-value {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.aggregate-track {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-surface);
}

.aggregate-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.16s ease;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.icon-button:focus-visible,
.clear-button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}

.upload-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.upload-list::-webkit-scrollbar {
  width: 8px;
}

.upload-list::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--scrollbar-thumb);
  background-clip: padding-box;
}

.upload-list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
  background-clip: padding-box;
}

/* Flat rows, separated by hairlines — no cards stacked inside a card. */
.upload-row {
  padding: 9px 10px 10px;
}

.upload-row + .upload-row {
  border-top: 1px solid var(--divider);
}

.upload-row:hover {
  background: var(--bg-hover);
}

.row-top {
  display: flex;
  align-items: center;
  gap: 7px;
}

.row-icon {
  display: inline-flex;
  color: var(--fg-muted);
  flex-shrink: 0;
}

.row-icon.is-uploading,
.row-icon.is-processing {
  color: var(--accent);
}

.row-icon.is-done {
  color: var(--success);
}

.row-icon.is-failed {
  color: var(--danger);
}

.spinner {
  animation: spin 1s linear infinite;
}

.row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  line-height: 16px;
}

.upload-row.is-done .row-name {
  color: var(--fg-muted);
}

.row-dismiss {
  margin-left: auto;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.row-meter {
  height: 3px;
  margin: 7px 0 5px 20px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-hover);
}

.row-meter-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.16s ease;
}

.is-done .row-meter-fill {
  background: var(--success);
}

.is-failed .row-meter-fill {
  background: var(--danger);
}

.row-bottom {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-left: 20px;
}

.row-status {
  color: var(--fg-muted);
  font-size: 11px;
}

/* Status colour lives in the icon and the meter; small text stays readable
   in both the dark and light themes. */
.row-status.is-done,
.row-status.is-failed {
  color: var(--fg);
}

/* Measurement is one of the few honest uses of mono in a UI. */
.row-percent {
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.row-error {
  margin: 5px 0 0 20px;
  color: var(--danger);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.panel-foot {
  border-top: 1px solid var(--divider);
  padding: 6px 10px;
  flex-shrink: 0;
}

.clear-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.clear-button:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }

  .row-meter-fill,
  .aggregate-fill {
    transition: none;
  }
}
</style>

<template>
  <div class="notification-panel" :class="{ visible: panelVisible }">
    <div class="panel-header">
      <span class="panel-title">{{ t('notification.title') }}</span>
      <button class="panel-close" @click="panelVisible = false">&times;</button>
    </div>
    <div class="panel-list">
      <NotificationCard
        v-for="n in notifications"
        :key="n.id"
        :type="n.type"
        :title="n.title"
        :body="n.body"
        :timestamp="n.timestamp"
        :pane-label="paneLabels[n.paneId]"
        @dismiss="dismissOne(n.id)"
        @goto="$emit('goto-pane', n.paneId)"
      />
      <div v-if="notifications.length === 0" class="panel-empty">{{ t('notification.empty') }}</div>
    </div>
    <button v-if="notifications.length > 0" class="panel-clear" @click="clearAll">{{ t('notification.clearAll') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useNotification } from '../../composables/useNotification'
import { useI18n } from '../../composables/useI18n'
import NotificationCard from './NotificationCard.vue'

defineProps<{
  paneLabels: Record<string, string>
}>()

defineEmits<{ 'goto-pane': [paneId: string] }>()

const { notifications, panelVisible, dismissOne, clearAll } = useNotification()
const { t } = useI18n()
</script>

<style scoped>
.notification-panel {
  position: fixed;
  top: calc(40px + env(safe-area-inset-top, 0px));
  right: 8px;
  width: min(320px, calc(100vw - 16px));
  max-height: min(480px, calc(100vh - 60px));
  overflow: hidden;
  transform: translateY(-10px);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  background: var(--bg-surface, #1e1e2e);
  display: flex;
  flex-direction: column;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.notification-panel.visible {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--divider, #333);
  flex-shrink: 0;
}
.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-muted, #888);
}
.panel-close {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.panel-close:hover {
  color: var(--fg, #ccc);
}
.panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-empty {
  text-align: center;
  color: var(--fg-muted, #666);
  font-size: 12px;
  padding: 24px 0;
}
.panel-clear {
  margin: 8px 12px 12px;
  padding: 6px 0;
  background: none;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: var(--fg-muted, #888);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.panel-clear:hover {
  color: var(--fg, #ccc);
  border-color: var(--fg-muted, #666);
}
</style>

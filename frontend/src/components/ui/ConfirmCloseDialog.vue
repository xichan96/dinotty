<template>
  <ConfirmModal
    :visible="ui.confirmCloseVisible"
    :title="t('confirm.closeTabTitle')"
    :message="closeMessage"
    :confirm-text="t('confirm.closeTabConfirm')"
    :cancel-text="t('confirm.closeTabCancel')"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useI18n } from '../../composables/useI18n'
import { formatCloseTabMessage } from '../../composables/formatCloseTabMessage'
import { findFirstLeaf } from '../../types/pane'
import ConfirmModal from './ConfirmModal.vue'

const emit = defineEmits<{
  confirm: [tabId: string, paneId: string | null]
}>()

const ui = useUiStore()
const session = useSessionStore()
const { t, locale } = useI18n()

const tabTitle = computed(() => {
  const id = ui.pendingCloseTabId
  if (!id) return ''
  const tab = session.findTab(id)
  if (!tab) return ''
  if (tab.type === 'terminal') {
    const leaf = findFirstLeaf(tab.layout)
    return leaf?.title ?? 'Terminal'
  }
  return tab.title
})

const closeMessage = computed(() => {
  if (!tabTitle.value) return t('confirm.closeTabMessage')
  return formatCloseTabMessage(t('confirm.closeTabMessage'), tabTitle.value, locale.value)
})

function onConfirm() {
  if (!ui.pendingCloseTabId) return
  emit('confirm', ui.pendingCloseTabId, ui.pendingClosePaneId)
}

function onCancel() {
  ui.cancelClose()
}
</script>

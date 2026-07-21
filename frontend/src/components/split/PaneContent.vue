<template>
  <TerminalPane
    v-if="kind === 'terminal'"
    :ref="(el: any) => emit('register', leaf.paneId, el)"
    :pane-id="leaf.paneId"
    :ssh-host="leaf.shell_type === 'ssh' ? leaf.title : undefined"
    @title-change="(title: string) => emit('titleChange', leaf.paneId, title)"
    @shell-info="(shell: string) => emit('shellInfo', leaf.paneId, shell)"
    @input="(data: string) => emit('input', leaf.paneId, data)"
    @file-click="(path: string) => emit('fileClick', path)"
    @preview-link="(url: string) => emit('previewLink', leaf.paneId, url)"
    @link-activate="emit('linkActivate')"
    @reconnect="emit('reconnect', leaf.paneId)"
    @split-horizontal="emit('splitHorizontal')"
    @split-vertical="emit('splitVertical')"
    @toggle-broadcast="emit('toggleBroadcast')"
    @new-local-terminal="emit('newLocalTerminal')"
  />
  <PluginView
    v-else-if="kind === 'plugin' && plugin && api"
    :data-plugin-pane-id="leaf.paneId"
    :plugin="plugin"
    :api="api"
  />
  <FileWorkspacePreview
    v-else-if="kind === 'files'"
    :visible="true"
    :pane-id="leaf.paneId"
    embedded
    @close="emit('close', leaf.paneId)"
  />
  <WebPreview
    v-else-if="kind === 'web'"
    :visible="true"
    :url="leaf.url || ''"
    @close="emit('close', leaf.paneId)"
  />
  <div v-else class="pane-content-empty">
    <p>{{ t('split.unknownPaneKind', { kind: leaf.kind ?? '(none)' }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LeafPane } from '../../types/pane'
import { paneKind } from '../../types/pane'
import TerminalPane from '../terminal/TerminalPane.vue'
import PluginView from '../plugin/PluginView.vue'
import FileWorkspacePreview from '../preview/FileWorkspacePreview.vue'
import WebPreview from '../preview/WebPreview.vue'
import { usePluginLoader } from '../../composables/usePluginLoader'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  leaf: LeafPane
}>()

const emit = defineEmits<{
  register: [paneId: string, el: any]
  titleChange: [paneId: string, title: string]
  shellInfo: [paneId: string, shell: string]
  input: [paneId: string, data: string]
  fileClick: [path: string]
  previewLink: [paneId: string, url: string]
  linkActivate: []
  close: [paneId: string]
  reconnect: [paneId: string]
  splitHorizontal: []
  splitVertical: []
  toggleBroadcast: []
  newLocalTerminal: []
}>()

const { t } = useI18n()
const { loadedPlugins, getPluginContext } = usePluginLoader()

const kind = computed(() => paneKind(props.leaf))
const plugin = computed(() =>
  kind.value === 'plugin' && props.leaf.pluginId
    ? loadedPlugins.get(props.leaf.pluginId)
    : undefined
)
const api = computed(() =>
  props.leaf.pluginId ? getPluginContext(props.leaf.pluginId) : undefined
)
</script>

<style scoped>
.pane-content-empty {
  padding: 1rem;
  color: var(--text-muted, #858585);
}
</style>

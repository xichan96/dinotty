<template>
  <div v-if="visible" class="preview-panel" :class="[direction, { reversed }]">
    <div
      class="preview-panel-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    ></div>
    <div class="preview-panel-inner">
      <div class="preview-toolbar">
        <div class="preview-mode-switch">
          <button type="button" :class="{ active: kind === 'web' }" @click="switchToWeb" :title="t('previewPanel.switchWeb')"><Globe :size="14" /></button>
          <button type="button" :class="{ active: kind === 'files' }" @click="switchToFiles" :title="t('previewPanel.switchFiles')"><FolderOpen :size="14" /></button>
        </div>
        <div class="preview-toolbar-sep"></div>
        <button type="button" :disabled="!canGoBack" @click="goBack" title="Back"><ChevronLeft :size="14" /></button>
        <button type="button" :disabled="!canGoForward" @click="goForward" title="Forward"><ChevronRight :size="14" /></button>
        <button type="button" @click="refresh" title="Refresh"><RotateCw :size="14" /></button>
        <div class="preview-address-wrap">
          <form class="preview-address" @submit.prevent="go">
            <input
              ref="addressInputRef"
              v-model="localAddress"
              type="text"
              enterkeyhint="go"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              :placeholder="t('previewPanel.placeholder')"
              @focus="onAddressFocus"
              @blur="onAddressBlur"
            />
            <button type="submit" class="go-btn" title="Go"><ArrowRight :size="14" /></button>
          </form>
          <AddressDropdown
            :visible="addressDropdownVisible && kind === 'web'"
            @select="onDropdownSelect"
            @close="addressDropdownVisible = false"
          />
        </div>
        <button v-if="kind === 'web' && webUrl" type="button" @click="openInBrowser" :title="t('previewPanel.openInBrowser')"><ExternalLink :size="14" /></button>
        <button v-if="kind === 'web' && webUrl" type="button" :class="{ 'star-active': isWebBookmarked }" @click="onToggleWebBookmark" :title="isWebBookmarked ? t('webBookmark.removeFrom') : t('webBookmark.addTo')"><Star :size="14" :fill="isWebBookmarked ? 'currentColor' : 'none'" /></button>
        <button type="button" @click="close" title="Close"><X :size="14" /></button>
      </div>
      <div class="preview-body">
        <div v-show="kind === 'web'" class="preview-web">
          <iframe
            :src="resolvedIframeSrc"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
          ></iframe>
        </div>
        <FileWorkspacePreview
          v-show="kind === 'files'"
          ref="filesRef"
          v-model:tree-collapsed="treeCollapsed"
          embedded
          :visible="visible && kind === 'files'"
          :pane-id="paneId"
          @navigate="onFilesNavigate"
          @update:can-go-back="filesCanGoBack = $event"
          @update:can-go-forward="filesCanGoForward = $event"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import FileWorkspacePreview from './FileWorkspacePreview.vue'
import { isWebPreviewInput, normalizeWebUrl, urlToPreviewSrc } from '../../utils/previewRouting'
import { getApiBase, getAuthToken } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { ChevronLeft, ChevronRight, RotateCw, ArrowRight, ExternalLink, X, Globe, FolderOpen, Star } from 'lucide-vue-next'
import { usePaneResize } from '../../composables/usePaneResize'
import { useWebBookmarks } from '../../composables/useWebBookmarks'
import { useRecentUrls } from '../../composables/useRecentAccess'
import { settings } from '../../composables/useSettings'
import AddressDropdown from './AddressDropdown.vue'

const props = defineProps<{
  visible: boolean
  paneId: string
  address: string
  kind: 'web' | 'files'
  webUrl: string
  panelPosition: 'left' | 'right' | 'top' | 'bottom'
}>()

const emit = defineEmits<{
  close: []
  'update:address': [v: string]
  'update:kind': [v: 'web' | 'files']
  'update:webUrl': [v: string]
}>()

const { t } = useI18n()

const filesRef = ref<InstanceType<typeof FileWorkspacePreview>>()
const previewHttpBase = ref('')
const treeCollapsed = ref(false)
const addressInputRef = ref<HTMLInputElement>()
const localAddress = ref('')
const navCounter = ref(0)
const webBookmarks = useWebBookmarks()
const recentUrlsComposable = useRecentUrls()
const addressDropdownVisible = ref(false)

const isWebBookmarked = computed(() => {
  if (props.kind !== 'web' || !props.webUrl) return false
  return webBookmarks.isBookmarked(props.webUrl)
})

function onToggleWebBookmark() {
  if (!props.webUrl) return
  webBookmarks.toggleBookmark(props.webUrl, props.webUrl)
}

function onAddressFocus() {
  if (webBookmarks.bookmarks.value.length > 0 || settings.recent_urls.length > 0) {
    addressDropdownVisible.value = true
  }
}

function onAddressBlur() {
  setTimeout(() => { addressDropdownVisible.value = false }, 200)
}

function onDropdownSelect(url: string) {
  localAddress.value = url
  go()
  addressDropdownVisible.value = false
}

const navHistory = ref<string[]>([])
const navIndex = ref(-1)
const filesCanGoBack = ref(false)
const filesCanGoForward = ref(false)
const canGoBack = computed(() => {
  if (props.kind === 'files') return filesCanGoBack.value
  return navIndex.value > 0
})
const canGoForward = computed(() => {
  if (props.kind === 'files') return filesCanGoForward.value
  return navIndex.value < navHistory.value.length - 1
})
const navFromHistory = ref(false)

function pushHistory(url: string) {
  if (navFromHistory.value) { navFromHistory.value = false; return }
  if (navHistory.value[navIndex.value] === url) return
  navHistory.value = navHistory.value.slice(0, navIndex.value + 1)
  navHistory.value.push(url)
  navIndex.value = navHistory.value.length - 1
}

function goBack() {
  if (props.kind === 'files') { filesRef.value?.goBack(); return }
  if (!canGoBack.value) return
  navFromHistory.value = true
  navIndex.value--
  const url = navHistory.value[navIndex.value]
  localAddress.value = url
  emit('update:address', url)
  emit('update:webUrl', url)
  navCounter.value++
}

function goForward() {
  if (props.kind === 'files') { filesRef.value?.goForward(); return }
  if (!canGoForward.value) return
  navFromHistory.value = true
  navIndex.value++
  const url = navHistory.value[navIndex.value]
  localAddress.value = url
  emit('update:address', url)
  emit('update:webUrl', url)
  navCounter.value++
}

const direction = computed(() =>
  props.panelPosition === 'left' || props.panelPosition === 'right'
    ? 'horizontal' : 'vertical'
)

const resolvedIframeSrc = computed(() => {
  if (!props.webUrl) return 'about:blank'
  const base = urlToPreviewSrc(props.webUrl, previewHttpBase.value || undefined)
  const sep = base.includes('?') ? '&' : '?'
  let src = `${base}${sep}_t=${navCounter.value}`
  if (base.startsWith('/api/proxy')) {
    const token = getAuthToken()
    if (token) src += `&token=${encodeURIComponent(token)}`
  }
  return src
})

function openInBrowser() {
  if (props.webUrl) window.open(props.webUrl, '_blank')
}

watch(
  () => [props.address, props.visible],
  () => {
    if (props.visible) localAddress.value = props.address
  },
  { immediate: true },
)

watch(
  () => [props.visible, props.kind, props.webUrl],
  () => {
    if (props.visible && props.kind === 'web' && props.webUrl) {
      navCounter.value++
      recentUrlsComposable.recordUrl(props.webUrl)
    }
  },
  { immediate: true },
)

watch(
  () => props.visible && props.kind === 'files',
  async (on, wasOn) => {
    if (on && !wasOn) {
      treeCollapsed.value = false
      await restoreFilesPreview()
    }
  },
)

async function restoreFilesPreview() {
  if (!props.address) return
  await nextTick()
  await nextTick()
  filesRef.value?.openFromTerminal(props.address)
}

function switchToWeb() {
  if (props.kind === 'web') return
  emit('update:kind', 'web')
  localAddress.value = props.webUrl || ''
  if (!props.webUrl) {
    nextTick(() => addressInputRef.value?.focus())
  }
}

function switchToFiles() {
  if (props.kind === 'files') return
  treeCollapsed.value = false
  emit('update:kind', 'files')
  localAddress.value = props.address || ''
  void (async () => {
    await nextTick()
    await nextTick()
    if (props.address) filesRef.value?.openFromTerminal(props.address)
  })()
}

function go() {
  const raw = localAddress.value.trim()
  if (!raw) return
  if (isWebPreviewInput(raw)) {
    const url = normalizeWebUrl(raw)
    emit('update:kind', 'web')
    emit('update:webUrl', url)
    emit('update:address', url)
    localAddress.value = url
    pushHistory(url)
    navCounter.value++
  } else {
    treeCollapsed.value = false
    emit('update:kind', 'files')
    emit('update:address', raw)
    void (async () => {
      await nextTick()
      await nextTick()
      filesRef.value?.openFromTerminal(raw)
    })()
  }
  addressInputRef.value?.blur()
}

function refresh() {
  if (props.kind === 'web') navCounter.value++
  else filesRef.value?.reloadAll()
}

function close() {
  emit('close')
}

function onFilesNavigate(path: string) {
  localAddress.value = path
  emit('update:address', path)
}

async function openFromPath(path: string) {
  treeCollapsed.value = false
  emit('update:kind', 'files')
  emit('update:address', path)
  localAddress.value = path
  await nextTick()
  await nextTick()
  filesRef.value?.openFromTerminal(path)
}

function openFromWebUrl(url: string) {
  emit('update:kind', 'web')
  emit('update:webUrl', url)
  emit('update:address', url)
  localAddress.value = url
  pushHistory(url)
  navCounter.value++
}

defineExpose({ openFromPath, openFromWebUrl })

const reversed = computed(() => props.panelPosition === 'left' || props.panelPosition === 'top')

const { startDrag } = usePaneResize('.preview-panel', direction, reversed)

function onProxyMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin) return
  if (e.data?.type === 'proxy-navigate' && e.data.url && props.kind === 'web') {
    localAddress.value = e.data.url
    emit('update:address', e.data.url)
    pushHistory(e.data.url)
  }
}

onMounted(async () => {
  window.addEventListener('message', onProxyMessage)
  previewHttpBase.value = await getApiBase()
  if (props.visible && props.kind === 'files' && props.address) {
    treeCollapsed.value = false
    // Wait for FileWorkspacePreview to mount and PTY session to be ready
    for (let i = 0; i < 5; i++) {
      await nextTick()
      await new Promise((r) => setTimeout(r, 300))
      if (filesRef.value) {
        filesRef.value.openFromTerminal(props.address)
        break
      }
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onProxyMessage)
})
</script>

<style scoped>
.preview-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-panel.horizontal {
  flex-direction: row;
  height: 100%;
}

.preview-panel.vertical {
  flex-direction: column;
  width: 100%;
}

.preview-panel-divider {
  flex-shrink: 0;
  background: var(--border, #333);
  transition: background 0.15s;
  z-index: 2;
}

.preview-panel.horizontal .preview-panel-divider {
  width: 6px;
  cursor: col-resize;
}

.preview-panel.vertical .preview-panel-divider {
  height: 6px;
  cursor: row-resize;
}

.preview-panel-divider:hover {
  background: var(--accent, #89b4fa);
}

.preview-panel.reversed .preview-panel-divider {
  order: 2;
}

.preview-panel.reversed .preview-panel-inner {
  order: 1;
}

.preview-panel-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-mode-switch {
  display: flex;
  align-items: center;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.preview-mode-switch button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  padding: 2px 7px;
  cursor: pointer;
  border-radius: 0;
  line-height: 1;
}

.preview-mode-switch button:hover:not(.active) {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
}

.preview-mode-switch button.active {
  color: var(--accent, #89b4fa);
  background: var(--tab-hover-bg, #333);
}

.preview-toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border, #333);
  flex-shrink: 0;
  margin: 0 2px;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--tab-bg, #252525);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.preview-toolbar button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}

.preview-toolbar button:hover:not(:disabled) {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
}

.preview-toolbar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.preview-address {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 3px;
}

.preview-address:focus-within {
  border-color: var(--accent, #89b4fa);
}

.preview-address input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--fg, #ccc);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
  outline: none;
}

.go-btn {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  cursor: pointer;
}

.go-btn:hover {
  color: var(--fg, #ccc);
}

.preview-body {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.preview-web {
  position: absolute;
  inset: 0;
  background: #fff;
}

.preview-web iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.preview-body > :deep(.file-workspace-embedded) {
  position: absolute;
  inset: 0;
}

.star-active {
  color: var(--accent, #89b4fa) !important;
}

.preview-address-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
}
.preview-address-wrap .preview-address {
  flex: 1;
}
</style>

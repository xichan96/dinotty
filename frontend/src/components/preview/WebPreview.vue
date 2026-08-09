<template>
  <div v-if="visible" class="web-preview" :class="{ 'in-leaf': inLeaf }">
    <div
      v-if="!inLeaf"
      class="web-preview-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDragTouch"
    ></div>
    <div class="web-preview-panel">
      <div class="web-preview-toolbar">
        <button type="button" :disabled="!canGoBack" @click="goBack" title="Back">
          <ChevronLeft :size="14" />
        </button>
        <button type="button" :disabled="!canGoForward" @click="goForward" title="Forward">
          <ChevronRight :size="14" />
        </button>
        <button type="button" @click="refresh" title="Refresh"><RotateCw :size="14" /></button>
        <div class="preview-address-wrap">
          <form class="web-preview-address" @submit.prevent="navigateFromInput">
            <input
              ref="addressInput"
              v-model="addressValue"
              type="text"
              enterkeyhint="go"
              inputmode="url"
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
            :visible="addressDropdownVisible"
            @select="onDropdownSelect"
            @close="addressDropdownVisible = false"
          />
        </div>
        <button
          v-if="currentUrl"
          type="button"
          @click="openInBrowser"
          :title="t('previewPanel.openInBrowser')"
        >
          <ExternalLink :size="14" />
        </button>
        <button
          v-if="currentUrl"
          type="button"
          :class="{ 'star-active': isBookmarked }"
          @click="onToggleBookmark"
          :title="isBookmarked ? t('webBookmark.removeFrom') : t('webBookmark.addTo')"
        >
          <Star :size="14" :fill="isBookmarked ? 'currentColor' : 'none'" />
        </button>
        <button
          type="button"
          :class="{ 'devtools-active': devtoolsVisible }"
          @click="devtoolsVisible = !devtoolsVisible"
          :title="t('devtools.toggleDevtools')"
        >
          <Bug :size="14" />
        </button>
        <button v-if="!inLeaf" type="button" @click="close" title="Close">
          <X :size="14" />
        </button>
      </div>
      <div class="web-preview-content">
        <iframe
          ref="iframeRef"
          :src="resolvedSrc"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
        ></iframe>
      </div>
      <DevToolsPanel
        v-model:visible="devtoolsVisible"
        :console-entries="consoleEntries"
        :network-entries="networkEntries"
        :error-count="errorCount"
        @clear-console="clearConsole"
        @clear-network="clearNetwork"
        @eval="evalInIframe"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import DevToolsPanel from './DevToolsPanel.vue'
import AddressDropdown from './AddressDropdown.vue'
import { urlToPreviewSrc } from '../../utils/previewRouting'
import { getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { useWebBookmarks } from '../../composables/useWebBookmarks'
import { useDevTools } from '../../composables/useDevTools'
import { useRecentUrls } from '../../composables/useRecentAccess'
import { settings } from '../../composables/useSettings'
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  ArrowRight,
  ExternalLink,
  X,
  Star,
  Bug,
} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    url: string
    inLeaf?: boolean
  }>(),
  { inLeaf: true }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const iframeRef = ref<HTMLIFrameElement>()
const addressInput = ref<HTMLInputElement>()
const addressValue = ref('')
const currentUrl = ref('')
const navCounter = ref(0)
const previewHttpBase = ref('')
const addressDropdownVisible = ref(false)
const devtoolsVisible = ref(false)
const isLandscape = ref(window.innerWidth > window.innerHeight)

const webBookmarks = useWebBookmarks()
const recentUrlsComposable = useRecentUrls()
const {
  consoleEntries,
  networkEntries,
  errorCount,
  clearConsole,
  clearNetwork,
  allowOrigin,
  isAllowedOrigin,
} = useDevTools()

const navHistory = ref<string[]>([])
const navIndex = ref(-1)
const navFromHistory = ref(false)

const canGoBack = computed(() => navIndex.value > 0)
const canGoForward = computed(() => navIndex.value < navHistory.value.length - 1)

const isBookmarked = computed(() => {
  if (!currentUrl.value) return false
  return webBookmarks.isBookmarked(currentUrl.value)
})

function pushHistory(url: string) {
  if (navFromHistory.value) {
    navFromHistory.value = false
    return
  }
  if (navHistory.value[navIndex.value] === url) return
  navHistory.value = navHistory.value.slice(0, navIndex.value + 1)
  navHistory.value.push(url)
  navIndex.value = navHistory.value.length - 1
}

function goBack() {
  if (!canGoBack.value) return
  navFromHistory.value = true
  navIndex.value--
  const url = navHistory.value[navIndex.value]
  currentUrl.value = url
  addressValue.value = url
  navCounter.value++
}

function goForward() {
  if (!canGoForward.value) return
  navFromHistory.value = true
  navIndex.value++
  const url = navHistory.value[navIndex.value]
  currentUrl.value = url
  addressValue.value = url
  navCounter.value++
}

const resolvedSrc = computed(() => {
  if (!currentUrl.value) return 'about:blank'
  const base = urlToPreviewSrc(currentUrl.value, previewHttpBase.value || undefined)
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}_t=${navCounter.value}`
})

const direction = computed(() => (isLandscape.value ? 'horizontal' : 'vertical'))

function onResize() {
  isLandscape.value = window.innerWidth > window.innerHeight
}

watch(
  () => [props.url, props.visible],
  () => {
    if (props.visible && props.url) {
      currentUrl.value = props.url
      addressValue.value = props.url
      pushHistory(props.url)
      navCounter.value++
      recentUrlsComposable.recordUrl(props.url)
    }
  },
  { immediate: true }
)

function navigateFromInput() {
  const val = addressValue.value.trim()
  if (!val) return

  let next: string
  if (val.startsWith('http://') || val.startsWith('https://')) {
    next = val
  } else if (val.match(/^:?(\d+)(\/.*)?$/)) {
    const m = val.match(/^:?(\d+)(\/.*)?$/)!
    next = `http://localhost:${m[1]}${m[2] || '/'}`
  } else if (val.startsWith('/')) {
    try {
      const prev = new URL(currentUrl.value)
      prev.pathname = val
      next = prev.toString()
    } catch {
      return
    }
  } else {
    next = `http://${val}`
  }

  currentUrl.value = next
  addressValue.value = next
  pushHistory(next)
  navCounter.value++
  recentUrlsComposable.recordUrl(next)
  addressInput.value?.blur()
}

function refresh() {
  navCounter.value++
}

function close() {
  emit('close')
}

function openInBrowser() {
  if (currentUrl.value) window.open(currentUrl.value, '_blank')
}

function onToggleBookmark() {
  if (!currentUrl.value) return
  webBookmarks.toggleBookmark(currentUrl.value, currentUrl.value)
}

function onAddressFocus() {
  if (webBookmarks.bookmarks.value.length > 0 || settings.recent_urls.length > 0) {
    addressDropdownVisible.value = true
  }
}

function onAddressBlur() {
  setTimeout(() => {
    addressDropdownVisible.value = false
  }, 200)
}

function onDropdownSelect(url: string) {
  addressValue.value = url
  navigateFromInput()
  addressDropdownVisible.value = false
}

function evalInIframe(code: string) {
  const iframe = iframeRef.value
  if (!iframe?.contentWindow) return
  try {
    const result = (iframe.contentWindow as any).eval(code)
    const display =
      result === undefined
        ? 'undefined'
        : typeof result === 'object'
          ? JSON.stringify(result, null, 2)
          : String(result)
    consoleEntries.value.push({
      id: Date.now(),
      level: 'log',
      args: ['> ' + code, display],
      ts: Date.now(),
    })
  } catch (err: any) {
    consoleEntries.value.push({
      id: Date.now(),
      level: 'error',
      args: ['> ' + code, err.message],
      ts: Date.now(),
    })
  }
}

function openFromWebUrl(url: string) {
  currentUrl.value = url
  addressValue.value = url
  pushHistory(url)
  navCounter.value++
  recentUrlsComposable.recordUrl(url)
}

defineExpose({ openFromWebUrl })

function stripCacheBuster(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.delete('_t')
    return u.toString()
  } catch {
    return url
  }
}

function onProxyMessage(e: MessageEvent) {
  if (!isAllowedOrigin(e.origin)) return
  if (e.data?.type === 'proxy-navigate' && e.data.url) {
    const url = stripCacheBuster(e.data.url)
    currentUrl.value = url
    addressValue.value = url
    pushHistory(url)
  }
}

function startDrag(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest('.web-preview') as HTMLElement
  const parent = el?.parentElement
  if (!parent) return

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
  document.body.appendChild(overlay)

  const onMove = (ev: MouseEvent) => {
    const rect = parent.getBoundingClientRect()
    const horiz = direction.value === 'horizontal'
    const total = horiz ? rect.width : rect.height
    const mousePos = horiz ? ev.clientX - rect.left : ev.clientY - rect.top
    const termPct = Math.max(15, Math.min(85, (mousePos / total) * 100))
    const termChild = parent.querySelector(':scope > .terminal-pane-container') as HTMLElement
    const previewChild = parent.querySelector(':scope > .web-preview') as HTMLElement
    if (termChild) termChild.style.flex = `0 0 ${termPct}%`
    if (previewChild) previewChild.style.flex = `0 0 ${100 - termPct}%`
  }
  const onUp = () => {
    overlay.remove()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.dispatchEvent(new Event('resize'))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startDragTouch(e: TouchEvent) {
  const el = (e.target as HTMLElement).closest('.web-preview') as HTMLElement
  const parent = el?.parentElement
  if (!parent) return

  const onMove = (ev: TouchEvent) => {
    const rect = parent.getBoundingClientRect()
    const touch = ev.touches[0]
    const horiz = direction.value === 'horizontal'
    const total = horiz ? rect.width : rect.height
    const touchPos = horiz ? touch.clientX - rect.left : touch.clientY - rect.top
    const termPct = Math.max(15, Math.min(85, (touchPos / total) * 100))
    const termChild = parent.querySelector(':scope > .terminal-pane-container') as HTMLElement
    const previewChild = parent.querySelector(':scope > .web-preview') as HTMLElement
    if (termChild) termChild.style.flex = `0 0 ${termPct}%`
    if (previewChild) previewChild.style.flex = `0 0 ${100 - termPct}%`
  }
  const onEnd = () => {
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
    window.dispatchEvent(new Event('resize'))
  }
  window.addEventListener('touchmove', onMove)
  window.addEventListener('touchend', onEnd)
}

onMounted(async () => {
  window.addEventListener('message', onProxyMessage)
  window.addEventListener('resize', onResize)
  previewHttpBase.value = await getApiBase()
  allowOrigin(previewHttpBase.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onProxyMessage)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.web-preview {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.web-preview:not(.in-leaf).horizontal {
  flex-direction: row;
  height: 100%;
}

.web-preview:not(.in-leaf).vertical {
  flex-direction: column;
  width: 100%;
}

.web-preview-divider {
  flex-shrink: 0;
  background: var(--border);
  transition: background 0.15s;
  z-index: 2;
}

.web-preview:not(.in-leaf).horizontal .web-preview-divider {
  width: 6px;
  cursor: col-resize;
}

.web-preview:not(.in-leaf).vertical .web-preview-divider {
  height: 6px;
  cursor: row-resize;
}

.web-preview-divider:hover {
  background: var(--accent, #89b4fa);
}

.web-preview-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.web-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--tab-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.web-preview-toolbar button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.web-preview-toolbar button:hover:not(:disabled) {
  color: var(--fg);
  background: var(--tab-hover-bg, #333);
}

.web-preview-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.web-preview-toolbar button.star-active {
  color: var(--accent, #e5c07b);
}

.web-preview-toolbar button.devtools-active {
  color: var(--accent, #89b4fa);
}

.preview-address-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
}

.web-preview-address {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.web-preview-address:focus-within {
  border-color: var(--accent, #89b4fa);
}

.web-preview-address input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
  outline: none;
}

.go-btn {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  padding: 2px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.go-btn:hover {
  color: var(--fg);
}

.web-preview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #fff;
  min-height: 0;
}

.web-preview-content iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
</style>

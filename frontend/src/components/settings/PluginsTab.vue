<template>
  <div>
    <div class="plugin-tabs">
      <button class="plugin-tab" :class="{ active: tab === 'market' }" @click="selectTab('market')">
        {{ t('settings.plugins.market') }}
      </button>
      <button
        class="plugin-tab"
        :class="{ active: tab === 'installed' }"
        @click="selectTab('installed')"
      >
        {{ t('settings.plugins.installed') }} ({{ settingsPlugins.length }})
      </button>
    </div>

    <div v-if="statusMsg" :class="statusOk ? 'plugin-success-msg' : 'plugin-error-msg'">
      {{ statusMsg }}
    </div>

    <!-- Market Tab -->
    <div v-show="tab === 'market' && !detailPlugin">
      <div v-if="marketLoading" class="plugin-empty">
        {{ t('settings.plugins.loading') }}
      </div>
      <div v-else-if="marketError" class="plugin-error-msg">
        {{ t('settings.plugins.fetchError') }}: {{ marketError }}
        <button class="plugin-retry-btn" @click="fetchMarket()">
          {{ t('settings.plugins.retry') }}
        </button>
      </div>
      <template v-else>
        <div class="plugin-filter-bar">
          <input
            v-model="marketQuery"
            type="text"
            class="plugin-search-input"
            :placeholder="t('plugin.searchPlaceholder')"
          />
          <div class="plugin-category-chips">
            <button
              v-for="cat in categoryOptions"
              :key="cat.value || 'all'"
              class="plugin-category-chip"
              :class="{ active: marketCategory === cat.value }"
              @click="marketCategory = cat.value"
            >
              {{ cat.label }}
            </button>
          </div>
          <label class="plugin-toggle-inline">
            <input v-model="showIncompatibleModel" type="checkbox" />
            <span>{{ t('plugin.showIncompatible') }}</span>
          </label>
        </div>
        <div v-if="filteredMarketPlugins.length === 0" class="plugin-empty">
          {{ t('settings.plugins.noPlugins') }}
        </div>
        <div
          v-for="mp in filteredMarketPlugins"
          :key="mp.id"
          class="plugin-card plugin-card-clickable"
          :class="{ 'plugin-card-incompatible': !mp.compatible }"
          @click="openDetail(mp)"
        >
          <div class="plugin-card-header">
            <span class="plugin-card-name">{{ mp.name }}</span>
            <span v-if="mp.category" class="plugin-badge category">{{
              t('plugin.category.' + mp.category)
            }}</span>
            <span class="plugin-card-version">v{{ mp.version }}</span>
            <span v-if="mp.installed_version && !mp.has_update" class="plugin-badge installed">
              {{ t('settings.plugins.installedBadge') }}
            </span>
            <span v-if="mp.has_update" class="plugin-badge update">
              {{ t('settings.plugins.hasUpdate') }}
            </span>
            <span v-if="!mp.compatible" class="plugin-badge incompatible">
              {{ t('plugin.incompatible') }}
            </span>
          </div>
          <p class="plugin-card-desc">
            {{ locale === 'zh' && mp.description_zh ? mp.description_zh : mp.description }}
          </p>
          <div class="plugin-card-actions">
            <button
              v-if="!mp.installed_version && mp.compatible"
              class="plugin-install-btn"
              :disabled="isBusy(mp.id)"
              @click.stop="onMarketInstall(mp)"
            >
              <span v-if="isBusy(mp.id)" class="plugin-spinner"></span>
              {{ t('settings.plugins.installFromMarket') }}
            </button>
            <button
              v-else-if="mp.has_update && mp.compatible"
              class="plugin-install-btn"
              :disabled="isBusy(mp.id)"
              @click.stop="onMarketInstall(mp)"
            >
              <span v-if="isBusy(mp.id)" class="plugin-spinner"></span>
              {{ t('settings.plugins.updateFromMarket') }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Market Detail View -->
    <div v-if="tab === 'market' && detailPlugin" class="plugin-detail">
      <div class="plugin-detail-header">
        <button class="plugin-back-btn" @click="detailPlugin = null">
          <span class="plugin-back-arrow">&larr;</span> {{ t('settings.plugins.back') }}
        </button>
      </div>

      <div class="plugin-detail-info">
        <div class="plugin-detail-title-row">
          <span class="plugin-detail-name">{{ detailPlugin.name }}</span>
          <span class="plugin-card-version">v{{ detailPlugin.version }}</span>
          <span
            v-if="detailPlugin.installed_version && !detailPlugin.has_update"
            class="plugin-badge installed"
          >
            {{ t('settings.plugins.installedBadge') }}
          </span>
          <span v-if="detailPlugin.has_update" class="plugin-badge update">
            {{ t('settings.plugins.hasUpdate') }}
          </span>
        </div>
        <p v-if="detailPlugin.author" class="plugin-detail-author">
          {{ t('settings.plugins.author') }}: {{ detailPlugin.author }}
        </p>
        <p class="plugin-detail-desc">
          {{
            locale === 'zh' && detailPlugin.description_zh
              ? detailPlugin.description_zh
              : detailPlugin.description
          }}
        </p>
        <div class="plugin-detail-actions">
          <button
            v-if="!detailPlugin.installed_version"
            class="plugin-install-btn"
            :disabled="isBusy(detailPlugin.id)"
            @click="onMarketInstall(detailPlugin)"
          >
            <span v-if="isBusy(detailPlugin.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.installFromMarket') }}
          </button>
          <button
            v-else-if="detailPlugin.has_update"
            class="plugin-install-btn"
            :disabled="isBusy(detailPlugin.id)"
            @click="onMarketInstall(detailPlugin)"
          >
            <span v-if="isBusy(detailPlugin.id)" class="plugin-spinner"></span>
            {{ t('settings.plugins.updateFromMarket') }}
          </button>
          <button
            v-if="detailPlugin.installed_version"
            class="plugin-action-btn plugin-danger"
            :disabled="isBusy(detailPlugin.id)"
            @click="onUninstall(detailPlugin.id)"
          >
            {{ t('settings.plugins.uninstall') }}
          </button>
          <a
            v-if="detailPlugin.homepage"
            :href="detailPlugin.homepage"
            target="_blank"
            class="plugin-link"
          >
            {{ t('settings.plugins.viewOnGithub') }}
          </a>
        </div>
      </div>

      <div class="plugin-detail-readme">
        <div v-if="readmeLoadingState" class="plugin-readme-loading">
          <span class="plugin-spinner"></span> {{ t('settings.plugins.loading') }}
        </div>
        <div
          v-else-if="readmeHtmlContent"
          class="plugin-readme-body"
          v-html="readmeHtmlContent"
        ></div>
        <div v-else class="plugin-readme-empty">{{ t('settings.plugins.noReadme') }}</div>
      </div>
    </div>

    <!-- Installed Tab -->
    <div v-show="tab === 'installed'">
      <div class="plugin-toolbar">
        <button
          class="plugin-action-btn"
          :disabled="isBusy('dir-install')"
          @click="showDirInstall = !showDirInstall"
        >
          <span v-if="isBusy('dir-install')" class="plugin-spinner"></span>
          {{ t('settings.plugins.installFolder') }}
        </button>
        <button class="plugin-action-btn" :disabled="isBusy('refresh')" @click="onRefresh">
          <span v-if="isBusy('refresh')" class="plugin-spinner"></span>
          {{ t('settings.plugins.refresh') }}
        </button>
      </div>
      <div v-if="showDirInstall" class="plugin-dir-install">
        <button class="plugin-browse-btn" @click="browseInstallDirectory">
          {{ installDirPath || t('settings.plugins.browseFolder') }}
        </button>
        <label class="plugin-dev-toggle" :title="t('settings.plugins.devLinkHint')">
          <input v-model="devLinkMode" type="checkbox" />
          <span>{{ t('settings.plugins.devLinkCheckbox') }}</span>
        </label>
        <button
          class="plugin-action-btn"
          :disabled="!installDirPath.trim() || isBusy('dir-install')"
          @click="onInstallFromDir"
        >
          <span v-if="isBusy('dir-install')" class="plugin-spinner"></span>
          {{ t('settings.plugins.install') }}
        </button>
      </div>

      <div v-if="settingsPlugins.length === 0" class="plugin-empty">
        {{ t('settings.plugins.none') }}
      </div>
      <template v-else>
        <div class="plugin-filter-bar">
          <input
            v-model="installedQuery"
            type="text"
            class="plugin-search-input"
            :placeholder="t('plugin.searchPlaceholder')"
          />
          <div class="plugin-category-chips">
            <button
              v-for="cat in categoryOptions"
              :key="cat.value || 'all'"
              class="plugin-category-chip"
              :class="{ active: installedCategory === cat.value }"
              @click="installedCategory = cat.value"
            >
              {{ cat.label }}
            </button>
          </div>
        </div>
        <div v-if="filteredSettingsPlugins.length === 0" class="plugin-empty">
          {{ t('settings.plugins.none') }}
        </div>
        <div v-for="p in filteredSettingsPlugins" :key="p.id" class="plugin-card">
          <div class="plugin-card-header">
            <span class="plugin-card-name">{{ p.name }}</span>
            <span v-if="p.category" class="plugin-badge category">{{
              t('plugin.category.' + p.category)
            }}</span>
            <span v-if="p.isDevLink" class="plugin-badge dev">{{
              t('settings.plugins.devBadge')
            }}</span>
            <span v-if="p.state === 'error'" class="plugin-badge error">error</span>
            <span class="plugin-card-version">v{{ p.version }}</span>
          </div>
          <p v-if="p.description" class="plugin-card-desc">{{ p.description }}</p>
          <p v-if="p.error" class="plugin-card-error">{{ p.error }}</p>
          <div v-if="p.permissions.length" class="plugin-permissions">
            <span class="plugin-permissions-label">{{ t('settings.plugins.permissions') }}</span>
            <code v-for="permission in p.permissions" :key="permission">{{ permission }}</code>
          </div>
          <div v-if="p.overlays.length" class="plugin-permissions">
            <span class="plugin-permissions-label">{{ t('settings.plugins.overlays') }}</span>
            <label v-for="oid in p.overlays" :key="oid" class="plugin-toggle-inline" :title="oid">
              <input
                type="checkbox"
                :checked="!hiddenOverlayIncludes(oid)"
                @change="onToggleOverlay(oid, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ overlayName(oid) }}</span>
            </label>
          </div>
          <div class="plugin-card-actions">
            <label class="plugin-toggle-inline" :title="t('plugin.showInToolbar')">
              <input
                type="checkbox"
                :checked="!hiddenToolbarIncludes(p.id)"
                @change="toggleToolbarVisible(p.id, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ t('plugin.showInToolbar') }}</span>
            </label>
            <button
              v-if="p.state === 'active' && p.hasComponent"
              class="plugin-install-btn"
              :disabled="isBusy(p.id)"
              @click="emit('open-plugin', p.id)"
            >
              {{ t('settings.plugins.openManagement') }}
            </button>
            <button
              v-if="p.marketEntry"
              class="plugin-install-btn"
              :disabled="isBusy(p.id)"
              @click="onUpdateFromRepo(p.marketEntry!)"
            >
              <span v-if="isBusy(p.id)" class="plugin-spinner"></span>
              {{ t('settings.plugins.updateFromMarket') }}
            </button>
            <label v-else class="plugin-action-btn" :class="{ disabled: isBusy(`update:${p.id}`) }">
              <input
                type="file"
                accept=".tar.gz,.tgz"
                hidden
                :disabled="isBusy(`update:${p.id}`)"
                @change="onUpdateFile($event, p.id)"
              />
              <span v-if="isBusy(`update:${p.id}`)" class="plugin-spinner"></span>
              <span>{{ t('settings.plugins.update') }}</span>
            </label>
            <button
              class="plugin-action-btn plugin-danger"
              :disabled="isBusy(p.id)"
              @click="onUninstall(p.id)"
            >
              {{ t('settings.plugins.uninstall') }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <FilePickerModal
      v-if="!isTauri()"
      :visible="showPicker"
      pane-id=""
      root="~"
      @update:visible="showPicker = $event"
      @select="onPickerSelect"
    />

    <ConfirmModal
      :visible="!!confirmUninstall"
      :title="t('settings.plugins.uninstall')"
      :message="t('settings.plugins.confirmUninstall')"
      :confirm-text="t('settings.plugins.uninstall')"
      :cancel-text="t('terminal.cancel')"
      @confirm="doUninstall"
      @cancel="confirmUninstall = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch, apiUrl } from '../../composables/apiBase'
import { usePluginLoader } from '../../composables/usePluginLoader'
import { usePluginOverlaysStore } from '../../stores/pluginOverlays'
import { useMarketplace, type MarketPlugin } from '../../composables/useMarketplace'
import { hasHostPluginView } from '../../utils/hostPluginViews'
import { describeHttpError, describeRequestError } from '../../utils/httpError'
import { uiConfirm } from '../../composables/useConfirm'
import { settings, saveSettings } from '../../composables/useSettings'
import { isTauri, tauriInvoke } from '../../composables/useTransport'
import ConfirmModal from '../ui/ConfirmModal.vue'
import FilePickerModal from '../preview/FilePickerModal.vue'

const emit = defineEmits<{ 'open-plugin': [pluginId: string] }>()

const { t, locale } = useI18n()
const { loadedPlugins, loadAll, unloadPlugin } = usePluginLoader()
const overlayStore = usePluginOverlaysStore()
const {
  plugins: marketPlugins,
  loading: marketLoading,
  error: marketError,
  installing,
  fetchMarket,
  fetchReadme,
  installFromMarket,
} = useMarketplace()

const tab = ref<'market' | 'installed'>('market')
const statusMsg = ref('')
const statusOk = ref(false)
const devLinkMode = ref(false)
const showDirInstall = ref(false)
const installDirPath = ref('')
const busyOps = ref<Set<string>>(new Set())
const confirmUninstall = ref<string | null>(null)
const showPicker = ref(false)

// Detail view state
const detailPlugin = ref<MarketPlugin | null>(null)
const readmeCache = ref<Map<string, string | null>>(new Map())
const readmeLoadingState = ref(false)

const readmeHtmlContent = computed(() => {
  if (!detailPlugin.value) return null
  const cached = readmeCache.value.get(detailPlugin.value.id)
  return cached ?? null
})

const settingsPlugins = computed(() =>
  Array.from(loadedPlugins.values())
    .map((p) => ({
      id: p.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      state: p.state,
      error: p.error,
      hasComponent: !!p.exports?.component || hasHostPluginView(p.id),
      permissions: p.manifest.permissions ?? [],
      isDevLink: p.isDevLink,
      category: p.manifest.category,
      marketEntry: marketPlugins.value.find((mp) => mp.id === p.id),
      overlays: overlayStore.overlays
        .filter((o) => o.pluginId === p.id && !o.defaultHidden)
        .map((o) => o.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
)

const PLUGIN_CATEGORY_ORDER = ['system', 'dev', 'ai', 'files', 'network', 'other'] as const

const categoryOptions = computed(() => [
  { value: '', label: t('plugin.category.all') },
  ...PLUGIN_CATEGORY_ORDER.map((c) => ({ value: c, label: t(`plugin.category.${c}`) })),
])

const marketQuery = ref('')
const marketCategory = ref('')
const installedQuery = ref('')
const installedCategory = ref('')

const showIncompatibleModel = computed({
  get: () => settings.plugin_prefs?.show_incompatible ?? false,
  set: (v: boolean) => {
    settings.plugin_prefs = {
      ...(settings.plugin_prefs ?? {
        hidden_toolbar: [],
        hidden_overlays: [],
        show_incompatible: false,
      }),
      show_incompatible: v,
    }
    void saveSettings()
  },
})

function matchesQuery(query: string, fields: Array<string | undefined>): boolean {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(q))
}

const filteredMarketPlugins = computed(() => {
  return marketPlugins.value
    .filter((mp) => (settings.plugin_prefs?.show_incompatible ? true : mp.compatible))
    .filter((mp) => !marketCategory.value || mp.category === marketCategory.value)
    .filter((mp) => matchesQuery(marketQuery.value, [mp.name, mp.id, mp.description, mp.author]))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const filteredSettingsPlugins = computed(() => {
  return settingsPlugins.value
    .filter((p) => !installedCategory.value || p.category === installedCategory.value)
    .filter((p) => matchesQuery(installedQuery.value, [p.name, p.id, p.description]))
})

function hiddenToolbarIncludes(id: string): boolean {
  return (settings.plugin_prefs?.hidden_toolbar ?? []).includes(id)
}

async function toggleToolbarVisible(id: string, visible: boolean) {
  const current = settings.plugin_prefs?.hidden_toolbar ?? []
  const next = visible ? current.filter((x) => x !== id) : [...current, id]
  settings.plugin_prefs = {
    ...(settings.plugin_prefs ?? {
      hidden_toolbar: [],
      hidden_overlays: [],
      show_incompatible: false,
    }),
    hidden_toolbar: next,
  }
  await saveSettings()
}

function hiddenOverlayIncludes(id: string): boolean {
  return (settings.plugin_prefs?.hidden_overlays ?? []).includes(id)
}

/** 'overlay-demo:fab' -> 'Fab' */
function overlayName(id: string): string {
  const short = id.split(':').pop() ?? id
  return short.charAt(0).toUpperCase() + short.slice(1)
}

function onToggleOverlay(id: string, visible: boolean) {
  overlayStore.setUserVisible(id, visible)
  void saveSettings()
}

function setStatus(msg: string, ok: boolean) {
  statusMsg.value = msg
  statusOk.value = ok
  setTimeout(() => {
    statusMsg.value = ''
  }, 4000)
}

function selectTab(value: 'market' | 'installed') {
  tab.value = value
  detailPlugin.value = null
}

function isBusy(key: string) {
  return installing.value.has(key) || busyOps.value.has(key)
}
function markBusy(key: string) {
  busyOps.value = new Set([...busyOps.value, key])
}
function unmarkBusy(key: string) {
  const next = new Set(busyOps.value)
  next.delete(key)
  busyOps.value = next
}

watch(
  tab,
  (val) => {
    if (
      val === 'market' &&
      marketPlugins.value.length === 0 &&
      !marketLoading.value &&
      !marketError.value
    ) {
      fetchMarket()
    }
  },
  { immediate: true }
)

async function renderMarkdown(src: string): Promise<string> {
  const [m, dp] = await Promise.all([import('marked'), import('dompurify')])
  const html = m.parse(src, { async: false }) as string
  return dp.default.sanitize(html)
}

async function openDetail(mp: MarketPlugin) {
  detailPlugin.value = mp
  if (readmeCache.value.has(mp.id)) return

  readmeLoadingState.value = true
  try {
    const md = await fetchReadme(mp.id)
    if (md) {
      const html = await renderMarkdown(md)
      readmeCache.value = new Map([...readmeCache.value, [mp.id, html]])
    } else {
      readmeCache.value = new Map([...readmeCache.value, [mp.id, null]])
    }
  } finally {
    readmeLoadingState.value = false
  }
}

async function onMarketInstall(mp: MarketPlugin) {
  let result = await installFromMarket(mp)
  if (result.permissions && (await confirmNativePermissions(result.permissions))) {
    result = await installFromMarket(mp, true)
  }
  if (result.ok) {
    setStatus(`Installed ${mp.name} v${mp.version}`, true)
    await loadAll()
    await fetchMarket()
    // Update detail plugin data only if already in detail view
    if (detailPlugin.value?.id === mp.id) {
      const updated = marketPlugins.value.find((p) => p.id === mp.id)
      if (updated) detailPlugin.value = updated
    }
  } else {
    setStatus(result.error || 'Install failed', false)
  }
}

async function onUpdateFromRepo(mp: MarketPlugin) {
  let result = await installFromMarket(mp)
  if (result.permissions && (await confirmNativePermissions(result.permissions))) {
    result = await installFromMarket(mp, true)
  }
  if (result.ok) {
    setStatus(`Updated ${mp.name} to v${mp.version}`, true)
    await unloadPlugin(mp.id)
    await loadAll()
    await fetchMarket()
  } else {
    setStatus(result.error || 'Update failed', false)
  }
}

function onPickerSelect(path: string) {
  installDirPath.value = path
  showPicker.value = false
}

async function browseInstallDirectory() {
  if (!isTauri()) {
    showPicker.value = true
    return
  }

  try {
    const selected = (await tauriInvoke('pick_workspace_dir', {
      base: installDirPath.value.trim() || undefined,
    })) as string | null
    if (selected) onPickerSelect(selected)
  } catch (error) {
    setStatus(describeRequestError(error, 'Unable to open folder picker'), false)
  }
}

async function requestedNativePermissions(res: Response): Promise<string[] | null> {
  if (res.status !== 428) return null
  const body = await res.json().catch(() => null)
  return Array.isArray(body?.permissions) ? body.permissions : []
}

function confirmNativePermissions(permissions: string[]): Promise<boolean> {
  return uiConfirm(
    `${t('settings.plugins.nativePermissionWarning')}\n\n${permissions.join('\n')}`,
    {
      title: t('settings.plugins.nativePermissionTitle'),
      confirmText: t('settings.plugins.nativePermissionApprove'),
      cancelText: t('terminal.cancel'),
    }
  )
}

async function onInstallFromDir() {
  const path = installDirPath.value.trim()
  if (!path) return
  markBusy('dir-install')
  try {
    const request = (approveNative: boolean) =>
      authFetch(apiUrl('/api/plugins/install-dir'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          dev_link: devLinkMode.value,
          approve_native: approveNative,
        }),
      })
    let res = await request(false)
    const permissions = await requestedNativePermissions(res)
    if (permissions && (await confirmNativePermissions(permissions))) {
      res = await request(true)
    }
    if (res.ok) {
      const manifest = await res.json()
      const mode = devLinkMode.value ? 'Linked' : 'Installed'
      setStatus(`${mode} ${manifest.name} v${manifest.version}`, true)
      installDirPath.value = ''
      showDirInstall.value = false
      await loadAll()
      await fetchMarket()
    } else {
      setStatus(await describeHttpError(res, 'Install failed'), false)
    }
  } catch (error) {
    setStatus(describeRequestError(error, 'Install failed'), false)
  } finally {
    unmarkBusy('dir-install')
  }
}

async function onUpdateFile(e: Event, id: string) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  markBusy(`update:${id}`)
  try {
    const request = (approveNative: boolean) => {
      const form = new FormData()
      form.append('file', file)
      return authFetch(
        apiUrl(`/api/plugins/${id}/update?approve_native=${approveNative ? 'true' : 'false'}`),
        { method: 'POST', body: form }
      )
    }
    let res = await request(false)
    const permissions = await requestedNativePermissions(res)
    if (permissions && (await confirmNativePermissions(permissions))) {
      res = await request(true)
    }
    if (res.ok) {
      const manifest = await res.json()
      setStatus(`Updated ${manifest.name} to v${manifest.version}`, true)
      await unloadPlugin(id)
      await loadAll()
      await fetchMarket()
    } else {
      setStatus(await describeHttpError(res, 'Update failed'), false)
    }
  } catch (error) {
    setStatus(describeRequestError(error, 'Update failed'), false)
  } finally {
    unmarkBusy(`update:${id}`)
    input.value = ''
  }
}

function onUninstall(id: string) {
  confirmUninstall.value = id
}

async function doUninstall() {
  const id = confirmUninstall.value!
  confirmUninstall.value = null
  try {
    const res = await authFetch(apiUrl(`/api/plugins/${id}`), { method: 'DELETE' })
    if (res.ok) {
      await unloadPlugin(id)
      setStatus(`Uninstalled ${id}`, true)
      await fetchMarket()
      if (detailPlugin.value?.id === id) {
        const updated = marketPlugins.value.find((p) => p.id === id)
        if (updated) detailPlugin.value = updated
      }
    } else {
      setStatus(await describeHttpError(res, 'Uninstall failed'), false)
    }
  } catch (error) {
    setStatus(describeRequestError(error, 'Uninstall failed'), false)
  }
}

async function onRefresh() {
  markBusy('refresh')
  try {
    await Promise.all([loadAll(), fetchMarket()])
    setStatus(t('settings.plugins.refresh') + ' ✓', true)
  } catch {
    setStatus('Refresh failed', false)
  } finally {
    unmarkBusy('refresh')
  }
}
</script>

<style scoped>
.plugin-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.plugin-tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.plugin-tab:hover {
  color: var(--text-primary);
}
.plugin-tab.active {
  color: var(--fg-bright);
  border-bottom-color: var(--accent);
}
.plugin-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.plugin-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.plugin-search-input {
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--fg);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  transition: border-color 0.15s;
}
.plugin-search-input:focus {
  border-color: var(--fg-muted);
}
.plugin-category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.plugin-category-chip {
  padding: 3px 10px;
  font-size: 11px;
  color: var(--fg-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}
.plugin-category-chip:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}
.plugin-category-chip.active {
  color: var(--bg);
  background: var(--fg-muted);
  border-color: var(--fg-muted);
}
.plugin-toggle-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--fg-muted);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.plugin-toggle-inline input[type='checkbox'] {
  accent-color: var(--accent);
}
.plugin-badge.category {
  color: var(--fg-muted);
  background: var(--bg-hover);
}
.plugin-badge.incompatible {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 15%, transparent);
}
.plugin-card-incompatible {
  opacity: 0.7;
}
.plugin-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.plugin-dir-install {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 12px;
}
.plugin-browse-btn {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.plugin-browse-btn:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}
.plugin-dev-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.plugin-dev-toggle input[type='checkbox'] {
  accent-color: var(--accent);
}
.plugin-install-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--fg-bright);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.plugin-install-btn:hover {
  background: var(--bg-hover);
  border-color: var(--fg-muted);
}
.plugin-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 5px;
  background: none;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition:
    background 0.15s,
    color 0.15s;
}
.plugin-action-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.plugin-danger {
  color: var(--fg-muted);
}
.plugin-danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
.plugin-error-msg {
  margin: 8px 0;
  color: var(--danger);
  font-size: 13px;
}
.plugin-retry-btn {
  margin-left: 8px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--fg-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.plugin-retry-btn:hover {
  color: var(--fg-bright);
  border-color: var(--fg-muted);
}
.plugin-success-msg {
  margin: 8px 0;
  color: var(--success);
  font-size: 13px;
}
.plugin-empty {
  padding: 12px 0;
  color: var(--text-muted);
  font-size: 13px;
}
.plugin-card {
  padding: 14px 16px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.plugin-card-clickable {
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.plugin-card-clickable:hover {
  border-color: var(--fg-muted);
  background: var(--bg-surface-hover);
}
.plugin-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.plugin-card-name {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.4;
}
.plugin-card-version {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}
.plugin-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.4;
}
.plugin-badge.installed {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 15%, transparent);
}
.plugin-badge.update {
  color: var(--fg-muted);
  background: var(--bg-hover);
}
.plugin-badge.error {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 15%, transparent);
}
.plugin-badge.dev {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 15%, transparent);
}
.plugin-card-desc {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.plugin-card-error {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.plugin-permissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px 0 10px;
  font-size: 11px;
  color: var(--fg-muted);
}
.plugin-permissions code {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono);
  color: var(--fg);
  background: var(--bg-hover);
}
.plugin-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  align-items: center;
}
.plugin-link {
  font-size: 12px;
  color: var(--fg-muted);
  text-decoration: none;
  transition: color 0.15s;
}
.plugin-link:hover {
  color: var(--fg-bright);
}
.plugin-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--text-muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: plugin-spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
.plugin-install-btn .plugin-spinner {
  border-color: var(--fg-muted);
  border-top-color: transparent;
}
@keyframes plugin-spin {
  to {
    transform: rotate(360deg);
  }
}
.plugin-action-btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* Detail view */
.plugin-detail-header {
  margin-bottom: 14px;
}
.plugin-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}
.plugin-back-btn:hover {
  color: var(--fg-bright);
}
.plugin-back-arrow {
  font-size: 16px;
  line-height: 1;
}
.plugin-detail-info {
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  margin-bottom: 12px;
}
.plugin-detail-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.plugin-detail-name {
  font-weight: 600;
  font-size: 16px;
  line-height: 1.4;
}
.plugin-detail-author {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
.plugin-detail-desc {
  margin: 8px 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.plugin-detail-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.plugin-detail-readme {
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}
.plugin-readme-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
}
.plugin-readme-empty {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 0;
}
.plugin-readme-body {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.6;
  max-height: 500px;
  overflow-y: auto;
}
.plugin-readme-body :deep(h1),
.plugin-readme-body :deep(h2),
.plugin-readme-body :deep(h3) {
  color: var(--text-primary);
  margin: 16px 0 8px;
  font-weight: 600;
}
.plugin-readme-body :deep(h1) {
  font-size: 18px;
}
.plugin-readme-body :deep(h2) {
  font-size: 16px;
}
.plugin-readme-body :deep(h3) {
  font-size: 14px;
}
.plugin-readme-body :deep(p) {
  margin: 8px 0;
}
.plugin-readme-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
  margin: 8px 0;
}
.plugin-readme-body :deep(code) {
  background: var(--bg-input);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
}
.plugin-readme-body :deep(pre) {
  background: var(--bg-input);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.plugin-readme-body :deep(pre code) {
  background: none;
  padding: 0;
}
.plugin-readme-body :deep(ul),
.plugin-readme-body :deep(ol) {
  padding-left: 20px;
  margin: 8px 0;
}
.plugin-readme-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.plugin-readme-body :deep(a:hover) {
  text-decoration: underline;
}
.plugin-readme-body :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-muted);
}
.plugin-readme-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}
.plugin-readme-body :deep(th),
.plugin-readme-body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  font-size: 12px;
  text-align: left;
}
.plugin-readme-body :deep(th) {
  background: var(--bg-input);
  font-weight: 600;
}
</style>

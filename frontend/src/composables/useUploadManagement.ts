import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useToast } from 'vue-toastification'
import { apiUrl, authFetch } from './apiBase'
import type { SettingsData } from './useSettings'
import type { UploadResponse } from '../types/uploads'

export interface UploadManagementOptions {
  settings: SettingsData
  saveSettings: () => Promise<void>
  toast?: ReturnType<typeof useToast>
  t: (key: string) => string
}

export interface UploadManagement {
  uploadBusy: Ref<'' | 'status' | 'clear' | 'adopt'>
  uploadStatus: Ref<{ managed: boolean; foreign: boolean; empty: boolean }>
  uploadDirError: Ref<string>
  uploadStatusLabel: Ref<string>
  uploadDirPlaceholder: Ref<string>
  refreshUploadStatus: () => Promise<void>
  onUploadSettingsChange: () => Promise<void>
  pickUploadDir: () => Promise<void>
  pickDefaultBaseDir: () => Promise<void>
  pickDefaultWorkspaceRoot: () => Promise<void>
  restoreDefaultUploadDir: () => Promise<void>
  clearUploads: () => Promise<void>
  adoptUploads: () => Promise<void>
  onUploadStatusEvent: (ev: Event) => void
}

export function useUploadManagement(opts: UploadManagementOptions): UploadManagement {
  const { settings, saveSettings, toast, t } = opts

  const uploadBusy = ref<'' | 'status' | 'clear' | 'adopt'>('')
  const uploadStatus = ref({ managed: false, foreign: false, empty: true })
  const uploadDirError = ref('')

  const uploadStatusLabel = computed(() => {
    if (uploadStatus.value.foreign) return t('settings.uploads.statusForeign')
    if (uploadStatus.value.managed) return t('settings.uploads.statusManaged')
    return t('settings.uploads.statusUnknown')
  })

  const uploadDirPlaceholder = computed(() => {
    const platform = (navigator.platform || '').toLowerCase()
    const userAgent = (navigator.userAgent || '').toLowerCase()
    if (platform.startsWith('win') || userAgent.includes('windows')) return '%TEMP%\\dinotty'
    if (platform.includes('mac') || userAgent.includes('mac os')) return '$TMPDIR/dinotty'
    return '/tmp/dinotty'
  })

  function setUploadStatus(data: UploadResponse) {
    uploadDirError.value = ''
    uploadStatus.value = {
      managed: !!data.managed,
      foreign: !!data.foreign,
      empty: !!data.empty,
    }
  }

  function errorStatus(err: unknown): number | undefined {
    if (typeof err !== 'object' || err === null || !('status' in err)) return undefined
    const status = Number((err as { status: unknown }).status)
    return Number.isFinite(status) ? status : undefined
  }

  async function postUploadsStatus() {
    const res = await authFetch(apiUrl('/api/uploads'), { method: 'GET' })
    if (!res.ok) throw { status: res.status }
    return (await res.json()) as UploadResponse
  }

  async function refreshUploadStatus() {
    if (uploadBusy.value) return
    uploadBusy.value = 'status'
    try {
      setUploadStatus(await postUploadsStatus())
      uploadDirError.value = ''
    } catch (err) {
      uploadDirError.value = errorStatus(err) === 400 ? t('settings.uploads.dirInvalid') : ''
      uploadStatus.value = { managed: false, foreign: false, empty: true }
    } finally {
      uploadBusy.value = ''
    }
  }

  async function onUploadSettingsChange() {
    if (!Number.isFinite(settings.upload_cap_mb as number)) settings.upload_cap_mb = 0
    if (!Number.isFinite(settings.upload_file_cap_mb as number)) settings.upload_file_cap_mb = 0
    if (!Number.isFinite(settings.upload_cap_count as number)) settings.upload_cap_count = 0
    await saveSettings()
    await refreshUploadStatus()
  }

  async function pickUploadDir() {
    try {
      const dir = await invoke<string | null>('pick_upload_dir')
      if (!dir) return
      settings.upload_dir = dir
      await onUploadSettingsChange()
    } catch {
      uploadDirError.value = t('settings.uploads.dirInvalid')
    }
  }

  async function pickDefaultBaseDir() {
    const dir = await invoke<string | null>('pick_workspace_dir', {
      base: settings.default_base_dir || undefined,
    })
    if (!dir) return
    settings.default_base_dir = dir
    await saveSettings()
  }

  async function pickDefaultWorkspaceRoot() {
    const dir = await invoke<string | null>('pick_workspace_dir', {
      base: settings.default_workspace_root || undefined,
    })
    if (!dir) return
    settings.default_workspace_root = dir
    await saveSettings()
  }

  async function restoreDefaultUploadDir() {
    try {
      const res = await authFetch(apiUrl('/api/uploads/default-dir'), { method: 'GET' })
      if (!res.ok) throw new Error(`default upload dir failed: ${res.status}`)
      const data = (await res.json()) as { default_dir?: string }
      if (!data.default_dir) return
      settings.upload_dir = data.default_dir
      await onUploadSettingsChange()
    } catch {
      uploadDirError.value = t('settings.uploads.dirInvalid')
    }
  }

  async function clearUploads() {
    uploadBusy.value = 'clear'
    try {
      const res = await authFetch(apiUrl('/api/uploads/clear'), { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setUploadStatus((await res.json()) as UploadResponse)
      toast?.success(t('settings.uploads.clearDone'))
    } catch {
      toast?.error(t('settings.uploads.clearFailed'))
      uploadBusy.value = ''
      await refreshUploadStatus()
    } finally {
      uploadBusy.value = ''
    }
  }

  async function adoptUploads() {
    uploadBusy.value = 'adopt'
    try {
      const res = await authFetch(apiUrl('/api/uploads/adopt'), { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setUploadStatus((await res.json()) as UploadResponse)
      toast?.success(t('settings.uploads.adoptDone'))
    } catch {
      toast?.error(t('settings.uploads.adoptFailed'))
      uploadBusy.value = ''
      await refreshUploadStatus()
    } finally {
      uploadBusy.value = ''
    }
  }

  function onUploadStatusEvent(ev: Event) {
    setUploadStatus((ev as CustomEvent<UploadResponse>).detail ?? {})
  }

  onMounted(() => {
    void refreshUploadStatus()
    window.addEventListener('dinotty-upload-status', onUploadStatusEvent)
  })

  onUnmounted(() => {
    window.removeEventListener('dinotty-upload-status', onUploadStatusEvent)
  })

  return {
    uploadBusy,
    uploadStatus,
    uploadDirError,
    uploadStatusLabel,
    uploadDirPlaceholder,
    refreshUploadStatus,
    onUploadSettingsChange,
    pickUploadDir,
    pickDefaultBaseDir,
    pickDefaultWorkspaceRoot,
    restoreDefaultUploadDir,
    clearUploads,
    adoptUploads,
    onUploadStatusEvent,
  }
}

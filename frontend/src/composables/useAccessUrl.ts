import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import QRCode from 'qrcode'
import { apiUrl, authFetch, getApiBase } from './apiBase'
import { copyToClipboard } from '../utils/clipboard'

export interface AccessUrlOptions {
  t: (key: string) => string
}

export interface AccessUrl {
  accessUrl: Ref<string>
  logModalVisible: Ref<boolean>
  logContent: Ref<string>
  logLoading: Ref<boolean>
  copied: Ref<boolean>
  qrCanvasRef: Ref<HTMLCanvasElement | null>
  copyAccessUrl: () => Promise<void>
  refreshAccessUrl: () => Promise<void>
  viewLog: () => Promise<void>
  refreshLog: () => Promise<void>
}

export function useAccessUrl(opts: AccessUrlOptions): AccessUrl {
  const { t } = opts

  const accessUrl = ref('')
  const logModalVisible = ref(false)
  const logContent = ref('')
  const logLoading = ref(false)
  const copied = ref(false)
  const qrCanvasRef = ref<HTMLCanvasElement | null>(null)

  watch([accessUrl, qrCanvasRef], ([url, canvas]) => {
    if (url && canvas) {
      QRCode.toCanvas(canvas, url, {
        width: 160,
        margin: 2,
        color: { dark: '#C7C7C7', light: '#00000000' },
      })
    }
  })

  async function fetchAccessUrl() {
    try {
      await getApiBase()
      const res = await authFetch(apiUrl('/api/info'))
      const info = await res.json()
      accessUrl.value = `http://${info.lan_ip}:${info.port}`
    } catch {
      const { hostname } = window.location
      const host = hostname === 'localhost' ? '127.0.0.1' : hostname
      const port = window.location.port
      accessUrl.value = `http://${host}${port ? ':' + port : ''}`
    }
  }

  function onNetworkChange() {
    void fetchAccessUrl()
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void fetchAccessUrl()
    }
  }

  async function copyAccessUrl() {
    await copyToClipboard(accessUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }

  async function refreshLog() {
    logLoading.value = true
    try {
      const res = await authFetch(apiUrl('/api/log'))
      if (res.ok) {
        logContent.value = await res.text()
      } else {
        logContent.value = t('settings.log.noLog')
      }
    } catch {
      logContent.value = t('settings.log.noLog')
    } finally {
      logLoading.value = false
    }
  }

  async function viewLog() {
    logModalVisible.value = true
    await refreshLog()
  }

  onMounted(() => {
    window.addEventListener('online', onNetworkChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    window.removeEventListener('online', onNetworkChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    accessUrl,
    logModalVisible,
    logContent,
    logLoading,
    copied,
    qrCanvasRef,
    copyAccessUrl,
    refreshAccessUrl: fetchAccessUrl,
    viewLog,
    refreshLog,
  }
}

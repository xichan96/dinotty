import { computed, ref } from 'vue'
import { isTauri, tauriInvoke } from './useTransport'

export type AutostartPackageKind =
  | 'windowsDesktop'
  | 'macosInstalledApp'
  | 'linuxDeb'
  | 'linuxAppImage'
  | 'unknown'
export type AutostartState = 'off' | 'onCurrent' | 'onDifferentPath' | 'error'
export type AutostartSupportReason =
  | 'unsupportedPlatform'
  | 'unsupportedPackage'
  | 'unstableInstallLocation'
  | 'executablePathUnavailable'
  | 'homeDirectoryUnavailable'
  | 'trayUnavailable'
  | 'runtimeEvidenceInvalid'
export type AutostartStateError = 'registrationMalformed' | 'registrationUnreadable'
export type AutostartOperationError =
  | 'notAllowed'
  | 'writeFailed'
  | 'deleteFailed'
  | 'verificationFailed'
export type AutostartWarning =
  | 'pathMoveBreaksRegistration'
  | 'removableVolumeMayBeUnavailable'
  | 'desktopEnvironmentDependent'
  | 'systemMaySuppress'

export interface AutostartStatus {
  packageKind: AutostartPackageKind
  canEnable: boolean
  canDisable: boolean
  supportReason?: AutostartSupportReason
  state: AutostartState
  stateError?: AutostartStateError
  warnings: AutostartWarning[]
}

interface SetAutostartResult {
  status: AutostartStatus
  operationError?: AutostartOperationError
}

export function isDesktopTauri(): boolean {
  if (!isTauri()) return false
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return !/Android|iPhone|iPad|iPod/i.test(userAgent)
}

export function useAutostart() {
  const status = ref<AutostartStatus | null>(null)
  const loading = ref(false)
  const requesting = ref(false)
  const operationError = ref<AutostartOperationError | null>(null)

  const visible = computed(() => {
    const value = status.value
    if (!isDesktopTauri() || !value) return false
    return !(value.packageKind === 'unknown' && value.state === 'off' && !value.canDisable)
  })

  async function refresh() {
    if (!isDesktopTauri() || requesting.value) return
    loading.value = true
    try {
      status.value = (await tauriInvoke('autostart_status')) as AutostartStatus
    } catch {
      // A browser, mobile shell, or older desktop backend must not expose a broken control.
      status.value = null
    } finally {
      loading.value = false
    }
  }

  async function setEnabled(
    enabled: boolean,
    confirmPortableAutostart: () => boolean = () => true
  ): Promise<boolean> {
    if (requesting.value || !status.value) return false
    if (
      enabled &&
      status.value.warnings.includes('pathMoveBreaksRegistration') &&
      !confirmPortableAutostart()
    ) {
      return false
    }

    requesting.value = true
    operationError.value = null
    try {
      const result = (await tauriInvoke('set_autostart', { enabled })) as SetAutostartResult
      status.value = result.status
      operationError.value = result.operationError ?? null
      return !result.operationError
    } catch {
      operationError.value = 'verificationFailed'
      try {
        status.value = (await tauriInvoke('autostart_status')) as AutostartStatus
      } catch {
        status.value = null
      }
      return false
    } finally {
      requesting.value = false
    }
  }

  return { status, loading, requesting, operationError, visible, refresh, setEnabled }
}

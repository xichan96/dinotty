import { apiErrorCode } from './apiError'

const SETTINGS_ERROR_CODES = new Set([
  'shell_unavailable',
  'wsl_distro_missing',
  'wsl_timeout',
  'wsl_list_failed',
  'wsl_capability_unsupported',
  'wsl_output_invalid',
])

export function shellErrorMessage(
  error: unknown,
  translate: (key: string) => string,
  fallbackKey: string
): string {
  const code = apiErrorCode(error)
  if (code) {
    const key = `terminal.sessionError.${code}`
    const message = translate(key)
    if (message !== key) return message
  }
  return translate(fallbackKey)
}

export function canFixShellErrorInSettings(error: unknown): boolean {
  const code = apiErrorCode(error)
  return code !== undefined && SETTINGS_ERROR_CODES.has(code)
}

export const isWindowsClient: boolean =
  typeof navigator !== 'undefined' &&
  /Win/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform,
  )

export function isIPhoneClient(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPod/i.test(navigator.userAgent)
}

/**
 * Returns the current client's host target string, matching the backend
 * `HostTarget::as_str()` vocabulary. Returns `null` when the platform
 * cannot be mapped to a known target.
 */
export function hostTarget(): string | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    ''

  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua)
  const isWin = /Win/i.test(platform) || /Windows/i.test(ua)
  const isLinux = /Linux/i.test(platform) || /X11/i.test(ua)
  const isArm = /arm|aarch64/i.test(ua) || /arm64/i.test(platform)

  if (isMac) return isArm ? 'macos-aarch64' : 'macos-x86_64'
  if (isWin) return 'windows-x86_64'
  if (isLinux) return isArm ? 'linux-aarch64' : 'linux-x86_64'
  return null
}

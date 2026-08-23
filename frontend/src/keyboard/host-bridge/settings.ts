// Host singleton bridge (keyboard-plugin-design.md Phase 1b): redirects
// plugin imports of the host's `composables/useSettings` to the host module
// exposed on `window.__DINOTTY_HOST__` (assigned by the host's
// installHostBridge() at startup, before any plugin loads). Without this,
// a plugin bundle would hold its own `settings` reactive object and diverge
// from the host app.
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useSettings: {
        settings: Record<string, any>
        useSettings: () => { settings: Record<string, any>; [k: string]: unknown }
        onThemeChange: (fn: (xtermTheme: unknown) => void) => void
        onTextChange: (fn: (text: unknown) => void) => void
      }
    }
  }
).__DINOTTY_HOST__?.useSettings
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useSettings not assigned')
}

export const settings: Record<string, any> = host.settings
export const useSettings = host.useSettings
export const onThemeChange = host.onThemeChange
export const onTextChange = host.onTextChange

/** Mirrors the host backend's MobileInputMode serde type (bare string). */
export type MobileInputMode = 'builtin' | 'system' | (string & {})

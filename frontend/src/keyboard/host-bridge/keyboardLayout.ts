// Host singleton bridge: keyboard layout resolution. `useKeyboardLayout`
// derives the key rows (builtin rows + settings-driven action keyboard)
// from the host settings singleton; the host keeps it because the in-core
// system keyboard (SystemKeyboardToolbar) shares the same chain
// (actionKeyDef -> appActionCatalog -> useKeybindings).
const host = (
  window as unknown as {
    __DINOTTY_HOST__?: {
      useKeyboardLayout: {
        useKeyboardLayout: (opts: Record<string, unknown>) => {
          rows: unknown
          [k: string]: unknown
        }
      }
    }
  }
).__DINOTTY_HOST__?.useKeyboardLayout
if (!host) {
  throw new Error('host bridge missing: window.__DINOTTY_HOST__.useKeyboardLayout not assigned')
}

export const useKeyboardLayout = host.useKeyboardLayout

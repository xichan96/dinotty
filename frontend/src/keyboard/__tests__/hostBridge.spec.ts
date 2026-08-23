import { describe, expect, it, vi } from 'vitest'

// Breaks the useFileNavigation -> ... -> usePluginLoader -> useEventBridge ->
// useSyncWebSocket -> usePluginLoader cycle (known issue, same as
// createKeyboardContext.spec.ts).
vi.mock('../../composables/useEventBridge', () => ({
  subscribe: vi.fn(() => ({ dispose() {} })),
  emit: vi.fn(),
}))

import { installHostBridge } from '../installHostBridge'
import { settings as hostSettings } from '../../composables/useSettings'
import { useHistory } from '../../composables/useHistory'
import { useSelectedPath } from '../../composables/useFileNavigation'

type HostBridge = {
  useSettings: typeof import('../../composables/useSettings')
  useHistory: typeof import('../../composables/useHistory')
  useI18n: typeof import('../../composables/useI18n')
  useFileNavigation: typeof import('../../composables/useFileNavigation')
}

function bridge(): HostBridge {
  installHostBridge()
  return (window as unknown as { __DINOTTY_HOST__: HostBridge }).__DINOTTY_HOST__
}

describe('installHostBridge', () => {
  it('exposes the host singleton composable namespaces on window', () => {
    const b = bridge()
    // Plugin bundles read these namespaces through the _shared/host-bridge
    // shims (dinotty-plugins repo) - identity here is the whole contract.
    expect(b.useSettings.settings).toBe(hostSettings)
    expect(b.useSettings.useSettings().settings).toBe(hostSettings)
    expect(b.useHistory.useHistory().suggestions).toBe(useHistory().suggestions)
    expect(b.useI18n.useI18n().t).toBeTypeOf('function')
    expect(b.useFileNavigation.useSelectedPath().selectedPath).toBe(useSelectedPath().selectedPath)
  })
})

import { ref } from 'vue'
import type { Component } from 'vue'
import type { MobileInputMode } from './useSettings'

/**
 * Keyboard provider registry — host-owned "who plays" layer
 * (keyboard-plugin-design.md §4.1, Phase 1a).
 *
 * Host registers `builtin-keyboard` / `system`; plugins register their own
 * keyboard contributions in a later phase. The registry is intentionally thin:
 * it maps the persisted `mobile_input_mode` setting to an active provider id
 * and falls back to the bundled builtin keyboard when the requested provider
 * is not registered.
 */

export type KeyboardProviderKind = 'host' | 'bundled' | 'plugin'

export interface KeyboardProviderInfo {
  id: string
  kind: KeyboardProviderKind
  /**
   * Renderable component when a loaded plugin contributes this provider.
   * Absent while only the host fallback (in-core components) plays.
   */
  component?: Component
  /**
   * Host-owned reservation band (keyboard-plugin-design.md §三 D / Phase 2):
   * a fixed height the host reserves when the keyboard is visible, or 'auto'
   * for the host to measure the rendered component root via ResizeObserver.
   * Absent when the provider self-reports through ctx.setDesiredHeight.
   */
  desiredHeight?: number | 'auto'
}

export const BUILTIN_KEYBOARD_ID = 'builtin-keyboard'
export const SYSTEM_KEYBOARD_ID = 'system'

const providers = ref(new Map<string, KeyboardProviderInfo>())
let hostProvidersRegistered = false

export function useKeyboardProviders() {
  function register(p: KeyboardProviderInfo) {
    providers.value.set(p.id, p)
  }

  function unregister(id: string) {
    providers.value.delete(id)
  }

  /**
   * Attach a plugin-contributed component to a provider entry. A pre-existing
   * host entry keeps its kind so unloading restores the host fallback.
   *
   * The `system` provider is host-frozen (keyboard-plugin-design.md §5 1c):
   * third-party contributions must never attach to it, so registration is a
   * silent no-op. Mutual exclusion (invariant §二 #2) is otherwise preserved
   * by resolveActive picking a single provider from mobile_input_mode.
   */
  function registerComponent(
    id: string,
    kind: KeyboardProviderKind,
    component: Component,
    desiredHeight?: number | 'auto'
  ) {
    if (id === SYSTEM_KEYBOARD_ID) return
    const existing = providers.value.get(id)
    providers.value.set(id, { id, kind: existing?.kind ?? kind, component, desiredHeight })
  }

  /** Detach a plugin-contributed component; host-registered providers keep their entry. */
  function unregisterComponent(id: string) {
    const existing = providers.value.get(id)
    if (!existing) return
    const { component: _component, desiredHeight: _desiredHeight, ...base } = existing
    if (base.kind === 'host') providers.value.set(id, base)
    else providers.value.delete(id)
  }

  /** Resolve the active provider id from the persisted mobile_input_mode setting. */
  function resolveActive(mode: MobileInputMode | null | undefined): string {
    const requested =
      mode == null || mode === 'builtin'
        ? BUILTIN_KEYBOARD_ID
        : mode === 'system'
          ? SYSTEM_KEYBOARD_ID
          : mode
    return providers.value.has(requested) ? requested : BUILTIN_KEYBOARD_ID
  }

  return { providers, register, unregister, registerComponent, unregisterComponent, resolveActive }
}

/** Register the two host providers. Called once at app startup. */
export function initHostKeyboardProviders() {
  if (hostProvidersRegistered) return
  hostProvidersRegistered = true
  const { register } = useKeyboardProviders()
  register({ id: BUILTIN_KEYBOARD_ID, kind: 'host' })
  register({ id: SYSTEM_KEYBOARD_ID, kind: 'host' })
}

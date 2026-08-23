import { watch, type Ref } from 'vue'
import type {
  KeyboardContext,
  KeyboardHostEventMap,
  KeyboardIncomingEventMap,
} from '../../../plugin-api/index'
import { settings } from '../composables/useSettings'
import { useHistory } from '../composables/useHistory'
import { useI18n } from '../composables/useI18n'
import { useSelectedPath } from '../composables/useFileNavigation'

export const KEYBOARD_API_VERSION = 1

/**
 * Host-owned pieces the keyboard context needs from the App shell.
 * Everything closured in App.vue (send functions, IME state, host event
 * dispatch) is injected here; shared singletons (settings, history,
 * selectedPath, i18n) are pulled directly from their composables so plugin
 * providers observe the exact same reactive instances as the host.
 */
export interface KeyboardHostDeps {
  visible: Ref<boolean>
  activePaneId: Ref<string | null>
  sendActive(data: string): Promise<void>
  sendBroadcast(data: string): Promise<void>
  sendToPane(paneId: string, data: string): Promise<void>
  nativeImeOpen: Ref<boolean>
  setNativeImeOpen(open: boolean): void
  onHostEvent<K extends keyof KeyboardHostEventMap>(event: K, data: KeyboardHostEventMap[K]): void
}

export function createKeyboardContext(deps: KeyboardHostDeps): KeyboardContext {
  const { locale, t } = useI18n()
  const history = useHistory()
  const { selectedPath } = useSelectedPath()

  function send(target: 'active' | 'broadcast' | string, data: string): Promise<void> {
    if (target === 'active') return Promise.resolve(deps.sendActive(data))
    if (target === 'broadcast') return Promise.resolve(deps.sendBroadcast(data))
    return Promise.resolve(deps.sendToPane(target, data))
  }

  function setDesiredHeight(h: number): void {
    // Same mechanism the builtin keyboard uses today: a root CSS variable
    // that drives the terminal viewport reservation.
    document.documentElement.style.setProperty('--mkb-height', `${h}px`)
  }

  function onViewportResize(
    cb: (info: { height: number; offsetTop: number; baseline: number }) => void
  ) {
    // jsdom and non-visualViewport embeddings have no vv; no-op so callers can
    // subscribe unconditionally.
    const vv = window.visualViewport
    if (!vv) return { dispose() {} }
    // resize + scroll only, deliberately no orientationchange: rotation also
    // fires a vv resize, and delivering the callback at orientationchange time
    // would run keyboard viewport logic before the keyboard's own rotation
    // handling (e.g. iOS dismiss-detection arming) has re-baselined.
    const handler = () => {
      cb({ height: vv.height, offsetTop: vv.offsetTop, baseline: window.innerHeight })
    }
    vv.addEventListener('resize', handler)
    vv.addEventListener('scroll', handler)
    return {
      dispose() {
        vv.removeEventListener('resize', handler)
        vv.removeEventListener('scroll', handler)
      },
    }
  }

  function onDidChangeSettings(cb: (s: Record<string, any>) => void) {
    const stop = watch(
      () => settings,
      (s) => cb(s as unknown as Record<string, any>),
      { deep: true }
    )
    return { dispose: () => stop() }
  }

  const ctx: KeyboardContext = {
    version: KEYBOARD_API_VERSION,
    visible: deps.visible,
    activePaneId: deps.activePaneId,

    send,

    setDesiredHeight,
    onViewportResize,

    i18n: {
      getLocale: () => locale.value,
      onDidChangeLocale(callback) {
        const stop = watch(locale, (l, previous) => {
          if (l !== previous) callback(l)
        })
        return { dispose: () => stop() }
      },
      t,
    },

    settingsData: settings as unknown as Record<string, any>,
    onDidChangeSettings,

    events: {
      emit(event, data) {
        deps.onHostEvent(event, data)
      },
      on<K extends keyof KeyboardIncomingEventMap>(
        event: K,
        cb: (data: KeyboardIncomingEventMap[K]) => void
      ) {
        if (event === 'modifiers-consumed') {
          const handler = (e: Event) => {
            const detail = (
              e as CustomEvent<{
                paneId?: string
                modifiers?: KeyboardIncomingEventMap['modifiers-consumed']['modifiers']
              }>
            ).detail
            cb({
              paneId: detail?.paneId ?? '',
              modifiers: detail?.modifiers,
            } as KeyboardIncomingEventMap[K])
          }
          window.addEventListener('dinotty-mobile-modifiers-consumed', handler)
          return {
            dispose: () => window.removeEventListener('dinotty-mobile-modifiers-consumed', handler),
          }
        }
        return { dispose() {} }
      },
    },

    nativeImeOpen: deps.nativeImeOpen,
    setNativeImeOpen: deps.setNativeImeOpen,

    history: {
      suggestions: history.suggestions,
      fetchSuggestions: (prefix?: string, limit?: number) =>
        history.fetchSuggestions(prefix, limit),
      fetchDebounced: (prefix?: string) => history.fetchDebounced(prefix),
      deleteSuggestion: (command: string) => history.deleteSuggestion(command),
    },

    selectedPath,
  }

  return ctx
}

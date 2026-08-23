import { computed, ref, watch, nextTick, type Ref, type ComponentPublicInstance } from 'vue'
import { createKeyboardContext } from '../keyboard/createKeyboardContext'
import { useKeyboardBand } from '../keyboard/useKeyboardBand'
import type { KeyboardHostEventMap } from '../../../plugin-api/index'
import { useViewportResize } from './useViewportResize'
import { useOverlayKeyboardBroadcast } from './useOverlayKeyboardBroadcast'
import { useKeyboardOverlap } from './useKeyboardOverlap'
import { imeKeyboardOverlapPx, type MobileInputMode } from './useSettings'
import {
  isTouchDevice,
  isKbTypingLocked,
  setKbTypingLock,
  setSystemImeAuthorized,
  configureAllMobileInputTextareas,
  applyAfterTerminalComposition,
  setActivePaneId,
} from './useTerminal'
import { hasCollapseGuard, hasOpenGuard } from '../utils/keyboardGuardMode'
import { emptyMobileTerminalModifiers, type MobileTerminalModifiers } from '../utils/terminalInput'
import { getAllLeaves, paneKind } from '../types/pane'
import { createFrozenSendFn, type SendDataFn } from '../utils/frozenSend'
import { useSettingsStore } from '../stores/settingsStore'
import type { useAppCore } from './useAppCore'
import type { useAppActions } from './useAppActions'

export interface AppKeyboardOptions {
  core: ReturnType<typeof useAppCore>
  actions: ReturnType<typeof useAppActions>
  settingsStore: ReturnType<typeof useSettingsStore>
  bookmarksRef: Ref<{ open(): void } | undefined>
}

export function useAppKeyboard(options: AppKeyboardOptions) {
  const { core, actions, settingsStore, bookmarksRef } = options
  const { dispatchAppAction } = actions
  const {
    kbTyping,
    terminalImeFocused,
    mobileInputGuideVisible,
    systemActionKeyboardOpen,
    keyboardHostRef,
    systemToolbarRef,
    activeKeyboardProvider,
    effectiveMobileInputMode,
    activeTerminalLeaf,
    hasActiveTerminalLeaf,
    persistentSystemToolbar,
    systemToolbarVisible,
    appSettings,
    tabs,
    activePaneId,
    activeTab,
    kbVisible,
    getSendFn,
    getActiveTerminalRef,
    canRestoreSystemInputFocus,
    focusSystemInput,
    pasteActiveTerminal,
    termRefs,
    focusActive,
  } = core

  // ── Module-level gesture state (kept together as one block). ──
  let linkJustActivated = false
  let scrollGestureDetected = false
  let scrollGestureTimer = 0
  const TERMINAL_LONG_PRESS_MS = 500
  const TERMINAL_MOUSE_REPLAY_MS = 500
  let terminalTouchOpenPending = false
  let terminalTouchOpenStartedAt = 0
  let terminalTouchMouseReplayUntil = 0
  let terminalTouchFocusBlockUntil = 0

  const keyboardVisible = computed({
    get: () => kbVisible.value && hasActiveTerminalLeaf.value,
    set: (v: boolean) => onBuiltinKeyboardVisibilityChange(v),
  })

  // ── Send functions (getSendFn is broadcast-mode aware, invariant §二 #6) ──
  function sendActiveData(data: string): Promise<void> {
    return Promise.resolve(getSendFn()?.(data) ?? undefined)
  }

  function getBroadcastSendFn(): SendDataFn | null {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    if (!tab || tab.type !== 'terminal') return null
    const leaves = getAllLeaves(tab.layout).filter((leaf) => paneKind(leaf) === 'terminal')
    if (!leaves.length) return null
    return createFrozenSendFn(
      leaves.map((leaf) => (d: string) => termRefs[leaf.paneId]?.sendData(d, true)),
      leaves.length > 1 ? () => tab.broadcastActivity++ : undefined
    )
  }

  function sendBroadcastData(data: string): Promise<void> {
    return Promise.resolve(getBroadcastSendFn()?.(data) ?? undefined)
  }

  function sendToPaneData(paneId: string, data: string): Promise<void> {
    return Promise.resolve(termRefs[paneId]?.sendData(data) ?? undefined)
  }

  function onKeyboardHostEvent(
    event: keyof KeyboardHostEventMap,
    data: KeyboardHostEventMap[keyof KeyboardHostEventMap]
  ) {
    switch (event) {
      case 'app-action': {
        const d = data as KeyboardHostEventMap['app-action']
        dispatchAppAction(d.id, d.options)
        break
      }
      case 'bookmarks':
        bookmarksRef.value?.open()
        break
      case 'dismiss':
        onKeyboardDismiss()
        break
      case 'typing-change': {
        const d = data as KeyboardHostEventMap['typing-change']
        kbTyping.value = d.focused
        break
      }
      case 'upload-status': {
        // Forwarded as the legacy window event so existing subscribers
        // (useUploadManagement) keep working.
        window.dispatchEvent(
          new CustomEvent('dinotty-upload-status', { detail: data as Record<string, unknown> })
        )
        break
      }
      case 'modifier-change': {
        const d = data as KeyboardHostEventMap['modifier-change']
        onSystemModifierChange(d.modifiers as MobileTerminalModifiers)
        break
      }
      case 'focus-xterm':
        focusSystemInput()
        break
      case 'paste-text': {
        const d = data as KeyboardHostEventMap['paste-text']
        pasteActiveTerminal(d.text)
        break
      }
      default:
        break
    }
  }

  const keyboardCtx = createKeyboardContext({
    visible: keyboardVisible,
    activePaneId: computed(() => activeTerminalLeaf.value?.paneId ?? null),
    sendActive: sendActiveData,
    sendBroadcast: sendBroadcastData,
    sendToPane: sendToPaneData,
    nativeImeOpen: terminalImeFocused,
    // System keyboard requests native IME state through the context; routing open
    // through requestTerminalKeyboard keeps the action-panel + visibility state
    // machine in sync (same semantics as the old toggle-ime host handler).
    setNativeImeOpen: (open: boolean) => (open ? requestTerminalKeyboard() : closeSystemIme()),
    onHostEvent: onKeyboardHostEvent,
  })

  // ── Keyboard reservation band (Phase 2: provider.desiredHeight -> --mkb-height) ──
  // One band owns --mkb-height at all times. In system mode the frozen toolbar is
  // host-rendered (no provider component), so the band measures it directly via
  // 'auto' instead of reading provider.desiredHeight; a second band instance
  // would race writes and zero out the builtin keyboard's reservation.
  useKeyboardBand({
    visible: computed(() =>
      effectiveMobileInputMode.value === 'system'
        ? systemToolbarVisible.value
        : keyboardVisible.value
    ),
    desiredHeight: computed(() =>
      effectiveMobileInputMode.value === 'system'
        ? ('auto' as const)
        : activeKeyboardProvider.value?.desiredHeight
    ),
    hostRef: computed(() =>
      effectiveMobileInputMode.value === 'system' ? systemToolbarRef.value : keyboardHostRef.value
    ),
  })

  const {
    isLandscape,
    systemKeyboardOpen,
    dispose: disposeViewport,
  } = useViewportResize({
    kbVisible,
    activePaneId,
    tabs,
    termRefs,
    terminalImeFocused,
    onSystemKeyboardClose: onSystemKeyboardClosed,
  })

  useOverlayKeyboardBroadcast({ systemKeyboardOpen, kbVisible })

  const isSingleTerminalTab = computed(() => {
    const tab = activeTab.value
    if (!tab || tab.type !== 'terminal') return false
    const leaves = getAllLeaves(tab.layout)
    return leaves.length === 1 && paneKind(leaves[0]) === 'terminal'
  })
  const keyboardOverlapLayoutEligible = computed(() =>
    effectiveMobileInputMode.value === 'system'
      ? hasActiveTerminalLeaf.value
      : isSingleTerminalTab.value
  )
  useKeyboardOverlap({
    settingPx: imeKeyboardOverlapPx,
    kbVisible,
    textInputFocused: computed(() =>
      effectiveMobileInputMode.value === 'builtin'
        ? kbTyping.value
        : terminalImeFocused.value && systemKeyboardOpen.value
    ),
    layoutEligible: keyboardOverlapLayoutEligible,
    hasVerticalPreview: computed(() => false),
  })

  // ── Keyboard state machine ──────────────────────────────────────
  function onSystemModifierChange(modifiers: MobileTerminalModifiers) {
    getActiveTerminalRef()?.setVirtualModifiers(modifiers)
  }

  function onSystemActionKeyboardChange(open: boolean) {
    systemActionKeyboardOpen.value = open
    if (open) {
      getActiveTerminalRef()?.blur()
      terminalImeFocused.value = false
    }
  }

  function dismissTerminalKeyboard(terminal = getActiveTerminalRef()) {
    systemActionKeyboardOpen.value = false
    kbVisible.value = false
    terminalImeFocused.value = false
    mobileInputGuideVisible.value = false
    terminal?.blur()

    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      (activeElement.classList.contains('xterm-helper-textarea') ||
        activeElement.closest('#mobile-kb, #system-mobile-kb'))
    ) {
      activeElement.blur()
    }
  }

  function closeSystemIme(terminal = getActiveTerminalRef()) {
    systemActionKeyboardOpen.value = false
    terminalImeFocused.value = false
    if (!persistentSystemToolbar.value) kbVisible.value = false
    terminal?.blur()
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      activeElement.classList.contains('xterm-helper-textarea')
    ) {
      activeElement.blur()
    }
  }

  function onSystemKeyboardClosed() {
    if (
      effectiveMobileInputMode.value !== 'system' ||
      !kbVisible.value ||
      systemActionKeyboardOpen.value
    )
      return
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      activeElement.classList.contains('xterm-helper-textarea')
    ) {
      closeSystemIme()
    }
  }

  function requestTerminalKeyboard() {
    if (!hasActiveTerminalLeaf.value) return
    if (isTouchDevice() && appSettings.mobile_input_mode == null) {
      kbVisible.value = false
      mobileInputGuideVisible.value = true
      return
    }

    mobileInputGuideVisible.value = false
    systemActionKeyboardOpen.value = false
    kbVisible.value = true
    if (effectiveMobileInputMode.value === 'system') focusSystemInput(true)
  }

  function toggleTerminalKeyboard() {
    if (kbVisible.value) dismissTerminalKeyboard()
    else requestTerminalKeyboard()
  }

  function onBuiltinKeyboardVisibilityChange(visible: boolean) {
    if (visible) requestTerminalKeyboard()
    else kbVisible.value = false
  }

  function onMobileInputGuideChoose(mode: MobileInputMode) {
    // This handler is reached synchronously from the card's click event. Keeping
    // focus in this stack is required for iOS Safari/PWA to open the software IME.
    appSettings.mobile_input_mode = mode
    void settingsStore.save()
    configureAllMobileInputTextareas(mode)
    mobileInputGuideVisible.value = false
    if (!hasActiveTerminalLeaf.value) {
      dismissTerminalKeyboard()
      return
    }
    systemActionKeyboardOpen.value = false
    kbVisible.value = true
    if (mode === 'system') focusSystemInput(true)
  }

  function onKeyboardDismiss() {
    const tab = activeTab.value
    if (tab?.type === 'terminal') {
      termRefs[tab.activePaneId]?.blur()
    }
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
  }

  // ── Sticky-typing / manual-open touch guards (C27) ──────────────
  function guardTerminalFocusEvent(e: Event) {
    const target = e.target as HTMLElement | null
    // Rejected touches can still synthesize a mousedown. Stop it before xterm's
    // bubble listener focuses the helper textarea; normal pointerdown is untouched.
    if (
      e.type === 'mousedown' &&
      isTouchDevice() &&
      effectiveMobileInputMode.value === 'system' &&
      !terminalImeFocused.value &&
      performance.now() < terminalTouchFocusBlockUntil &&
      target?.closest('.terminal-pane-container') &&
      !target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    // Manual-open protection belongs to the xterm helper textarea's
    // inputMode / virtualkeyboardpolicy. Cancelling terminal pointer defaults
    // here would also cancel the browser selection anchor.
    if (!isKbTypingLocked()) return
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    e.preventDefault()
  }

  function onTabContentMouseDownCapture(e: MouseEvent) {
    guardTerminalFocusEvent(e)
  }

  function onTabContentPointerDownCapture(e: PointerEvent) {
    guardTerminalFocusEvent(e)
  }

  function onAppMouseReplayCapture(e: MouseEvent) {
    if (performance.now() >= terminalTouchMouseReplayUntil) {
      terminalTouchMouseReplayUntil = 0
      return
    }
    const target = e.target as HTMLElement | null
    if (!target?.closest('#system-mobile-kb')) return
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'click') terminalTouchMouseReplayUntil = 0
  }

  function onAppTouchStartCapture(e: TouchEvent) {
    const target = e.target as HTMLElement | null
    if (target?.closest('#system-mobile-kb')) terminalTouchMouseReplayUntil = 0
  }

  function armTerminalTouchOpen(e: Event) {
    const target = e.target as HTMLElement | null
    if (
      isTouchDevice() &&
      effectiveMobileInputMode.value === 'system' &&
      !terminalImeFocused.value &&
      target?.closest('.terminal-pane-container') &&
      !target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      terminalTouchFocusBlockUntil = 0
      terminalTouchOpenPending = true
      terminalTouchOpenStartedAt = performance.now()
    }
  }

  function onTabContentTouchStartCapture(e: TouchEvent) {
    armTerminalTouchOpen(e)
  }

  function onTabContentTouchCancelCapture() {
    terminalTouchOpenPending = false
    terminalTouchFocusBlockUntil = performance.now() + TERMINAL_MOUSE_REPLAY_MS
  }

  function onTerminalTouch(e: TouchEvent) {
    if (!isTouchDevice()) return
    const openPending = terminalTouchOpenPending
    const endedAt = performance.now()
    const heldFor = endedAt - terminalTouchOpenStartedAt
    terminalTouchOpenPending = false
    const target = e.target as HTMLElement
    if (target.closest('.terminal-pane-container')) {
      if (effectiveMobileInputMode.value === 'system' && openPending)
        terminalTouchFocusBlockUntil = endedAt + TERMINAL_MOUSE_REPLAY_MS
      // Don't show keyboard when tapping a link (file path or URL)
      if (linkJustActivated) {
        linkJustActivated = false
        return
      }
      // Don't show keyboard when a scroll gesture was just detected
      if (scrollGestureDetected) {
        scrollGestureDetected = false
        if (kbVisible.value && !hasCollapseGuard(appSettings.keyboard_guard_mode))
          effectiveMobileInputMode.value === 'system' ? closeSystemIme() : (kbVisible.value = false)
        return
      }
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
      const term = paneId ? termRefs[paneId]?.getTerminal() : null
      if (term && term.touchMoved) {
        term.touchMoved = false
        if (kbVisible.value && !hasCollapseGuard(appSettings.keyboard_guard_mode))
          effectiveMobileInputMode.value === 'system' ? closeSystemIme() : (kbVisible.value = false)
        return
      }
      // An un-armed tap means the textarea was already focused when the gesture
      // started. While kbVisible is true that is a caret-repositioning tap and
      // must not toggle the toolbar; but a stale focus without kbVisible (e.g.
      // programmatic refocus after window focus never opens the iOS keyboard)
      // must fall through and re-open, or the system toolbar can never come
      // back. v0.22.0 opened unconditionally on tap.
      if (
        effectiveMobileInputMode.value === 'system' &&
        (heldFor >= TERMINAL_LONG_PRESS_MS || (!openPending && kbVisible.value))
      )
        return
      if (!hasOpenGuard(appSettings.keyboard_guard_mode)) {
        if (effectiveMobileInputMode.value === 'system') {
          terminalTouchFocusBlockUntil = 0
          terminalTouchMouseReplayUntil = endedAt + TERMINAL_MOUSE_REPLAY_MS
        }
        requestTerminalKeyboard()
      }
    }
  }

  function onLinkActivate() {
    if (effectiveMobileInputMode.value === 'system' && terminalTouchMouseReplayUntil > 0) {
      const withinReplayWindow = performance.now() < terminalTouchMouseReplayUntil
      terminalTouchMouseReplayUntil = 0
      if (withinReplayWindow) closeSystemIme()
      return
    }
    linkJustActivated = true
  }

  function onTerminalScroll() {
    scrollGestureDetected = true
    clearTimeout(scrollGestureTimer)
    scrollGestureTimer = window.setTimeout(() => {
      scrollGestureDetected = false
    }, 300)
    if (hasCollapseGuard(appSettings.keyboard_guard_mode)) return
    if (effectiveMobileInputMode.value === 'system') {
      closeSystemIme()
      return
    }
    if (kbVisible.value) kbVisible.value = false
  }

  // ── Document focus guard (C35) ──────────────────────────────────
  function onDocumentFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.classList.contains('xterm-helper-textarea')) {
      // Reject only a touch gesture already classified as scroll/long-press/cancelled.
      // Manual-open protection uses inputMode=none instead of blur so hardware input
      // keeps working while the touch software keyboard remains closed.
      if (
        isTouchDevice() &&
        effectiveMobileInputMode.value === 'system' &&
        (terminalTouchOpenPending || performance.now() < terminalTouchFocusBlockUntil) &&
        !terminalImeFocused.value
      ) {
        target.blur()
        return
      }
      if (
        isTouchDevice() &&
        effectiveMobileInputMode.value === 'system' &&
        hasOpenGuard(appSettings.keyboard_guard_mode) &&
        !terminalImeFocused.value
      )
        return
      terminalImeFocused.value = effectiveMobileInputMode.value === 'system'
      return
    }
    if (
      effectiveMobileInputMode.value === 'system' &&
      kbVisible.value &&
      target.matches('input, textarea, select, [contenteditable="true"]') &&
      !target.closest('#system-mobile-kb')
    ) {
      systemActionKeyboardOpen.value = false
      kbVisible.value = false
      terminalImeFocused.value = false
      getActiveTerminalRef()?.setVirtualModifiers(emptyMobileTerminalModifiers())
    }
  }

  // Sticky typing mode: the terminal must not be able to take focus while the user
  // is typing on the mobile keyboard, otherwise the iOS system keyboard closes.
  // Only under the collapse guard, so off/open_only stay upstream-equivalent.
  watch(
    [kbTyping, () => appSettings.keyboard_guard_mode],
    ([typing, mode]) => {
      setKbTypingLock(isTouchDevice() && typing && hasCollapseGuard(mode))
    },
    { immediate: true }
  )

  // Manual-open protection controls only the touch software IME. Keep xterm's
  // textarea focusable for hardware input, but expose inputMode=text only after
  // the explicit keyboard action authorizes it. Synchronous updates preserve the
  // browser user-gesture stack required to open mobile keyboards.
  watch(
    [terminalImeFocused, () => appSettings.keyboard_guard_mode],
    ([open]) => {
      setSystemImeAuthorized(open)
      if (effectiveMobileInputMode.value === 'system') configureAllMobileInputTextareas('system')
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    () => appSettings.mobile_input_mode,
    (mode, previousMode) => {
      applyAfterTerminalComposition(() => {
        configureAllMobileInputTextareas(mode)
        if (previousMode != null && previousMode !== mode && kbVisible.value) {
          dismissTerminalKeyboard()
        }
      })
    },
    { immediate: true, flush: 'sync' }
  )

  // Track effective active pane for Tauri WKWebView input guard
  function syncActivePaneId() {
    const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
    const paneId = tab?.type === 'terminal' ? tab.activePaneId : null
    setActivePaneId(paneId)
  }
  // Fire on tab switch (store activePaneId change) and initial load
  watch(activePaneId, syncActivePaneId, { immediate: true })
  // Fire when tab list changes (add/remove) — not deep, just array reference
  watch(() => tabs.value.length, syncActivePaneId)
  // Fire when active terminal tab's internal focus changes (sync WS, etc.)
  watch(
    [
      () => {
        const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
        return tab?.type === 'terminal' ? tab.activePaneId : null
      },
      hasActiveTerminalLeaf,
    ],
    ([paneId, isTerminalLeaf], [previousPaneId]) => {
      setActivePaneId(paneId)
      const previousTerminal = previousPaneId ? (termRefs[previousPaneId] ?? null) : null
      if (previousPaneId && previousPaneId !== paneId) {
        previousTerminal?.setVirtualModifiers(emptyMobileTerminalModifiers())
      }
      if (!isTerminalLeaf) {
        dismissTerminalKeyboard(previousTerminal)
        return
      }
      if (
        paneId &&
        effectiveMobileInputMode.value === 'system' &&
        kbVisible.value &&
        !systemActionKeyboardOpen.value
      ) {
        nextTick(focusSystemInput)
      }
    }
  )

  const onWindowFocus = () => {
    nextTick(() => focusActive())
  }

  return {
    keyboardVisible,
    keyboardCtx,
    systemKeyboardOpen,
    isLandscape,
    disposeViewport,
    dismissTerminalKeyboard,
    closeSystemIme,
    requestTerminalKeyboard,
    toggleTerminalKeyboard,
    onBuiltinKeyboardVisibilityChange,
    onSystemActionKeyboardChange,
    onMobileInputGuideChoose,
    onSystemModifierChange,
    onKeyboardDismiss,
    onTabContentMouseDownCapture,
    onTabContentPointerDownCapture,
    onAppMouseReplayCapture,
    onAppTouchStartCapture,
    onTabContentTouchStartCapture,
    onTabContentTouchCancelCapture,
    onTerminalTouch,
    onLinkActivate,
    onTerminalScroll,
    onDocumentFocusIn,
    onWindowFocus,
  }
}

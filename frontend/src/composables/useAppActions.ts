import { computed, type Ref } from 'vue'
import { getAllLeaves } from '../types/pane'
import type { useAppCore } from './useAppCore'
import type { Command } from '../components/command/CommandPalette.vue'
import { useKeybindings, keyEventMatchesBinding } from './useKeybindings'
import { useSuperviseTabs } from './useSuperviseTabs'
import { createHostClipboardPasteController } from '../utils/hostClipboardPaste'
import { readHostClipboard } from '../utils/clipboard'
import { resolveResponsiveToastPosition } from '../utils/toastPosition'
import { getTerminalSequenceAppAction, isDispatchableAppAction } from '../utils/appActionCatalog'
import { isWindowsClient } from '../utils/clientPlatform'
import { getEffectiveSuperviseReload } from './useDeviceSuperviseReload'
import type { AppActionOptions } from '../components/keyboard/mkbTypes'
import type { useToast } from 'vue-toastification'

export interface AppActionsOptions {
  core: ReturnType<typeof useAppCore>
  paletteRef: Ref<{ toggle(): void } | undefined>
  bookmarksRef: Ref<{ open(): void } | undefined>
  sshPanelRef: Ref<{ open(): void } | undefined>
  lastTabCloseShortcutAt: Ref<number>
  toast: ReturnType<typeof useToast>
}

export function useAppActions(options: AppActionsOptions) {
  const { core, paletteRef, bookmarksRef, sshPanelRef, lastTabCloseShortcutAt, toast } = options
  const {
    tabs,
    activePaneId,
    activeTab,
    appSettings,
    visibleTabList,
    newTab,
    splitPane,
    termRefs,
    requestCloseTab,
    activateTab,
    onClosePane,
    openOrFocusPreview,
    triggerAddCursors,
    adjustActiveTerminalFontSize,
    getSendFn,
    getActiveTerminalRef,
    canRestoreSystemInputFocus,
    systemActionKeyboardOpen,
    reloadApp,
    openOverview,
    templatePickerVisible,
    openSaveTemplateDialog,
    allCommands,
    loadedPlugins,
    pluginList,
    openPlugin,
    activeWorkspacePath,
    t,
  } = core
  const { getBinding, formatBinding } = useKeybindings()
  const { supervise } = useSuperviseTabs()

  const hostClipboardPaste = createHostClipboardPasteController({
    fetchText: async () => {
      const text = await readHostClipboard()
      if (text === null) throw new Error('clipboard unavailable')
      return text
    },
    paste: (text, autoEnter) => {
      getActiveTerminalRef()?.pasteFromClipboard(
        text,
        autoEnter,
        !systemActionKeyboardOpen.value && canRestoreSystemInputFocus()
      )
    },
    clipboardEmpty: () =>
      toast.info(t('mobileKb.clipboardEmpty'), { position: resolveResponsiveToastPosition() }),
    pasteFailed: () =>
      toast.error(t('mobileKb.pasteFailed'), { position: resolveResponsiveToastPosition() }),
    confirmMultiline: (lines) =>
      toast.info(t('mobileKb.confirmMultiline', { n: lines }), {
        position: resolveResponsiveToastPosition(),
      }),
  })

  const paletteCommands = computed<Command[]>(() => {
    const base: Command[] = [
      {
        icon: '＋',
        title: t('palette.newTab'),
        subtitle: t('palette.newTabDesc'),
        kbd: formatBinding(getBinding('newTab')),
        action: () => newTab(),
      },
      {
        icon: '✕',
        title: t('palette.closeTab'),
        subtitle: t('palette.closeTabDesc'),
        kbd: formatBinding(getBinding('closeTab')),
        action: async () => {
          if (activePaneId.value) {
            const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
            if (tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1) {
              await onClosePane(tab.paneId, tab.activePaneId)
            } else {
              await requestCloseTab(activePaneId.value)
            }
          }
        },
      },
      {
        icon: '⊞',
        title: t('palette.splitHorizontal'),
        subtitle: t('palette.splitHorizontalDesc'),
        kbd: formatBinding(getBinding('splitHorizontal')),
        action: () => splitPane.splitPane('horizontal'),
      },
      {
        icon: '⊟',
        title: t('palette.splitVertical'),
        subtitle: t('palette.splitVerticalDesc'),
        kbd: formatBinding(getBinding('splitVertical')),
        action: () => splitPane.splitPane('vertical'),
      },
      {
        icon: '★',
        title: t('palette.bookmarks'),
        subtitle: t('palette.bookmarksDesc'),
        kbd: formatBinding(getBinding('openBookmarks')),
        action: () => bookmarksRef.value?.open(),
      },
      {
        icon: '⊡',
        title: t('palette.openFilePreview'),
        subtitle: t('palette.openFilePreviewDesc'),
        action: () => openOrFocusPreview('files'),
      },
      {
        icon: '⊙',
        title: t('palette.openWebPreview'),
        subtitle: t('palette.openWebPreviewDesc'),
        action: () => openOrFocusPreview('web'),
      },
      {
        icon: '⠿',
        title: t('palette.addCursors'),
        subtitle: t('palette.addCursorsDesc'),
        kbd: formatBinding(getBinding('addCursorsInFiles')),
        action: () => triggerAddCursors(),
      },
      {
        icon: '⇄',
        title: t('palette.sshConnect'),
        subtitle: t('palette.sshConnectDesc'),
        action: () => sshPanelRef.value?.open(),
      },
      // Only show "New Local Terminal" when active tab is an SSH session
      ...(activeTab.value?.type === 'terminal' && activeTab.value.connectionId
        ? [
            {
              icon: '⌂',
              title: t('palette.newLocalTerminal'),
              subtitle: t('palette.newLocalTerminalDesc'),
              action: () => splitPane.splitPane('horizontal', true, activeWorkspacePath.value),
            },
          ]
        : []),
      // Only show "Save as Template" when active tab is a terminal tab with a layout
      ...(activeTab.value?.type === 'terminal'
        ? [
            {
              icon: '⎘',
              title: t('palette.saveAsTemplate'),
              subtitle: t('palette.saveAsTemplateDesc'),
              action: () => openSaveTemplateDialog(activeTab.value!.paneId),
            },
          ]
        : []),
      {
        icon: '⊷',
        title: t('palette.applyTemplate'),
        subtitle: t('palette.applyTemplateDesc'),
        kbd: formatBinding(getBinding('applyTemplate')),
        action: () => {
          templatePickerVisible.value = true
        },
      },
    ]

    // Plugin-registered commands
    for (const cmd of allCommands.value) {
      const plugin = loadedPlugins.get(cmd.pluginId)
      // Look up title from manifest commands list
      const cmdDef = plugin?.manifest.commands?.find((c) => c.id === cmd.id)
      base.push({
        icon: '◈',
        title: cmdDef?.title || cmd.id,
        subtitle: plugin?.manifest.name,
        action: () => {
          openPlugin(cmd.pluginId)
          cmd.handler()
        },
      })
    }

    // Plugin open commands (skip if plugin already registered its own commands)
    const pluginsWithCommands = new Set(allCommands.value.map((c) => c.pluginId))
    for (const p of pluginList.value) {
      if (p.state === 'active' && !pluginsWithCommands.has(p.id)) {
        base.push({
          icon: '◈',
          title: t('palette.openPlugin', { name: p.name }),
          subtitle: t('palette.openPluginDesc'),
          action: () => openPlugin(p.id),
        })
      }
    }

    return base
  })

  const keyActions: Record<string, (options?: AppActionOptions) => void> = {
    togglePalette: () => paletteRef.value?.toggle(),
    openBookmarks: () => bookmarksRef.value?.open(),
    newTab: () => newTab(),
    applyTemplate: () => {
      templatePickerVisible.value = true
    },
    closeTab: async () => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (tab?.type === 'terminal' && getAllLeaves(tab.layout).length > 1) {
        // Multi-pane: route through confirmation gate (consistent with X button)
        await onClosePane(tab.paneId, tab.activePaneId)
      } else {
        await requestCloseTab(activePaneId.value)
      }
    },
    splitHorizontal: () => splitPane.splitPane('horizontal'),
    splitVertical: () => splitPane.splitPane('vertical'),
    toggleBroadcast: () => splitPane.toggleBroadcast(),
    toggleZoom: () => splitPane.toggleZoom(),
    equalizePanes: () => splitPane.equalizePanes(),
    focusNextPane: () => splitPane.focusNext(),
    focusPrevPane: () => splitPane.focusPrev(),
    searchTerminal: () => {
      if (!activePaneId.value) return
      const tab = tabs.value.find((t) => t.paneId === activePaneId.value)
      if (!tab || tab.type !== 'terminal') return
      termRefs[tab.activePaneId]?.toggleSearch()
    },
    pasteTerminal: (options) => void hostClipboardPaste.trigger(options?.autoEnter ?? true),
    missionControl: () => openOverview(),
    superviseTabs: () =>
      void supervise((id) => activateTab(id, { defer: true }))
        .then((activated) => {
          if (activated && getEffectiveSuperviseReload()) reloadApp()
        })
        .catch(console.error),
    sshConnect: () => sshPanelRef.value?.open(),
    fontSizeUp: () => adjustActiveTerminalFontSize(1),
    fontSizeDown: () => adjustActiveTerminalFontSize(-1),
    reloadApp: () => reloadApp(),
    fontSizeReset: () => adjustActiveTerminalFontSize(0),
    addCursorsInFiles: () => triggerAddCursors(),
  }

  function dispatchAppAction(id: string, options?: AppActionOptions) {
    if (!isDispatchableAppAction(id)) return
    const terminalAction = getTerminalSequenceAppAction(id)
    if (terminalAction) {
      getSendFn()?.(terminalAction.sequence)
      return
    }
    if (id === 'closeTab') lastTabCloseShortcutAt.value = Date.now()
    keyActions[id]?.(options)
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const cmd = e.metaKey || e.ctrlKey
    const altAsCmd = appSettings.windowsAltAsCmd && isWindowsClient
    // On Windows, Ctrl+Alt is AltGr (a layout-character modifier), never an app command —
    // exclude it regardless of Alt-as-Cmd so AltGr keeps producing its character. macOS
    // (isWindowsClient=false) is unaffected.
    const appCmd = (cmd || (altAsCmd && e.altKey)) && !(isWindowsClient && e.ctrlKey && e.altKey)
    if (!appCmd) return

    for (const [id, action] of Object.entries(keyActions)) {
      const binding = getBinding(id)
      if (keyEventMatchesBinding(e, binding)) {
        e.preventDefault()
        if (id === 'closeTab') {
          lastTabCloseShortcutAt.value = Date.now()
        }
        action()
        return
      }
    }

    // Cmd+Option+Arrow: focus neighbor pane (spatial navigation)
    if (cmd && e.altKey && !e.shiftKey) {
      const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      if (dirMap[e.key]) {
        e.preventDefault()
        splitPane.focusNeighbor(dirMap[e.key])
        return
      }
    }

    // Cmd+Option+Shift+Arrow: keyboard resize
    if (cmd && e.altKey && e.shiftKey) {
      const dirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      if (dirMap[e.key]) {
        e.preventDefault()
        splitPane.keyboardResize(dirMap[e.key])
        return
      }
    }

    if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1
      if (idx < visibleTabList.value.length) {
        e.preventDefault()
        activateTab(visibleTabList.value[idx].paneId)
      }
    }
  }

  return {
    hostClipboardPaste,
    paletteCommands,
    keyActions,
    dispatchAppAction,
    onGlobalKeydown,
  }
}

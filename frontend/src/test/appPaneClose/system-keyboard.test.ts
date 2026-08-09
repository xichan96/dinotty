import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  mountWithTabs,
  mocks,
  SplitContainerStub,
  MobileKeyboardStub,
  SystemKeyboardToolbarStub,
  KbToggleButtonStub,
} from './_setup'
import { settings } from '../../composables/useSettings'
import { useUiStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { Tab } from '../../types/pane'

describe('App.vue - system keyboard dismissal', () => {
  it('runs the real dismiss button chain in textarea, active-terminal, active-element order', async () => {
    const wrapper = await mountWithTabs({ realKeyboard: true })
    const order: string[] = []
    const fallbackInput = document.createElement('input')
    document.body.appendChild(fallbackInput)
    const nativeFallbackBlur = fallbackInput.blur.bind(fallbackInput)
    vi.spyOn(fallbackInput, 'blur').mockImplementation(() => {
      order.push('activeElement')
      nativeFallbackBlur()
    })

    const activeTerminal = {
      sendData: vi.fn(),
      setOutputListener: vi.fn(),
      blur: vi.fn(() => {
        order.push('terminalRef')
        fallbackInput.focus()
      }),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)

    const textarea = wrapper.find<HTMLTextAreaElement>('.mkb-text-input').element
    textarea.focus()
    await nextTick()
    const nativeTextareaBlur = textarea.blur.bind(textarea)
    vi.spyOn(textarea, 'blur').mockImplementation(() => {
      order.push('textarea')
      nativeTextareaBlur()
    })

    const dismissButton = wrapper.find('.mkb-dismiss-btn')
    expect(dismissButton.attributes('title')).toBe('mobileKb.dismissKeyboard')
    expect(dismissButton.attributes('aria-label')).toBe('mobileKb.dismissKeyboard')
    await dismissButton.trigger('mousedown')

    expect(order).toEqual(['textarea', 'terminalRef', 'activeElement'])
    expect(activeTerminal.blur).toHaveBeenCalledOnce()
    fallbackInput.remove()
  })

  it('blurs the active element when the MobileKeyboard stub emits dismiss', async () => {
    const wrapper = await mountWithTabs()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const blur = vi.spyOn(input, 'blur')

    await wrapper.findComponent(MobileKeyboardStub).vm.$emit('dismiss')

    expect(blur).toHaveBeenCalledOnce()
    input.remove()
  })

  it('does not throw for a non-terminal active tab and blurs from the real dismiss button', async () => {
    const wrapper = await mountWithTabs({ realKeyboard: true })
    const session = useSessionStore()
    session.setTabs([
      { type: 'plugin', paneId: 'plugin:memory', title: 'Memory', pluginId: 'memory' },
    ])
    session.setActivePane('plugin:memory')
    await nextTick()

    const textarea = wrapper.find<HTMLTextAreaElement>('.mkb-text-input').element
    textarea.focus()
    await nextTick()
    const blur = vi.spyOn(textarea, 'blur')

    await expect(wrapper.find('.mkb-dismiss-btn').trigger('mousedown')).resolves.toBeUndefined()
    expect(blur).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(textarea)
  })
})

describe('App.vue - system keyboard state regressions', () => {
  it('dismisses the toolbar when VisualViewport reports a native keyboard close', async () => {
    settings.mobile_input_mode = 'system'
    const wrapper = await mountWithTabs()
    const ui = useUiStore()
    const activeTerminal = {
      setOutputListener: vi.fn(),
      blur: vi.fn(),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)
    ui.kbVisible = true
    await nextTick()

    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()

    mocks.onSystemKeyboardClose?.()
    await nextTick()

    expect(ui.kbVisible).toBe(false)
    expect(activeTerminal.blur).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(textarea)
    expect(wrapper.findComponent(SystemKeyboardToolbarStub).props('visible')).toBe(false)
    textarea.remove()
  })

  it('pastes without refocusing xterm while the full action panel remains open', async () => {
    settings.mobile_input_mode = 'system'
    const wrapper = await mountWithTabs()
    const ui = useUiStore()
    const activeTerminal = {
      setOutputListener: vi.fn(),
      blur: vi.fn(),
      pasteFromClipboard: vi.fn(),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)
    ui.kbVisible = true
    await nextTick()

    const toolbar = wrapper.findComponent(SystemKeyboardToolbarStub)
    await toolbar.vm.$emit('update:actionOpen', true)
    mocks.authFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'echo from panel' }),
    })

    await toolbar.vm.$emit('app-action', 'pasteTerminal', { autoEnter: false })
    await vi.waitFor(() => {
      expect(activeTerminal.pasteFromClipboard).toHaveBeenCalledWith(
        'echo from panel',
        false,
        false
      )
    })

    expect(activeTerminal.blur).toHaveBeenCalledOnce()
    expect(toolbar.props('actionOpen')).toBe(true)
  })

  it.each(['plugin', 'files', 'web'] as const)(
    'dismisses terminal input state when the active leaf changes to %s',
    async (kind) => {
      settings.mobile_input_mode = 'system'
      const wrapper = await mountWithTabs()
      const session = useSessionStore()
      const ui = useUiStore()
      const nonTerminalPaneId = `${kind}-leaf`
      const mixedTab: Tab = {
        type: 'terminal',
        paneId: 'mixed-tab',
        activePaneId: 'terminal-leaf',
        paneMru: ['terminal-leaf', nonTerminalPaneId],
        broadcastMode: false,
        broadcastActivity: 0,
        layout: {
          type: 'split',
          id: 'mixed-root',
          direction: 'horizontal',
          ratios: [0.5, 0.5],
          children: [
            {
              type: 'leaf',
              kind: 'terminal',
              paneId: 'terminal-leaf',
              title: 'Terminal',
              ratio: 0.5,
              zoomed: false,
            },
            {
              type: 'leaf',
              kind,
              paneId: nonTerminalPaneId,
              title: kind,
              ratio: 0.5,
              zoomed: false,
            },
          ],
        },
      }
      session.setTabs([mixedTab])
      session.setActivePane(mixedTab.paneId)
      await nextTick()

      const terminal = {
        setOutputListener: vi.fn(),
        setVirtualModifiers: vi.fn(),
        blur: vi.fn(),
      }
      await wrapper
        .findComponent(SplitContainerStub)
        .vm.$emit('register', 'terminal-leaf', terminal)
      ui.kbVisible = true
      const toolbar = wrapper.findComponent(SystemKeyboardToolbarStub)
      await toolbar.vm.$emit('update:actionOpen', true)
      terminal.blur.mockClear()

      const reactiveMixedTab = session.tabs[0]
      if (reactiveMixedTab.type !== 'terminal') throw new Error('expected terminal tab')
      reactiveMixedTab.activePaneId = nonTerminalPaneId
      await nextTick()

      expect(ui.kbVisible).toBe(false)
      expect(toolbar.props('visible')).toBe(false)
      expect(toolbar.props('actionOpen')).toBe(false)
      expect(toolbar.props('paneId')).toBe('')
      expect(toolbar.props('getSendFn')()).toBeNull()
      expect(terminal.setVirtualModifiers).toHaveBeenCalledWith(false, false)
      expect(terminal.blur).toHaveBeenCalledOnce()

      await wrapper.findComponent(KbToggleButtonStub).vm.$emit('toggle')
      expect(ui.kbVisible).toBe(false)
    }
  )
})

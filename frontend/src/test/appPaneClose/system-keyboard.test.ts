import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { useIsMobile } from '../../composables/useIsMobile'
import type { Tab } from '../../types/pane'

afterEach(() => {
  settings.system_toolbar_mode = 'follow_ime'
  settings.keyboard_guard_mode = 'off'
  useIsMobile().isMobile.value = false
})

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
  async function mountUnguardedTouchTerminal() {
    mocks.touchDevice = true
    settings.mobile_input_mode = 'system'
    settings.system_toolbar_mode = 'persistent_mobile'
    settings.keyboard_guard_mode = 'off'
    useIsMobile().isMobile.value = true
    const wrapper = await mountWithTabs()
    const activeTerminal = {
      setOutputListener: vi.fn(),
      setVirtualModifiers: vi.fn(),
      getTerminal: vi.fn(() => ({ touchMoved: false })),
      focus: vi.fn(),
      blur: vi.fn(),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)
    const terminalSurface = document.createElement('div')
    terminalSurface.className = 'terminal-pane-container'
    const helper = document.createElement('textarea')
    helper.className = 'xterm-helper-textarea'
    document.body.appendChild(helper)
    wrapper.get('#tab-content').element.appendChild(terminalSurface)
    return { wrapper, activeTerminal, terminalSurface, helper }
  }

  it('guards manual-open focus only on touch input', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.vue'), 'utf8')
    const guard = source.match(
      /if \(\s*(isTouchDevice\(\) &&[\s\S]*?effectiveMobileInputMode\.value === 'system' &&[\s\S]*?hasOpenGuard\(appSettings\.keyboard_guard_mode\)[\s\S]*?target\?\.closest\('\.terminal-pane-container'\)[\s\S]*?)\s*\) \{\s*e\.preventDefault\(\)/
    )

    expect(guard).not.toBeNull()
    expect(guard?.[1].trimStart().startsWith('isTouchDevice() &&')).toBe(true)
  })

  it('keeps the toolbar visible after IME close only in persistent phone mode', async () => {
    settings.mobile_input_mode = 'system'
    settings.system_toolbar_mode = 'persistent_mobile'
    useIsMobile().isMobile.value = true
    const wrapper = await mountWithTabs()
    const ui = useUiStore()
    ui.kbVisible = true
    await nextTick()

    mocks.onSystemKeyboardClose?.()
    await nextTick()

    const toolbar = wrapper.findComponent(SystemKeyboardToolbarStub)
    expect(toolbar.props('visible')).toBe(true)
    expect(toolbar.props('imeOpen')).toBe(false)
  })

  it('uses the fixed toolbar control to close and reopen the phone IME', async () => {
    settings.mobile_input_mode = 'system'
    settings.system_toolbar_mode = 'persistent_mobile'
    useIsMobile().isMobile.value = true
    const wrapper = await mountWithTabs()
    const activeTerminal = {
      setOutputListener: vi.fn(),
      setVirtualModifiers: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
    }
    await wrapper.findComponent(SplitContainerStub).vm.$emit('register', 'pane-1', activeTerminal)
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()
    await nextTick()

    const toolbar = wrapper.findComponent(SystemKeyboardToolbarStub)
    await toolbar.vm.$emit('toggle-ime')
    expect(toolbar.props('visible')).toBe(true)
    expect(toolbar.props('imeOpen')).toBe(false)
    expect(activeTerminal.blur).toHaveBeenCalledOnce()

    await toolbar.vm.$emit('toggle-ime')
    expect(activeTerminal.focus).toHaveBeenCalledOnce()
    expect(toolbar.props('imeOpen')).toBe(true)
    textarea.remove()
  })

  it('serializes an unguarded terminal touch until touchend', async () => {
    const { wrapper, activeTerminal, terminalSurface, helper } =
      await mountUnguardedTouchTerminal()

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    helper.focus()
    await nextTick()
    expect(document.activeElement).not.toBe(helper)
    expect(activeTerminal.focus).not.toHaveBeenCalled()

    const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true })
    terminalSurface.dispatchEvent(touchEnd)
    await nextTick()
    expect(touchEnd.defaultPrevented).toBe(false)
    expect(activeTerminal.focus).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(SystemKeyboardToolbarStub).props('imeOpen')).toBe(true)
    helper.remove()
  })

  it('keeps rejected terminal gestures from opening the system IME', async () => {
    const { wrapper, activeTerminal, terminalSurface, helper } =
      await mountUnguardedTouchTerminal()

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    helper.focus()
    document.dispatchEvent(new Event('terminal-scroll'))
    terminalSurface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(activeTerminal.focus).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(helper)
    expect(wrapper.findComponent(SystemKeyboardToolbarStub).props('imeOpen')).toBe(false)

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    terminalSurface.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true }))
    await nextTick()
    expect(activeTerminal.focus).not.toHaveBeenCalled()
    expect(wrapper.findComponent(SystemKeyboardToolbarStub).props('imeOpen')).toBe(false)
    helper.remove()
  })

  it('blocks only the compatibility mousedown after a long press', async () => {
    const { wrapper, activeTerminal, terminalSurface, helper } =
      await mountUnguardedTouchTerminal()
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    now.mockReturnValue(600)
    terminalSurface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(activeTerminal.focus).not.toHaveBeenCalled()

    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    terminalSurface.dispatchEvent(pointerDown)
    expect(pointerDown.defaultPrevented).toBe(false)

    const xtermFocus = vi.fn(() => helper.focus())
    terminalSurface.addEventListener('mousedown', xtermFocus)
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    terminalSurface.dispatchEvent(mouseDown)
    await nextTick()
    expect(xtermFocus).not.toHaveBeenCalled()
    expect(mouseDown.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(helper)
    expect(wrapper.findComponent(SystemKeyboardToolbarStub).props('imeOpen')).toBe(false)
    helper.remove()
  })

  it('blocks mouse replay only on the newly shown toolbar', async () => {
    const { wrapper, terminalSurface, helper } = await mountUnguardedTouchTerminal()
    const toolbar = document.createElement('div')
    toolbar.id = 'system-mobile-kb'
    const toolbarButton = document.createElement('button')
    toolbar.appendChild(toolbarButton)
    wrapper.get('#app-root').element.appendChild(toolbar)
    const onClick = vi.fn()
    toolbarButton.addEventListener('click', onClick)

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    terminalSurface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }))
    await nextTick()

    const replay = new MouseEvent('click', { bubbles: true, cancelable: true })
    toolbarButton.dispatchEvent(replay)
    expect(replay.defaultPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    terminalSurface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }))
    toolbarButton.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    const realFollowUp = new MouseEvent('click', { bubbles: true, cancelable: true })
    toolbarButton.dispatchEvent(realFollowUp)
    expect(realFollowUp.defaultPrevented).toBe(false)
    expect(onClick).toHaveBeenCalledOnce()
    helper.remove()
  })

  it('does not open the system IME after terminal link activation', async () => {
    const { wrapper, activeTerminal, terminalSurface, helper } =
      await mountUnguardedTouchTerminal()

    terminalSurface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    await wrapper.findComponent(SplitContainerStub).vm.$emit('link-activate')
    const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true })
    terminalSurface.dispatchEvent(touchEnd)
    await nextTick()
    expect(activeTerminal.focus).not.toHaveBeenCalled()
    expect(touchEnd.defaultPrevented).toBe(false)
    helper.remove()
  })

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
      expect(terminal.setVirtualModifiers).toHaveBeenCalledWith({
        ctrl: 'off',
        shift: 'off',
        alt: 'off',
        meta: 'off',
      })
      expect(terminal.blur).toHaveBeenCalledOnce()

      await wrapper.findComponent(KbToggleButtonStub).vm.$emit('toggle')
      expect(ui.kbVisible).toBe(false)
    }
  )
})

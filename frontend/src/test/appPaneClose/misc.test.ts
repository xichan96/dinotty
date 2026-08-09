import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountWithTabs, SplitContainerStub, MobileKeyboardStub } from './_setup'

describe('App.vue - terminal-sequence app actions', () => {
  it('sends each exact sequence through the active terminal input path and no-ops unknown ids', async () => {
    const wrapper = await mountWithTabs()
    const activeTerminal = { sendData: vi.fn(), setOutputListener: vi.fn() }
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    await splitContainer.vm.$emit('register', 'pane-1', activeTerminal)

    const keyboard = wrapper.findComponent(MobileKeyboardStub)
    const cases = [
      ['term.newline', '\x1b\r'],
      ['term.lineStart', '\x01'],
      ['term.lineEnd', '\x05'],
      ['term.deleteToLineStart', '\x15'],
    ] as const

    for (const [id, sequence] of cases) {
      await keyboard.vm.$emit('app-action', id, {})
      expect(activeTerminal.sendData).toHaveBeenLastCalledWith(sequence)
    }
    expect(activeTerminal.sendData).toHaveBeenCalledTimes(cases.length)

    await keyboard.vm.$emit('app-action', 'unknown-action', { autoEnter: true })
    expect(activeTerminal.sendData).toHaveBeenCalledTimes(cases.length)
  })
})


describe('App.vue - records terminal shell type', () => {
  it('writes shell info into the matching leaf pane', async () => {
    // 步骤1：挂载包含两个本地终端 Pane 的应用。
    const wrapper = await mountWithTabs()
    const splitContainer = wrapper.findComponent(SplitContainerStub)
    const layout = splitContainer.props('layout') as {
      children: Array<{ paneId: string; shell_type?: string }>
    }

    // 步骤2：模拟 PowerShell 终端上报 shell 类型。
    await splitContainer.vm.$emit('shell-info', 'pane-1', 'powershell')
    await nextTick()

    // 步骤3：应用状态应记录该类型，供“运行代码”选择正确解释器。
    expect(layout.children[0].shell_type).toBe('powershell')
  })
})

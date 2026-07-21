import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import SplitContainer from '../components/split/SplitContainer.vue'

const TerminalPaneStub = defineComponent({
  name: 'TerminalPane',
  emits: ['shellInfo'],
  setup() {
    return function renderTerminalPane() {
      return h('div', { class: 'terminal-pane-stub' })
    }
  },
})

describe('SplitContainer shell info', function splitContainerShellInfoSuite() {
  it('forwards the leaf shell type with its pane id', async function forwardsShellInfo() {
    // 步骤1：挂载一个最小叶子终端，并替换真实终端实现。
    const wrapper = mount(SplitContainer, {
      props: {
        layout: {
          type: 'leaf',
          paneId: 'pane-1',
          title: 'Terminal',
          ratio: 1,
          zoomed: false,
        },
        activePaneId: 'pane-1',
        broadcastMode: false,
        broadcastActivity: 0,
        tabId: 'tab-1',
      },
      global: {
        stubs: {
          TerminalPane: TerminalPaneStub,
        },
      },
    })

    // 步骤2：模拟底层终端识别出 PowerShell。
    const terminalPane = wrapper.findComponent(TerminalPaneStub)
    await terminalPane.vm.$emit('shellInfo', 'powershell')

    // 步骤3：容器应补充 pane id 后向上转发。
    expect(wrapper.emitted('shellInfo')).toEqual([['pane-1', 'powershell']])
    wrapper.unmount()
  })
})

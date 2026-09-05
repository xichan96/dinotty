import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { LeafPane } from '../types/pane'
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

/** Captures the props PaneContent would receive, so we can assert workspaceId
 *  reaches every leaf pane (incl. nested split leaves). */
const PaneContentCapture = defineComponent({
  name: 'PaneContentCapture',
  props: {
    leaf: { type: Object, required: true },
    isVisible: { type: Boolean, default: false },
    isFocused: { type: Boolean, default: false },
    workspaceId: { type: String, default: undefined },
  },
  setup() {
    return () => h('div', { class: 'pane-content-capture' })
  },
})

describe('SplitContainer shell info', function splitContainerShellInfoSuite() {
  it.each(['horizontal', 'vertical'] as const)(
    'anchors both %s split close controls to their pane headers',
    async function rendersCloseIcons(direction) {
      const wrapper = mount(SplitContainer, {
        props: {
          layout: {
            type: 'split',
            id: 'split-1',
            direction,
            ratios: [0.5, 0.5],
            children: [
              {
                type: 'leaf',
                paneId: 'pane-1',
                title: 'Terminal 1',
                ratio: 0.5,
                zoomed: false,
              },
              {
                type: 'leaf',
                paneId: 'pane-2',
                title: 'Terminal 2',
                ratio: 0.5,
                zoomed: false,
              },
            ],
          },
          activePaneId: 'pane-1',
          broadcastMode: false,
          broadcastActivity: 0,
          showHeader: true,
          allowClose: true,
          tabId: 'tab-1',
        },
        global: {
          stubs: {
            TerminalPane: TerminalPaneStub,
          },
        },
      })

      const leaves = wrapper.findAll('.split-leaf')
      expect(leaves).toHaveLength(2)
      for (const leaf of leaves) {
        const header = leaf.get('.pane-header')
        const closeButton = header.get('.pane-close-btn')
        expect(header.classes()).toContain(`direction-${direction}`)
        expect(closeButton.find('svg').exists()).toBe(true)
        expect(closeButton.text()).toBe('')
      }

      await leaves[0].get('.pane-close-btn').trigger('click')
      await leaves[1].get('.pane-close-btn').trigger('click')
      expect(wrapper.emitted('close')).toEqual([['pane-1'], ['pane-2']])
      wrapper.unmount()
    }
  )

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

describe('SplitContainer workspaceId pass-through', () => {
  const pluginLeaf: LeafPane = {
    type: 'leaf',
    paneId: 'pane-plugin',
    kind: 'plugin',
    pluginId: 'demo',
    title: 'Demo',
    ratio: 1,
    zoomed: false,
  }

  it('forwards the tab workspaceId to a plugin pane leaf', () => {
    const wrapper = mount(SplitContainer, {
      props: {
        layout: pluginLeaf,
        activePaneId: 'pane-plugin',
        broadcastMode: false,
        broadcastActivity: 0,
        showHeader: true,
        tabId: 'tab-1',
        workspaceId: 'ws-abc',
      },
      global: { stubs: { PaneContent: PaneContentCapture } },
    })
    expect(wrapper.findComponent(PaneContentCapture).props('workspaceId')).toBe('ws-abc')
    wrapper.unmount()
  })

  it('threads the workspaceId down to panes nested inside a split', () => {
    const wrapper = mount(SplitContainer, {
      props: {
        layout: {
          type: 'split',
          id: 'split-1',
          direction: 'horizontal',
          ratios: [0.5, 0.5],
          children: [
            {
              type: 'leaf',
              paneId: 'pane-term',
              title: 'Terminal 1',
              ratio: 0.5,
              zoomed: false,
            },
            pluginLeaf,
          ],
        },
        activePaneId: 'pane-term',
        broadcastMode: false,
        broadcastActivity: 0,
        showHeader: true,
        tabId: 'tab-1',
        workspaceId: 'ws-abc',
      },
      global: { stubs: { PaneContent: PaneContentCapture } },
    })
    const captures = wrapper.findAllComponents(PaneContentCapture)
    expect(captures).toHaveLength(2)
    for (const capture of captures) {
      expect(capture.props('workspaceId')).toBe('ws-abc')
    }
    wrapper.unmount()
  })
})

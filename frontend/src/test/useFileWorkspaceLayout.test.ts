import { beforeEach, describe, expect, it } from 'vitest'
import { useFileWorkspaceLayout } from '../composables/useFileWorkspaceLayout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function bodyOfWidth(width: number): HTMLElement {
  return { getBoundingClientRect: () => ({ width }) } as unknown as HTMLElement
}

describe('useFileWorkspaceLayout', () => {
  beforeEach(() => {
    localStorage.removeItem('dinotty_tree_pane_width')
  })

  it('keeps a CSS-owned width out of the narrow drawer', () => {
    // 步骤1：窄屏下树宽由 CSS 的 drawer 规则控制，内联宽度会让过渡失效。
    setViewport(390, 844)
    const layout = useFileWorkspaceLayout()

    expect(layout.narrow.value).toBe(true)
    expect(layout.treeWrapStyle.value).toEqual({})
  })

  it('returns the persisted pane width on desktop', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()

    expect(layout.narrow.value).toBe(false)
    expect(layout.treeWrapStyle.value).toEqual({ width: `${layout.treePaneWidth.value}px` })
  })

  it('toggles and closes the drawer only while narrow', () => {
    setViewport(390, 844)
    const layout = useFileWorkspaceLayout()
    expect(layout.drawerOpen.value).toBe(true)

    layout.toggleDrawer()
    expect(layout.drawerOpen.value).toBe(false)
    layout.openDrawer()
    expect(layout.drawerOpen.value).toBe(true)
    layout.closeDrawer()
    expect(layout.drawerOpen.value).toBe(false)

    // 步骤2：桌面宽度下抽屉 API 不改变状态。
    setViewport(1280, 900)
    layout.onResize()
    layout.toggleDrawer()
    layout.openDrawer()
    expect(layout.drawerOpen.value).toBe(false)
  })

  it('clamps the pane width to the body and viewport cap', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()
    layout.treePaneWidth.value = 600

    layout.clampTreePaneWidth(bodyOfWidth(300))
    expect(layout.treePaneWidth.value).toBeCloseTo(234)

    layout.treePaneWidth.value = 700
    layout.clampTreePaneWidth(bodyOfWidth(2000))
    expect(layout.treePaneWidth.value).toBe(560)
  })

  it('re-reads the viewport on resize', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()
    expect(layout.narrow.value).toBe(false)

    setViewport(390, 844)
    layout.onResize()
    expect(layout.narrow.value).toBe(true)
  })
})

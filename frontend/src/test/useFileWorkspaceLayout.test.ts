import { beforeEach, describe, expect, it } from 'vitest'
import { useFileWorkspaceLayout } from '../composables/useFileWorkspaceLayout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function bodyOfWidth(width: number): HTMLElement {
  return { getBoundingClientRect: () => ({ width }) } as unknown as HTMLElement
}

function wrapOfWidth(width: number): HTMLElement {
  return bodyOfWidth(width)
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

  it('auto-fits on desktop until the splitter is dragged', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()

    expect(layout.narrow.value).toBe(false)
    expect(layout.treeWidthMode.value).toBe('auto')
    expect(layout.treeWrapStyle.value).toMatchObject({
      width: 'max-content',
      minWidth: '180px',
      maxWidth: 'min(78%, 420px)',
    })
  })

  it('uses a persisted width as a manual override', () => {
    localStorage.setItem('dinotty_tree_pane_width', '320')
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()

    expect(layout.treeWidthMode.value).toBe('manual')
    expect(layout.treeWrapStyle.value).toEqual({ width: '320px' })
  })

  it('takes over at the rendered width when dragging from auto mode', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()

    // 步骤1：拖动起点沿用当前渲染宽度，避免点击时面板跳变。
    layout.startTreeWidthDrag({ clientX: 200 } as MouseEvent, bodyOfWidth(1000), wrapOfWidth(250))
    expect(layout.treeWidthMode.value).toBe('manual')
    expect(layout.treePaneWidth.value).toBe(250)

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 280 }))
    expect(layout.treePaneWidth.value).toBe(330)

    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(localStorage.getItem('dinotty_tree_pane_width')).toBe('330')
  })

  it('keeps auto mode when the splitter is clicked without dragging', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()

    layout.startTreeWidthDrag({ clientX: 200 } as MouseEvent, bodyOfWidth(1000), wrapOfWidth(250))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(layout.treeWidthMode.value).toBe('auto')
    expect(localStorage.getItem('dinotty_tree_pane_width')).toBeNull()
  })

  it('returns to auto-fit when the splitter is double-clicked', () => {
    localStorage.setItem('dinotty_tree_pane_width', '320')
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()
    expect(layout.treeWidthMode.value).toBe('manual')

    layout.resetTreeWidthToAuto()
    expect(layout.treeWidthMode.value).toBe('auto')
    expect(layout.treeWrapStyle.value.width).toBe('max-content')
    expect(localStorage.getItem('dinotty_tree_pane_width')).toBeNull()
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

  it('clamps a manual width to the body and viewport cap', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()
    layout.treeWidthMode.value = 'manual'
    layout.treePaneWidth.value = 600

    layout.clampTreePaneWidth(bodyOfWidth(300))
    expect(layout.treePaneWidth.value).toBeCloseTo(234)

    layout.treePaneWidth.value = 700
    layout.clampTreePaneWidth(bodyOfWidth(2000))
    expect(layout.treePaneWidth.value).toBe(560)
  })

  it('does not clamp the auto width', () => {
    setViewport(1280, 900)
    const layout = useFileWorkspaceLayout()
    layout.treePaneWidth.value = 900

    layout.clampTreePaneWidth(bodyOfWidth(300))
    expect(layout.treePaneWidth.value).toBe(900)
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

import { describe, expect, it, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import OpenInterfacesSection from '../components/settings/OpenInterfacesSection.vue'
import { settings } from '../composables/useSettings'

// The open-interfaces group is a settings + testing panel in the General tab:
// toggles for Open API / MCP, a /api/input test form, and Agent API guidance.
// It does NOT re-enumerate every endpoint or MCP tool — the full list lives in
// the API docs.

let wrapper: VueWrapper | null = null

beforeEach(() => {
  wrapper?.unmount()
  wrapper = null
  settings.locale = 'en'
  settings.open_api.enabled = false
  settings.mcp.http_enabled = true
  settings.mcp.stdio_enabled = false
})

function mountSection() {
  wrapper = mount(OpenInterfacesSection)
  return wrapper!
}

describe('OpenInterfacesSection', () => {
  it('renders the three interface groups with toggles bound to settings', async () => {
    const w = mountSection()

    const text = w.text()
    expect(text).toContain('Open API')
    expect(text).toContain('Agent API')
    expect(text).toContain('MCP Server')

    const checkboxes = w.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(3)
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[2].element as HTMLInputElement).checked).toBe(false)

    await checkboxes[0].setValue(true)
    expect(settings.open_api.enabled).toBe(true)
    await checkboxes[2].setValue(true)
    expect(settings.mcp.stdio_enabled).toBe(true)
  })

  it('shows the /api/input test panel only when Open API is on', async () => {
    const w = mountSection()
    expect(w.text()).not.toContain('/api/input')

    settings.open_api.enabled = true
    await w.vm.$nextTick()

    const text = w.text()
    expect(text).toContain('/api/input')
    expect(text).toContain('Send Test')
  })

  it('does not enumerate endpoints or MCP tools (they live in the API docs)', () => {
    settings.open_api.enabled = true
    const w = mountSection()
    const text = w.text()
    expect(text).not.toContain('/api/sessions')
    expect(text).not.toContain('tab_create')
    expect(text).not.toContain('terminal:read')
  })

  it('keeps the Agent API token guidance', () => {
    const w = mountSection()
    expect(w.text()).toContain('/api/tokens')
  })
})

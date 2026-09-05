import { describe, expect, it } from 'vitest'
import { floatPaneId, workspaceIdFromPaneId } from '../utils/pluginPaneId'

describe('workspaceIdFromPaneId', () => {
  it('scenario 1: decodes a new-format plugin pane id', () => {
    expect(workspaceIdFromPaneId('plugin:session-browser:4ce788c1-x')).toBe('4ce788c1-x')
  })

  it.each([
    ['scenario 2: empty workspace segment', 'plugin:json-formatter:'],
    ['scenario 3: old plugin format', 'plugin:whiteboard'],
    ['scenario 4: non-plugin pane id', 'a1b2c3d4-uuid'],
    ['extra segment', 'plugin:session-browser:workspace-a:extra'],
    ['wrong prefix', 'terminal:session-browser:workspace-a'],
  ])('returns undefined for %s', (_label, paneId) => {
    expect(workspaceIdFromPaneId(paneId)).toBeUndefined()
  })
})

describe('floatPaneId', () => {
  it('builds a 3-part plugin pane id with the float sentinel', () => {
    expect(floatPaneId('json-formatter')).toBe('plugin:json-formatter:float')
  })

  it('is stable and parses through workspaceIdFromPaneId as the float sentinel', () => {
    expect(workspaceIdFromPaneId(floatPaneId('x'))).toBe('float')
  })
})

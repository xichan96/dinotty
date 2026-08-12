import { describe, expect, it } from 'vitest'
import { actionKeyToKeyDef } from '../utils/actionKeyDef'
import { agentNameForLabel, isAgentIconEnabled } from '../utils/agentShortcutIcon'

describe('agent send shortcut display', () => {
  it('matches only exact trimmed agent labels without case sensitivity', () => {
    expect(agentNameForLabel(' Claude ')).toBe('claude')
    expect(agentNameForLabel('CODEX')).toBe('codex')
    expect(agentNameForLabel('openCode')).toBe('opencode')
    expect(agentNameForLabel('codex --profile x')).toBeNull()
    expect(agentNameForLabel('my codex')).toBeNull()
  })

  it('defaults matched send labels to icons and supports explicit text opt-out', () => {
    const auto = actionKeyToKeyDef({
      label: 'Codex',
      kind: 'send',
      send: 'codex --profile work',
      auto_enter: true,
      repeat: true,
    })
    const text = actionKeyToKeyDef({
      label: 'Codex',
      kind: 'send',
      send: 'codex --profile work',
      display: 'text',
      auto_enter: true,
      repeat: true,
    })

    expect(auto.icon).toBeTruthy()
    expect(auto.l).toBe('')
    expect(auto.s).toBe('codex --profile work\r')
    expect(auto.repeat).toBe(true)
    expect(text.icon).toBeUndefined()
    expect(text.l).toBe('Codex')
    expect(text.s).toBe('codex --profile work\r')
    expect(text.repeat).toBe(true)
  })

  it('enables the editor checkbox from the live label and ignores send content', () => {
    expect(isAgentIconEnabled({ label: 'cLaUdE', kind: 'send', send: 'anything' })).toBe(true)
    expect(isAgentIconEnabled({ label: 'Claude', kind: 'action', action: 'newTab' })).toBe(false)
    expect(isAgentIconEnabled({ label: 'launcher', kind: 'send', send: 'codex' })).toBe(false)
  })
})

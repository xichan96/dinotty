import type { Component } from 'vue'
import ClaudeLogo from '../components/icons/ClaudeLogo.vue'
import CodexLogo from '../components/icons/CodexLogo.vue'
import OpencodeLogo from '../components/icons/OpencodeLogo.vue'
import type { ActionKey } from '../composables/useSettings'

export type AgentShortcutName = 'claude' | 'codex' | 'opencode'

const AGENT_ICONS: Record<AgentShortcutName, Component> = {
  claude: ClaudeLogo,
  codex: CodexLogo,
  opencode: OpencodeLogo,
}

export function agentNameForLabel(label: string): AgentShortcutName | null {
  const normalized = label.trim().toLocaleLowerCase('en-US')
  return normalized === 'claude' || normalized === 'codex' || normalized === 'opencode'
    ? normalized
    : null
}

export function agentIconForLabel(label: string): Component | undefined {
  const name = agentNameForLabel(label)
  return name ? AGENT_ICONS[name] : undefined
}

export function isAgentIconEnabled(
  key: Pick<ActionKey, 'kind' | 'label'> & Partial<ActionKey>
): boolean {
  return key.kind !== 'action' && agentNameForLabel(key.label) !== null
}

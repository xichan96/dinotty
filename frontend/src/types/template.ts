import type { PaneLayout } from './pane'

export type TemplateScope = 'workspace' | 'global'

export interface LayoutTemplate {
  id: string
  name: string
  scope: TemplateScope
  workspace_id?: string
  created_at: string
  updated_at: string
  layout: PaneLayout
}

export interface TemplateIndexEntry {
  id: string
  name: string
  scope: TemplateScope
  workspace_id?: string
  updated_at: string
}

export interface TemplateIndex {
  templates: TemplateIndexEntry[]
}

export interface PaneOverride {
  cwd?: string
  startup_command?: string
  title?: string
  path?: string
  url?: string
  plugin_options?: unknown
}

export interface CreateTemplateBody {
  name: string
  scope: TemplateScope
  workspace_id?: string
  source_tab_id: string
  pane_overrides?: Record<string, PaneOverride>
}

export interface UpdateTemplateBody {
  name?: string
  source_tab_id?: string
  pane_overrides?: Record<string, PaneOverride>
}

export interface ListTemplatesQuery {
  scope: TemplateScope
  workspace_id?: string
}

export interface ApplyTemplateBody {
  template_id: string
  workspace_id?: string
}

export interface ApplyTemplateResult {
  tab_id: string
  layout: PaneLayout
  warnings: string[]
}

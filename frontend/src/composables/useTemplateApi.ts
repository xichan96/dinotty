import { authFetch, apiUrl } from './apiBase'
import type {
  LayoutTemplate,
  TemplateIndex,
  CreateTemplateBody,
  UpdateTemplateBody,
  ListTemplatesQuery,
  ApplyTemplateBody,
  ApplyTemplateResult,
} from '../types/template'

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  if (entries.length === 0) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of entries) sp.set(k, v as string)
  return `?${sp.toString()}`
}

export async function apiListTemplates(
  query: ListTemplatesQuery
): Promise<TemplateIndex> {
  const res = await authFetch(apiUrl(`/api/templates${qs({ scope: query.scope, workspace_id: query.workspace_id })}`))
  if (!res.ok) throw new Error(`list templates failed: ${res.status}`)
  return res.json()
}

export async function apiGetTemplate(
  id: string,
  query: ListTemplatesQuery
): Promise<LayoutTemplate> {
  const res = await authFetch(apiUrl(`/api/templates/${id}${qs({ scope: query.scope, workspace_id: query.workspace_id })}`))
  if (!res.ok) throw new Error(`get template failed: ${res.status}`)
  return res.json()
}

export async function apiCreateTemplate(
  body: CreateTemplateBody
): Promise<{ template_id: string }> {
  const res = await authFetch(apiUrl('/api/templates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `create template failed: ${res.status}`)
  }
  return res.json()
}

export async function apiUpdateTemplate(
  id: string,
  query: ListTemplatesQuery,
  body: UpdateTemplateBody
): Promise<{ ok: boolean }> {
  const res = await authFetch(apiUrl(`/api/templates/${id}${qs({ scope: query.scope, workspace_id: query.workspace_id })}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `update template failed: ${res.status}`)
  }
  return res.json()
}

export async function apiDeleteTemplate(
  id: string,
  query: ListTemplatesQuery
): Promise<{ ok: boolean }> {
  const res = await authFetch(apiUrl(`/api/templates/${id}${qs({ scope: query.scope, workspace_id: query.workspace_id })}`), {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `delete template failed: ${res.status}`)
  }
  return res.json()
}

export async function apiApplyTemplate(
  body: ApplyTemplateBody
): Promise<ApplyTemplateResult> {
  const res = await authFetch(apiUrl('/api/templates/apply'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `apply template failed: ${res.status}`)
  }
  return res.json()
}

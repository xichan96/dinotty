import { authFetch, apiUrl } from './apiBase'

export interface CreateTabResult {
  tab_id: string
  pane_id: string
  layout: any
  cwd?: string
  connection_id?: string
}

export interface SplitPaneResult {
  new_pane_id: string
  layout: any
}

export interface ClosePaneResult {
  ok: boolean
  tab_closed: boolean
  layout?: any
  active_pane_id?: string
}

export interface ListTabsResult {
  tabs: Array<{ tab_id: string; pane_id: string; layout?: any; active_pane_id?: string; cwd?: string; connection_id?: string }>
  active_pane_id: string | null
}

export async function apiListTabs(): Promise<ListTabsResult> {
  const res = await authFetch(apiUrl('/api/tabs'))
  if (!res.ok) throw new Error(`list tabs failed: ${res.status}`)
  return res.json()
}

export async function apiCreateTab(
  cwd?: string,
  argv?: string[],
  title?: string
): Promise<CreateTabResult> {
  const res = await authFetch(apiUrl('/api/tabs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, argv, title }),
  })
  if (!res.ok) throw new Error(`create tab failed: ${res.status}`)
  return res.json()
}

export async function apiCloseTab(tabId: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}`), { method: 'DELETE' })
  if (!res.ok) throw new Error(`close tab failed: ${res.status}`)
}

export async function apiSplitPane(
  tabId: string,
  paneId: string,
  direction: string,
  forceLocal?: boolean,
  cwd?: string
): Promise<SplitPaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pane_id: paneId, direction, force_local: forceLocal ?? false, cwd }),
  })
  if (!res.ok) throw new Error(`split pane failed: ${res.status}`)
  return res.json()
}

export async function apiClosePane(tabId: string, paneId: string): Promise<ClosePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/${paneId}`), { method: 'DELETE' })
  if (!res.ok) throw new Error(`close pane failed: ${res.status}`)
  return res.json()
}

export async function apiActivatePane(tabId: string, paneId: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/${paneId}/activate`), {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(`activate pane failed: ${res.status}`)
}

export async function apiUpdateLayout(
  tabId: string,
  layout: any,
  activePaneId: string
): Promise<void> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/layout`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, active_pane_id: activePaneId }),
  })
  if (!res.ok) throw new Error(`update layout failed: ${res.status}`)
}

// ─── SSH ────────────────────────────────────────────────────────────

export interface SshAuthMethod {
  type: 'password' | 'key_file' | 'key_inline'
  password?: string
  key_path?: string
  private_key?: string
  passphrase?: string
}

export interface SshConnectRequest {
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  default_command?: string
  initial_cwd?: string
}

export interface SshProfileConnectRequest {
  profile_id: string
}

export async function apiCreateSshQuickTab(req: SshConnectRequest, signal?: AbortSignal): Promise<CreateTabResult> {
  const res = await authFetch(apiUrl('/api/tabs/ssh/quick'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `SSH connect failed: ${res.status}`)
  }
  return res.json()
}

export async function apiCreateSshTab(
  profileId: string,
  initialCwd?: string,
  signal?: AbortSignal
): Promise<CreateTabResult> {
  const res = await authFetch(apiUrl('/api/tabs/ssh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId, initial_cwd: initialCwd }),
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `SSH connect failed: ${res.status}`)
  }
  return res.json()
}

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

// ─── Non-terminal panes (plugin/files/web) ─────────────────────────

export interface CreatePaneResult {
  new_pane_id: string
  layout: any
}

export async function apiCreatePluginPane(
  tabId: string,
  pluginId: string,
  targetPaneId: string,
  direction: string
): Promise<CreatePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/plugin`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plugin_id: pluginId,
      target_pane_id: targetPaneId,
      direction,
    }),
  })
  if (!res.ok) throw new Error(`create plugin pane failed: ${res.status}`)
  return res.json()
}

export async function apiCreateFilesPane(
  tabId: string,
  path: string,
  targetPaneId: string,
  direction: string
): Promise<CreatePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/files`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      target_pane_id: targetPaneId,
      direction,
    }),
  })
  if (!res.ok) throw new Error(`create files pane failed: ${res.status}`)
  return res.json()
}

export async function apiCreateWebPane(
  tabId: string,
  url: string,
  targetPaneId: string,
  direction: string
): Promise<CreatePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${tabId}/pane/web`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      target_pane_id: targetPaneId,
      direction,
    }),
  })
  if (!res.ok) throw new Error(`create web pane failed: ${res.status}`)
  return res.json()
}

// ─── Cross-tab move/extract ────────────────────────────────────────

export interface MovePaneResult {
  source_layout?: any
  layout: any
  active_pane_id: string
  mode: 'a' | 'b'
}

export async function apiMovePane(
  dstTabId: string,
  req: {
    source_tab_id: string
    source_pane_id?: string
    target_pane_id: string
    direction: string
  }
): Promise<MovePaneResult> {
  const res = await authFetch(apiUrl(`/api/tabs/${dstTabId}/pane/move`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`move pane failed: ${res.status}`)
  return res.json()
}

export interface ExtractPaneResult {
  new_tab_id: string
  pane_id: string
  source_layout: any
}

export async function apiExtractPane(
  sourceTabId: string,
  paneId: string
): Promise<ExtractPaneResult> {
  const res = await authFetch(apiUrl('/api/tabs/extract'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_tab_id: sourceTabId, pane_id: paneId }),
  })
  if (!res.ok) throw new Error(`extract pane failed: ${res.status}`)
  return res.json()
}

export interface CreatePluginTabResult {
  tab_id: string
  pane_id: string
  layout: any
}

/** Create a new tab whose root layout is a single plugin leaf (no PTY).
 *  Used so plugin tabs gain a backend `tab_layouts` entry, enabling Mode A
 *  drag-and-drop merge with other tabs. Pass `tabId` to reuse an existing
 *  paneId when migrating frontend-only plugin tabs. */
export async function apiCreatePluginTab(
  pluginId: string,
  options?: { title?: string; tabId?: string }
): Promise<CreatePluginTabResult> {
  const res = await authFetch(apiUrl('/api/tabs/plugin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plugin_id: pluginId,
      title: options?.title,
      tab_id: options?.tabId,
    }),
  })
  if (!res.ok) throw new Error(`create plugin tab failed: ${res.status}`)
  return res.json()
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

export interface Workspace {
  id: string
  name: string
  path: string
  order: number
  /** References an SshProfile.id when this is a remote workspace. */
  connection_id?: string
  abbr?: string
  color?: string
  /** Per-workspace override for tab badge rendering. */
  tab_badge?: boolean
}

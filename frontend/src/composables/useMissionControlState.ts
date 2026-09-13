import { reactive } from 'vue'
import type { McOp } from '../types/protocol'
import { cachedCapabilities, ensureCapabilities } from './serverCapabilities'

/// Global Mission Control state mirror. The backend is the single source of
/// truth; this reactive object is updated from `mission_control_toggled` /
/// `selection_changed` / `mc_snapshot` sync messages. All MC UI components
/// subscribe to this instead of holding their own local refs, so multi-
/// client changes (hardware keyboard, other tabs, other devices) propagate
/// automatically.
///
/// Singleton: the same object is shared across every component that imports
/// it - same pattern as the `useWorkspaces` global state.
export interface MissionControlState {
  open: boolean
  /// `null` means the default workspace (`__default__`).
  selectedWorkspaceId: string | null
  selectedTabId: string | null
  /// Tab title looked up by the server when selected_tab_id changed, so
  /// touchscreen clients can render the name without a tab_list round-trip.
  selectedTabTitle: string | null
  /// Whether `open` describes the *server's* state rather than a leftover.
  ///
  /// `false` from a server switch, which clears the mirror, until that server's
  /// `mc_snapshot` arrives. Only the downgrade path below reads it, and it
  /// reads it to *refuse*: a `toggle` sent on a mirror that does not describe
  /// the server is the exact mistake `McOp::Set` was introduced to remove.
  synced: boolean
}

const mcState = reactive<MissionControlState>({
  open: false,
  selectedWorkspaceId: null,
  selectedTabId: null,
  selectedTabTitle: null,
  synced: false,
})

/// Record that the mirror now describes the active server's own state.
///
/// Called when `mc_snapshot` arrives - the server's own answer, sent as the
/// sync socket opens.
export function markMcSnapshot(): void {
  mcState.synced = true
}

/// Sender registry. App.vue calls `setMcSender(syncWs.sendSync)` once the
/// sync WS is created; components call `sendMcOp(op)` without needing the
/// WS passed in as a prop.
type McSender = (op: McOp) => void
let mcSender: McSender = () => {
  // No-op until App.vue wires the real sender. Logged at debug to avoid
  // noise in tests / Storybook-style isolated mounts.
  if (typeof console !== 'undefined') {
    console.debug('[mc] sender not registered yet, dropping op')
  }
}

export function setMcSender(sender: McSender): void {
  mcSender = sender
}

/// Capability a server advertises when it understands [`McOp`]'s `set`.
/// Mirrors `CAPABILITIES` in `src/api/info.rs`.
const MC_OP_SET = 'mc_op_set'

/// Send a Mission Control op to the active server.
///
/// The one exit for every MC op, which is what lets the compatibility branch
/// below exist in one place instead of at each call site.
export function sendMcOp(op: McOp): void {
  if (op.kind !== 'set') {
    mcSender(op)
    return
  }
  const caps = cachedCapabilities()
  if (caps) {
    sendSetOp(op, caps)
    return
  }
  // Not asked yet - first seconds after load, or a failed lookup. Ask, then
  // decide; `null` means we still cannot tell.
  void ensureCapabilities().then((resolved) => sendSetOp(op, resolved))
}

function sendSetOp(op: { kind: 'set'; open: boolean }, caps: Set<string> | null): void {
  // `null` is "could not ask", which is not evidence the server is old: send
  // the caller's intent unchanged, exactly as a client that never asked would.
  if (caps === null || caps.has(MC_OP_SET)) {
    mcSender(op)
    return
  }
  downgradeToToggle(op)
}

/// Drive `open` at a server that only knows `toggle`.
///
/// `Toggle` is not idempotent, so it may stand in for `Set` only when the
/// mirror is *known* to describe the server's own state and disagrees with the
/// target - otherwise the op is dropped rather than risked. The case that
/// matters is a switch to an older server: the mirror was cleared on the way
/// over, so a click racing that server's `mc_snapshot` declines instead of
/// closing the overview for every other client attached to it. The user is
/// clicking; they can click again, and a later click finds the mirror synced.
///
/// `open` is per-server and global, so there is no per-client shortcut: what
/// this protects is someone else's Mission Control, on another device.
function downgradeToToggle(op: { kind: 'set'; open: boolean }): void {
  if (!mcState.synced || mcState.open === op.open) return
  mcSender({ kind: 'toggle' })
}

export function useMissionControlState() {
  return mcState
}

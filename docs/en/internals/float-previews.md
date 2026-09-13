# Floating windows for File Browser & Web Browser (no plugin conversion)

Status: **design — approved 2026-09-09** (user confirmed: implement Phases 1+2 together; accept the `isWindow` gate on `FileWorkspacePreview`).

## Why

Plugin panes can open as a **tab**, a **split pane**, or a **floating draggable window**.
The built-in File Browser (`kind:'files'` → `FileWorkspacePreview.vue`) and Web Browser
(`kind:'web'` → `WebPreview.vue`) can only open as split leaves inside a terminal tab.
The user wants the same floating-window experience for files/web.

We deliberately do **NOT** convert files/web into plugins: that would require host-bridge
shims + a duplicated giant bundle (the Monaco/editor stack cannot live in a plugin), and the
`builtin-keyboard` precedent shows built-in "plugins" still live in the host core. Instead we
generalize the **existing** plugin floating-window infrastructure so its body can render a
built-in preview pane. Split-leaf paths stay 100% intact (additive). No backend changes.
This phase does not build a plugin-kind registry, but the seam it introduces is where one
would attach later.

## Key existing facts (verified)

- Pinia float store is already keyed by **arbitrary strings** and has no plugin logic:
  `stores/pluginFloatWindows.ts` (`open/openIds/isOpen/close/toggle/focus/zOf` on `Map<string,number>`).
  Generalizing it = parameter rename `pluginId`→`windowId` + comments, **not a rewrite**.
- Window chrome: `components/plugin/PluginFloatWindow.vue` — drag titlebar (`useFloatingDrag`),
  resize (`useWindowResize`), geometry persisted to localStorage `dinotty:floating-win:{id}`
  (`:88`), opacity from `settings.plugin_prefs.float_opacity` (`:69-74`), single instance, z-order.
  Body renders `<PluginView :plugin :api>` (`:27-37`).
- Host layer: `components/plugin/PluginFloatWindowHost.vue` — fixed z-index 640 (`App.vue:368-372`),
  v-for over `store.openIds`, resolves each to a `LoadedPlugin`, drops windows whose plugin is
  no longer active (`watch renderable :40-45`).
- Launcher: `composables/usePluginLauncher.ts` — `openPlugin(id, mode?)`; `floating` branch →
  `opts.floatWindows.open(id)` (`:61-74`); explicit mode > pref > touch forces `'tab'`
  (`resolvePluginOpenMode :34-42`). Wired in `useAppCore.ts:781-794` with
  `openModePref: id => settings.plugin_prefs?.open_modes?.[id] ?? 'tab'`.
- `PaneContent.vue` is the single leaf dispatcher (`:1-49`): `files` branch passes
  `FileWorkspacePreview` `visible/pane-id/shell-type/initial-path/source-pane-id`; `web` branch
  passes `WebPreview` `visible/url`. Both are leaf-only; no other render sites exist.
- `FileWorkspacePreview.vue` props: `visible, paneId, inLeaf?=true, shellType?, initialPath?,
  sourcePaneId?`. Derives `apiPaneId = sourcePaneId || paneId` for workspace REST
  (list/meta/git-status need a PTY-session pane_id). Has dormant `inLeaf:false` chrome (divider +
  toolbar Close). ~1100 lines; renders the Monaco/editor stack. defineExpose incl.
  `openFromTerminal`, `reloadAll`, drawer ops, `goBack/goForward`.
- `WebPreview.vue` props: `visible, url, inLeaf?=true`. Does **not** need a session (proxying via
  `/api/proxy`, `/preview/:host/:port` is session-independent). defineExpose `openFromWebUrl`.
- **`FileWorkspacePreview` global side effects** (the risky part) — `onMounted:774-781` registers
  window-level `keydown`(save)/`scroll`(close-context) capture, `setActiveWorkspace()`,
  `setEditorSplitForCursorGroup(editorSplit)`; watch at `:346` calls `setActiveLeaf(...)`.
  `onBeforeUnmount:783-793` unregisters, `setEditorSplitForCursorGroup(null)`, `setActiveLeaf(null)`.
  `setActiveLeaf`/`registerEditor` live in `composables/useEditorRegistry.ts` (module singletons,
  `:5-31`); `setEditorSplitForCursorGroup` in `composables/useCursorGroup.ts`.
  → A files float coexisting with a files leaf would fight over these singletons + capture
    window keydown/scroll. **Gate with `isWindow?: boolean`.**
- Workspace REST calls need a terminal leaf `pane_id`. `FileWorkspacePreview` binds via
  `sourcePaneId`. `activeTerminalLeaf` is available in `useAppCore.ts` (~`:121-126`).
- Entry surfaces today: Monitor menu (`App.vue:85-103` File browser/Web preview →
  `openOrFocusPreview('files'|'web')`); command palette (`useAppActions.ts:129-140`). Terminal
  link/file click (`useAppCore.ts:595-601, 640-653`) also create/focus leaves. Plugin open-mode
  pref UI is in Settings→Plugins (`PluginsTab.vue:347-358`) — the only place a mode is chosen.
- Settings: `frontend/src/composables/useSettings.ts` `SettingsData` (`:61`), `plugin_prefs`
  `:74/:260/:514-520`. Rust side settings under `src/settings/types/` use `#[serde(default)]`;
  optional keys round-trip. i18n catalogs `frontend/src/composables/i18n/en.ts` + `zh.ts`.

## Design

### Descriptor type — new `frontend/src/types/floatWindow.ts`

```ts
import type { LoadedPlugin, PluginContext } from '../composables/usePluginLoader'

/** Pane kinds that can host a floating window. A future registry extends this. */
export type FloatablePaneKind = 'plugin' | 'files' | 'web'

/** What a floating window renders. Plugin windows bind a LoadedPlugin; built-in
 *  previews carry the payload a layout leaf would have (LeafPane.path/url/sourcePaneId). */
export type FloatWindowContent =
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'files'; sourcePaneId: string; initialPath?: string }
  | { kind: 'web'; initialUrl?: string }

/** Window identity = pinia store key AND geometry localStorage key.
 *  Plugin windows keep id === plugin.id (back-compat). files/web are
 *  single-instance-per-kind: fixed ids 'float:files' / 'float:web'. */
export function floatWindowId(c: FloatWindowContent): string {
  return c.kind === 'plugin' ? c.pluginId : `float:${c.kind}`
}

/** Internal state key for a files window's heavy tree/editor state, scoped to
 *  the bound terminal so two workspaces never bleed through the in-memory
 *  state map (useFileWorkspaceState). */
export function filesStatePaneId(sourcePaneId: string): string {
  return `float:files:${sourcePaneId}`
}

/** Mirror of resolvePluginOpenMode. Floats are desktop-only. */
export type PreviewOpenMode = 'split' | 'floating'
export function resolvePreviewOpenMode(
  explicit: PreviewOpenMode | undefined,
  pref: PreviewOpenMode,
  touch: boolean
): PreviewOpenMode {
  if (touch) return 'split'
  return explicit ?? pref
}
```

`FloatWindowContent` is a **union, not a registry** — the host resolves each open id to one
branch via a small resolver. That resolver is the seam a future registry formalizes into
`Map<kind, { idFactory, resolveContent, renderer, openModePref }>`.

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Identity & dedup | single instance per kind (`float:files`/`float:web` fixed ids) | FileWorkspacePreview is heavy/stateful (tree cache, cwd, editor splits, one watch ws per pane). `store.open()` is idempotent → reopen = bring to front. |
| files → terminal binding | **snapshot `sourcePaneId` at open**, frozen for window lifetime | Workspace calls need a stable PTY pane_id; live-tracking would repoint an open tree/editors at a different session. Re-bind = close → reopen. |
| web | no terminal needed | proxying is session-independent. |
| inLeaf in float | **keep default `true`**, fill via CSS `.float-body--preview{display:flex}` | Components are self-contained full-bleed; `inLeaf:false` is a legacy "terminal-sibling" mode, inert in a float. |
| UX entry | mirror plugin open-mode pref: `settings.preview_open_modes[kind] ∈ {'split','floating'}`, default `'split'` | Monitor/palette route through `openPreview(kind)`; default unchanged → opt-in only. |
| Terminal link/file click | unchanged (split/focus only) | a terminal gesture shouldn't silently detach into a float. |
| Geometry defaults | plugin 480×360 stays; files 780×540, web 720×520 | files is tree+editor two columns; plugin default too small. |
| Opacity | previews = 1 | `float_opacity` is plugin-id-keyed. |

### Phase 1 — generalize chrome + store/host (plugin path untouched)

Ordered; each step compiles, existing plugin tests stay green.

1. **New** `frontend/src/types/floatWindow.ts` (above) + i18n keys (titles reuse
   `previewPanel.switchFiles/switchWeb`; new `settings.previewOpenMode.*` in Phase 2).
2. `stores/pluginFloatWindows.ts`: rename param `pluginId`→`windowId` + header comment only.
   No logic change. Store tests remain valid.
3. `components/plugin/PluginFloatWindow.vue` → single chrome/body dispatcher:
   - Props: add optional `content?: FloatWindowContent`; keep `plugin`/`api` so existing tests
     mounting `{plugin, api, workspaceId}` pass. `winId = content ? floatWindowId(content) : plugin?.id`.
   - Title (`:16`), storageKey (`:88`), z/store calls (`:22/:166/:171`) use `winId`.
   - Defaults table keyed by kind: `{ plugin:{480,360}, files:{780,540}, web:{720,520} }`
     (replaces `:78-79` constants and centering `:145-147`).
   - Opacity only when kind==='plugin' (`:69-74`).
   - Body (`:27-37`): 3-way branch — plugin → `<PluginView>` verbatim; files →
     `<FileWorkspacePreview :visible :pane-id="filesStatePaneId(content.sourcePaneId)"
       :source-pane-id :initial-path :is-window>`; web → `<WebPreview :visible :url>`. Do **not**
     pass `in-leaf` (default true). Preview content needs `:pane-id` = scoped state key so
     workspace A tree/editors never restore into workspace B while the store id stays `float:files`.
   - Wrap body: `<div class="float-body" :class="content ? 'float-body--preview' : ''">`; CSS
     `.float-body--preview{display:flex} .float-body--preview>*{flex:1;min-width:0;min-height:0}`.
4. `components/plugin/PluginFloatWindowHost.vue`:
   - Add optional `getPreviewContent?: (id: string) => FloatWindowContent | undefined`.
   - `renderable` (`:28-32`) → `FloatWindowEntry[]`: plugin id → `{plugin, api}`;
     else `getPreviewContent(id)` → `{content}`; null → not rendered. Drop separate `apis` (`:34-36`).
   - Keep the drop-`watch` (`:40-45`) spirit: close any open id whose entry can't be resolved.
   - Template passes `:plugin`/`:api`/`:content` from the entry.
5. `composables/useAppCore.ts`:
   - `const previewFloatContents = shallowReactive<Record<string, FloatWindowContent>>({})`;
     `getPreviewFloatContent(id)` reads it.
   - `openPreviewFloat(content)`: record content, then `floatWindows.open(floatWindowId(content))`
     (idempotent bring-to-front). Store already available in launcher scope.
   - `activeTerminalSourcePane()` from `activeTerminalLeaf` (`~:121-126`); files open with no
     active terminal → toast + abort (mirror `openOrFocusPreview` precondition).
   - Return exports: `getPreviewFloatContent` (Phase 1), `openPreview` (Phase 2).
6. `App.vue:368-372`: pass `:get-preview-content="getPreviewFloatContent"`.
7. `FileWorkspacePreview.vue`: add optional prop `isWindow?: boolean` (default false). When true:
   skip window `keydown`/`scroll` capture, skip `setEditorSplitForCursorGroup` (both directions),
   skip `setActiveLeaf` writes (keep `:346` neutral — do not null the leaf's own state), skip
   `setActiveWorkspace`. Monaco's own bindings still fire when the float's editor is focused.
   (`WebPreview` needs no gate — no global listeners.)

### Phase 2 — UX entry + per-kind pref

1. `useSettings.ts`: add optional `preview_open_modes?: Partial<Record<'files'|'web','split'|'floating'>>`
   to `SettingsData` (`:61`). No default needed; readers use `?? 'split'`. Optional → round-trips
   through server (`#[serde(default)]`), no schema bump.
2. `useAppCore.ts`:
   - `previewOpenModePref(kind)` reads the setting.
   - `openPreview(kind: 'files'|'web', payload?, explicit?)`: `resolvePreviewOpenMode`; floating →
     `openPreviewFloat(...)` (files needs `activeTerminalSourcePane` + `initialPath` defaulting to
     the active terminal tab cwd); split → existing `openOrFocusPreview(kind)` unchanged.
3. Entry swap (behavior-neutral at default 'split'): `App.vue` Monitor items `:85-103` and
   `useAppActions.ts` palette `:129-140` call `openPreview(kind)` instead of `openOrFocusPreview`.
   `onPreviewLink`/`onFileClick` unchanged.
4. Settings UI: a "Previews" row per kind (select split/floating) writing `preview_open_modes` +
   `saveSettings()`. Natural home `components/settings/GeneralTab.vue`. i18n keys
   `settings.previewOpenMode.*` in `en.ts`/`zh.ts`.
5. Free hardening: `getPreviewFloatContent('float:files')` returns content only while its
   `sourcePaneId` is still a live terminal leaf (search `getAllLeaves(tab.layout)`). When the
   bound terminal closes, resolver returns undefined → host drop-watch auto-closes → unmount
   persists file state. Zero new logic in Host.

### Phase 3 (not now) — what the seam unlocks

Extending `FloatWindowContent` + one body branch + one resolver entry = third-party pane kinds,
no store/chrome changes.

## Files

- New: `frontend/src/types/floatWindow.ts`
- Edit: `components/plugin/PluginFloatWindow.vue`, `components/plugin/PluginFloatWindowHost.vue`,
  `components/preview/FileWorkspacePreview.vue` (isWindow gate only),
  `composables/useAppCore.ts`, `stores/pluginFloatWindows.ts` (rename only), `App.vue`,
  `composables/useSettings.ts`, `composables/useAppActions.ts`,
  `components/settings/GeneralTab.vue`, `composables/i18n/en.ts`, `zh.ts`
- Not touched: backend, `PaneContent.vue`, `WebPreview.vue` body, `types/pane.ts`
- Tests: existing `PluginFloatWindow.test.ts` / `PluginFloatWindowHost.test.ts` /
  `pluginFloatWindows.test.ts` must stay green (additive `content?`/`getPreviewContent?` props).
  Add files/web branch tests (vi-mock the two preview components) + `resolvePreviewOpenMode`
  truth-table test.

## Risks

1. `FileWorkspacePreview` global singletons (`useEditorRegistry.activeLeaf`,
   `useCursorGroup`) — mitigated by `isWindow` gate (§Phase 1.7). A leaf files + float files
   coexisting must not cross-wire add-cursors / save-keydown.
2. Heavy state keyed by paneId (`useFileWorkspaceState` Map) — scoped via `filesStatePaneId`.
   Existing `clearFileWorkspaceState` call sites use leaf pane ids, never `float:files:*`.
3. One watch ws per files instance — single-instance-per-kind + auto-close on bound-terminal
   gone bounds it to one socket.
4. Never pass `inLeaf:false` from a float; never feed `float:*` to `workspaceIdFromPaneId`
   (utils/pluginPaneId.ts expects 3-part `plugin:a:b` — returns undefined safely, but don't rely).

## Verification (manual)

1. Plugins still float with restored geometry/opacity; plugin float tests green.
2. Set File browser mode=Floating → Monitor opens a single draggable/resizable float bound to
   the active terminal: tree lists, files open in the float's editor, git status updates;
   reopen brings same window to front (no duplicate).
3. Window survives a terminal tab switch (snapshot binding); geometry persists across reload
   under `dinotty:floating-win:float:files`.
4. Web mode=Floating: iframe float works; address bar/devtools/bookmarks fine; proxying intact.
5. Default split mode unchanged — Monitor/palette behavior is byte-for-byte today's.
6. Close ✕ unmounts + persists files state; reopen restores previous tree/editors; no state
   leakage between two different bound terminals.
7. Leaf files + float files coexist: clicking files in the leaf opens in the leaf; add-cursors
   acts on the leaf context (after isWindow gate), not the float.
8. Touch device forces Split.
9. Closing the bound terminal auto-closes the float without error toasts.
10. No `workspaceIdFromPaneId('float:…')` calls; no console errors on `float:*` ids.

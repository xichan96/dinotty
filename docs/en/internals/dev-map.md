# Dinotty dev map (for worktree agents)

Main repo checkout (this machine): **`/Users/CHENXI/rust/dinotty`**
User/home: `cvte` / `/Users/CHENXI` (skill docs that say `/Users/talentc` are from another
machine — translate paths to `/Users/CHENXI`).

This file is a **shared one-shot briefing** so worktree agents don't re-explore the project.
Read the full design at `docs/en/internals/float-previews.md` (absolute path, main repo —
worktrees won't have repo docs).

## Product

dinotty = a terminal/workspace web app. Rust backend (`src/`, crate `dinotty-server`,
axum, WebSocket `/ws/sync`) + Vue 3 + TS + Pinia frontend (`frontend/src`). Pane kinds:
`terminal | plugin | files | web` (frontend `frontend/src/types/pane.ts:5`). Tabs are
`TerminalTab` holding a split layout of leaves; `PaneContent.vue` dispatches leaf kind →
component. Workspace REST APIs are keyed by a terminal pane_id (the "sourcePaneId").

## Layout / key files (frontend)

- `frontend/src/types/pane.ts` — `PaneKind`, `LeafPane` (payload `path`/`url`/`pluginId`/
  `sourcePaneId`), layout helpers `findLeaf`/`getAllLeaves`/`ensureSplitRoot`.
- `frontend/src/types/editorPane.ts`, `types/floatWindow.ts` (NEW), `types/upload.ts`.
- `frontend/src/App.vue` — top-level workbench; mounts `PluginFloatWindowHost` (~368) and
  `PluginOverlayHost` (~367); the Monitor menu (~85-103) opens file/web previews.
- `frontend/src/components/split/PaneContent.vue` — leaf dispatcher (kind→component, ~1-49).
- `frontend/src/components/split/SplitContainer.vue` — recursive split-tree renderer.
- `frontend/src/components/plugin/` — `PluginFloatWindow.vue` (float chrome),
  `PluginFloatWindowHost.vue` (layer), `PluginView.vue` (plugin body).
- `frontend/src/components/preview/FileWorkspacePreview.vue` (~1100 lines; the file browser),
  `WebPreview.vue` (~563; web browser iframe), `DevToolsPanel.vue`, `FilePickerModal.vue`.
- `frontend/src/components/workspace/TreeRows.ts`, `gitDecorations.ts`.
- `frontend/src/components/settings/PluginsTab.vue`, `GeneralTab.vue`.
- `frontend/src/composables/useAppCore.ts` — central wiring: `openOrFocusPreview(kind)`,
  `onFileClick`, `onPreviewLink`, `registerTermRef`, launcher assembly (~781-794).
- `frontend/src/composables/usePluginLauncher.ts` — plugin open (tab/floating/pane).
- `frontend/src/composables/useSplitPane.ts` — `insertNonTerminalPane(kind,payload)` → REST.
- `frontend/src/composables/useSettings.ts` — `SettingsData` (~61), settings reactive store,
  `saveSettings`. Rust mirror under `src/settings/types/` (`#[serde(default)]`).
- `frontend/src/composables/usePluginLoader.ts` — plugin load/ctx; `useEditorRegistry.ts`
  (module singletons `activeLeaf`/`registerEditor`), `useCursorGroup.ts`.
- `frontend/src/stores/pluginFloatWindows.ts` — float pinia store (`Map<string,number>`).
- `frontend/src/utils/pluginPaneId.ts` (`workspaceIdFromPaneId`, `floatPaneId`),
  `utils/hostPluginViews.ts` (`HOST_PLUGIN_VIEWS`).
- i18n catalogs: `frontend/src/composables/i18n/en.ts`, `zh.ts`.

## Conventions / traps

- Tests: `frontend/src/test/*.test.ts` + `composables/__tests__/` (vitest). Frontend tests run
  with `npm test` (cwd `frontend`) — **no npx**; a fresh worktree needs
  `cd frontend && npm install --registry https://registry.npmmirror.com` first.
- Do not touch the user's running dinotty (port 8999 desktop app / any server). Test instances
  run with `DINOTTY_CONFIG_SUFFIX=-<name> DINOTTY_TOKEN=<token> <bin> --port 589xx`.
- Commits: Conventional Commits, no Co-Authored-By trailer, no push.
- Worktrees lack `.claude/doc` and repo docs; cross-read the main repo by absolute path.

## The change (summary)

Make `files`/`web` panes openable as floating windows **without converting them to plugins**,
by generalizing the plugin float chrome/host/store to host `FloatWindowContent` entries.
Full spec + decisions + file list + risks: **`/Users/CHENXI/rust/dinotty/docs/en/internals/float-previews.md`** — read it first; verify the file:line anchors there against the worktree before editing.

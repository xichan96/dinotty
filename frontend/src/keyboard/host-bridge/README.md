# host-bridge

Host bridge shims for keyboard plugin bundles. Plugins import these instead of
the real host modules; at build time `resolve.alias` redirects to these shims,
which read from `window.__DINOTTY_VUE__` / `window.__DINOTTY_HOST__` at runtime.

**Sync contract**: these files mirror `dinotty-plugins/_shared/host-bridge/`.
Changes to either copy must be applied to the other. The plugins-repo copy is
the source of truth for third-party plugins (mini-keyboard); the main-repo copy
is used by the builtin-keyboard lib build (`frontend/src/keyboard/builtin-keyboard/vite.config.ts`).

Design doc: `.claude/doc/keyboard-plugin-design.md` (Phase 1b).

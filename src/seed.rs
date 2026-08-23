//! Bundled seed plugins shipped inside the server binary (keyboard-plugin-design.md, Phase 1b).
//!
//! The app carries the builtin mobile keyboard as a plugin: the built plugin
//! directory lives at `seed/builtin-keyboard/` (repository root) and is embedded
//! at compile time, so every deployment (dev server, cargo deb, Tauri desktop)
//! seeds the plugin without extra packaging or path resolution. On startup
//! `PluginManager::ensure_seed` installs it when missing and updates it when the
//! installed copy is older; afterwards the normal plugin update channel owns it.
//!
//! `seed/` must exist at build time (committed with `.gitkeep`); the
//! `seed/builtin-keyboard/` contents are build artifacts and gitignored, so a
//! dev checkout without a built seed simply skips seeding.

use rust_embed::Embed;

#[derive(Embed)]
#[folder = "seed/"]
pub struct SeedAssets;

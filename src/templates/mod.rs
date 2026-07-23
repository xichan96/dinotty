//! Layout templates: save a tab's layout tree as a reusable template.
//!
//! See `.claude/doc/layout-templates-design.md` for the full design.
//!
//! Phase 1: CRUD storage + handlers.
//! Phase 2: `apply_template` with two-phase PTY creation.

pub mod apply;
pub mod handlers;
pub mod store;
pub mod types;

pub use apply::apply_template;
pub use handlers::{
    create_template, delete_template, get_template, list_templates, update_template,
};
pub use store::{StoreError, TemplateStore};
pub use types::{
    ApplyTemplateBody, CreateTemplateBody, ListTemplatesQuery, PaneOverride, Template,
    TemplateIndex, TemplateIndexEntry, TemplateScope, UpdateTemplateBody,
};

use std::sync::Arc;

use crate::platform::{
    shell::ShellPreference, shell::ShellResolveError, shell_probe::ShellProbeService,
};
use crate::pty;
use crate::session::{self, SessionManager, SyncMsg};
use crate::settings::SettingsState;

use super::types::{validate_create_tab_request, CreateTabRequest, SplitPaneRequest};

pub struct CreateTabOutcome {
    pub tab_id: String,
    pub pane_id: String,
    pub layout: serde_json::Value,
    pub cwd: Option<String>,
}

pub enum CreateTabError {
    Validation(String),
    ShellResolve(ShellResolveError),
    PtyCreate(String),
    SessionDiedEarly { argv_command: bool },
}

#[allow(clippy::too_many_lines)]
pub async fn create_tab(
    manager: &Arc<SessionManager>,
    settings: &SettingsState,
    shell_probe: &ShellProbeService,
    req: CreateTabRequest,
) -> Result<CreateTabOutcome, CreateTabError> {
    let requested_cwd = validate_create_tab_request(&req).map_err(CreateTabError::Validation)?;
    let tab_id = uuid::Uuid::new_v4().to_string();
    let pane_id = uuid::Uuid::new_v4().to_string();

    // Copy settings under the lock, then probe outside it.
    let (cwd, shell_preference) = {
        let s = settings.read().await;
        let cwd = match requested_cwd {
            Some(cwd) => Some(cwd),
            None => s.resolved_default_workspace_root(),
        };
        let preference =
            ShellPreference::new(s.shell.clone(), s.shell_path.clone(), s.wsl_distro.clone());
        (cwd, preference)
    };
    let is_argv_command = req.argv.is_some();
    let shell_spec = if is_argv_command {
        None
    } else {
        Some(shell_probe.resolve(&shell_preference).await.map_err(CreateTabError::ShellResolve)?)
    };

    // Create PTY session
    let (session, shell_type) = pty::create_session(
        manager,
        &pane_id,
        Some(&tab_id),
        None,
        cwd.map(pty::LaunchCwd::Host),
        req.argv,
        shell_spec,
    )
    .map_err(|e| {
        tracing::error!("Failed to create PTY: {e}");
        CreateTabError::PtyCreate(e)
    })?;
    let cwd_str = session.cwd_for_workspace().map(|cwd| cwd.to_string_lossy().into_owned());

    // Create initial layout with single leaf
    let title = req.title.as_deref().unwrap_or("Terminal");
    let layout = serde_json::json!({
        "type": "leaf",
        "paneId": pane_id,
        "title": title,
        "shell_type": shell_type,
        "ratio": 1,
        "zoomed": false,
    });

    let publish_tab = || {
        if !manager.insert_tab_for_session(
            &pane_id,
            &session,
            tab_id.clone(),
            serde_json::json!({
                "layout": layout.clone(),
                "active_pane_id": pane_id.clone(),
            }),
            pane_id.clone(),
        ) {
            return false;
        }

        manager.broadcast_sync(&SyncMsg::TabCreated {
            tab_id: tab_id.clone(),
            pane_id: pane_id.clone(),
            layout: Some(layout.clone()),
            cwd: cwd_str.clone(),
            connection_id: None,
            workspace_id: None,
        });
        if manager.is_current_session(&pane_id, &session) {
            true
        } else {
            // If close won after guarded publication but before TabCreated was
            // sent, order a final corrective close after that late creation.
            manager.broadcast_sync(&SyncMsg::TabClosed { pane_id: tab_id.clone() });
            false
        }
    };

    if !publish_tab() {
        return Err(CreateTabError::SessionDiedEarly { argv_command: is_argv_command });
    }

    Ok(CreateTabOutcome { tab_id, pane_id, layout, cwd: cwd_str })
}

pub struct SplitPaneOutcome {
    pub new_pane_id: String,
    pub layout: serde_json::Value,
}

pub enum SplitPaneError {
    TabNotFound,
    TabHasNoLayout,
    PaneNotFoundInTab,
    ShellResolve(ShellResolveError),
    SessionCreate(String),
    LayoutUpdateFailed,
}

#[allow(clippy::too_many_lines)]
pub async fn split_pane(
    manager: &Arc<SessionManager>,
    settings: &SettingsState,
    shell_probe: &ShellProbeService,
    tab_id: &str,
    req: SplitPaneRequest,
) -> Result<SplitPaneOutcome, SplitPaneError> {
    // Verify tab exists
    let tab_val = match manager.tab_layouts.get(tab_id) {
        Some(v) => v.value().clone(),
        None => return Err(SplitPaneError::TabNotFound),
    };

    let layout = match tab_val.get("layout") {
        Some(l) => l.clone(),
        None => return Err(SplitPaneError::TabHasNoLayout),
    };

    // Verify target pane exists in layout
    let leaf_ids = session::collect_leaf_pane_ids(&layout);
    if !leaf_ids.contains(&req.pane_id) {
        return Err(SplitPaneError::PaneNotFoundInTab);
    }

    let new_pane_id = uuid::Uuid::new_v4().to_string();

    // Check if source pane is an SSH session
    let ssh_params = manager.sessions.get(&req.pane_id).and_then(|s| s.ssh_params.clone());

    // Create session for new pane (SSH or local PTY)
    let source_cwd = manager.sessions.get(&req.pane_id).and_then(|session| session.host_cwd());

    let shell_preference = {
        let s = settings.read().await;
        ShellPreference::new(s.shell.clone(), s.shell_path.clone(), s.wsl_distro.clone())
    };
    let shell_spec = if req.force_local || ssh_params.is_none() {
        Some(shell_probe.resolve(&shell_preference).await.map_err(SplitPaneError::ShellResolve)?)
    } else {
        None
    };

    let (session, _shell_type) = if req.force_local {
        // Force local PTY - use explicit cwd if provided, otherwise inherit from source
        let local_cwd = req.cwd.map(std::path::PathBuf::from).or(source_cwd);
        pty::create_session(
            manager,
            &new_pane_id,
            Some(tab_id),
            None,
            local_cwd.map(pty::LaunchCwd::Host),
            None,
            shell_spec.clone(),
        )
        .map_err(|e| {
            tracing::error!("Failed to create PTY for force-local split: {e}");
            SplitPaneError::SessionCreate(e)
        })?
    } else if let Some(params) = ssh_params {
        // Source is an SSH session - create a new SSH connection to the same host
        crate::ssh::create_ssh_session(manager, &new_pane_id, params, None).await.map_err(|e| {
            tracing::error!("Failed to create SSH session for split: {e}");
            SplitPaneError::SessionCreate(e)
        })?
    } else {
        // Local PTY - honor explicit cwd override, otherwise inherit from source pane
        let local_cwd = req.cwd.map(std::path::PathBuf::from).or(source_cwd);
        pty::create_session(
            manager,
            &new_pane_id,
            Some(tab_id),
            None,
            local_cwd.map(pty::LaunchCwd::Host),
            None,
            shell_spec,
        )
        .map_err(|e| {
            tracing::error!("Failed to create PTY for split: {e}");
            SplitPaneError::SessionCreate(e)
        })?
    };

    // Update layout tree
    let is_ssh = manager.sessions.get(&new_pane_id).is_some_and(|s| s.is_ssh());
    let new_layout =
        if let Some(session) = is_ssh.then(|| manager.sessions.get(&new_pane_id)).flatten() {
            let title = format!(
                "{}@{}",
                session.ssh_params.as_ref().map_or("ssh", |p| p.username.as_str()),
                session.ssh_params.as_ref().map_or("", |p| p.host.as_str()),
            );
            session::insert_pane_into_layout_with_info(
                &layout,
                &req.pane_id,
                &req.direction,
                &new_pane_id,
                &title,
                "ssh",
            )
        } else {
            session::insert_pane_into_layout(&layout, &req.pane_id, &req.direction, &new_pane_id)
        };
    let Some(new_layout) = new_layout else {
        // Clean up PTY if layout update fails
        manager.kill_and_remove(&new_pane_id);
        return Err(SplitPaneError::LayoutUpdateFailed);
    };

    // Store updated layout
    let active_pane_id = new_pane_id.clone();
    manager.insert_tab(
        tab_id.to_string(),
        serde_json::json!({
            "layout": new_layout.clone(),
            "active_pane_id": active_pane_id.clone(),
        }),
    );

    // Broadcast to all sync clients
    manager.broadcast_sync(&SyncMsg::LayoutUpdated {
        pane_id: tab_id.to_string(),
        layout: new_layout.clone(),
        active_pane_id,
    });
    manager.recheck_publish_or_correct(&new_pane_id, &session);

    Ok(SplitPaneOutcome { new_pane_id, layout: new_layout })
}

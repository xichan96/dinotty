use tauri::{AppHandle, WebviewWindow};

/// Bring an auxiliary window to the front, surfacing every failed step.
pub fn focus_window(window: &WebviewWindow) -> Result<(), String> {
    let mut failures = Vec::new();
    if let Err(error) = window.show() {
        failures.push(format!("show: {error}"));
    }
    if let Err(error) = window.unminimize() {
        failures.push(format!("unminimize: {error}"));
    }
    if let Err(error) = window.set_focus() {
        failures.push(format!("set_focus: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("failed to focus window: {}", failures.join(", ")))
    }
}

/// Run a task on the Tauri main thread and wait for its result. The runtime
/// executes the task inline when called from the main thread and queues it
/// otherwise, so this is safe from both command threads and event callbacks.
pub fn run_on_main_thread_blocking<T, F>(app: &AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(task());
    })
    .map_err(|error| format!("failed to schedule window task: {error}"))?;
    rx.recv().map_err(|error| format!("window task failed: {error}"))
}

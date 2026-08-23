use super::data::{
    Cell, CellAttrs, CommandResult, CommandState, CursorState, OscAction, PendingCommand,
    PrivateModes, ScreenBuffer, SyncEvent,
};
use super::performer::ScreenPerformer;
use super::render::{attrs_eq, encode_sgr, has_attrs, render_buffer, restore_cursor_state};
use std::collections::VecDeque;
use std::fmt::Write;
use std::time::Instant;

pub struct VirtualScreen {
    pub(crate) primary: ScreenBuffer,
    pub(crate) alternate: ScreenBuffer,
    pub(crate) using_alternate: bool,
    pub(crate) scrollback: VecDeque<Vec<Cell>>,
    parser: vte::Parser,
    pub(crate) cols: usize,
    pub(crate) rows: usize,
    pub(crate) saved_cursor: Option<CursorState>,
    // OSC 133 command detection
    pub(crate) command_state: CommandState,
    pub(crate) pending_command: Option<PendingCommand>,
    pub(crate) command_results: Vec<CommandResult>,
    // Prompt detection fallback
    pub(crate) last_output_time: Option<Instant>,
    // DEC mode 2026 synchronized output events
    pub(crate) sync_events: Vec<SyncEvent>,
    // OSC 9/777/BEL notification detection
    pub(crate) osc_actions: Vec<OscAction>,
    pub(crate) private_modes: PrivateModes,
}

impl VirtualScreen {
    #[must_use]
    pub fn new(cols: usize, rows: usize) -> Self {
        Self {
            primary: ScreenBuffer::new(cols, rows),
            alternate: ScreenBuffer::new(cols, rows),
            using_alternate: false,
            scrollback: VecDeque::new(),
            parser: vte::Parser::new(),
            cols,
            rows,
            saved_cursor: None,
            command_state: CommandState::Idle,
            pending_command: None,
            command_results: Vec::new(),
            last_output_time: None,
            sync_events: Vec::new(),
            osc_actions: Vec::new(),
            private_modes: PrivateModes::default(),
        }
    }

    /// Drain all pending sync events. Called by the PTY read loop after feeding output.
    pub fn drain_sync_events(&mut self) -> Vec<SyncEvent> {
        std::mem::take(&mut self.sync_events)
    }

    /// Drain all pending command results. Called by the WS handler after feeding output.
    pub fn drain_command_results(&mut self) -> Vec<CommandResult> {
        std::mem::take(&mut self.command_results)
    }

    /// Drain all pending OSC notification actions (OSC 9/777/BEL).
    pub fn drain_osc_actions(&mut self) -> Vec<OscAction> {
        std::mem::take(&mut self.osc_actions)
    }

    /// Get the collected stdout from the current/last command
    pub fn take_command_output(&mut self) -> String {
        self.pending_command
            .as_mut()
            .map(|p| String::from_utf8_lossy(&std::mem::take(&mut p.output_buf)).into_owned())
            .unwrap_or_default()
    }

    /// Check if shell integration (OSC 133) has been detected
    #[must_use]
    pub fn has_shell_integration(&self) -> bool {
        !self.command_results.is_empty()
            || matches!(self.command_state, CommandState::CommandStart | CommandState::Executing)
    }

    /// Check if enough time has passed since last output for prompt detection.
    /// Returns true if we should attempt prompt detection (>= 100ms silence).
    #[must_use]
    pub fn should_check_prompt(&self) -> bool {
        self.last_output_time.is_some_and(|t| t.elapsed().as_millis() >= 100)
            && self.command_state == CommandState::Idle
    }

    /// Attempt prompt detection on the current screen content.
    /// Returns a `CommandResult` if a prompt pattern is found at the cursor line.
    pub fn detect_prompt(&mut self) -> Option<CommandResult> {
        use regex::Regex;
        use std::sync::OnceLock;

        static PROMPT_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
        let patterns = PROMPT_PATTERNS.get_or_init(|| {
            [
                r"^[#$%>] ?$",
                r"^[a-zA-Z0-9_.\-]+@[a-zA-Z0-9_.\-]+[:~].*[$#] ?$",
                r"^[a-zA-Z0-9_.\-]+@.*\$ ?$",
            ]
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect()
        });

        // Get the current cursor line content
        let buf = if self.using_alternate { &self.alternate } else { &self.primary };
        let row = buf.cursor.row;
        if row >= buf.rows {
            return None;
        }

        let line: String = buf.cells[row]
            .iter()
            .take(buf.cursor.col + 1)
            .map(|c| if c.ch == '\0' { ' ' } else { c.ch })
            .collect();
        let line = line.trim_end();

        for re in patterns {
            if re.is_match(line) {
                let duration_ms = self
                    .pending_command
                    .as_ref()
                    .map_or(0, |p| p.start_time.elapsed().as_millis() as u64);

                self.command_state = CommandState::Idle;
                self.pending_command.take();

                return Some(CommandResult {
                    exit_code: -1,
                    duration_ms,
                    method: "prompt_detection".to_string(),
                });
            }
        }

        None
    }

    /// Called when a command is sent to the terminal (from agent API).
    /// Sets up state for command output collection.
    pub fn begin_command_tracking(&mut self) {
        self.command_state = CommandState::CommandStart;
        self.pending_command =
            Some(PendingCommand { start_time: Instant::now(), output_buf: Vec::new() });
    }

    /// Force-finish command tracking (e.g. on timeout). Returns collected output.
    pub fn finish_command_tracking(&mut self, exit_code: i32) -> (String, CommandResult) {
        let pending = self.pending_command.take();
        let stdout = pending
            .as_ref()
            .map(|p| String::from_utf8_lossy(&p.output_buf).into_owned())
            .unwrap_or_default();
        let duration_ms = pending.map_or(0, |p| p.start_time.elapsed().as_millis() as u64);

        let result = CommandResult { exit_code, duration_ms, method: "timeout".to_string() };
        self.command_state = CommandState::Idle;
        (stdout, result)
    }

    pub fn feed(&mut self, data: &[u8]) {
        // Track output timing for prompt detection fallback
        self.last_output_time = Some(Instant::now());

        // Collect visible output for command stdout capture
        if matches!(self.command_state, CommandState::CommandStart | CommandState::Executing) {
            if let Some(ref mut pending) = self.pending_command {
                // Only collect printable ASCII and UTF-8 text, skip ESC sequences
                for &b in data {
                    if b >= 0x20 && b != 0x7f {
                        pending.output_buf.push(b);
                    }
                }
                // Cap buffer at 1MB
                if pending.output_buf.len() > 1024 * 1024 {
                    pending.output_buf.drain(..512 * 1024);
                }
            }
        }

        let mut performer = ScreenPerformer {
            screen: if self.using_alternate { &mut self.alternate } else { &mut self.primary },
            scrollback: &mut self.scrollback,
            saved_cursor: &mut self.saved_cursor,
            pending_switch: None,
            using_alternate: self.using_alternate,
            command_state: &mut self.command_state,
            pending_command: &mut self.pending_command,
            command_results: &mut self.command_results,
            sync_events: &mut self.sync_events,
            osc_actions: &mut self.osc_actions,
            private_modes: &mut self.private_modes,
        };

        for &byte in data {
            self.parser.advance(&mut performer, byte);

            // Handle alternate screen switch after processing
            if let Some(enter) = performer.pending_switch.take() {
                if enter && !performer.using_alternate {
                    self.saved_cursor = Some(self.primary.cursor.clone());
                    self.alternate = ScreenBuffer::new(self.cols, self.rows);
                    // Recreate performer pointing at alternate screen
                    performer = ScreenPerformer {
                        screen: &mut self.alternate,
                        scrollback: &mut self.scrollback,
                        saved_cursor: &mut self.saved_cursor,
                        pending_switch: None,
                        using_alternate: true,
                        command_state: &mut self.command_state,
                        pending_command: &mut self.pending_command,
                        command_results: &mut self.command_results,
                        sync_events: &mut self.sync_events,
                        osc_actions: &mut self.osc_actions,
                        private_modes: &mut self.private_modes,
                    };
                } else if !enter && performer.using_alternate {
                    let saved = self.saved_cursor.clone();
                    // Recreate performer pointing at primary screen
                    performer = ScreenPerformer {
                        screen: &mut self.primary,
                        scrollback: &mut self.scrollback,
                        saved_cursor: &mut self.saved_cursor,
                        pending_switch: None,
                        using_alternate: false,
                        command_state: &mut self.command_state,
                        pending_command: &mut self.pending_command,
                        command_results: &mut self.command_results,
                        sync_events: &mut self.sync_events,
                        osc_actions: &mut self.osc_actions,
                        private_modes: &mut self.private_modes,
                    };
                    if let Some(ref s) = saved {
                        performer.screen.cursor = s.clone();
                    }
                }
            }
        }
        self.using_alternate = performer.using_alternate;
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.primary.resize(cols, rows, Some(&mut self.scrollback));
        self.alternate.resize(cols, rows, None);
    }

    #[must_use]
    pub fn snapshot_scrollback_chunks(&self, chunk_lines: usize) -> Vec<String> {
        // Scrollback belongs to the primary screen and is replayed even while
        // the alternate screen is active - the client resets xterm before the
        // replay, so skipping it would erase the visible history.
        if self.scrollback.is_empty() {
            return Vec::new();
        }
        let mut chunks = Vec::new();
        let mut current = String::new();
        let mut lines_in_chunk = 0;

        for row in &self.scrollback {
            let mut prev_attrs = CellAttrs::default();
            let last_content = row
                .iter()
                .rposition(|c| (c.ch != ' ' && c.ch != '\0') || has_attrs(&c.attrs))
                .map_or(0, |i| i + 1);
            for cell in &row[..last_content] {
                if cell.ch == '\0' {
                    continue;
                }
                if !attrs_eq(&cell.attrs, &prev_attrs) {
                    current.push_str(&encode_sgr(&cell.attrs));
                    prev_attrs = cell.attrs;
                }
                cell.write_to(&mut current);
            }
            if has_attrs(&prev_attrs) {
                current.push_str("\x1b[0m");
            }
            current.push_str("\r\n");
            lines_in_chunk += 1;

            if lines_in_chunk >= chunk_lines {
                chunks.push(std::mem::take(&mut current));
                lines_in_chunk = 0;
            }
        }
        if !current.is_empty() {
            chunks.push(current);
        }
        chunks
    }

    /// Snapshot for the reconnect replay path. Unlike [`Self::snapshot`], this
    /// assumes the client has just written the scrollback chunks into a
    /// freshly reset terminal, so it first scrolls the scrollback tail out of
    /// the viewport (the absolute-addressed redraw below would otherwise
    /// overwrite the last screenful of history before it ever reaches the
    /// client's scrollback buffer). When the alternate screen is active it
    /// also repaints the primary buffer before entering it, so leaving the
    /// alternate screen reveals the pre-reconnect content instead of a blank
    /// primary screen.
    #[must_use]
    pub fn snapshot_for_replay(&self) -> String {
        let mut out = String::with_capacity(self.cols * self.rows * 4);

        out.push_str("\x1b[?25l"); // hide cursor during draw

        // The last min(scrollback, rows-1) replayed lines are still in the
        // viewport (chunks end with \r\n, so the bottom row is the cursor's
        // blank line). Scroll them into the client's scrollback before
        // redrawing over them.
        let pending = self.scrollback.len().min(self.rows.saturating_sub(1));
        if pending > 0 {
            let _ = write!(out, "\x1b[{};1H", self.rows);
            for _ in 0..pending {
                out.push('\n');
            }
        }

        out.push_str("\x1b[0m"); // reset all attributes
        render_buffer(&self.primary, &mut out);
        if self.using_alternate {
            restore_cursor_state(&self.primary, &mut out);
            out.push_str("\x1b[?1049h"); // enter alternate screen (saves primary cursor)
            out.push_str("\x1b[0m");
            render_buffer(&self.alternate, &mut out);
            self.private_modes.write_replay(&mut out);
            restore_cursor_state(&self.alternate, &mut out);
        } else {
            self.private_modes.write_replay(&mut out);
            restore_cursor_state(&self.primary, &mut out);
        }
        out.push_str("\x1b[?25h"); // show cursor

        out
    }

    #[must_use]
    pub fn snapshot(&self) -> String {
        let buf = if self.using_alternate { &self.alternate } else { &self.primary };
        let mut out = String::with_capacity(self.cols * self.rows * 4);

        out.push_str("\x1b[?25l"); // hide cursor during draw
        out.push_str("\x1b[0m"); // reset all attributes

        if self.using_alternate {
            out.push_str("\x1b[?1049h"); // enter alternate screen
        }

        render_buffer(buf, &mut out);
        self.private_modes.write_replay(&mut out);
        restore_cursor_state(buf, &mut out);
        out.push_str("\x1b[?25h"); // show cursor

        out
    }

    #[must_use]
    pub fn snapshot_plain(&self) -> String {
        let buf = if self.using_alternate { &self.alternate } else { &self.primary };
        let mut lines = Vec::with_capacity(buf.rows);

        for row in &buf.cells {
            let mut line = String::with_capacity(self.cols);
            let last_content =
                row.iter().rposition(|c| c.ch != ' ' && c.ch != '\0').map_or(0, |i| i + 1);
            for cell in &row[..last_content] {
                if cell.ch == '\0' {
                    line.push(' ');
                } else {
                    line.push(cell.ch);
                }
            }
            lines.push(line);
        }
        lines.join("\n")
    }

    #[must_use]
    pub fn snapshot_scrollback_plain(&self, max_lines: Option<usize>) -> Vec<String> {
        if self.scrollback.is_empty() {
            return Vec::new();
        }
        let skip =
            if let Some(max) = max_lines { self.scrollback.len().saturating_sub(max) } else { 0 };

        self.scrollback
            .iter()
            .skip(skip)
            .map(|row| {
                let mut line = String::with_capacity(self.cols);
                let last_content =
                    row.iter().rposition(|c| c.ch != ' ' && c.ch != '\0').map_or(0, |i| i + 1);
                for cell in &row[..last_content] {
                    if cell.ch == '\0' {
                        line.push(' ');
                    } else {
                        line.push(cell.ch);
                    }
                }
                line
            })
            .collect()
    }

    #[must_use]
    pub fn scrollback_len(&self) -> usize {
        self.scrollback.len()
    }

    #[must_use]
    pub fn is_using_alternate(&self) -> bool {
        self.using_alternate
    }

    #[must_use]
    pub fn cols(&self) -> usize {
        self.cols
    }

    #[must_use]
    pub fn rows(&self) -> usize {
        self.rows
    }

    /// Get current cursor position (row, col).
    #[must_use]
    pub fn cursor_position(&self) -> (usize, usize) {
        let buf = if self.using_alternate { &self.alternate } else { &self.primary };
        (buf.cursor.row, buf.cursor.col)
    }
}

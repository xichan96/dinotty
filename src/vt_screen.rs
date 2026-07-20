#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::struct_excessive_bools
)]
use std::collections::VecDeque;
use std::fmt::Write;
use std::time::Instant;
use unicode_width::UnicodeWidthChar;
use vte::{Params, Perform};

/// OSC 133 command detection state
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandState {
    Idle,
    CommandStart,
    Executing,
}

/// Result of a detected command execution
#[derive(Clone, Debug)]
pub struct CommandResult {
    pub exit_code: i32,
    pub duration_ms: u64,
    pub method: String, // "shell_integration" or "prompt_detection"
}

/// Tracks a pending command for collecting output
struct PendingCommand {
    start_time: Instant,
    output_buf: String,
}

/// DEC mode 2026 synchronized output events
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncEvent {
    Start,
    Stop,
}

#[derive(Clone, Copy, Default)]
pub struct CellAttrs {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
    pub strikethrough: bool,
}

#[derive(Clone, Copy)]
pub enum Color {
    Indexed(u8),
    Rgb(u8, u8, u8),
}

const MAX_COMBINING: usize = 3;

#[derive(Clone, Copy)]
struct Cell {
    ch: char,
    combining: [char; MAX_COMBINING],
    combining_len: u8,
    attrs: CellAttrs,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            ch: ' ',
            combining: ['\0'; MAX_COMBINING],
            combining_len: 0,
            attrs: CellAttrs::default(),
        }
    }
}

impl Cell {
    fn push_combining(&mut self, c: char) {
        let len = self.combining_len as usize;
        if len < MAX_COMBINING {
            self.combining[len] = c;
            self.combining_len += 1;
        }
    }

    fn write_to(&self, out: &mut String) {
        out.push(self.ch);
        for i in 0..self.combining_len as usize {
            out.push(self.combining[i]);
        }
    }
}

#[derive(Clone, Default)]
struct CursorState {
    row: usize,
    col: usize,
    attrs: CellAttrs,
}

#[derive(Clone)]
struct ScreenBuffer {
    cells: Vec<Vec<Cell>>,
    cursor: CursorState,
    scroll_top: usize,
    scroll_bottom: usize,
    cols: usize,
    rows: usize,
}

impl ScreenBuffer {
    fn new(cols: usize, rows: usize) -> Self {
        Self {
            cells: vec![vec![Cell::default(); cols]; rows],
            cursor: CursorState::default(),
            scroll_top: 0,
            scroll_bottom: rows - 1,
            cols,
            rows,
        }
    }

    fn resize(
        &mut self,
        cols: usize,
        rows: usize,
        mut scrollback: Option<&mut VecDeque<Vec<Cell>>>,
    ) {
        let old_rows = self.cells.len();
        let old_cols = if old_rows > 0 { self.cells[0].len() } else { 0 };

        if rows < old_rows {
            let mut excess = old_rows - rows;
            // Trim blank rows below the cursor from the bottom first.
            while excess > 0
                && self.cells.len() > self.cursor.row + 1
                && self.cells.last().is_some_and(|last| {
                    last.iter().all(|c| (c.ch == ' ' || c.ch == '\0') && !has_attrs(&c.attrs))
                })
            {
                self.cells.pop();
                excess -= 1;
            }
            // Rows that still don't fit move from the top into scrollback
            // (primary screen only) instead of truncating the bottom, where
            // the most recent output and the prompt live.
            for _ in 0..excess {
                let row = self.cells.remove(0);
                if let Some(sb) = scrollback.as_deref_mut() {
                    sb.push_back(row);
                    if sb.len() > 10000 {
                        sb.pop_front();
                    }
                }
                self.cursor.row = self.cursor.row.saturating_sub(1);
            }
        } else if rows > old_rows {
            self.cells.resize(rows, vec![Cell::default(); cols]);
        }
        if cols != old_cols {
            for row in &mut self.cells {
                row.resize(cols, Cell::default());
            }
        }
        self.cols = cols;
        self.rows = rows;
        self.scroll_top = 0;
        self.scroll_bottom = rows - 1;
        if self.cursor.row >= rows {
            self.cursor.row = rows - 1;
        }
        if self.cursor.col >= cols {
            self.cursor.col = cols - 1;
        }
    }

    fn scroll_up(&mut self, scrollback: &mut VecDeque<Vec<Cell>>) {
        let row = self.cells.remove(self.scroll_top);
        if self.scroll_top == 0 {
            scrollback.push_back(row);
            if scrollback.len() > 10000 {
                scrollback.pop_front();
            }
        }
        self.cells.insert(self.scroll_bottom, vec![Cell::default(); self.cols]);
    }

    fn scroll_down(&mut self) {
        self.cells.remove(self.scroll_bottom);
        self.cells.insert(self.scroll_top, vec![Cell::default(); self.cols]);
    }
}

pub struct VirtualScreen {
    primary: ScreenBuffer,
    alternate: ScreenBuffer,
    using_alternate: bool,
    scrollback: VecDeque<Vec<Cell>>,
    parser: vte::Parser,
    cols: usize,
    rows: usize,
    saved_cursor: Option<CursorState>,
    // OSC 133 command detection
    command_state: CommandState,
    pending_command: Option<PendingCommand>,
    command_results: Vec<CommandResult>,
    // Prompt detection fallback
    last_output_time: Option<Instant>,
    // DEC mode 2026 synchronized output events
    sync_events: Vec<SyncEvent>,
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

    /// Get the collected stdout from the current/last command
    pub fn take_command_output(&mut self) -> String {
        self.pending_command.as_mut().map(|p| std::mem::take(&mut p.output_buf)).unwrap_or_default()
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
            Some(PendingCommand { start_time: Instant::now(), output_buf: String::new() });
    }

    /// Force-finish command tracking (e.g. on timeout). Returns collected output.
    pub fn finish_command_tracking(&mut self, exit_code: i32) -> (String, CommandResult) {
        let pending = self.pending_command.take();
        let stdout = pending.as_ref().map(|p| p.output_buf.clone()).unwrap_or_default();
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
                        pending.output_buf.push(b as char);
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
        // the alternate screen is active — the client resets xterm before the
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
        restore_cursor_state(&self.primary, &mut out);
        if self.using_alternate {
            out.push_str("\x1b[?1049h"); // enter alternate screen (saves primary cursor)
            out.push_str("\x1b[0m");
            render_buffer(&self.alternate, &mut out);
            restore_cursor_state(&self.alternate, &mut out);
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

/// Render every row of `buf` with absolute addressing (`CSI row;1 H` +
/// erase-line), skipping trailing blanks, and leave attributes reset.
fn render_buffer(buf: &ScreenBuffer, out: &mut String) {
    let mut prev_attrs = CellAttrs::default();
    for (row_idx, row) in buf.cells.iter().enumerate() {
        let _ = write!(out, "\x1b[{};1H\x1b[2K", row_idx + 1); // move to row start + erase line

        // Find last non-space column to avoid trailing spaces
        let last_content = row
            .iter()
            .rposition(|c| (c.ch != ' ' && c.ch != '\0') || has_attrs(&c.attrs))
            .map_or(0, |i| i + 1);

        for cell in &row[..last_content] {
            if cell.ch == '\0' {
                continue;
            }
            if !attrs_eq(&cell.attrs, &prev_attrs) {
                out.push_str(&encode_sgr(&cell.attrs));
                prev_attrs = cell.attrs;
            }
            cell.write_to(out);
        }

        // Reset attrs at end of row
        if has_attrs(&prev_attrs) {
            out.push_str("\x1b[0m");
            prev_attrs = CellAttrs::default();
        }
    }
    out.push_str("\x1b[0m");
}

/// Restore `buf`'s scroll region (if non-default) and cursor position.
fn restore_cursor_state(buf: &ScreenBuffer, out: &mut String) {
    if buf.scroll_top != 0 || buf.scroll_bottom != buf.rows - 1 {
        let _ = write!(out, "\x1b[{};{}r", buf.scroll_top + 1, buf.scroll_bottom + 1);
    }
    let _ = write!(out, "\x1b[{};{}H", buf.cursor.row + 1, buf.cursor.col + 1);
}

fn has_attrs(a: &CellAttrs) -> bool {
    a.fg.is_some()
        || a.bg.is_some()
        || a.bold
        || a.dim
        || a.italic
        || a.underline
        || a.inverse
        || a.strikethrough
}

fn attrs_eq(a: &CellAttrs, b: &CellAttrs) -> bool {
    color_eq(a.fg, b.fg)
        && color_eq(a.bg, b.bg)
        && a.bold == b.bold
        && a.dim == b.dim
        && a.italic == b.italic
        && a.underline == b.underline
        && a.inverse == b.inverse
        && a.strikethrough == b.strikethrough
}

fn color_eq(a: Option<Color>, b: Option<Color>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(Color::Indexed(x)), Some(Color::Indexed(y))) => x == y,
        (Some(Color::Rgb(r1, g1, b1)), Some(Color::Rgb(r2, g2, b2))) => {
            r1 == r2 && g1 == g2 && b1 == b2
        }
        _ => false,
    }
}

fn encode_sgr(attrs: &CellAttrs) -> String {
    let mut params: Vec<String> = vec!["0".to_string()]; // reset first
    if attrs.bold {
        params.push("1".to_string());
    }
    if attrs.dim {
        params.push("2".to_string());
    }
    if attrs.italic {
        params.push("3".to_string());
    }
    if attrs.underline {
        params.push("4".to_string());
    }
    if attrs.inverse {
        params.push("7".to_string());
    }
    if attrs.strikethrough {
        params.push("9".to_string());
    }
    match attrs.fg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 30 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 90 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("38;5;{c}")),
        Some(Color::Rgb(r, g, b)) => params.push(format!("38;2;{r};{g};{b}")),
        None => {}
    }
    match attrs.bg {
        Some(Color::Indexed(c)) if c < 8 => params.push(format!("{}", 40 + c)),
        Some(Color::Indexed(c)) if c < 16 => params.push(format!("{}", 100 + c - 8)),
        Some(Color::Indexed(c)) => params.push(format!("48;5;{c}")),
        Some(Color::Rgb(r, g, b)) => params.push(format!("48;2;{r};{g};{b}")),
        None => {}
    }
    format!("\x1b[{}m", params.join(";"))
}

// Internal performer that applies VT sequences to the screen buffer
struct ScreenPerformer<'a> {
    screen: &'a mut ScreenBuffer,
    scrollback: &'a mut VecDeque<Vec<Cell>>,
    saved_cursor: &'a mut Option<CursorState>,
    pending_switch: Option<bool>,
    using_alternate: bool,
    command_state: &'a mut CommandState,
    pending_command: &'a mut Option<PendingCommand>,
    command_results: &'a mut Vec<CommandResult>,
    sync_events: &'a mut Vec<SyncEvent>,
}

impl Perform for ScreenPerformer<'_> {
    fn print(&mut self, c: char) {
        let width = UnicodeWidthChar::width(c).unwrap_or(0);
        if width == 0 {
            // Append combining character to the previous cell
            let row = self.screen.cursor.row;
            let col = self.screen.cursor.col;
            if row < self.screen.rows && col > 0 {
                let prev = &mut self.screen.cells[row][col - 1];
                if prev.ch != ' ' && prev.ch != '\0' {
                    prev.push_combining(c);
                }
            }
            return;
        }
        if self.screen.cursor.col >= self.screen.cols {
            self.screen.cursor.col = 0;
            self.screen.cursor.row += 1;
            if self.screen.cursor.row > self.screen.scroll_bottom {
                self.screen.cursor.row = self.screen.scroll_bottom;
                self.screen.scroll_up(self.scrollback);
            }
        }
        if width == 2 && self.screen.cursor.col + 1 >= self.screen.cols {
            self.screen.cursor.col = 0;
            self.screen.cursor.row += 1;
            if self.screen.cursor.row > self.screen.scroll_bottom {
                self.screen.cursor.row = self.screen.scroll_bottom;
                self.screen.scroll_up(self.scrollback);
            }
        }
        let row = self.screen.cursor.row;
        let col = self.screen.cursor.col;
        if row < self.screen.rows && col < self.screen.cols {
            // Clear orphaned half of a wide char we're about to overwrite
            let old = self.screen.cells[row][col].ch;
            if old == '\0' && col > 0 {
                self.screen.cells[row][col - 1] = Cell::default();
            }
            if old != '\0' && old != ' ' {
                if let Some(2) = UnicodeWidthChar::width(old) {
                    if col + 1 < self.screen.cols {
                        self.screen.cells[row][col + 1] = Cell::default();
                    }
                }
            }
            self.screen.cells[row][col] = Cell {
                ch: c,
                combining: ['\0'; MAX_COMBINING],
                combining_len: 0,
                attrs: self.screen.cursor.attrs,
            };
            if width == 2 && col + 1 < self.screen.cols {
                self.screen.cells[row][col + 1] = Cell {
                    ch: '\0',
                    combining: ['\0'; MAX_COMBINING],
                    combining_len: 0,
                    attrs: self.screen.cursor.attrs,
                };
            }
        }
        self.screen.cursor.col += width;
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            0x08 // BS
                if self.screen.cursor.col > 0 => {
                    self.screen.cursor.col -= 1;
                }
            0x09 => { // HT (tab)
                self.screen.cursor.col = ((self.screen.cursor.col / 8) + 1) * 8;
                if self.screen.cursor.col >= self.screen.cols {
                    self.screen.cursor.col = self.screen.cols - 1;
                }
            }
            0x0A..=0x0C => { // LF, VT, FF
                self.screen.cursor.row += 1;
                if self.screen.cursor.row > self.screen.scroll_bottom {
                    self.screen.cursor.row = self.screen.scroll_bottom;
                    self.screen.scroll_up(self.scrollback);
                }
            }
            0x0D => { // CR
                self.screen.cursor.col = 0;
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        // OSC 133: Shell Integration (VS Code / FinalTerm / iTerm2)
        // Format: ESC ] 133 ; <cmd> [ ; <args> ] ST
        //   A = Prompt start
        //   B = Command start (after user presses Enter)
        //   C = Command executed (not all shells emit this)
        //   D = Command finished, followed by ;exit_code
        if params.len() < 2 {
            return;
        }
        // First param should be "133"
        if params[0] != b"133" {
            return;
        }
        let cmd = params[1];
        match cmd {
            b"A" => {
                // Prompt start
                *self.command_state = CommandState::Idle;
                self.pending_command.take();
            }
            b"B" => {
                // Command start (user executed a command)
                // If already tracking a command (double B without D), force-finish the old one
                if matches!(
                    *self.command_state,
                    CommandState::CommandStart | CommandState::Executing
                ) {
                    if let Some(pending) = self.pending_command.take() {
                        let duration_ms = pending.start_time.elapsed().as_millis() as u64;
                        self.command_results.push(CommandResult {
                            exit_code: -1,
                            duration_ms,
                            method: "interrupted".to_string(),
                        });
                    }
                }
                *self.command_state = CommandState::CommandStart;
                *self.pending_command =
                    Some(PendingCommand { start_time: Instant::now(), output_buf: String::new() });
            }
            b"D" => {
                // Command finished
                let exit_code = if params.len() >= 3 {
                    std::str::from_utf8(params[2])
                        .ok()
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(-1)
                } else {
                    -1
                };

                let duration_ms = self
                    .pending_command
                    .as_ref()
                    .map_or(0, |p| p.start_time.elapsed().as_millis() as u64);

                let stdout = self
                    .pending_command
                    .as_mut()
                    .map(|p| std::mem::take(&mut p.output_buf))
                    .unwrap_or_default();

                self.command_results.push(CommandResult {
                    exit_code,
                    duration_ms,
                    method: "shell_integration".to_string(),
                });

                *self.command_state = CommandState::Idle;
                self.pending_command.take();
                let _ = stdout; // available for future use
            }
            _ => {}
        }
    }

    #[allow(clippy::too_many_lines)]
    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        // Handle DECSET/DECRST (CSI ? Ps h/l)
        if intermediates == b"?" {
            let ps: Vec<u16> = params.iter().flat_map(|s| s.iter().copied()).collect();
            match action {
                'h' => {
                    for &p in &ps {
                        if p == 1049 || p == 47 || p == 1047 {
                            self.pending_switch = Some(true);
                        } else if p == 2026 {
                            self.sync_events.push(SyncEvent::Start);
                        }
                    }
                    return;
                }
                'l' => {
                    for &p in &ps {
                        if p == 1049 || p == 47 || p == 1047 {
                            self.pending_switch = Some(false);
                        } else if p == 2026 {
                            self.sync_events.push(SyncEvent::Stop);
                        }
                    }
                    return;
                }
                _ => {}
            }
            return;
        }

        // Only the empty-intermediate (standard) CSI forms below are implemented.
        // `intermediates` here also carries private-parameter bytes `<=>` and true
        // intermediate bytes (0x20-0x2f); ignore them all rather than dispatch by
        // final byte alone — e.g. `\e[>4;2m` (modifyOtherKeys) must not become SGR,
        // and `CSI Ps SP @` (SL) must not become ICH. If SL/SR/etc. are ever added,
        // match on (action, intermediates) BEFORE this guard.
        if !intermediates.is_empty() {
            return;
        }

        let ps: Vec<u16> = params.iter().flat_map(|s| s.iter().copied()).collect();
        let p0 = ps.first().copied().unwrap_or(0) as usize;
        let p1 = ps.get(1).copied().unwrap_or(0) as usize;

        match action {
            'A' => {
                // CUU - cursor up
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = self.screen.cursor.row.saturating_sub(n);
            }
            'B' => {
                // CUD - cursor down
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = (self.screen.cursor.row + n).min(self.screen.rows - 1);
            }
            'C' => {
                // CUF - cursor forward
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = (self.screen.cursor.col + n).min(self.screen.cols - 1);
            }
            'D' => {
                // CUB - cursor back
                let n = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = self.screen.cursor.col.saturating_sub(n);
            }
            'H' | 'f' => {
                // CUP - cursor position
                let row = if p0 == 0 { 1 } else { p0 };
                let col = if p1 == 0 { 1 } else { p1 };
                self.screen.cursor.row = (row - 1).min(self.screen.rows - 1);
                self.screen.cursor.col = (col - 1).min(self.screen.cols - 1);
            }
            'J' => {
                // ED - erase display
                match p0 {
                    0 => {
                        // from cursor to end
                        let row = self.screen.cursor.row;
                        let col = self.screen.cursor.col;
                        for c in &mut self.screen.cells[row][col..] {
                            *c = Cell::default();
                        }
                        for r in (row + 1)..self.screen.rows {
                            for c in &mut self.screen.cells[r] {
                                *c = Cell::default();
                            }
                        }
                    }
                    1 => {
                        // from start to cursor
                        let row = self.screen.cursor.row;
                        let col = self.screen.cursor.col;
                        for r in 0..row {
                            for c in &mut self.screen.cells[r] {
                                *c = Cell::default();
                            }
                        }
                        for c in &mut self.screen.cells[row][..=col.min(self.screen.cols - 1)] {
                            *c = Cell::default();
                        }
                    }
                    2 | 3 => {
                        // entire screen
                        for r in &mut self.screen.cells {
                            for c in r {
                                *c = Cell::default();
                            }
                        }
                    }
                    _ => {}
                }
            }
            'K' => {
                // EL - erase line
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                match p0 {
                    0 => {
                        for c in &mut self.screen.cells[row][col..] {
                            *c = Cell::default();
                        }
                    }
                    1 => {
                        for c in &mut self.screen.cells[row][..=col.min(self.screen.cols - 1)] {
                            *c = Cell::default();
                        }
                    }
                    2 => {
                        for c in &mut self.screen.cells[row] {
                            *c = Cell::default();
                        }
                    }
                    _ => {}
                }
            }
            'L' => {
                // IL - insert lines
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                for _ in 0..n {
                    if self.screen.scroll_bottom < self.screen.cells.len() {
                        self.screen.cells.remove(self.screen.scroll_bottom);
                    }
                    self.screen.cells.insert(row, vec![Cell::default(); self.screen.cols]);
                }
            }
            'M' => {
                // DL - delete lines
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                for _ in 0..n {
                    if row < self.screen.cells.len() {
                        self.screen.cells.remove(row);
                    }
                    self.screen
                        .cells
                        .insert(self.screen.scroll_bottom, vec![Cell::default(); self.screen.cols]);
                }
            }
            'P' => {
                // DCH - delete characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for _ in 0..n {
                    if col < self.screen.cells[row].len() {
                        self.screen.cells[row].remove(col);
                        self.screen.cells[row].push(Cell::default());
                    }
                }
            }
            '@' => {
                // ICH - insert characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for _ in 0..n {
                    self.screen.cells[row].insert(col, Cell::default());
                    self.screen.cells[row].truncate(self.screen.cols);
                }
            }
            'S' => {
                // SU - scroll up
                let n = if p0 == 0 { 1 } else { p0 };
                for _ in 0..n {
                    self.screen.scroll_up(self.scrollback);
                }
            }
            'T' => {
                // SD - scroll down
                let n = if p0 == 0 { 1 } else { p0 };
                for _ in 0..n {
                    self.screen.scroll_down();
                }
            }
            'r' => {
                // DECSTBM - set scroll region
                let top = if p0 == 0 { 1 } else { p0 };
                let bottom = if p1 == 0 { self.screen.rows } else { p1 };
                self.screen.scroll_top = (top - 1).min(self.screen.rows - 1);
                self.screen.scroll_bottom = (bottom - 1).min(self.screen.rows - 1);
                self.screen.cursor.row = 0;
                self.screen.cursor.col = 0;
            }
            'd' => {
                // VPA - line position absolute
                let row = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.row = (row - 1).min(self.screen.rows - 1);
            }
            'G' | '`' => {
                // CHA - cursor character absolute
                let col = if p0 == 0 { 1 } else { p0 };
                self.screen.cursor.col = (col - 1).min(self.screen.cols - 1);
            }
            'X' => {
                // ECH - erase characters
                let n = if p0 == 0 { 1 } else { p0 };
                let row = self.screen.cursor.row;
                let col = self.screen.cursor.col;
                for i in 0..n {
                    if col + i < self.screen.cols {
                        self.screen.cells[row][col + i] = Cell::default();
                    }
                }
            }
            'm' => {
                // SGR - select graphic rendition
                self.apply_sgr(params);
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], _ignore: bool, byte: u8) {
        match (intermediates, byte) {
            (b"7", _) | ([], b'7') => {
                // DECSC - save cursor
                *self.saved_cursor = Some(self.screen.cursor.clone());
            }
            (b"8", _) | ([], b'8') => {
                // DECRC - restore cursor
                if let Some(ref saved) = self.saved_cursor {
                    self.screen.cursor = saved.clone();
                }
            }
            ([], b'M') => {
                // RI - reverse index (scroll down)
                if self.screen.cursor.row == self.screen.scroll_top {
                    self.screen.scroll_down();
                } else if self.screen.cursor.row > 0 {
                    self.screen.cursor.row -= 1;
                }
            }
            _ => {}
        }
    }
}

impl ScreenPerformer<'_> {
    fn apply_sgr(&mut self, params: &Params) {
        if params.is_empty() {
            self.screen.cursor.attrs = CellAttrs::default();
            return;
        }
        // Build a list of (value, has_subparam) pairs to distinguish 4 from 4:N
        // Each sub-slice from Params represents colon-separated sub-parameters.
        // E.g. "4:3" yields one sub-slice [4, 3], while "4;3" yields two sub-slices [4] and [3].
        let mut sgr_items: Vec<(u16, Option<u16>)> = Vec::new();
        for sub in params {
            if sub.is_empty() {
                continue;
            }
            // First element is the SGR code; second (if present) is a colon sub-parameter
            sgr_items.push((sub[0], sub.get(1).copied()));
        }

        let mut i = 0;
        while i < sgr_items.len() {
            let (code, sub) = sgr_items[i];
            match code {
                0 => self.screen.cursor.attrs = CellAttrs::default(),
                1 => self.screen.cursor.attrs.bold = true,
                2 => self.screen.cursor.attrs.dim = true,
                3 => self.screen.cursor.attrs.italic = true,
                4 => {
                    // 4 = underline on; 4:0 = off, 4:1..4:5 = various styles (all "on" for us)
                    match sub {
                        Some(0) => self.screen.cursor.attrs.underline = false,
                        _ => self.screen.cursor.attrs.underline = true,
                    }
                }
                7 => self.screen.cursor.attrs.inverse = true,
                9 => self.screen.cursor.attrs.strikethrough = true,
                21 | 22 => {
                    self.screen.cursor.attrs.bold = false;
                    self.screen.cursor.attrs.dim = false;
                }
                23 => self.screen.cursor.attrs.italic = false,
                24 => self.screen.cursor.attrs.underline = false,
                27 => self.screen.cursor.attrs.inverse = false,
                29 => self.screen.cursor.attrs.strikethrough = false,
                30..=37 => self.screen.cursor.attrs.fg = Some(Color::Indexed((code - 30) as u8)),
                38 => {
                    i += 1;
                    if i < sgr_items.len() {
                        match sgr_items[i].0 {
                            5 => {
                                i += 1;
                                if i < sgr_items.len() {
                                    self.screen.cursor.attrs.fg =
                                        Some(Color::Indexed(sgr_items[i].0 as u8));
                                }
                            }
                            2 if i + 3 < sgr_items.len() => {
                                self.screen.cursor.attrs.fg = Some(Color::Rgb(
                                    sgr_items[i + 1].0 as u8,
                                    sgr_items[i + 2].0 as u8,
                                    sgr_items[i + 3].0 as u8,
                                ));
                                i += 3;
                            }
                            _ => {}
                        }
                    }
                }
                39 => self.screen.cursor.attrs.fg = None,
                40..=47 => self.screen.cursor.attrs.bg = Some(Color::Indexed((code - 40) as u8)),
                48 => {
                    i += 1;
                    if i < sgr_items.len() {
                        match sgr_items[i].0 {
                            5 => {
                                i += 1;
                                if i < sgr_items.len() {
                                    self.screen.cursor.attrs.bg =
                                        Some(Color::Indexed(sgr_items[i].0 as u8));
                                }
                            }
                            2 if i + 3 < sgr_items.len() => {
                                self.screen.cursor.attrs.bg = Some(Color::Rgb(
                                    sgr_items[i + 1].0 as u8,
                                    sgr_items[i + 2].0 as u8,
                                    sgr_items[i + 3].0 as u8,
                                ));
                                i += 3;
                            }
                            _ => {}
                        }
                    }
                }
                49 => self.screen.cursor.attrs.bg = None,
                90..=97 => {
                    self.screen.cursor.attrs.fg = Some(Color::Indexed((code - 90 + 8) as u8));
                }
                100..=107 => {
                    self.screen.cursor.attrs.bg = Some(Color::Indexed((code - 100 + 8) as u8));
                }
                _ => {}
            }
            i += 1;
        }
    }
}

#[cfg(test)]
mod csi_dispatch_tests {
    use super::*;

    fn cell(vs: &VirtualScreen, row: usize, col: usize) -> &Cell {
        &vs.primary.cells[row][col]
    }

    // `CSI > 4 ; 2 m` (XTMODKEYS) must NOT be parsed as SGR — regression for the
    // spurious full-screen underline+dim leak seen when TUIs (e.g. Claude Code)
    // emit modifyOtherKeys before drawing.
    #[test]
    fn private_marker_sgr_is_not_applied() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[>4;2mX");
        let c = cell(&vs, 0, 0);
        assert_eq!(c.ch, 'X');
        assert!(!c.attrs.underline, "private-marker >4;2m leaked underline onto cell");
        assert!(!c.attrs.dim, "private-marker >4;2m leaked dim onto cell");
    }

    #[test]
    fn all_non_question_private_markers_are_not_sgr() {
        for marker in *b"><=" {
            let sequence = [b"\x1b[".as_slice(), &[marker], b"4;2mX"].concat();
            let mut vs = VirtualScreen::new(20, 5);
            vs.feed(&sequence);
            let c = cell(&vs, 0, 0);
            assert_eq!(c.ch, 'X');
            assert!(!c.attrs.underline, "private marker {marker:?} leaked underline onto cell");
            assert!(!c.attrs.dim, "private marker {marker:?} leaked dim onto cell");
        }
    }

    // Standard SGR underline (no marker) must still work.
    #[test]
    fn standard_sgr_underline_applies() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[4mX");
        assert!(cell(&vs, 0, 0).attrs.underline, "standard \\e[4m failed to underline");
    }

    // Colon sub-params stay in `params` (not `intermediates`), so 4:3 (curly) is
    // still underline-on and 4:0 is off — unaffected by the intermediates guard.
    #[test]
    fn colon_subparam_underline_unaffected() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[4:3mA\x1b[4:0mB");
        assert!(cell(&vs, 0, 0).attrs.underline, "4:3 should be underline-on");
        assert!(!cell(&vs, 0, 1).attrs.underline, "4:0 should be underline-off");
    }

    // `CSI > 4 ; 2 f` (XTFMTKEYS) must NOT be treated as HVP cursor move.
    #[test]
    fn private_marker_f_does_not_move_cursor() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[>4;2fX");
        assert_eq!(cell(&vs, 0, 0).ch, 'X', "private-marker >4;2f wrongly moved the cursor");
    }

    #[test]
    fn true_intermediate_sl_is_not_dispatched_as_ich() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"XY");
        vs.feed(b"\x1b[1;1H");
        vs.feed(b"\x1b[1 @");
        assert_eq!(cell(&vs, 0, 0).ch, 'X', "CSI Ps SP @ was wrongly dispatched as ICH");
    }

    #[test]
    fn decset_1049_enters_alternate_screen() {
        let mut vs = VirtualScreen::new(20, 5);
        assert!(!vs.is_using_alternate());
        vs.feed(b"\x1b[?1049h");
        assert!(vs.is_using_alternate());
    }
}

// Reconnect replay + resize history preservation. The client resets xterm on
// Reconnected, then the server replays scrollback chunks followed by
// snapshot_for_replay() — these tests pin the escape-sequence contract that
// keeps the replayed scrollback out of the redraw's way, and that resize
// never silently drops screen content.
#[cfg(test)]
mod replay_and_resize_tests {
    use super::*;

    fn feed_lines(vs: &mut VirtualScreen, n: usize) {
        for i in 0..n {
            vs.feed(format!("l{i}\r\n").as_bytes());
        }
    }

    // After the scrollback chunks are written into a freshly reset terminal,
    // the tail of the scrollback still sits in the viewport. The replay
    // snapshot must scroll it out (cursor to bottom row + one LF per pending
    // line) before redrawing with absolute addressing, or those lines are
    // overwritten and never reach the client's scrollback buffer.
    #[test]
    fn replay_snapshot_scrolls_short_scrollback_out_of_viewport() {
        let mut vs = VirtualScreen::new(20, 6);
        feed_lines(&mut vs, 8); // 6 rows -> 3 lines scrolled into scrollback
        assert_eq!(vs.scrollback_len(), 3);
        let snap = vs.snapshot_for_replay();
        let expected = format!("\x1b[?25l\x1b[6;1H{}", "\n".repeat(3));
        assert!(
            snap.starts_with(&expected),
            "replay snapshot must scroll the 3 pending scrollback lines out first, got: {:?}",
            &snap[..expected.len().min(snap.len())]
        );
    }

    // With a full viewport of scrollback tail, rows-1 lines are pending.
    #[test]
    fn replay_snapshot_scrolls_full_viewport_of_scrollback_out() {
        let mut vs = VirtualScreen::new(20, 6);
        feed_lines(&mut vs, 20);
        assert_eq!(vs.scrollback_len(), 15);
        let snap = vs.snapshot_for_replay();
        let expected = format!("\x1b[?25l\x1b[6;1H{}", "\n".repeat(5));
        assert!(
            snap.starts_with(&expected),
            "replay snapshot must scroll rows-1 pending lines out first"
        );
    }

    #[test]
    fn replay_snapshot_without_scrollback_has_no_padding() {
        let mut vs = VirtualScreen::new(20, 6);
        vs.feed(b"hi");
        assert_eq!(vs.scrollback_len(), 0);
        let snap = vs.snapshot_for_replay();
        assert!(
            snap.starts_with("\x1b[?25l\x1b[0m"),
            "no scrollback -> no scroll padding before the redraw"
        );
    }

    // Scrollback belongs to the primary screen and must be replayed even when
    // the session is currently in the alternate screen — the client just reset
    // xterm, so skipping it here loses the entire visible history once the
    // alternate-screen app exits.
    #[test]
    fn scrollback_is_replayed_while_in_alternate_screen() {
        let mut vs = VirtualScreen::new(20, 6);
        feed_lines(&mut vs, 10);
        vs.feed(b"\x1b[?1049h");
        assert!(vs.is_using_alternate());
        assert!(
            !vs.snapshot_scrollback_chunks(200).is_empty(),
            "primary scrollback must be replayed while in alternate screen"
        );
    }

    // In alternate-screen mode the replay must paint the primary buffer
    // first, then enter the alternate screen and paint it — so that a later
    // DECRST 1049 reveals the pre-reconnect primary content instead of a
    // blank screen.
    #[test]
    fn replay_snapshot_paints_primary_before_entering_alternate() {
        let mut vs = VirtualScreen::new(30, 6);
        vs.feed(b"primary-content\r\n");
        vs.feed(b"\x1b[?1049h");
        vs.feed(b"alt-content");
        let snap = vs.snapshot_for_replay();
        let alt_enter = snap.find("\x1b[?1049h").expect("replay must enter alternate screen");
        let primary = snap.find("primary-content").expect("replay must include primary screen");
        let alt = snap.find("alt-content").expect("replay must include alternate screen");
        assert!(primary < alt_enter, "primary content must be painted before entering alt screen");
        assert!(alt > alt_enter, "alt content must be painted after entering alt screen");
    }

    // Shrinking rows must push the top rows into scrollback (like a real
    // terminal), not truncate the bottom of the screen where the most recent
    // output lives.
    #[test]
    fn resize_shrink_pushes_top_rows_into_scrollback() {
        let mut vs = VirtualScreen::new(10, 4);
        vs.feed(b"l1\r\nl2\r\nl3\r\nl4");
        assert_eq!(vs.scrollback_len(), 0);
        vs.resize(10, 2);
        assert_eq!(vs.scrollback_len(), 2, "top rows must move into scrollback on shrink");
        assert_eq!(vs.snapshot_scrollback_plain(None), vec!["l1".to_string(), "l2".to_string()]);
        assert_eq!(vs.snapshot_plain(), "l3\nl4", "bottom rows must stay on screen");
        assert_eq!(vs.primary.cursor.row, 1, "cursor must follow the content up");
    }

    // Blank rows below the cursor are removed first, so a mostly-empty screen
    // shrinks without polluting scrollback.
    #[test]
    fn resize_shrink_trims_blank_bottom_rows_before_scrollback() {
        let mut vs = VirtualScreen::new(10, 4);
        vs.feed(b"top");
        vs.resize(10, 2);
        assert_eq!(vs.scrollback_len(), 0, "blank bottom rows must be trimmed, not scrolled back");
        assert_eq!(vs.snapshot_plain(), "top\n");
        assert_eq!(vs.primary.cursor.row, 0);
    }
}

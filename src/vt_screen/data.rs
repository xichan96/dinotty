use std::collections::VecDeque;
use std::time::Instant;

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
pub(crate) struct PendingCommand {
    pub start_time: Instant,
    pub output_buf: Vec<u8>,
}

/// DEC mode 2026 synchronized output events
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncEvent {
    Start,
    Stop,
}

/// OSC 9 / OSC 777 / BEL notification detection result
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OscAction {
    Bell,
    Notify { title: Option<String>, body: String },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum MouseProtocol {
    #[default]
    None,
    X10,
    Normal,
    Button,
    Any,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum MouseEncoding {
    #[default]
    Default,
    Sgr,
    SgrPixels,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PrivateModes {
    pub mouse: MouseProtocol,
    pub encoding: MouseEncoding,
    pub cursor_keys: bool,
    pub keypad: bool,
    pub bracketed_paste: bool,
    pub focus_event: bool,
}

impl PrivateModes {
    pub(crate) fn soft_reset(&mut self) {
        self.cursor_keys = false;
        self.keypad = false;
        self.bracketed_paste = false;
        self.focus_event = false;
    }

    pub(crate) fn write_replay(self, out: &mut String) {
        // Install the encoding first so a mouse event racing replay cannot be
        // emitted using the wrong wire format.
        match self.encoding {
            MouseEncoding::Default => {}
            MouseEncoding::Sgr => out.push_str("\x1b[?1006h"),
            MouseEncoding::SgrPixels => out.push_str("\x1b[?1016h"),
        }
        match self.mouse {
            MouseProtocol::None => {}
            MouseProtocol::X10 => out.push_str("\x1b[?9h"),
            MouseProtocol::Normal => out.push_str("\x1b[?1000h"),
            MouseProtocol::Button => out.push_str("\x1b[?1002h"),
            MouseProtocol::Any => out.push_str("\x1b[?1003h"),
        }
        if self.cursor_keys {
            out.push_str("\x1b[?1h");
        }
        if self.keypad {
            out.push_str("\x1b[?66h");
        }
        if self.bracketed_paste {
            out.push_str("\x1b[?2004h");
        }
        // Focus events (1004) are tracked but intentionally not replayed: a
        // reconnect can otherwise trigger a focus-report feedback storm.
    }
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

pub(crate) const MAX_COMBINING: usize = 3;

#[derive(Clone, Copy)]
pub(crate) struct Cell {
    pub ch: char,
    pub combining: [char; MAX_COMBINING],
    pub combining_len: u8,
    pub attrs: CellAttrs,
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
    pub(crate) fn push_combining(&mut self, c: char) {
        let len = self.combining_len as usize;
        if len < MAX_COMBINING {
            self.combining[len] = c;
            self.combining_len += 1;
        }
    }

    pub(crate) fn write_to(&self, out: &mut String) {
        out.push(self.ch);
        for i in 0..self.combining_len as usize {
            out.push(self.combining[i]);
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct CursorState {
    pub row: usize,
    pub col: usize,
    pub attrs: CellAttrs,
}

#[derive(Clone)]
pub(crate) struct ScreenBuffer {
    pub cells: Vec<Vec<Cell>>,
    pub cursor: CursorState,
    pub scroll_top: usize,
    pub scroll_bottom: usize,
    pub cols: usize,
    pub rows: usize,
}

impl ScreenBuffer {
    pub(crate) fn new(cols: usize, rows: usize) -> Self {
        Self {
            cells: vec![vec![Cell::default(); cols]; rows],
            cursor: CursorState::default(),
            scroll_top: 0,
            scroll_bottom: rows - 1,
            cols,
            rows,
        }
    }

    pub(crate) fn resize(
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
                    last.iter().all(|c| {
                        (c.ch == ' ' || c.ch == '\0') && !super::render::has_attrs(&c.attrs)
                    })
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

    pub(crate) fn scroll_up(&mut self, scrollback: &mut VecDeque<Vec<Cell>>) {
        let row = self.cells.remove(self.scroll_top);
        if self.scroll_top == 0 {
            scrollback.push_back(row);
            if scrollback.len() > 10000 {
                scrollback.pop_front();
            }
        }
        self.cells.insert(self.scroll_bottom, vec![Cell::default(); self.cols]);
    }

    pub(crate) fn scroll_down(&mut self) {
        self.cells.remove(self.scroll_bottom);
        self.cells.insert(self.scroll_top, vec![Cell::default(); self.cols]);
    }
}

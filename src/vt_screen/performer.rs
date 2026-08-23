use super::data::{
    Cell, CellAttrs, Color, CommandResult, CommandState, MouseEncoding, MouseProtocol, OscAction,
    PendingCommand, PrivateModes, ScreenBuffer, MAX_COMBINING,
};
use std::collections::VecDeque;
use std::time::Instant;
use unicode_width::UnicodeWidthChar;
use vte::{Params, Perform};

/// Truncate a notification payload to `max` bytes without splitting a
/// multi-byte UTF-8 character.
fn truncate_utf8(s: &str) -> String {
    const MAX: usize = 4 * 1024;
    if s.len() <= MAX {
        return s.to_string();
    }
    let mut end = MAX;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

// Internal performer that applies VT sequences to the screen buffer
pub(crate) struct ScreenPerformer<'a> {
    pub screen: &'a mut ScreenBuffer,
    pub scrollback: &'a mut VecDeque<Vec<Cell>>,
    pub saved_cursor: &'a mut Option<super::data::CursorState>,
    pub pending_switch: Option<bool>,
    pub using_alternate: bool,
    pub command_state: &'a mut CommandState,
    pub pending_command: &'a mut Option<PendingCommand>,
    pub command_results: &'a mut Vec<CommandResult>,
    pub sync_events: &'a mut Vec<super::data::SyncEvent>,
    pub osc_actions: &'a mut Vec<OscAction>,
    pub private_modes: &'a mut PrivateModes,
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
            0x07 => { // BEL - terminal notification bell
                self.osc_actions.push(OscAction::Bell);
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        // vte always pushes the final (possibly empty) segment on termination,
        // so params is never empty and params[0] is safe to index.
        match params[0] {
            b"133" => self.dispatch_osc133(params),
            b"9" => self.dispatch_osc9(params),
            b"777" => self.dispatch_osc777(params),
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
                        match p {
                            1 => self.private_modes.cursor_keys = true,
                            9 => self.private_modes.mouse = MouseProtocol::X10,
                            47 | 1047 | 1049 => self.pending_switch = Some(true),
                            66 => self.private_modes.keypad = true,
                            1000 => self.private_modes.mouse = MouseProtocol::Normal,
                            1002 => self.private_modes.mouse = MouseProtocol::Button,
                            1003 => self.private_modes.mouse = MouseProtocol::Any,
                            1004 => self.private_modes.focus_event = true,
                            1006 => self.private_modes.encoding = MouseEncoding::Sgr,
                            1016 => self.private_modes.encoding = MouseEncoding::SgrPixels,
                            2004 => self.private_modes.bracketed_paste = true,
                            2026 => self.sync_events.push(super::data::SyncEvent::Start),
                            _ => {}
                        }
                    }
                    return;
                }
                'l' => {
                    for &p in &ps {
                        match p {
                            1 => self.private_modes.cursor_keys = false,
                            9 | 1000 | 1002 | 1003 => {
                                self.private_modes.mouse = MouseProtocol::None;
                            }
                            47 | 1047 | 1049 => self.pending_switch = Some(false),
                            66 => self.private_modes.keypad = false,
                            1004 => self.private_modes.focus_event = false,
                            1006 | 1016 => {
                                self.private_modes.encoding = MouseEncoding::Default;
                            }
                            2004 => self.private_modes.bracketed_paste = false,
                            2026 => self.sync_events.push(super::data::SyncEvent::Stop),
                            _ => {}
                        }
                    }
                    return;
                }
                _ => {}
            }
            return;
        }

        if intermediates == b"!" && action == 'p' {
            self.private_modes.soft_reset();
            return;
        }

        // Only the empty-intermediate (standard) CSI forms below are implemented.
        // `intermediates` here also carries private-parameter bytes `<=>` and true
        // intermediate bytes (0x20-0x2f); ignore them all rather than dispatch by
        // final byte alone - e.g. `\e[>4;2m` (modifyOtherKeys) must not become SGR,
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
            ([], b'c') => {
                // RIS - hard reset private modes
                *self.private_modes = PrivateModes::default();
            }
            _ => {}
        }
    }
}

impl ScreenPerformer<'_> {
    /// OSC 133: Shell Integration (`VS Code` / `FinalTerm` / iTerm2)
    /// Format: ESC ] 133 ; <cmd> [ ; <args> ] ST
    ///   A = Prompt start
    ///   B = Command start (after user presses Enter)
    ///   C = Command executed (not all shells emit this)
    ///   D = Command finished, followed by `;exit_code`
    fn dispatch_osc133(&mut self, params: &[&[u8]]) {
        if params.len() < 2 {
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
                    Some(PendingCommand { start_time: Instant::now(), output_buf: Vec::new() });
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
                    .map(|p| {
                        String::from_utf8_lossy(&std::mem::take(&mut p.output_buf)).into_owned()
                    })
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

    /// OSC 9: terminal notification (iTerm2 / Windows Terminal / `WezTerm`).
    /// Format: `ESC ] 9 ; <message> BEL|ST`. An empty message is treated as a
    /// bell. `9;4` (taskbar progress) and `9;9` (cwd tracking) are
    /// terminal-announce sequences and ignored.
    fn dispatch_osc9(&mut self, params: &[&[u8]]) {
        if matches!(params.get(1).copied(), Some(b"4" | b"9")) {
            return;
        }
        let mut msg = Vec::new();
        for (i, seg) in params[1..].iter().enumerate() {
            if i > 0 {
                msg.push(b';');
            }
            msg.extend_from_slice(seg);
        }
        if msg.is_empty() {
            self.osc_actions.push(OscAction::Bell);
            return;
        }
        let body = truncate_utf8(&String::from_utf8_lossy(&msg));
        self.osc_actions.push(OscAction::Notify { title: None, body });
    }

    /// OSC 777: notification (`ConEmu` / urxvt / Ghostty / Warp).
    /// Format: `ESC ] 777 ; notifysend ; <title> ; <body> BEL|ST`. Only the
    /// `notifysend`/`notify` commands are notifications - other 777 commands
    /// (progress, settabicon, ...) are ignored.
    fn dispatch_osc777(&mut self, params: &[&[u8]]) {
        if !matches!(params.get(1).copied(), Some(b"notifysend" | b"notify")) {
            return;
        }
        let mut payload = Vec::new();
        for (i, seg) in params[2..].iter().enumerate() {
            if i > 0 {
                payload.push(b';');
            }
            payload.extend_from_slice(seg);
        }
        let payload = String::from_utf8_lossy(&payload);
        let (title, body) = match payload.find(';') {
            Some(idx) => (Some(&payload[..idx]), &payload[idx + 1..]),
            None => (None, payload.as_ref()),
        };
        self.osc_actions
            .push(OscAction::Notify { title: title.map(truncate_utf8), body: truncate_utf8(body) });
    }
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
mod tests {
    use super::truncate_utf8;

    #[test]
    fn truncate_utf8_passes_short_strings_through() {
        assert_eq!(truncate_utf8("abc"), "abc");
    }

    #[test]
    fn truncate_utf8_cuts_at_char_boundary() {
        // 3000 CJK chars = 9000 bytes; byte 4096 falls mid-character, so the
        // cut must back off to 4095.
        let s = "中".repeat(3000);
        let t = truncate_utf8(&s);
        assert_eq!(t.len(), 4095);
        assert!(t.chars().all(|c| c == '中'));
    }

    #[test]
    fn truncate_utf8_keeps_ascii_at_exact_limit() {
        let s = "a".repeat(4096);
        assert_eq!(truncate_utf8(&s).len(), 4096);
    }
}

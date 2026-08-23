#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::struct_excessive_bools
)]
mod data;
mod performer;
mod render;
mod screen;

pub use data::{CellAttrs, Color, CommandResult, CommandState, OscAction, SyncEvent};
pub use screen::VirtualScreen;

// Re-export private items at crate scope so tests in this module (which use
// `use super::*`) can still access them after the split.
#[cfg(test)]
pub(crate) use data::{Cell, MouseEncoding, MouseProtocol, PrivateModes};

#[cfg(test)]
mod csi_dispatch_tests {
    use super::*;

    const REPLAY_SEQUENCES: [&str; 10] = [
        "\x1b[?9h",
        "\x1b[?1000h",
        "\x1b[?1002h",
        "\x1b[?1003h",
        "\x1b[?1006h",
        "\x1b[?1016h",
        "\x1b[?1h",
        "\x1b[?66h",
        "\x1b[?2004h",
        "\x1b[?1004h",
    ];

    fn cell(vs: &VirtualScreen, row: usize, col: usize) -> &Cell {
        &vs.primary.cells[row][col]
    }

    fn set_all_tracked_modes(vs: &mut VirtualScreen) {
        vs.feed(b"\x1b[?1003;1016;1;66;2004;1004h");
    }

    #[test]
    fn private_mode_set_reset_pairing_round_trips_each_family() {
        for (mode, expected) in [
            (9, MouseProtocol::X10),
            (1000, MouseProtocol::Normal),
            (1002, MouseProtocol::Button),
            (1003, MouseProtocol::Any),
        ] {
            let mut vs = VirtualScreen::new(20, 5);
            vs.feed(format!("\x1b[?{mode}h").as_bytes());
            assert_eq!(vs.private_modes.mouse, expected);
            vs.feed(format!("\x1b[?{mode}l").as_bytes());
            assert_eq!(vs.private_modes.mouse, MouseProtocol::None);
        }

        for (mode, expected) in [(1006, MouseEncoding::Sgr), (1016, MouseEncoding::SgrPixels)] {
            let mut vs = VirtualScreen::new(20, 5);
            vs.feed(format!("\x1b[?{mode}h").as_bytes());
            assert_eq!(vs.private_modes.encoding, expected);
            vs.feed(format!("\x1b[?{mode}l").as_bytes());
            assert_eq!(vs.private_modes.encoding, MouseEncoding::Default);
        }

        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1;66;2004;1004h");
        assert!(vs.private_modes.cursor_keys);
        assert!(vs.private_modes.keypad);
        assert!(vs.private_modes.bracketed_paste);
        assert!(vs.private_modes.focus_event);
        vs.feed(b"\x1b[?1;66;2004;1004l");
        assert_eq!(vs.private_modes, PrivateModes::default());
    }

    #[test]
    fn private_mode_switch_within_mouse_family_keeps_only_last_value() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1000h\x1b[?1003h");

        assert_eq!(vs.private_modes.mouse, MouseProtocol::Any);
        let snapshot = vs.snapshot();
        assert!(snapshot.contains("\x1b[?1003h"));
        assert!(!snapshot.contains("\x1b[?1000h"));

        vs.feed(b"\x1b[?1000l");
        assert_eq!(vs.private_modes.mouse, MouseProtocol::None);

        vs.feed(b"\x1b[?1006h\x1b[?1016h\x1b[?1006l");
        assert_eq!(vs.private_modes.encoding, MouseEncoding::Default);
    }

    #[test]
    fn multi_param_private_mode_set_and_reset_processes_every_parameter() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1000;1006h");
        assert_eq!(vs.private_modes.mouse, MouseProtocol::Normal);
        assert_eq!(vs.private_modes.encoding, MouseEncoding::Sgr);

        vs.feed(b"\x1b[?1000;1006l");
        assert_eq!(vs.private_modes.mouse, MouseProtocol::None);
        assert_eq!(vs.private_modes.encoding, MouseEncoding::Default);
    }

    #[test]
    fn private_mode_csi_can_be_split_across_feed_calls() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1000;10");
        assert_eq!(vs.private_modes, PrivateModes::default());
        vs.feed(b"06h");

        assert_eq!(vs.private_modes.mouse, MouseProtocol::Normal);
        assert_eq!(vs.private_modes.encoding, MouseEncoding::Sgr);
    }

    #[test]
    fn ris_clears_all_private_modes_but_decstr_preserves_mouse_families() {
        let mut vs = VirtualScreen::new(20, 5);
        set_all_tracked_modes(&mut vs);
        vs.feed(b"\x1b[!p");

        assert_eq!(vs.private_modes.mouse, MouseProtocol::Any);
        assert_eq!(vs.private_modes.encoding, MouseEncoding::SgrPixels);
        assert!(!vs.private_modes.cursor_keys);
        assert!(!vs.private_modes.keypad);
        assert!(!vs.private_modes.bracketed_paste);
        assert!(!vs.private_modes.focus_event);

        set_all_tracked_modes(&mut vs);
        vs.feed(b"\x1bc");
        assert_eq!(vs.private_modes, PrivateModes::default());
    }

    #[test]
    fn alternate_screen_enter_exit_does_not_change_private_modes() {
        let mut vs = VirtualScreen::new(20, 5);
        set_all_tracked_modes(&mut vs);
        let expected = vs.private_modes;

        vs.feed(b"\x1b[?1049h");
        assert!(vs.is_using_alternate());
        assert_eq!(vs.private_modes, expected);
        vs.feed(b"\x1b[?1049l");
        assert!(!vs.is_using_alternate());
        assert_eq!(vs.private_modes, expected);
    }

    #[test]
    fn excluded_private_mode_sequences_are_not_tracked_or_replayed() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?2;3;6;7;8;12;25;45;67;1005;1015;1048;2026h");

        assert_eq!(vs.private_modes, PrivateModes::default());
        assert_eq!(vs.drain_sync_events(), vec![SyncEvent::Start]);

        let snapshot = vs.snapshot();
        for mode in [2, 3, 6, 7, 8, 12, 45, 67, 1005, 1015, 1048, 2026] {
            let sequence = format!("\x1b[?{mode}h");
            assert!(!snapshot.contains(&sequence), "unexpected replay sequence {sequence:?}");
        }
        assert_eq!(
            snapshot.matches("\x1b[?25h").count(),
            1,
            "mode 25 must only be shown by the render layer"
        );
    }

    #[test]
    fn snapshot_replays_modes_after_render_before_scroll_region_and_cursor() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"content\x1b[2;4r\x1b[?1003h\x1b[3;5H");

        let snapshot = vs.snapshot();
        let final_render_row = snapshot.find("\x1b[5;1H\x1b[2K").unwrap();
        let mode = snapshot.find("\x1b[?1003h").unwrap();
        let scroll_region = snapshot.find("\x1b[2;4r").unwrap();
        let final_cursor = snapshot.find("\x1b[3;5H").unwrap();
        assert!(final_render_row < mode);
        assert!(mode < scroll_region);
        assert!(scroll_region < final_cursor);
    }

    #[test]
    fn snapshot_replays_mouse_encoding_before_protocol() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1000;1006h");

        let snapshot = vs.snapshot();
        let encoding_offset = snapshot.find("\x1b[?1006h").unwrap();
        let protocol_offset = snapshot.find("\x1b[?1000h").unwrap();
        assert!(encoding_offset < protocol_offset);
    }

    #[test]
    fn reconnect_snapshot_replays_mouse_encoding_before_protocol() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b[?1000;1006h");

        let snapshot = vs.snapshot_for_replay();
        let encoding_offset = snapshot.find("\x1b[?1006h").unwrap();
        let protocol_offset = snapshot.find("\x1b[?1000h").unwrap();
        assert!(encoding_offset < protocol_offset);
    }

    #[test]
    fn snapshot_with_default_private_modes_emits_no_replay_sequences() {
        let snapshot = VirtualScreen::new(20, 5).snapshot();
        for sequence in REPLAY_SEQUENCES {
            assert!(!snapshot.contains(sequence), "unexpected replay sequence {sequence:?}");
        }
    }

    #[test]
    fn replaying_snapshot_twice_is_idempotent_and_omits_focus_event_mode() {
        let mut source = VirtualScreen::new(20, 5);
        set_all_tracked_modes(&mut source);
        let snapshot = source.snapshot();
        assert!(!snapshot.contains("\x1b[?1004h"));

        let mut replayed = VirtualScreen::new(20, 5);
        replayed.feed(snapshot.as_bytes());
        let after_first_replay = replayed.private_modes;
        assert_eq!(after_first_replay.mouse, MouseProtocol::Any);
        assert_eq!(after_first_replay.encoding, MouseEncoding::SgrPixels);
        assert!(after_first_replay.cursor_keys);
        assert!(after_first_replay.keypad);
        assert!(after_first_replay.bracketed_paste);
        assert!(!after_first_replay.focus_event);

        replayed.feed(snapshot.as_bytes());
        assert_eq!(replayed.private_modes, after_first_replay);
    }

    // `CSI > 4 ; 2 m` (XTMODKEYS) must NOT be parsed as SGR - regression for the
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
    // still underline-on and 4:0 is off - unaffected by the intermediates guard.
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

    #[test]
    fn feed_survives_multibyte_output_exceeding_cap() {
        let mut vs = VirtualScreen::new(80, 24);
        vs.begin_command_tracking();
        assert_eq!(vs.command_state, CommandState::CommandStart);
        assert!(vs.pending_command.is_some());

        // The odd-length ASCII prefix made the old String drain land inside a
        // multi-byte char, while 1024-byte reads split the Chinese UTF-8 input.
        let mut bulk = b"PTY".to_vec();
        while bulk.len() <= 1024 * 1024 {
            bulk.extend_from_slice("你好世界".as_bytes());
        }

        let mut chunks = bulk.chunks(1024);
        let first_chunk = chunks.next().unwrap();
        assert!(std::str::from_utf8(first_chunk).is_err());
        vs.feed(first_chunk);
        assert!(!vs.pending_command.as_ref().unwrap().output_buf.is_empty());
        for chunk in chunks {
            vs.feed(chunk);
        }

        // A separate post-cap feed must still reach the parser rather than
        // repeatedly panicking in the collection branch.
        vs.feed(b"\r\nPOST_CAP_MARKER\r\n");
        assert!(vs.snapshot_plain().contains("POST_CAP_MARKER"));

        let output = vs.take_command_output();
        assert!(std::str::from_utf8(output.as_bytes()).is_ok());
        assert!(output.contains("你好"));
        assert!(output.contains("世界"));
    }
}

// Reconnect replay + resize history preservation. The client resets xterm on
// Reconnected, then the server replays scrollback chunks followed by
// snapshot_for_replay() - these tests pin the escape-sequence contract that
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
    // the session is currently in the alternate screen - the client just reset
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
    // first, then enter the alternate screen and paint it - so that a later
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

#[cfg(test)]
mod osc_notification_tests {
    use super::{OscAction, VirtualScreen};

    #[test]
    fn osc9_with_message_yields_notify() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;task done\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "task done".into() }]
        );
    }

    #[test]
    fn osc9_with_st_terminator_yields_notify() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;via ST\x1b\\");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "via ST".into() }]
        );
    }

    #[test]
    fn osc9_empty_message_yields_bell() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;\x07");
        assert_eq!(vs.drain_osc_actions(), vec![OscAction::Bell]);
    }

    #[test]
    fn osc9_bare_single_param_yields_bell() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9\x07");
        assert_eq!(vs.drain_osc_actions(), vec![OscAction::Bell]);
    }

    #[test]
    fn osc9_progress_and_cwd_announces_are_ignored() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;4;50\x07");
        vs.feed(b"\x1b]9;9;\"/tmp\"\x07");
        vs.feed(b"\x1b]9;4\x07");
        vs.feed(b"\x1b]9;9\x07");
        assert!(vs.drain_osc_actions().is_empty());
    }

    #[test]
    fn osc9_message_with_semicolons_is_rejoined() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;part one;part two\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "part one;part two".into() }]
        );
    }

    #[test]
    fn osc9_can_be_split_across_feed_calls() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;hel");
        assert!(vs.drain_osc_actions().is_empty());
        vs.feed(b"lo\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "hello".into() }]
        );
    }

    #[test]
    fn osc9_bel_terminator_does_not_double_fire() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;hi\x07");
        // Exactly one action: the BEL terminator is consumed by the OSC parser
        // and must not also trigger execute(0x07).
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "hi".into() }]
        );
    }

    #[test]
    fn osc777_notifysend_splits_title_and_body() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]777;notifysend;Title;Body\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: Some("Title".into()), body: "Body".into() }]
        );
    }

    #[test]
    fn osc777_body_with_semicolons_keeps_remainder() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]777;notifysend;Title;Body;More\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: Some("Title".into()), body: "Body;More".into() }]
        );
    }

    #[test]
    fn osc777_variants_are_parsed_leniently() {
        let mut vs = VirtualScreen::new(20, 5);
        // `notify` prefix token, body only (no further `;`).
        vs.feed(b"\x1b]777;notify;Just a body\x07");
        // `notifysend` with no `;` after the token: body only.
        vs.feed(b"\x1b]777;notifysend;Solo\x07");
        assert_eq!(
            vs.drain_osc_actions(),
            vec![
                OscAction::Notify { title: None, body: "Just a body".into() },
                OscAction::Notify { title: None, body: "Solo".into() },
            ]
        );
    }

    #[test]
    fn osc777_non_notification_commands_are_ignored() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]777;progress;50\x07");
        vs.feed(b"\x1b]777;settabicon;Title\x07");
        assert!(vs.drain_osc_actions().is_empty());
    }

    #[test]
    fn bel_byte_yields_bell() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"output\x07more");
        assert_eq!(vs.drain_osc_actions(), vec![OscAction::Bell]);
    }

    #[test]
    fn osc9_long_message_is_truncated_at_char_boundary() {
        let mut vs = VirtualScreen::new(20, 5);
        let long = "a".repeat(8192);
        vs.feed(format!("\x1b]9;{long}\x07").as_bytes());
        let actions = vs.drain_osc_actions();
        match actions.as_slice() {
            [OscAction::Notify { body, .. }] => {
                // vte caps OSC content at ~1KB; our 4KB cap is defense in depth.
                assert!(body.len() < 8192, "message must be truncated, got {}", body.len());
                assert!(body.chars().all(|c| c == 'a'));
            }
            other => panic!("expected single Notify, got {other:?}"),
        }
    }

    #[test]
    fn osc9_multibyte_truncation_lands_on_char_boundary() {
        let mut vs = VirtualScreen::new(20, 5);
        // 3000 CJK chars = 9000 bytes; 4096 is not a multiple of 3, so the
        // naive byte cut would split a character.
        let long = "中".repeat(3000);
        vs.feed(format!("\x1b]9;{long}\x07").as_bytes());
        match vs.drain_osc_actions().as_slice() {
            [OscAction::Notify { body, .. }] => {
                // No mojibake: every surviving char is intact (the truncation
                // point may differ from our 4KB cap because vte caps first).
                assert!(body.chars().all(|c| c == '中'), "body: {body:?}");
            }
            other => panic!("expected single Notify, got {other:?}"),
        }
    }

    #[test]
    fn osc9_non_utf8_payload_is_lossy() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]9;ok\xff\xfe\x07");
        match vs.drain_osc_actions().as_slice() {
            [OscAction::Notify { body, .. }] => assert!(body.starts_with("ok")),
            other => panic!("expected single Notify, got {other:?}"),
        }
    }

    #[test]
    fn osc9_chinese_message_round_trips() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed("\x1b]9;任务完成\x07".as_bytes());
        assert_eq!(
            vs.drain_osc_actions(),
            vec![OscAction::Notify { title: None, body: "任务完成".into() }]
        );
    }

    #[test]
    fn osc133_detection_still_works_after_refactor() {
        let mut vs = VirtualScreen::new(20, 5);
        vs.feed(b"\x1b]133;A\x07");
        vs.feed(b"\x1b]133;B\x07");
        vs.feed(b"\x1b]133;D;0\x07");
        let results = vs.drain_command_results();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].exit_code, 0);
        // OSC 133 must not produce notification actions.
        assert!(vs.drain_osc_actions().is_empty());
    }
}

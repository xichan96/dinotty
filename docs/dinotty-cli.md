# `dinotty` CLI

A small command-line client for a running Dinotty instance. It consolidates the
ad-hoc scripts previously copied into skills (most notably
`dinotty-html-viewer`) into one binary with stable output and error codes.

The CLI lives in its own workspace member, [`cli/`](../cli), and depends only on
`reqwest` (blocking + rustls), `serde`, `serde_json`, and `dirs`.

## Install

From the repository root:

```bash
cargo install --path cli
```

This installs the `dinotty` binary into `~/.cargo/bin`. For a one-off build:

```bash
cargo build -p dinotty-cli --release
./target/release/dinotty --help
```

Verify with `dinotty --version`.

## Quick start

Inside a Dinotty terminal tab, `DINOTTY_URL` and `DINOTTY_PANE_ID` are injected
by Dinotty, so the common case needs no flags:

```bash
dinotty viewer open docs/mockups/file-browser-window-layout.html
```

Outside a Dinotty tab, pass the pane explicitly:

```bash
dinotty --pane 9e92584a-a919-453d-8fb1-d2d920506298 viewer open ./report.html
```

## Global options

Global options may appear before or after the command.

| Option | Environment | Default | Meaning |
| --- | --- | --- | --- |
| `--url <URL>` | `DINOTTY_URL` | `http://127.0.0.1:8999` | Dinotty base URL. A missing scheme becomes `http://`. |
| `--pane <ID>` | `DINOTTY_PANE_ID` | — | Default terminal pane id. |
| `--token <TOKEN>` | `DINOTTY_TOKEN` | — | Auth token. See the resolution order below. |
| `--json` | — | off | Print machine-readable JSON. Errors go to stderr as `{"ok":false,"error":{...}}`. |
| `--ansi` | — | off | With `screen`, return ANSI instead of plain text. |
| `-h`, `--help` | — | — | General help, or command help when appended (`dinotty viewer open --help`). |
| `-V`, `--version` | — | — | Print the version. |

Precedence is **flag > environment variable > default** for `--url` and
`--pane`.

### Token resolution

The first non-empty token wins:

1. `--token`
2. `DINOTTY_TOKEN`
3. `GET /api/auto-token` — only attempted when the base URL is loopback
   (`localhost`, `127.0.0.0/8`, `::1`). The endpoint itself also refuses
   non-local requests.
4. The token file written by the desktop app:
   - macOS: `~/Library/Application Support/dinotty/token`
   - Linux: `~/.local/share/dinotty/token` (or `$XDG_DATA_HOME/dinotty/token`),
     with `~/.config/dinotty/token` as a fallback for builds that use the config
     directory
   - Windows: `%APPDATA%\dinotty\token` and `%LOCALAPPDATA%\dinotty\token`
   - A non-empty `DINOTTY_CONFIG_SUFFIX` selects `dinotty<suffix>/token` first,
     then falls back to `dinotty/token`.

If no token is found the CLI sends no `Authorization` header, which works when
the server has no token configured (first-run setup allows all local requests).

## Commands

### `dinotty viewer open <file>`

Opens a file in the main UI's read-only file viewer.

1. `GET /api/workspace/cwd?pane_id=<pane>` resolves the pane's workspace.
2. The file path is resolved to an absolute, canonical path.
3. A file inside the workspace is sent as a workspace-relative path.
4. A file outside the workspace is copied to
   `<workspace>/.claude/artifacts/` first (identical copies are reused;
   name collisions get `-1`, `-2`, … suffixes).
5. `POST /api/sessions/<pane>/viewer` with `{"path":"<relative path>"}` asks the
   main UI to present the file.

Human output:

```
Opened .claude/artifacts/page.html
request_id: 2ce0f5b3-dce8-4a39-9d12-656668c66082
delivered_clients: 2
```

`--json` prints the server payload (`request_id`, `path`, `title`,
`delivered_clients`, …).

The viewer does **not** require Open API to be enabled, but it does require a
connected main UI (desktop window or browser tab) and a live pane.

### `dinotty sessions list`

Lists terminal sessions: pane id, tab id, status, size, and cwd.

Requires **Settings → Open API** to be enabled on the server; otherwise the CLI
reports `OPEN_API_DISABLED`.

### `dinotty tabs list`

Lists tabs (`tab_id`, `pane_id`, `title`, `cwd`). Does not require Open API.

### `dinotty input send <pane_id> <text>`

Writes `text` verbatim to the pane's terminal. Quote text that contains spaces;
to send a newline, use shell quoting such as `$'ls\n'`. With `--pane` or
`DINOTTY_PANE_ID` set, the pane id may be omitted:
`dinotty input send "ls\n"`.

Requires Open API.

### `dinotty screen <pane_id>`

Prints the pane's current screen. `--ansi` keeps escape sequences; the default
is plain text. The pane id may come from `--pane`/`DINOTTY_PANE_ID` instead of a
positional argument.

Requires Open API.

## Error codes

Errors are printed as `CODE: message`, followed by a `hint:` line when one is
available. With `--json` the same information is emitted to stderr as:

```json
{
  "ok": false,
  "error": { "code": "NO_UI_CLIENT", "message": "no connected main UI client", "hint": "..." }
}
```

Exit codes: `0` success, `1` API/runtime error, `2` usage error.

| Code | Meaning / suggested action |
| --- | --- |
| `NO_UI_CLIENT` | No Dinotty main UI is connected. Open the desktop app or a browser tab. |
| `UNKNOWN_PANE` | The pane id is not a live session. Re-run inside the Dinotty tab or use `sessions list`. |
| `CWD_UNAVAILABLE` | The pane has no local workspace (remote/SSH sessions are unsupported). |
| `SSH_UNSUPPORTED` | The pane is an SSH session; the file viewer is local-only. |
| `OUTSIDE_WORKSPACE` | The file could not be staged under the workspace. |
| `PATH_NOT_FOUND` | The file does not exist or is not readable. |
| `NOT_A_FILE` | The target is a directory or special file. |
| `FILE_TOO_LARGE` | The file exceeds the viewer's limit. |
| `SCOPE_DENIED` | The token lacks `workspace:read` or its path scope excludes the file. |
| `OPEN_API_DISABLED` | Enable Settings → Open API for `sessions`, `screen`, and `input`. |
| `UNAUTHORIZED` / `FORBIDDEN` | Check `--token`/`DINOTTY_TOKEN`; removing it allows loopback auto-token. |
| `REQUEST_FAILED` | The server could not be reached. Check `DINOTTY_URL`/`--url` and that Dinotty is running. |

## Relationship to skills

`~/.claude/skills/dinotty-html-viewer/SKILL.md` now uses
`dinotty viewer open <file>` as its primary path. Its
`scripts/open_in_dinotty.py` is kept as a legacy fallback for environments
where the binary is not installed; it implements the same resolve → stage →
`POST /viewer` flow.

Skills should shell out to `dinotty` rather than growing their own scripts. The
expected contract is: stable command names, machine-readable `--json` output,
and the error codes above.

## Remote Dinotty instances

`viewer open` stages out-of-workspace files **on the machine running the CLI**.
When `--url` points at a remote server, only files already inside that server's
workspace can be opened; local staging cannot help because the server cannot see
the CLI's filesystem. `sessions`, `tabs`, `screen`, and `input` work remotely as
long as the token is accepted.

## Roadmap

The command layout leaves room for additional subcommands without breaking the
current surface:

- `dinotty tabs new` / `dinotty tabs close <tab_id>`
- `dinotty workspace list|read|write`
- `dinotty input send --pane <id>` reusing the default pane
- `dinotty viewer open -` to read a path from stdin

New commands should be added as variants of `args::Command` plus a handler in
`cli/src/commands.rs`; HTTP helpers live in `cli/src/api.rs`.

# `dinotty` CLI

A small command-line client for a running Dinotty instance. It consolidates the
ad-hoc scripts previously copied into skills (most notably
`dinotty-html-viewer`) into one binary with stable output and error codes.

The CLI lives in its own workspace member, [`cli/`](https://github.com/xichan96/dinotty/tree/dev/cli), and depends only on
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

`/api/sessions` currently returns `tab_id: null`, so the human table resolves
the tab id from `/api/tabs` by pane id. `--json` still prints the raw
`/api/sessions` payload.

Requires **Settings → Open API** to be enabled on the server; otherwise the CLI
reports `OPEN_API_DISABLED`.

### `dinotty tabs list`

Lists tabs (`tab_id`, `pane_id`, `title`, `cwd`). Titles prefer the explicit
top-level `title` (set by `tabs rename`), then `layout.title`, then the layout
leaves' `layout.children[].title`; multiple leaf titles are joined with ` | `.
Does not require Open API.

### `dinotty tabs create`

```bash
dinotty tabs create [--cwd <dir>] [--title <title>] [--env KEY=VALUE]... [-- <argv>...]
```

Posts `{cwd, title, argv}` to `POST /api/tabs`. Everything after `--` is sent
as the argv array verbatim; without an argv the server opens the user's default
shell. The response contains the new `tab_id`, `pane_id`, `layout`, and `cwd`.

The HTTP API has **no env field**. `--env KEY=VALUE` therefore prefixes the
argv with `/usr/bin/env KEY=VALUE …` (POSIX only, like the dispatch skill's
existing convention); it requires an argv. Prefer absolute argv paths: Dinotty
only guarantees `/opt/homebrew/bin` and `/usr/local/bin` on the spawned PATH.

Everything after `--` belongs to the argv, including `--json`; put global
options before the separator:

```bash
dinotty --json tabs create --cwd /tmp -- /bin/sh -c 'sleep 60'
```

### `dinotty tabs close <tab_id>`

`DELETE /api/tabs/:tab_id`. Closing a tab terminates its panes. Does not
require Open API.

### `dinotty tabs rename <tab_id> <title>`

`POST /api/tabs/:tab_id/rename` with `{"title": "..."}`. The title may also be
passed as `--title`.

The server stores the rename as a tab-level `title`. A later layout update for
the same tab (for example a split) replaces that entry and can drop the renamed
title; rename after the layout is final.

### `dinotty tabs split <tab_id>`

```bash
dinotty tabs split <tab_id> --direction horizontal|vertical [--pane <pane_id>] [--cwd <dir>]
```

`POST /api/tabs/:tab_id/pane` with a split request. `--direction` accepts `h`
and `v` as shorthands. Without `--pane` (or the global `--pane`), the target is
the tab's first pane, resolved from `GET /api/tabs`. `--cwd` overrides the new
pane's working directory for local splits.

### `dinotty tabs activate <tab_id> [pane_id]`

`PUT /api/tabs/:tab_id/pane/:pane_id/activate`. Without a pane id it activates
the tab's first pane. This moves the server-global active pane, which also
brings the tab to the front in connected UIs.

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

## Workspace commands

All workspace commands resolve the pane from `--pane` / `DINOTTY_PANE_ID` and
take **workspace-relative paths**. The server strips leading slashes and
rejects `..`, so an absolute path like `/tmp/a.txt` means `<workspace>/tmp/a.txt`
rather than the filesystem path. Use `viewer open` when you want the CLI to
resolve and stage an arbitrary local path.

### `dinotty workspace list [<path>]`

`GET /api/workspace/list` for a directory (the workspace root when `path` is
omitted). Human output is a `NAME / TYPE / SIZE` table; `--json` prints the
server payload (`cwd`, `path`, `entries[]` with `is_dir`, `size`, `is_symlink`,
`is_cycle`).

### `dinotty workspace read <path>`

Streams raw bytes from `GET /api/workspace/raw` to stdout, so it works for any
file type and can be piped. The server caps downloads at 500 MiB.

With `--json` the command instead prints the `GET /api/workspace/meta` payload:
text preview, detected language, `truncated`, and MIME/kind. The preview is
capped at 512 KiB, so use plain output for full content.

### `dinotty workspace write <path> -`

Reads the new content from stdin and sends `PUT /api/workspace/file` with
`{"content": "..."}`. The trailing `-` is required to make the stdin source
explicit. Content must be UTF-8; the server accepts up to 500 MiB.

```bash
printf '# Notes\n' | dinotty workspace write notes.md -
```

### `dinotty workspace git status`

`GET /api/workspace/git-changes`, which reports `is_git_repo`, `repo_root`,
`head`, a summary (`files`, `additions`, `deletions`, `counts_complete`) and one
entry per changed path. Human output is a status table plus a totals line.

### `dinotty workspace git diff <path>`

`GET /api/workspace/git-file-diff` for one path. The endpoint returns whole-file
`original` (HEAD) and `modified` (working tree) contents rather than a unified
patch; `--json` exposes the full payload (`binary`, `too_large`, `orig_path`,
…).

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
| `TAB_NOT_FOUND` | The CLI could not find that tab in `GET /api/tabs` (it may have been closed). |
| `NOT_FOUND` | A tab, pane, or workspace path returned 404; check `tabs list` / `workspace list`. |
| `INVALID_PATH` | A workspace path contained `..`; paths are workspace-relative. |
| `PATH_NOT_FOUND` | The file does not exist or is not readable. |
| `NOT_A_FILE` | The target is a directory or special file. |
| `NOT_A_DIRECTORY` | The target of a listing is not a directory. |
| `ALREADY_EXISTS` | A create/rename target already exists. |
| `GIT_UNAVAILABLE` | Git data is not exposed for this pane (SSH/remote backends). |
| `FILE_TOO_LARGE` | The file exceeds the viewer's or download limit. |
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

The repository's `skills/` directory holds the reusable Dinotty skill series
(`dinotty-cli`, `dinotty-viewer`, `dinotty-sessions`, `dinotty-tabs`,
`dinotty-workspace`). They are the source of truth and are copied to
`~/.claude/skills/`; see `skills/README.md`.

## Remote Dinotty instances

`viewer open` stages out-of-workspace files **on the machine running the CLI**.
When `--url` points at a remote server, only files already inside that server's
workspace can be opened; local staging cannot help because the server cannot see
the CLI's filesystem. `sessions`, `tabs`, `screen`, and `input` work remotely as
long as the token is accepted.

## Roadmap

The command layout leaves room for additional subcommands without breaking the
current surface:

- `dinotty tabs move` / `dinotty tabs close-pane` for the remaining layout
  endpoints (`/pane/move`, `DELETE /api/tabs/:tab_id/pane/:pane_id`)
- `dinotty wait --pane <id> --until approval|idle|change` for event-driven
  dispatch (the current watcher polls `/screen` and `git rev-parse`)
- `dinotty viewer open -` to read a path from stdin
- `--env` for `tabs create` once `/api/tabs` grows an env field (today it uses
  the `/usr/bin/env` argv prefix)

New commands should be added as variants of `args::Command` plus a handler in
`cli/src/commands.rs`; HTTP helpers live in `cli/src/api.rs`.

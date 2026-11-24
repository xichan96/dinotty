# Dinotty skills

Reusable Claude Code skills for driving a running Dinotty instance. This
directory is the **source of truth**; `~/.claude/skills/` holds installed
copies.

Every skill shells out to the `dinotty` CLI (`cli/` in this repository) instead
of shipping its own scripts. The CLI contract — commands, `--json`, error codes
— is documented in [`docs/dinotty-cli.md`](../docs/dinotty-cli.md).

## Contents

| Skill | Purpose |
| --- | --- |
| `dinotty-cli` | Base reference: install, token, global options, command table, error codes |
| `dinotty-viewer` | Open HTML/Markdown/PDF/office/images in the user's Dinotty UI (with staging) |
| `dinotty-sessions` | List sessions, read a pane's screen, send text/keys, safety rules |
| `dinotty-tabs` | List/create/close/rename/split/activate tabs; argv/env conventions; test port isolation |
| `dinotty-workspace` | List/read/write workspace files, path jail, git status/diff |

Existing user-level skills that are intentionally **not** replaced:

- `dinotty-html-viewer` — the HTML-specific entry point. It keeps
  `scripts/open_in_dinotty.py` as a legacy fallback for machines without the
  CLI; new flows should use `dinotty viewer open`.
- `dinotty-dispatch-tabs` — still uses its Python/shell watcher scripts
  (`tabwatch.py`, `tabmgr.sh`) because event-driven waiting has no CLI command
  yet. A future `dinotty wait --pane <id> --until ...` can replace them; until
  then the scripts stay.

## Install / update

Install from a **stable checkout or clone** of the repository, not from a
`.claude/worktrees/...` path: worktrees are temporary and removing one would
leave broken symlinks.

```bash
REPO=/path/to/dinotty          # stable clone
for name in dinotty-cli dinotty-viewer dinotty-sessions dinotty-tabs dinotty-workspace; do
  mkdir -p "$HOME/.claude/skills/$name"
  rsync -a --delete "$REPO/skills/$name/" "$HOME/.claude/skills/$name/"
done
ls ~/.claude/skills
```

`--delete` only touches the five `dinotty-*` directories above; it never
touches `dinotty-html-viewer` or `dinotty-dispatch-tabs`.

A symlink is acceptable when the clone is long-lived:

```bash
ln -sfn "$REPO/skills/dinotty-cli" "$HOME/.claude/skills/dinotty-cli"
```

Do not symlink to a worktree under `.claude/worktrees/`.

## Sync to Dojo

Dojo's skills page (`/skills`, backed by `POST /api/admin/skills/upload`) imports
a `.zip` of skill directories:

```bash
cd skills
zip -qr /tmp/dinotty-skills.zip dinotty-cli dinotty-viewer dinotty-sessions dinotty-tabs dinotty-workspace
curl -s -H "Authorization: Bearer $DOJO_TOKEN" \
  -F "file=@/tmp/dinotty-skills.zip;type=application/zip" \
  "$DOJO_BASE/api/admin/skills/upload"
```

The response lists the imported paths. Keep `DOJO_TOKEN` in the environment;
never paste it into a skill or a commit.

## Editing

1. Edit the skill here in the repository.
2. Update `docs/dinotty-cli.md` if the skill depends on a new CLI command.
3. Run `cargo test -p dinotty-cli` and `cargo clippy -p dinotty-cli --all-targets`.
4. Re-copy to `~/.claude/skills/` and start a new Claude session to pick up the
   change (skills are loaded at session start).

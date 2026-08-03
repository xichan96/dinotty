# Contributing

PRs are welcome! Please follow these guidelines.

## Branch Strategy

- **PRs must target the `dev` branch** — do not submit PRs directly to `main`
- `main` is always kept in a stable, releasable state
- Create your feature branch from `dev`:

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature
```

## Branch Naming

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New feature | `feat/plugin-api` |
| `fix/` | Bug fix | `fix/resize-crash` |
| `docs/` | Documentation | `docs/contributing` |
| `refactor/` | Refactor (no behavior change) | `refactor/session-manager` |
| `chore/` | Build, deps, CI, etc. | `chore/update-deps` |

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <short description>

[optional body]
```

Common types: `feat` / `fix` / `docs` / `refactor` / `chore` / `style` / `test`

```
feat: add plugin hot-reload support
fix: fix mobile landscape layout crash
docs: update plugin development guide
```

## Pre-submission Checklist

Make sure these checks pass before submitting a PR:

```bash
# Backend
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace

# Frontend
cd frontend
pnpm exec vue-tsc --noEmit
pnpm test
```

Run the same checks on Windows PowerShell when touching Windows-sensitive code. For frontend checks:

```powershell
Set-Location frontend
pnpm exec vue-tsc --noEmit
pnpm test
Set-Location ..
```

If your change touches platform support, PTY, paths, shell startup, or plugin filesystem behavior, manually verify the affected platforms. For Windows changes, cover:

- Default shell detection for `pwsh.exe` / `powershell.exe` / `cmd.exe`
- `DINOTTY_SHELL` overriding the default shell
- `C:\...` paths, paths with spaces, and SSH private key paths
- Plugin dev-link; if symlink creation fails, enable Windows Developer Mode or run as Administrator

## Code Style

- **Rust**: Format with `rustfmt` (`cargo fmt`)
- **Frontend**: Follow the project's existing ESLint / Prettier config
- **Docs**: Keep bilingual README or paired docs in sync; call out Linux/macOS/Windows behavior differences explicitly

## Issues

Bug reports and feature requests are welcome via GitHub Issues, in either Chinese or English.

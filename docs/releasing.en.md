# Release Guide

This guide is for Dinotty repository maintainers. It explains how to prepare a version, promote `dev` to `main`, and trigger an official release with a Git tag. See the [Deployment Guide](deployment.en.md) for installing and deploying artifacts, and [Contributing](contributing.en.md) for the regular contribution workflow.

## Release Model

Dinotty Server and Desktop share one application version. `[workspace.package].version` in the root `Cargo.toml` is the single source of truth:

```toml
[workspace.package]
version = "0.19.0"
```

The following locations inherit or read that version and must not be updated independently:

- The root package and `src-tauri/Cargo.toml` use `version.workspace = true`.
- Tauri, the Rust runtime, plugin host, deb metadata, and portable filename read Cargo's resolved version.
- `Cargo.lock` records the resolved workspace package versions.
- Android has an independent version line and is not released with the root workspace version.

Official releases are triggered by a `vMAJOR.MINOR.PATCH` tag whose commit is in `main` history. The Package workflow validates the workspace version, lockfile, tag name, and tag branch before starting platform builds. Versions currently must be stable `MAJOR.MINOR.PATCH` values; prerelease suffixes such as `-alpha` or `-rc` and build metadata are not accepted.

## 1. Choose the Version

Choose the next version according to [Semantic Versioning](https://semver.org/):

| Change | Version | Example |
|--------|---------|---------|
| Incompatible breaking change | MAJOR | `0.19.0` → `1.0.0` |
| Backward-compatible feature | MINOR | `0.19.0` → `0.20.0` |
| Backward-compatible bug fix or small change | PATCH | `0.19.0` → `0.19.1` |

Confirm that the version has not been used. An official tag is considered occupied after its first push; do not delete, move, or force-update an official tag to replace released code.

## 2. Prepare the Version PR

Create a `chore/` branch from the latest `dev`:

```bash
git switch dev
git pull --ff-only origin dev
git switch -c chore/bump-version-0.19.0
```

Only change `[workspace.package].version` in the root `Cargo.toml`. Then let Cargo update the lockfile and run the unified version check:

```bash
cargo metadata --no-deps --format-version 1 > /dev/null
cargo metadata --locked --no-deps --format-version 1 > /dev/null
python3 scripts/check-workspace-version.py
```

Windows PowerShell:

```powershell
cargo metadata --no-deps --format-version 1 | Out-Null
cargo metadata --locked --no-deps --format-version 1 | Out-Null
python scripts/check-workspace-version.py
```

The script must print only the version without the `v` prefix, for example `0.19.0`. A normal version PR should contain only the version changes in `Cargo.toml` and `Cargo.lock`. Do not upgrade dependencies at the same time, and do not add duplicate versions to `src-tauri/Cargo.toml` or `src-tauri/tauri.conf.json`.

Run all checks required by the contribution guide:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace
cd frontend
pnpm exec vue-tsc --noEmit
pnpm test
```

Commit the change and open a PR targeting `dev`:

```bash
git add Cargo.toml Cargo.lock
git commit -m "chore: bump version to 0.19.0"
git push -u origin chore/bump-version-0.19.0
```

The version PR must be merged into `dev` and pass the complete CI suite. Regular contribution PRs still target `dev` only.

## 3. Promote to main

After the version PR is merged and all changes planned for the release have been validated, a maintainer promotes `dev` to `main` according to the repository protection rules. Do not edit the version directly on `main`, and do not create the official tag before promotion is complete.

After promotion, confirm that:

- CI passes on `main`.
- `main` contains the expected version PR and every commit planned for the release.
- `dev` did not bring in unvalidated changes by accident.
- `python3 scripts/check-workspace-version.py` (`python` on Windows) prints the expected version.

To inspect installers before the official release, manually run `Package` in GitHub Actions with `target_branch` set to `dev` or `main`. A manual run builds and uploads Actions artifacts retained for 14 days, but it does not create a GitHub Release and does not require a Git tag.

## 4. Create the Official Tag

Synchronize and check out the remote `main`, then validate the version again:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
VERSION=$(python3 scripts/check-workspace-version.py)
git log -1 --oneline
git tag -a "v${VERSION}" -m "Dinotty v${VERSION}"
git push origin "v${VERSION}"
```

Windows PowerShell:

```powershell
git fetch origin main --tags
git switch main
git pull --ff-only origin main
$Version = python scripts/check-workspace-version.py
if ($LASTEXITCODE -ne 0) { throw 'Workspace version validation failed' }
git log -1 --oneline
git tag -a "v$Version" -m "Dinotty v$Version"
git push origin "v$Version"
```

Before pushing, verify that the tag is exactly `v{workspace_version}` and that the current `HEAD` is the intended `main` commit. Do not use `git push --force` for an official tag.

## 5. Monitor the Package Workflow

Pushing the tag triggers `.github/workflows/package.yml`:

1. `prepare` confirms that the tag commit is in `origin/main` history.
2. `scripts/check-workspace-version.py` validates the single version source, Cargo packages, and lockfile.
3. The workflow confirms that the tag equals `v{workspace_version}`.
4. The macOS, Linux, and Windows jobs build and upload platform artifacts.
5. After every platform job succeeds, `publish-release` creates the GitHub Release, generates release notes, and attaches the artifacts.

Expected artifacts:

| Artifact | Contents |
|----------|----------|
| `dinotty-macos` | `.dmg` |
| `dinotty-linux` | Desktop `.deb` / `.AppImage`, Server `dinotty-server_*.deb` |
| `dinotty-windows` | NSIS installer, portable `.exe` |

After publishing, verify that the GitHub Release tag, title, and asset versions match. Perform at least a basic install and startup check for the supported platforms.

## Failure Handling

- **Temporary CI or infrastructure failure**: rerun the original workflow; keep the tag and commit unchanged.
- **Tag does not match the workspace version**: platform builds stop during `prepare`. If the tag has not become an official release, a repository administrator should handle the incorrect tag and create the correct version from the correct `main` commit; do not treat force-moving tags as a normal release step.
- **Tag is not in `main` history**: the workflow skips packaging and publishing. After the version change follows the normal path into `main`, publish an unused new version.
- **The tagged commit needs a code fix**: fix it on `dev`, increment the PATCH version, and repeat the version PR, promotion, and new-tag flow.
- **A Release exists or artifacts were distributed**: do not reuse the version; publish a new PATCH release.

> **Forced-tag warning**: Git allows a repository administrator to move a remote tag with an explicit force push. After GitHub accepts the forced update, the new tag push can still trigger the Package workflow; if the new target is in `main` history and passes version validation, the packaging and publishing jobs may run again. This makes one version refer to different code and may replace or mix existing Release assets. Use it only in an isolated CI/CD test repository or as an audited administrator emergency action, never as the normal release, fix, or retry procedure for the official repository.

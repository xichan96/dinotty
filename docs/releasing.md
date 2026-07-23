# 发布指南

本文面向 Dinotty 仓库维护者，说明如何准备版本、将 `dev` 晋升到 `main`，以及通过 Git tag 触发正式发布。安装和部署产物的方法见[部署指南](deployment.md)，普通代码贡献流程见[贡献指南](contributing.md)。

## 发布模型

Dinotty Server 和 Desktop 共用一个应用版本。根 `Cargo.toml` 的 `[workspace.package].version` 是唯一版本来源：

```toml
[workspace.package]
version = "0.19.0"
```

以下位置自动继承或读取该版本，不应单独修改：

- 根 package 和 `src-tauri/Cargo.toml` 使用 `version.workspace = true`；
- Tauri、Rust 运行时、插件宿主、deb metadata 和 portable 文件名读取 Cargo 解析后的版本；
- `Cargo.lock` 记录 workspace packages 的解析版本；
- Android 使用独立版本线，不随根 workspace 版本发布。

正式发布由 `main` 历史上的 `vMAJOR.MINOR.PATCH` tag 触发。Package workflow 会先验证 workspace 版本、lockfile、tag 名称和 tag 所在分支，再开始平台构建。版本号目前只接受稳定的 `MAJOR.MINOR.PATCH`，不接受 `-alpha`、`-rc` 或 build metadata。

## 1. 选择版本号

按照 [Semantic Versioning](https://semver.org/) 选择下一个版本：

| 变更 | 版本 | 示例 |
|------|------|------|
| 不兼容的破坏性变更 | MAJOR | `0.19.0` → `1.0.0` |
| 向后兼容的新功能 | MINOR | `0.19.0` → `0.20.0` |
| 向后兼容的 Bug 修复或小改动 | PATCH | `0.19.0` → `0.19.1` |

发布前确认该版本尚未被使用。正式 tag 首次推送后即视为占用；不要删除、移动或强制覆盖正式 tag 来替换已发布代码。

## 2. 准备版本 PR

从最新 `dev` 创建 `chore/` 分支：

```bash
git switch dev
git pull --ff-only origin dev
git switch -c chore/bump-version-0.19.0
```

只修改根 `Cargo.toml` 中的 `[workspace.package].version`。然后让 Cargo 更新 lockfile，并运行统一版本检查：

```bash
cargo metadata --no-deps --format-version 1 > /dev/null
cargo metadata --locked --no-deps --format-version 1 > /dev/null
python3 scripts/check-workspace-version.py
```

Windows PowerShell：

```powershell
cargo metadata --no-deps --format-version 1 | Out-Null
cargo metadata --locked --no-deps --format-version 1 | Out-Null
python scripts/check-workspace-version.py
```

脚本应只输出不带 `v` 的版本号，例如 `0.19.0`。正常版本 PR 只应包含 `Cargo.toml` 和 `Cargo.lock` 的版本变化；不要顺带升级依赖，也不要修改 `src-tauri/Cargo.toml` 或 `src-tauri/tauri.conf.json` 来重复声明版本。

按照贡献规范完成全部检查：

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace
cd frontend
pnpm exec vue-tsc --noEmit
pnpm test
```

提交并向 `dev` 创建 PR：

```bash
git add Cargo.toml Cargo.lock
git commit -m "chore: bump version to 0.19.0"
git push -u origin chore/bump-version-0.19.0
```

版本 PR 必须先合入 `dev` 并通过完整 CI。普通贡献 PR 仍然只能以 `dev` 为目标分支。

## 3. 晋升到 main

版本 PR 合入且计划纳入本次发布的改动全部验证完成后，由维护者按照仓库保护规则将 `dev` 晋升到 `main`。不要直接在 `main` 上修改版本，也不要在晋升完成前创建正式 tag。

晋升后确认：

- `main` 的 CI 已通过；
- `main` 包含预期的版本 PR 和全部计划发布的 commit；
- `dev` 中没有尚未验证但被意外带入的改动；
- `python3 scripts/check-workspace-version.py`（Windows 使用 `python`）输出预期版本。

如需在正式发布前检查安装包，可从 GitHub Actions 手动运行 `Package`，将 `target_branch` 设为 `dev` 或 `main`。手动运行会构建并上传保留 14 天的 Actions artifacts，但不会创建 GitHub Release，也不需要 Git tag。

## 4. 创建正式 tag

同步并检出远端 `main`，再次确认版本：

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
VERSION=$(python3 scripts/check-workspace-version.py)
git log -1 --oneline
git tag -a "v${VERSION}" -m "Dinotty v${VERSION}"
git push origin "v${VERSION}"
```

Windows PowerShell：

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

推送前应确认 tag 名称是 `v{workspace_version}`，且当前 `HEAD` 正是要发布的 `main` commit。不要使用 `git push --force` 发布正式 tag。

## 5. 监控 Package workflow

tag push 会触发 `.github/workflows/package.yml`：

1. `prepare` 确认 tag commit 位于 `origin/main` 历史；
2. `scripts/check-workspace-version.py` 校验唯一版本源、Cargo packages 和 lockfile；
3. workflow 确认 tag 等于 `v{workspace_version}`；
4. macOS、Linux 和 Windows jobs 构建并上传平台产物；
5. 全部平台 jobs 成功后，`publish-release` 创建 GitHub Release、生成 release notes 并附加产物。

预期产物如下：

| Artifact | 内容 |
|----------|------|
| `dinotty-macos` | `.dmg` |
| `dinotty-linux` | Desktop `.deb` / `.AppImage`、Server `dinotty-server_*.deb` |
| `dinotty-windows` | NSIS 安装包、portable `.exe` |

发布完成后检查 GitHub Release 的 tag、标题和资产版本一致，并至少对所支持平台的安装包做基本启动验证。

## 失败处理

- **临时 CI 或基础设施故障**：rerun 原 workflow；tag 和 commit 保持不变。
- **tag 名称与 workspace 版本不一致**：workflow 会在 `prepare` 阶段停止，不会启动平台构建。若 tag 尚未作为正式版本发布，由仓库管理员处理错误 tag，再从正确的 `main` commit 创建正确版本；不要把强制移动 tag 当作正常发布步骤。
- **tag 不在 `main` 历史**：workflow 会跳过打包和发布。在版本改动按流程进入 `main` 后，使用尚未占用的新版本发布。
- **tagged commit 的代码需要修复**：在 `dev` 上修复并提升 PATCH 版本，重新走版本 PR、晋升和新 tag 流程。
- **Release 已创建或产物已分发**：不要复用版本号；发布新的 PATCH 版本修复。

> **强制 tag 提醒**：Git 允许仓库管理员在显式使用 force push 时移动远端 tag。GitHub 接受强制更新后，新的 tag push 仍可触发 Package workflow；只要新目标位于 `main` 历史且版本校验通过，打包和发布 jobs 就可能再次运行。这会让同一版本指向不同代码，并可能替换或混合已有 Release 资产，因此只应用于隔离的 CI/CD 测试仓库或经过审计的管理员应急处理，绝不能作为正式仓库的常规发布、修复或重试方式。

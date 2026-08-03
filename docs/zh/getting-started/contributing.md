# 贡献指南

欢迎为 Dinotty 提交 PR！请遵循以下规则。

## 分支策略

- **PR 只能提交到 `dev` 分支**，不要直接向 `main` 提交 PR
- `main` 分支始终保持稳定可发布状态
- 从 `dev` 分支创建你的功能分支：

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature
```

## 分支命名

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能 | `feat/plugin-api` |
| `fix/` | Bug 修复 | `fix/resize-crash` |
| `docs/` | 文档更新 | `docs/contributing` |
| `refactor/` | 重构（不改变功能） | `refactor/session-manager` |
| `chore/` | 构建、依赖、CI 等 | `chore/update-deps` |

## Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>: <简短描述>

[可选正文]
```

常用 type：`feat` / `fix` / `docs` / `refactor` / `chore` / `style` / `test`

```
feat: 添加插件热重载支持
fix: 修复移动端横屏布局错位
docs: 更新插件开发文档
```

## 提交前检查

确保以下检查通过后再提交 PR：

```bash
# 后端
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace

# 前端
cd frontend
pnpm exec vue-tsc --noEmit
pnpm test
```

Windows PowerShell 下同样需要执行上述检查；前端目录切换可以使用：

```powershell
Set-Location frontend
pnpm exec vue-tsc --noEmit
pnpm test
Set-Location ..
```

如果改动涉及平台适配、PTY、路径、Shell 或插件文件系统逻辑，请至少在受影响平台手动验证。Windows 相关改动建议覆盖：

- `pwsh.exe` / `powershell.exe` / `cmd.exe` 的默认 shell 检测
- `DINOTTY_SHELL` 覆盖默认 shell
- `C:\...` 路径、空格路径和 SSH 私钥路径
- 插件 dev-link；如符号链接失败，确认已开启 Windows Developer Mode 或使用管理员权限

## 代码风格

- **Rust**：使用 `rustfmt` 格式化（`cargo fmt`）
- **前端**：遵循项目已有的 ESLint / Prettier 配置
- **文档**：中英文 README 或成对文档需要同步更新；平台行为差异请明确写出 Linux/macOS/Windows

## Issue

Bug 报告和功能建议请使用 GitHub Issue，中文或英文均可。

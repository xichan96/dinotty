# PROGRESS — opt-rust-core

## 目标
后端三项：git 状态路径归一、自然序排序、watcher SSH 守卫与忽略规则。

## 已核实
- `git status --porcelain -z`（macOS 临时仓库实测）：
  - 普通条目 `XY<space>PATH\0`，路径原样 UTF-8，非 ASCII 不转义。
  - rename 为 `R  <new>\0<old>\0`，新路径在前，旧路径是独立 NUL 记录。
  - 未暂存的 mv 显示为 ` D` + `??`，不产生 R。
  - cwd 在子目录时，输出仍是仓库根相对路径；`git rev-parse --show-prefix` 返回 `sub/`（根为空行）。
- `src/workspace/handlers.rs:171`、`remote/mod.rs:74/84` 用 `to_lowercase()` 字典序。
- `handle_watch_socket` 无 SSH 判断；`Session::is_ssh()` 可用。
- tempfile 已是普通依赖。

## 改动
### 1. git 路径归一（已完成，提交 fix(workspace)）
- `git.rs`: 新增 `git_status_files()`（先 show-prefix，失败视为非仓库；再 `status --porcelain -z`）与 `parse_porcelain_z()`（NUL 解析、消费并丢弃 rename 的 old path、按前缀裁剪并丢弃前缀外文件）。
- 响应结构 `is_git_repo/files/status` 不变。
- 新增 7 个单测：仓库根、子目录、rename（根/子目录）、Unicode、文件名含 ` -> `、非仓库。

### 2. 自然序（已完成，提交 feat(workspace)）
- `util.rs`: `natural_cmp`（大小写不敏感、数字段按数值、前导零归一）+ `sort_dir_entries`（目录优先）。
- `handlers.rs` 本地列表、`remote/mod.rs` 两处 SFTP/sudo 列表改用 `sort_dir_entries`。
- 单测 5 个：数字序、大小写、前导零/Unicode、前缀长度、目录优先。

### 3. watcher（已完成，提交 fix(watcher)）
- `handle_watch_socket` 取到 session 后先判 `is_ssh()`，发 `WatchMessage::Error{message:"watch_unsupported_for_ssh"}` 并 return，不进入 watch/订阅。
- 新增 `is_ignored_path()`：任一路径组件命中 node_modules/.git/target/dist/.venv/__pycache__/.next/build（ASCII 大小写不敏感）即丢弃；在事件回调构造 WatchMessage 前过滤，被丢弃的路径不发 WS、不 publish EventBus。
- 单测 3 个：命中目录、近似名不误伤（build.rs / targeting / node_modules_extra）、大小写。

## 测试
- `cargo test`：全部通过（lib 834 passed, 11 ignored；集成测试全绿）。
- `cargo clippy --all-targets`：0 warning / 0 error。
- `cargo fmt --check`：clean。

## 提交
1. `fix(workspace): normalize git status paths to pane cwd`
2. `feat(workspace): sort directory listings in natural order`
3. `fix(watcher): skip SSH panes and ignore build/VCS directories`

## 未完成
- 无（三项均完成）。


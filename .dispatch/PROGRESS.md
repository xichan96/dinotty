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

### 2. 自然序（待做）
### 3. watcher（待做）

## 测试
- `cargo test --lib git_status`：7 passed。

## 未完成
- 自然序比较函数 + 两处调用替换 + 单测。
- watcher SSH 守卫 + 忽略目录过滤 + 单测。

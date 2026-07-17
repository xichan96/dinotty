# Git 管理缺陷记录

## 2026-07-18 Git 管理完整性修复

- 严重级别：P1，涉及破坏性操作的数据恢复、并发写入和凭据泄露。
- 根因：部分 Git 写命令绕过统一执行器；Worktree 以工作目录而非公共 Git 目录加锁；Hard Reset、Patch、强制 Worktree 删除缺少完整恢复链；部分后端能力没有前端入口。
- 修复：统一仓库写锁、命令日志、取消和输出脱敏；增加结构化备份及恢复前备份；Hard Reset 自动创建安全分支和 Stash；补齐 Worktree、Submodule、LFS、远程标签、Bisect 和 Patch 工作流。
- 验证：真实临时仓库测试覆盖 Hard Reset、Patch、Hunk、Cherry-pick、Rebase、Worktree 和 Clean；Git 模块 60 项测试、前端 512 项测试、生产构建均通过。

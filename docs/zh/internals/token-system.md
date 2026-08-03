# Token 权限系统技术文档

Dinotty 实现了基于 Capability 的多 Token 权限系统，支持细粒度的 API 访问控制。

## 目录

- [概述](#概述)
- [Token 类型](#token-类型)
- [Capability 列表](#capability-列表)
- [Token 管理 API](#token-管理-api)
- [存储与安全](#存储与安全)
- [过期与清理](#过期与清理)

---

## 概述

权限系统支持两种 Token：

| 类型 | 来源 | 权限 | 存储 |
|------|------|------|------|
| 全局 Token | 服务器配置 | 所有权限 | 内存中（`auth_token`） |
| Agent Token | `/api/tokens` API 创建 | 按 capability 控制 | `~/.config/dinotty/tokens.json` |

---

## Token 类型

### 全局 Token

- 服务器启动时配置
- 拥有所有 capability
- 用于管理操作和初始设置
- 通过环境变量或配置文件设置

### Agent Token

- 通过 API 创建，格式：`dnt_<64位十六进制>`
- 可指定 capability 和 scope
- 支持过期时间
- 创建后只显示一次，之后只显示前缀（如 `dnt_a1b2c3d4...`）

---

## Capability 列表

| Capability | 说明 | 典型用途 |
|------------|------|----------|
| `terminal:read` | 读取终端屏幕 | 监控、日志收集 |
| `terminal:write` | 发送命令到终端 | Agent 执行命令 |
| `terminal:create` | 创建新终端会话 | 自动化环境 |
| `terminal:kill` | 终止终端会话 | 清理资源 |
| `workspace:read` | 读取工作区文件 | 代码分析 |
| `workspace:write` | 写入工作区文件 | 自动修改代码 |
| `workspace:execute` | 执行工作区操作 | 构建、测试 |
| `plugin:exec` | 执行插件 | 插件自动化 |
| `settings:read` | 读取设置 | 配置查看 |
| `settings:write` | 修改设置、管理 Token | 系统管理 |

---

## Token 管理 API

### 创建 Token

```bash
POST /api/tokens
Authorization: Bearer <global-token>

{
  "name": "ci-agent",
  "description": "CI/CD pipeline agent",
  "capabilities": ["terminal:read", "terminal:write", "workspace:read"],
  "scopes": {
    "terminal:write": ["pane-abc123"]
  },
  "expires_in": 86400
}
```

**响应 (201)：**

```json
{
  "token": "dnt_a1b2c3d4e5f6...",
  "token_info": {
    "id": "uuid-xxx",
    "name": "ci-agent",
    "token_prefix": "dnt_a1b2c3d4...",
    "capabilities": ["terminal:read", "terminal:write", "workspace:read"],
    "scopes": {"terminal:write": ["pane-abc123"]},
    "created_at": 1719312000,
    "expires_at": 1719398400,
    "description": "CI/CD pipeline agent"
  }
}
```

**注意：** `token` 字段只在创建时返回一次，之后无法查看。

### 列出所有 Token

```bash
GET /api/tokens
Authorization: Bearer <global-token>
```

返回所有 Token 的信息（不含原始 token 值）。

### 查看 Token 详情

```bash
GET /api/tokens/:id
Authorization: Bearer <global-token>
```

### 更新 Token

```bash
PUT /api/tokens/:id
Authorization: Bearer <global-token>

{
  "name": "updated-name",
  "capabilities": ["terminal:read"]
}
```

### 撤销 Token

```bash
DELETE /api/tokens/:id
Authorization: Bearer <global-token>
```

撤销后 Token 立即失效，被加入撤销列表（24 小时后清理）。

---

## 存储与安全

### 存储位置

Token 元数据存储在平台配置目录下的 `tokens.json`：

| 平台 | Token 元数据路径 |
|------|------------------|
| Linux | `~/.config/dinotty/tokens.json` |
| macOS | `~/Library/Application Support/dinotty/tokens.json` |
| Windows | `%APPDATA%\dinotty\tokens.json` |

撤销列表保存在内存中（DashMap），并定期清理。

### 哈希算法

Token 使用 SHA-256 哈希存储，原始 token 值不保存：

```rust
fn hash_token(token: &str) -> String {
    // SHA-256 hash → 64 字符十六进制
}
```

### 验证流程

1. 从 `Authorization: Bearer <token>` 提取 token
2. 先检查是否匹配全局 token（constant-time 比较）
3. 对 token 计算 SHA-256 哈希
4. 在 DashMap 中查找匹配的 token 记录
5. 检查是否已撤销、是否已过期
6. 返回 TokenInfo（包含 capability 和 scope）

### Scope 限制

Scope 允许限制 capability 的适用范围：

```json
{
  "capabilities": ["terminal:write"],
  "scopes": {
    "terminal:write": ["pane-abc123"]
  }
}
```

此 token 只能对 `pane-abc123` 执行写操作。

---

## 过期与清理

### 过期机制

- 创建时可指定 `expires_in`（秒数）
- 过期后 token 自动失效
- 验证时检查 `expires_at` 字段

### 清理任务

每小时运行一次：

1. 移除已过期的 token 记录
2. 清理 24 小时前的撤销记录

```rust
pub fn start_cleanup_task(self: &Arc<Self>) {
    // 每 3600 秒执行
    // 1. 移除 expires_at < now 的 token
    // 2. 移除撤销时间 > 24h 的记录
}
```

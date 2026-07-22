# Dinotty Cloudflare Anonymous Quick Tunnel 插件实施方案

> 状态：实施中（本地开发闭环已完成，正式发布门槛未完成）  
> 日期：2026-07-15  
> Dinotty 通用框架目标分支：`feat/native-plugin-runtime`  
> 插件实现：独立仓库 `../dinotty-cloudflare-tunnel`，不放入 Dinotty 工作树  
> 核心约束：插件仓库与 Dinotty 主仓库独立；公网入口由插件自带的 Auth Gateway 完成强制鉴权，不依赖 Dinotty 的来源 IP 白名单、`trusted_proxies`、Token 或 Session 作为第一道安全边界。

## 0. 首版已确定决策

为避免实现阶段继续扩大范围，首版固定以下决策：

- 插件在 `../dinotty-cloudflare-tunnel/native/vendor/cloudflare-quick-tunnel` 内维护基于 `0.3.1` 的最小审计 fork；正式发布固定插件仓库 commit 和上游基线 commit，不直接依赖 crates.io 原版的 reactor 生命周期实现。
- fork 必须提供可订阅的 reactor/Tunnel 生命周期事件、不会丢失的取消信号、可设置 deadline 的 shutdown，以及 HTTP metadata 重建前的 framing/header 校验。
- 单个 reactor 断开时允许在同一个 Quick Tunnel 内重连并保持 URL；全部 reactor 耗尽后进入 `error` 并清理本次分享，不自动申请新 URL。
- 每次用户手动重新启动都创建新的 `generationId`、Share Access Key、Gateway Session 空间和 Quick Tunnel URL。
- Dinotty 通过受保护的 `DINOTTY_ORIGIN` 注入真实 loopback origin；插件不把默认端口 `8999` 当作运行时事实。
- managed process 使用宿主持有的 lifetime pipe。正常退出发送 shutdown，宿主异常消失时 Supervisor 从 EOF 得知并停止 Tunnel；PID 只用于诊断。
- 首版只承诺同源浏览器访问，不承诺 curl、第三方 WebSocket 客户端或 Agent API 通过 Gateway Session 工作。
- 首版支持 IPv4-only 和具有可用 IPv4 的双栈网络；IPv6-only、QUIC 被阻止后的 HTTP/2/TCP fallback 不属于首版支持范围。
- 首版不支持自动完整重建到新 URL，也不支持在 Dinotty 重启后恢复分享。
- 正式 Marketplace 发布必须等待 Dinotty Native Artifact Signing RFC 落地；此前只允许开发安装或明确标记为未受信任的本地安装。

### 0.1 实施进度（2026-07-15）

本方案已经开始执行，当前代码状态如下：

| 范围 | 状态 | 已落地内容 | 仍需完成 |
|---|---|---|---|
| Phase 0 / fork | 部分完成 | `0.3.1` 源码、commit 和 crates.io SHA-256 已固定；实现持久取消、shutdown deadline、reactor 事件和 metadata/framing 校验；fork 单测通过；Windows 实机完成 Quick Tunnel API/DNS/QUIC/register、未认证公网 401 和约 7 秒有界停止烟测 | 持续 edge canary、UDP/7844 阻断矩阵、metadata property/fuzz 持续测试 |
| Phase 1 / Dinotty 宿主 | 部分完成 | HostTarget resolver、目录逃逸检查、`minAppVersion`、实际 origin/保留环境注入、输出 drain、有界 ring buffer、stdin lifetime lease、更新/卸载/退出停止、后端 scope 过滤、Native 权限声明与确认 UI | Marketplace 服务端 artifact descriptor/安装、Native Artifact Signing RFC、发布者信任、三系统权限人工验证 |
| Phase 2 / Supervisor | 开发闭环完成 | prepare/run/status/stop、单实例锁、私有 capability 控制通道、独立 Key/Session、两阶段轮换、Host/Origin/路由策略、HTTP/WS Bridge、Preview 默认拒绝、reactor 全耗尽 fail closed | 第 15 节全部边界/并发/长流测试和真实 Cloudflare 行为记录 |
| Phase 3 / Plugin UI | 开发闭环完成 | 状态轮询、一次性 Key、两阶段轮换、Session 撤销、Preview 确认、诊断/限制提示；页面卸载只停止轮询 | 多浏览器和旧 generation 的端到端浏览器自动化测试 |
| Phase 4 / 正式分发 | 阻塞 | 本机 `windows-x86_64` 开发 artifact 可构建 | RFC、五目标 CI、签名/公证、SBOM、provenance 和正式 Marketplace 发布 |
| Phase 5 / 发布门槛 | 未开始 | 无 | 真实 edge canary、长稳测试、供应链/许可证审计和事件演练 |

插件实现位于 `../dinotty-cloudflare-tunnel`。当前只允许 dev-link/本地开发安装；不得因为本机 artifact 已生成而把 Phase 4 标记为完成。

## 1. 背景与目标

计划开发一个 Dinotty 第一方插件，使用 Rust 库
[`cloudflare-quick-tunnel`](https://crates.io/crates/cloudflare-quick-tunnel)
直接连接 Cloudflare Quick Tunnel，不安装、不下载、也不启动 `cloudflared`。

本方案只支持匿名 Quick Tunnel：

- 不需要 Cloudflare 账号、API Token 或 Tunnel Token。
- 每次启动由 Cloudflare 分配随机的 `https://*.trycloudflare.com` URL。
- Tunnel 只用于临时远程访问，不提供固定域名、SLA 或开机自启。
- 插件停止、卸载或 Dinotty 退出后，Tunnel 必须停止。

这里的“匿名”只表示无需登录 Cloudflare。公网请求必须先通过插件自己的 Share Access Key 和 Gateway Session 鉴权，之后才允许到达 Dinotty。

本方案需要同时满足以下目标：

- Cloudflare Tunnel 插件拥有独立仓库、版本、构建、签名和发布流程。
- 插件仓库同时包含 Plugin UI、Native Supervisor、Auth Gateway/Bridge 和 Tunnel 客户端。
- Dinotty 主程序只提供通用插件宿主能力，不包含 Cloudflare 或插件鉴权专用代码。
- 使用纯 Rust 连接 Cloudflare edge，不依赖外部 Go 二进制。
- 支持 Windows、Linux 和 macOS，覆盖约定的五个 HostTarget；网络侧首版要求可用 IPv4。
- 所有公网 HTTP 和 WebSocket 请求在连接 Dinotty 前完成插件鉴权。
- 即使 Dinotty Token 为空、loopback 位于白名单或 `trusted_proxies` 配置错误，未通过插件鉴权的公网请求仍不能到达 Dinotty。
- 不修改或自动覆盖 Dinotty 的 `ip_whitelist`、`auth.trusted_proxies`、Token、Session 和 Preview 配置。
- 提供启动、停止、密钥轮换、会话撤销、连接状态、随机公网 URL、流量指标和故障诊断。

以下内容不属于本方案目标：

- Named Tunnel、固定 hostname、自定义域名和 DNS 管理。
- Cloudflare Access、Cloudflare 身份登录和 Cloudflare 凭据存储。
- 与 Dinotty Token/Session 单点登录或自动换取 Dinotty Token。
- 多用户、角色、细粒度权限和只读终端账号。
- systemd、Windows Service 或 launchd 常驻服务。
- 系统启动后自动恢复公网 URL。
- 修改 Dinotty 核心鉴权语义。
- 将 Quick Tunnel 描述为生产部署方式。
- IPv6-only 网络和 QUIC 阻断后的 HTTP/2/TCP transport fallback。
- curl、第三方 WebSocket 客户端和 Agent API 的无浏览器 Gateway 登录流程。

## 2. 仓库与信任边界

### 2.1 仓库边界

代码分为两个独立仓库：

```text
Dinotty 主仓库
  - 通用 HostTarget / Marketplace artifact 能力
  - 通用 managed process 生命周期
  - 通用插件运行时目录和权限确认

dinotty-cloudflare-tunnel 插件仓库（本地路径 `../dinotty-cloudflare-tunnel`）
  - Plugin UI
  - Native Supervisor
  - Auth Gateway / HTTP + WebSocket Bridge
  - cloudflare-quick-tunnel 依赖及适配层
  - 插件状态、诊断、构建和发布配置
```

插件仓库可以独立升级和回滚。Dinotty 主仓库不得链接 `cloudflare-quick-tunnel`，不得增加 Cloudflare 专用路由、配置或状态机。

Auth Gateway 和 Bridge 是同一个 Native Supervisor 内的两个逻辑模块，编译为一个平台原生可执行文件。它们不是独立仓库，也不单独发布，避免版本组合和安全边界漂移。

### 2.2 鉴权边界

公网安全边界位于插件 Auth Gateway：

```text
未认证公网请求
  -> Cloudflare edge
  -> Tunnel client
  -> Auth Gateway 拒绝或显示独立登录页
  X  不连接 Dinotty origin

已认证公网请求
  -> Cloudflare edge
  -> Tunnel client
  -> Auth Gateway 验证 Gateway Session
  -> Bridge 严格清洗和转发
  -> DINOTTY_ORIGIN（http://127.0.0.1:<actual-port>）
```

安全不变量：

- Dinotty 只接收到已经通过插件鉴权的 Tunnel 请求。
- Gateway 必须先完成鉴权，再连接 origin 或转发请求体。
- `CF-Connecting-IP`、XFF、随机 URL 和来源 IP 均不是认证因素。
- Dinotty 原有 Token/Session 可以继续生效并形成第二层鉴权，但插件安全不能依赖它们存在或配置正确。
- Server 构建若仍要求 Dinotty Token，用户在通过 Gateway 后可能看到第二次 Dinotty 登录；首版不做单点登录。
- 获得 Share Access Key 的用户应视为临时的完整 Dinotty 操作者。Dinotty 包含终端能力，因此本方案不能声称对已认证用户提供低权限隔离。

### 2.3 信任假设

Cloudflare Quick Tunnel 在 Cloudflare edge 终止公网 TLS。本插件提供公网访问控制，但不提供浏览器到本机 Gateway 的端到端加密：

- Cloudflare 可以观察 Share Access Key 登录请求、Gateway Session Cookie、HTTP、WebSocket、终端内容和文件内容。
- 信任 Cloudflare edge 正确生成或覆盖其来源 metadata；即使该 metadata 异常，也不得改变鉴权结果，只能影响限速和诊断。
- 信任 Dinotty 宿主、已验证签名的插件发布者和本机操作系统的用户隔离。
- 不防御运行在同一操作系统用户下的恶意进程，也不防御已经获得 Share Access Key 的恶意操作者。
- Share Access Key 的分享渠道、系统剪贴板历史和远程设备安全不在插件保护范围内。
- 插件日志和状态仍必须最小化敏感数据；“Cloudflare 可观察流量”不意味着允许本地持久化这些内容。

## 3. Tunnel 库选型

第一版以 `cloudflare-quick-tunnel 0.3.1` 为审计基线，在 `../dinotty-cloudflare-tunnel/native/vendor/cloudflare-quick-tunnel` 维护最小 fork，并通过 path dependency 构建，同时固定插件仓库的 `Cargo.lock`。`native/vendor/cloudflare-quick-tunnel/UPSTREAM.md` 必须记录上游 crate 版本、上游 Git commit/source checksum、导入日期和补丁清单；正式 artifact 必须记录对应的插件仓库 commit。

该库提供：

- 向 Cloudflare Quick Tunnel API 申请临时 Tunnel。
- 通过 QUIC 和 Cap'n Proto RPC 注册到 `argotunnel` edge。
- 将 edge 请求代理到本机 TCP 端口。
- HTTP/1.1、WebSocket Upgrade、chunked body 和双向转发。
- HA 连接、流量指标和有限重连。

架构调用关系：

```text
Plugin UI
  -> Dinotty generic managed process API
  -> dinotty-quick-tunnel-supervisor
     -> Auth Gateway / Bridge
     -> cloudflare-quick-tunnel
```

### 3.1 已知风险和前置条件

`cloudflare-quick-tunnel` 是非官方第三方库，并依赖 Cloudflare 未承诺稳定的内部协议。发布前必须：

- 审核 vendored Cap'n Proto schema、Cloudflare 内部 CA 和 HTTP framing 实现。
- 审核请求头重建、连接池、WebSocket、chunked body 和错误路径。
- 保留真实 Cloudflare edge canary 测试。
- UDP/7844 被阻止时只报告错误，不回退到不安全直连。
- 验证 Windows、Linux 和 macOS 的 DNS、QUIC、证书和休眠恢复行为。

版本 `0.3.1` 的 `QuickTunnelHandle` 没有公开 reactor 存活状态或退出事件，shutdown 也不能可靠取消所有 connect/reconnect 阶段，因此无法直接实现可靠状态和有界停止。Phase 0 的 fork 必须提供：

- `watch`/stream 形式的 reactor 和聚合 Tunnel 状态事件。
- 不会丢失通知的 cancellation token；DNS、API、QUIC dial、register、backoff 和 supervisor accept 都必须可取消。
- `wait()` 或等价退出事件，明确区分用户停止、连接耗尽、内部错误和 panic。
- 接受 deadline 的 shutdown；deadline 到期后中止 reactor，不得无限等待 join/unregister。
- HTTP metadata 转换为 HTTP/1.1 前的 header name/value、CR/LF/NUL、重复 `Content-Length` 和 `Content-Length`/`Transfer-Encoding` 冲突校验。
- 针对连接中 shutdown、重连中 shutdown、部分/全部 HA reactor 退出和重复 shutdown 的确定性测试。

不得通过“指标一段时间未变化”推断 reactor 已退出，也不得把 crates.io `0.3.1` 原版的 `Notify::notify_waiters()` 当作可靠停止协议。若上游后续提供等价且经过验证的 API，可在单独升级评审后移除 fork。

## 4. 威胁模型

| 威胁 | 后果 | 处理方式 |
|---|---|---|
| 随机 Quick URL 被扫描或泄露 | 暴露公网登录入口 | URL 不作为认证；所有业务路由强制 Gateway Session |
| Share Access Key 被猜测 | 未授权控制 Dinotty | 256-bit 随机密钥、恒定时间校验、速率限制 |
| Share Access Key 泄露 | 攻击者获得临时完整权限 | 一键轮换密钥、撤销全部 Gateway Session、停止 Tunnel |
| 伪造 XFF/`CF-Connecting-IP` | 绕过来源判断或污染日志 | 来源头不参与鉴权；Bridge 删除后不向 Dinotty 生成 XFF |
| 绕过 Gateway 直接访问 Bridge | 未认证请求到达 Dinotty | Gateway 与 Bridge 使用同一请求入口，业务监听不提供旁路 |
| HTTP request smuggling/header injection | 绕过路由和鉴权或污染连接池 | 严格解析、framing 冲突 fail closed、请求认证后才转发 |
| 跨站请求或 WebSocket CSRF | 已登录浏览器被第三方站点利用 | 精确 Host/Origin、SameSite Cookie、状态变更请求校验 Origin |
| Cookie 被脚本读取 | Gateway Session 泄露 | `HttpOnly; Secure; SameSite=Strict; Path=/` |
| Cloudflare edge 缓存已认证响应 | 后续未认证请求绕过 Gateway 获得缓存内容 | 所有 Gateway 和受保护 origin 响应强制 `private, no-store` |
| Dinotty Token/白名单配置变化 | 核心鉴权行为变化 | Gateway 鉴权独立存在，不读取或修改这些配置 |
| Preview 意外暴露 | 访问本机开发服务 | Gateway 默认拒绝 `/preview/*`，用户单独显式开启 |
| Bridge 崩溃后端口被其他进程占用 | Tunnel 流量被错误进程接收 | 使用临时端口；Bridge 任务退出立即销毁 Tunnel 并终止 Supervisor |
| reactor 全部退出但 UI 仍显示在线 | 用户误判公网可用 | 使用上游/受审 fork 的显式生命周期事件 |
| shutdown 在连接或重连中丢失 | Dinotty 已退出但 Tunnel 进程残留 | fork 使用持久 cancellation token，所有网络阶段可取消并有 deadline |
| Dinotty 宿主异常退出 | Supervisor 和公网入口继续存在 | 宿主持有 lifetime pipe；Supervisor 收到 EOF 后 fail closed |
| 浏览器关闭或多客户端竞争 | Tunnel 状态失控 | 后端单实例、幂等命令、浏览器不拥有进程生命周期 |
| Marketplace/registry 被篡改 | 执行恶意 native binary | root 授权的 publisher key、artifact 签名、撤销/最低安全版本、哈希和安全解压 |

不在本威胁模型内：已获得 Share Access Key 的恶意操作者。由于其可以使用终端执行命令，该操作者原则上拥有运行 Dinotty 用户的权限。

## 5. 独立鉴权机制

### 5.1 Share Access Key

每次创建 Tunnel 前，Supervisor 必须生成新的 Share Access Key：

- 使用操作系统 CSPRNG 生成至少 32 字节随机值。
- 使用无填充 base64url 显示，禁止使用短数字 PIN 作为唯一凭据。
- 明文只在创建时向已登录的插件 UI 返回一次。
- 状态文件只保存带随机 salt 的密钥摘要，不保存明文。
- Rust 实现使用 `secrecy`/`zeroize` 等类型减少明文复制并在释放时清零，相关类型禁止 `Debug`、`Display` 和序列化。
- 日志、命令行参数、进程列表、URL、二维码和遥测中不得出现明文。
- Tunnel 停止后该密钥立即失效；下次启动默认生成新密钥。
- 轮换密钥时必须同时撤销全部 Gateway Session。

首版不支持用户自定义弱密码。如果后续允许自定义口令，必须使用 Argon2id 等抗暴力破解 KDF，不能沿用随机密钥的快速摘要方案。

### 5.2 创建和展示密钥

建议使用两阶段命令，避免把密钥放入长运行进程参数：

```text
prepare --json
  -> 检查当前没有运行中的 Supervisor
  -> 生成 generationId、Share Access Key、salt 和摘要
  -> 以私有权限原子写入 prepared state
  -> stdout 仅返回一次 generationId 和 public access key

run --generation <generationId> --json
  -> 获取并在整个进程生命周期持有单实例锁
  -> 只读取 generationId 精确匹配且未过期的 prepared state
  -> 启动 Gateway/Bridge
  -> 创建 Quick Tunnel
  -> 清除任何可能残留的明文缓冲
```

如果 `prepare` 后未成功启动，prepared state 应在短 TTL 后失效。并发的第二次 `prepare` 可以使旧 generation 失效，旧页面随后调用 `run` 必须收到 generation mismatch，而不能启动错误密钥。UI 不得把 access key 写入 `localStorage`、插件 storage 或其他持久化位置；只有用户显式点击复制时才允许写入系统剪贴板。

### 5.3 两阶段密钥轮换

密钥轮换必须避免“Supervisor 已切换，但 CLI/UI 未收到新明文密钥”导致分享永久锁死：

```text
rotate-key-prepare --generation <generationId> --json
  -> 生成 candidateId、新 Share Access Key、salt 和摘要
  -> 旧 Key 和旧 Session 继续有效
  -> 明文新 Key 只返回一次
  -> candidate 默认 5 分钟后过期

rotate-key-commit --generation <generationId> --candidate <candidateId> --json
  -> 原子切换到新摘要
  -> 撤销旧 Key 和全部旧 Gateway Session
  -> 主动关闭旧 Session 的 WebSocket 和长流

rotate-key-cancel --generation <generationId> --candidate <candidateId> --json
  -> 删除尚未提交的 candidate
```

同一时间只允许一个候选密钥。commit 必须幂等：重复提交同一 candidate 返回当前成功状态；错误 generation、过期或已取消 candidate 不得改变活动密钥。UI 必须先展示新密钥并要求用户确认已安全保存，再执行 commit。

### 5.4 Gateway Session

远程用户在插件登录页输入 Share Access Key。验证成功后，Gateway 生成独立、随机、不可预测的 Session ID，并只保存其摘要。

Cookie 建议：

```text
Set-Cookie: __Host-dinotty_share=<opaque-session-id>;
            Secure; HttpOnly; SameSite=Strict; Path=/
```

规则：

- 不设置 `Domain`。
- Session 绝对有效期默认不超过 12 小时，且不能超过本次 Tunnel 生命周期。
- 可配置较短的空闲过期时间，但活跃 WebSocket 不应因普通 HTTP 空闲被意外断开。
- 默认限制最多 32 个活动 Session；达到上限时拒绝创建并提示先撤销旧 Session，不能无界增长。
- 停止 Tunnel、轮换密钥、执行“撤销全部会话”或 Supervisor 退出时立即清空，并主动终止这些 Session 已建立的 WebSocket 和长流请求。
- Session 到达绝对有效期时，即使 WebSocket 仍活跃也必须关闭；关闭使用明确的 policy/expired 原因且不得包含凭据。
- Session 不与 Dinotty Session 共用 cookie name、存储或签名密钥。
- 不强制绑定来源 IP，避免移动网络切换导致错误退出；来源 IP 只用于限速和诊断。

### 5.5 Gateway 路由

Gateway 保留固定前缀：

```text
/.dinotty-share/login       GET   独立登录页
/.dinotty-share/login       POST  提交 Share Access Key
/.dinotty-share/logout      POST  注销当前 Gateway Session
/.dinotty-share/session     GET   返回当前 Gateway Session 状态
```

该前缀永远由 Gateway 处理，不转发给 Dinotty。未认证时：

- 仅 `GET`/`HEAD` 且 `Accept` 包含 `text/html` 的页面导航返回 302 到登录页。
- 其他 HTTP 请求返回结构化 JSON 401，不通过重定向返回 HTML。
- WebSocket Upgrade 在升级前返回 401。
- 不建立到 `DINOTTY_ORIGIN` 的连接，不预读或缓存大请求体。

Host 不匹配返回 421；有效 Session 的状态变更请求或 WebSocket Origin 不匹配返回 403；Preview 未开启返回 403。错误响应不得回显 Host、Origin、Cookie、Access Key 或内部 origin。

登录接口只接受 `application/x-www-form-urlencoded`（允许合法 charset 参数），body 上限 4 KiB；其他内容类型返回 415。验证使用恒定时间摘要比较，并同时实施每来源和全局速率限制。`CF-Connecting-IP` 缺失或非法时不能降低鉴权强度，只能退化为更严格的全局限速。

登录页必须直接嵌入 Supervisor，不加载第三方脚本、字体或分析服务，并设置严格 CSP、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer` 和 `X-Content-Type-Options: nosniff`。

### 5.6 Host、Origin、CSRF 和 WebSocket

- Gateway 只接受本次 Quick Tunnel 分配的精确 Host。
- 登录、注销以及转发给 Dinotty 的所有 `POST`、`PUT`、`PATCH`、`DELETE` 请求必须校验精确 `Origin`。
- WebSocket 必须先验证 Gateway Session，再验证精确 `Origin`，最后才允许 Upgrade。
- 不允许整个 `https://*.trycloudflare.com` 通配 Origin。
- 不把 Gateway Session 放入 URL query、fragment、WebSocket subprotocol 或自定义可被日志记录的 header。
- Gateway 登录、Session 状态和 401 响应必须设置 `Cache-Control: no-store`。
- Gateway 不向任意第三方 Origin 返回允许携带凭据的 CORS 响应。
- 所有经过 Gateway 鉴权后返回的 Dinotty 响应也必须覆盖为 `Cache-Control: private, no-store`，并移除会指示 CDN 缓存的冲突头；首版不允许用公开缓存换取静态资源性能。
- 首版只承诺同源浏览器客户端。缺少 `Origin` 的状态变更请求和 WebSocket 必须拒绝；不得为了兼容 curl 或 Agent 客户端放宽 Cookie Session 的 Origin 规则。

### 5.7 与 Dinotty 原鉴权的关系

插件鉴权与 Dinotty 鉴权相互独立：

- Gateway 成功只表示请求可以到达 Dinotty，不伪造 Dinotty Session。
- 插件不读取、保存、注入或自动获取 Dinotty Token。
- 插件不调用 `/api/auto-token` 获取核心 Token。
- Dinotty Server 若继续要求 Token，远程用户需要在 Gateway 登录后再完成 Dinotty 登录。
- Dinotty Desktop 因 loopback 白名单而放行业务请求时，安全仍由 Gateway Session 保证。
- Gateway 应默认阻止公网访问 `/api/auto-token`，避免临时 Share Session 被自动升级为长期 Dinotty Token。

因为终端本身提供代码执行能力，上述 `/api/auto-token` 阻止策略只用于避免意外凭据导出，不构成对恶意已认证操作者的沙箱。

## 6. Auth Gateway / Bridge

Gateway 和 Bridge 是同一条不可绕过的请求管线：

```text
parse request
  -> validate framing and limits
  -> validate exact Host
  -> handle reserved auth route OR validate Gateway Session
  -> enforce route policy
  -> sanitize headers
  -> connect Dinotty origin
  -> stream request/response
```

每个 HTTP 请求都必须独立验证 Gateway Session，不能因为同一 TCP/QUIC 连接上的前一个请求已经认证而缓存“连接已认证”状态。WebSocket 只在 Upgrade 时建立认证上下文，但必须登记到对应 Session，以便过期、轮换和撤销时主动关闭。

### 6.1 监听和端口

- 仅监听 `127.0.0.1`，第一版不使用 `localhost` 或 IPv6 loopback。
- 默认绑定 `127.0.0.1:0` 获取临时端口，不固定使用 `19090`。
- 将实际端口直接传给 `QuickTunnelManager::new(port)`。
- Bridge listener 必须在创建 Tunnel 前完成 bind。
- Bridge 任务退出、listener 异常关闭或端口所有权丢失时，立即 shutdown Tunnel 并退出 Supervisor。
- 健康检查和控制接口不得通过 Tunnel 业务端口公开。
- Dinotty origin 只能来自宿主注入且不可被插件启动参数覆盖的 `DINOTTY_ORIGIN`。
- `DINOTTY_ORIGIN` 只接受 `http://127.0.0.1:<non-zero-port>`，禁止 hostname、IPv6、userinfo、query、fragment 和非 loopback 地址。
- 正式运行不从持久配置或 UI 接受 origin port；`8999` 只能作为文档示例，不能作为运行时 fallback。
- Gateway 自检先验证未认证和保留鉴权路由，不得用“Dinotty origin 可连接”代替鉴权自检。

### 6.2 请求头策略

Bridge 必须：

- 删除 `X-Forwarded-For`、`Forwarded`、`X-Real-IP` 和不需要的 Cloudflare 来源头。
- 不向 Dinotty 生成 XFF，也不要求修改 `auth.trusted_proxies`。
- 从 `Cookie` 中移除 `__Host-dinotty_share`，保留其他合法 Cookie。
- 保留合法的 `Authorization` 和 Dinotty Session Cookie，使核心鉴权可以作为第二层继续工作。
- 保留并验证合法的 `Host` 和 `Origin`。
- 删除 origin 响应中试图设置 `__Host-dinotty_share` 的 `Set-Cookie`，该 Cookie 只能由 Gateway 签发。
- 覆盖 origin 的公开缓存策略，确保受保护响应不会由 Cloudflare edge 在 Gateway 之外重放。
- 正确清理 hop-by-hop headers，同时保留合法 WebSocket Upgrade 语义。
- 拒绝 header name/value 中的 CR、LF、NUL 和其他非法字节。
- 对重复或冲突的 `Content-Length`、`Content-Length`/`Transfer-Encoding` 冲突 fail closed。
- 设置 method、URI、header 数量、单头长度、总头大小和请求体上限。

`CF-Connecting-IP` 只可用于限速、脱敏诊断和审计，不得用于判定是否已认证。只接受一个语法正确的 IP；缺失、重复或非法时不使用 per-IP bucket，并应用更严格的全局限速。限速表必须有容量上限和 TTL/LRU 回收，避免高基数来源耗尽内存。

### 6.3 代理能力

Bridge 必须支持：

- HTTP request/response streaming。
- 大文件上传和下载，且不能无界缓存。
- WebSocket Upgrade 和全双工流。
- chunked transfer encoding。
- 连接、首字节、空闲和最大生命周期超时。
- 最大并发连接数和优雅关闭。

日志不得记录 Share Access Key、Gateway Session、Cookie、Authorization、请求体、终端内容或完整请求头。

### 6.4 默认资源限制

首版使用以下默认值；实现中的常量和测试必须引用同一个配置来源，UI 只展示允许用户调整的项目：

| 项目 | 默认值 | 处理方式 |
|---|---:|---|
| 登录 body | 4 KiB | 超限返回 413，不读取剩余 body并关闭连接 |
| URI 长度 | 8 KiB | 超限返回 414 |
| 单个 header | 8 KiB | 超限返回 431 |
| header 总大小 | 32 KiB | 超限返回 431 |
| header 数量 | 100 | 超限返回 431 |
| Gateway 并发请求/Upgrade | 200 | Gateway 超限返回 503 + `Retry-After`，不排无界队列；Cloudflare 自身可能返回 429 |
| 活动 Gateway Session | 32 | 达到上限拒绝新 Session |
| 普通受保护请求体 | 1 GiB | 流式累计，超限终止；不得整块缓存 |
| origin connect timeout | 5 秒 | 拒绝/失败返回脱敏 502，超时返回 504 |
| request header timeout | 10 秒 | 关闭连接 |
| origin first-byte timeout | 30 秒 | 返回脱敏 504 |
| 普通 HTTP idle timeout | 60 秒 | 关闭当前流 |
| WebSocket/长流绝对期限 | 不超过 Session 的 12 小时 | 到期主动关闭 |
| per-IP 登录失败 | 5 次/分钟，burst 10 | token bucket |
| 全局登录失败 | 30 次/分钟，burst 60 | token bucket |
| per-IP bucket 表 | 4096 项 | TTL + LRU 回收 |

`maxRequestBodyBytes` 可以作为非敏感设置调整，但必须有 1 MiB 至 2 GiB 的硬范围。存在 `Content-Length` 时可在转发前拒绝；chunked/未知长度 body 必须边转发边计数。WebSocket 不使用普通 HTTP idle timeout，应使用 ping/pong 检测死连接，同时严格执行 Session 绝对期限。

### 6.5 Preview 策略

由于 Dinotty 会把 Bridge 视为 loopback，核心 `preview.allow_external` 不能作为公网 Gateway 的唯一策略。插件必须自行执行：

- 默认拒绝所有 `/preview/*` 请求并返回 403。
- UI 提供本次 Tunnel 生命周期内的“允许 Preview”开关，默认关闭。
- 开启后仍要求有效 Gateway Session，并显示 Preview 可能执行任意本机 Web 应用代码的警告。
- 插件停止或重新启动后恢复关闭，不持久化自动开启。
- 不修改 Dinotty 的 `preview.allow_external`。
- Preview 和 `/api/auto-token` 等路由策略必须在严格 URI 解析和规范化后匹配；拒绝反斜杠、非法 percent-encoding、编码斜杠和 dot-segment 等歧义路径，防止策略绕过。

## 7. Supervisor 协议和状态

命令分为离线、长运行和在线控制三类。

离线命令不要求 Supervisor 已运行：

```text
version --json
doctor --offline --json
prepare --json
```

`run --generation <generationId> --json` 是唯一长运行命令。在线控制命令通过带本地访问控制的控制通道与 Supervisor 通信：

```text
status --json
stop --generation <generationId> --json
rotate-key-prepare --generation <generationId> --json
rotate-key-commit --generation <generationId> --candidate <candidateId> --json
rotate-key-cancel --generation <generationId> --candidate <candidateId> --json
revoke-sessions --generation <generationId> --json
set-preview --generation <generationId> --enabled <true|false> --json
doctor --online --json
```

Supervisor 未运行时，`status` 可以读取经过权限和 schema 校验的状态文件并返回 `stopped`、`error` 或 `stale`；不得把 stale PID/state 当作在线。宿主 shutdown 不复用 UI 的 generation 命令，而是通过 lifetime pipe 向自己拥有的子进程发送 shutdown frame。

控制通道优先使用：

- Unix：位于 `DINOTTY_PLUGIN_DATA_DIR` 的 Unix domain socket，目录和 socket 权限为当前用户私有。
- Windows：仅当前用户可访问的 Named Pipe。
- 如果平台必须使用 loopback TCP，则使用每次启动随机生成的 control capability，并存入私有权限文件；端口本身不视为认证。

### 7.1 宿主 lifetime pipe

Dinotty 启动 managed process 时为其创建只由宿主持有写端的 lifetime pipe，Supervisor 持有读端：

```text
正常退出：host 写入 {"type":"shutdown","deadlineMs":10000}，然后关闭写端
异常退出：操作系统关闭写端，Supervisor 读到 EOF
```

Supervisor 收到 shutdown frame 或 EOF 后必须立即拒绝新的登录/业务请求、撤销 Session、关闭 WebSocket/长流、关闭 Quick Tunnel，并在 10 秒内部 deadline 内退出。宿主等待最多 15 秒，之后强制终止进程。lifetime pipe 不承载浏览器发起的控制命令，也不得被插件启动参数替换。

`DINOTTY_PARENT_PID` 只用于诊断，不能作为异常退出检测的唯一机制。

### 7.2 状态协议

状态示例：

```json
{
  "ok": true,
  "state": "connected",
  "generationId": "0198...",
  "publicUrl": "https://example.trycloudflare.com",
  "edgeLocation": "per01",
  "startedAt": 1784102400,
  "libraryVersion": "0.3.1+dinotty-fork",
  "libraryCommit": "<audited-git-commit>",
  "gateway": {
    "healthy": true,
    "authenticatedSessions": 1,
    "previewEnabled": false,
    "origin": "http://127.0.0.1:9123"
  },
  "metrics": {
    "streamsTotal": 12,
    "bytesIn": 1024,
    "bytesOut": 4096,
    "reconnects": 0,
    "authFailures": 2
  }
}
```

状态文件和 `status` 输出不得包含 Share Access Key 明文、Gateway Session ID、Dinotty Token 或控制 capability。

状态至少区分：

```text
stopped
preparing
awaiting_run
starting_gateway
requesting_tunnel
connecting
connected
degraded
reconnecting
rotating_key
stopping
error
```

Supervisor 负责：

- 跨进程单实例锁，而不是只依赖 PID 文件。
- prepared state TTL 和 stale state 清理。
- Gateway、Bridge、Tunnel 和 Gateway Session 生命周期。
- 显式监控 reactor 生命周期。
- 单个 reactor 在同一 Tunnel 内进行有限重连并保持 URL；全部 reactor 耗尽后清理本次分享并进入 `error`，不得自动申请新 URL。
- 两阶段密钥轮换、candidate TTL 和全部 Session 撤销。
- 原子、私有权限状态文件。
- 监听 lifetime pipe；优雅停止内部 deadline 为 10 秒，宿主 15 秒后强制终止。
- 对 UI 返回脱敏、结构化错误。

## 8. 安全启动基线

Quick Tunnel 启动前只检查插件自身和运行环境：

- 当前 HostTarget 受支持。
- 插件 artifact 签名和 manifest 校验通过。
- `DINOTTY_PLUGIN_DATA_DIR` 权限仅允许当前用户访问。
- `DINOTTY_ORIGIN` 存在、来自宿主保留环境变量并通过精确 loopback URL 校验。
- lifetime pipe 已建立且由宿主持有另一端。
- 单实例锁可获得。
- 已生成有效且未过期的 prepared auth state。
- origin 只能是 `DINOTTY_ORIGIN` 指定的显式 IPv4 loopback 地址和有效端口，禁止任意主机名或远程 origin。
- Gateway 已成功绑定临时端口并通过本地自检。
- Quick Tunnel API、DNS 和 QUIC 可用。

以下 Dinotty 配置不再是启动条件：

- Dinotty Token 是否配置。
- `auth.trusted_proxies` 是否包含 loopback。
- `ip_whitelist` 是否为空、包含 LAN CIDR 或包含 loopback。
- `preview.allow_external` 的值。

这些配置可在诊断页作为信息显示，但插件不得自动修改，也不得因为它们不符合某个模板而拒绝启动。Gateway 的未认证请求测试必须在各种 Dinotty 配置组合下都保持 fail closed。

## 9. 插件产品形态

本方案只提供“临时 Quick Share”模式：

- 用户必须在已登录的 Dinotty 管理会话中显式启动。
- `prepare` 后 UI 显示一次 Share Access Key，并要求用户确认已经安全保存。
- 公网 URL 和 Access Key 分开复制，不生成带密钥 query 的一键 URL。
- 关闭任一浏览器页面不得停止 Tunnel。
- 用户点击停止、禁用/卸载插件或 Dinotty 正常退出时必须停止 Tunnel。
- Dinotty 重启后保持停止，不自动创建新 URL 或复用旧 Access Key。
- 同一 Dinotty 实例只允许一个 Supervisor。
- 多浏览器的 start/stop/rotate/revoke 操作必须幂等，并使用 generationId 防止旧页面操作新 Tunnel。

建议视图：

- **Overview**：公网 URL、连接状态、edge、运行时长、版本。
- **Access**：一次性显示/轮换 Share Access Key、撤销 Session、当前 Session 数。
- **Security**：独立鉴权状态、Origin 校验、Preview 开关、最近失败次数。
- **Connection**：启动、停止、复制 URL、打开 URL。
- **Diagnostics**：DNS、UDP/7844、QUIC、Gateway、origin、WebSocket 和最近错误。
- **Limitations**：随机 URL、无 Access、无 SLA、最多 200 个并发中的请求、无 SSE、无 IPv6-only 和无 QUIC fallback。

任何安全检查失败时必须禁用启动按钮。轮换密钥和停止操作需要二次确认。

## 10. 本地数据与隐私

持久配置只保存非敏感默认值：

```json
{
  "schemaVersion": 2,
  "haConnections": 2,
  "reconnectBudgetPerReactor": 10,
  "sessionTtlMinutes": 720,
  "maxRequestBodyBytes": 1073741824
}
```

`originPort` 不属于正式持久配置；origin 由每次宿主启动时注入的 `DINOTTY_ORIGIN` 决定。`reconnectBudgetPerReactor` 只控制同一 Quick Tunnel 内保持 URL 的 reactor 重连，不允许自动申请新 Tunnel。

运行时可以保存：

- Supervisor PID、generationId 和启动时间。
- 当前随机公网 URL 和 edge location。
- Gateway 临时端口和健康状态。
- Share Access Key 的 salt + 摘要。
- 脱敏错误、流量计数、鉴权失败数和重连次数。
- 控制通道位置；控制 capability 必须单独以私有权限保存且不进入 status。

不得保存或记录：

- Share Access Key 明文。
- Gateway Session 明文。
- Quick Tunnel API 返回的临时 tunnel secret。
- Dinotty Token、Authorization、Cookie 或 Session。
- 完整请求头、请求体、终端内容和 Cloudflare 控制协议原始报文。

公网 URL 不是认证凭据，但仍不得上传遥测。Share Access Key 只能按用户操作复制，不自动写入剪贴板。

## 11. 跨平台和分发

首版目标：

| 平台键 | Rust target | 说明 |
|---|---|---|
| `windows-x86_64` | `x86_64-pc-windows-msvc` | Windows 10/11 x64 |
| `linux-x86_64` | `x86_64-unknown-linux-musl` | Linux/NAS x64 |
| `linux-aarch64` | `aarch64-unknown-linux-musl` | ARM64 Linux/NAS |
| `macos-x86_64` | `x86_64-apple-darwin` | Intel Mac |
| `macos-aarch64` | `aarch64-apple-darwin` | Apple Silicon |

Windows aarch64 不属于首版承诺；文档和 Marketplace 必须明确显示 unsupported，而不能笼统声称所有 aarch64 平台均支持。

平台必须由 Dinotty 后端根据运行服务的 OS/arch 选择，不能使用远程浏览器的 `navigator.platform`。

manifest 使用向后兼容的平台入口：

```json
{
  "permissions": [
    "native.execute",
    "process.long-running",
    "network.outbound",
    "network.listen-loopback",
    "network.connect-loopback",
    "clipboard.write-on-user-action"
  ],
  "bin": {
    "mode": "cli",
    "entries": {
      "windows-x86_64": "bin/windows-x86_64/dinotty-quick-tunnel-supervisor.exe",
      "linux-x86_64": "bin/linux-x86_64/dinotty-quick-tunnel-supervisor",
      "linux-aarch64": "bin/linux-aarch64/dinotty-quick-tunnel-supervisor",
      "macos-x86_64": "bin/macos-x86_64/dinotty-quick-tunnel-supervisor",
      "macos-aarch64": "bin/macos-aarch64/dinotty-quick-tunnel-supervisor"
    },
    "lifecycle": {
      "scope": "host",
      "stdinLease": true,
      "shutdownDeadlineMs": 10000,
      "forceKillAfterMs": 15000
    }
  }
}
```

legacy `bin.entry` 与新 `bin.entries` 均可存在，但 resolver 必须定义唯一优先级：当前 HostTarget 存在 `entries[target]` 时使用它，否则才使用 legacy `entry`；未知 target、选中入口缺失或两者解析到插件目录外时 fail closed。

Cloudflare Supervisor 必须显式声明 `lifecycle.scope: "host"`，使其跨插件 UI 热重载和浏览器断开继续运行。未声明时宿主默认使用兼容性的 `ui` scope，并在 UI 热重载时停止 managed process。

正式 Marketplace artifact 每个平台只包含当前目标的 Supervisor，manifest 可以保留其他平台的逻辑 entry，但安装器只要求选中 target 的入口存在。artifact descriptor 必须单独绑定 `pluginId`、`version`、`target`、`sha256`、压缩大小、解压上限、`minAppVersion`、选中 entry 和 `publisherKeyId`；浏览器安装时只提交插件 ID。

### 11.1 Native Artifact Signing RFC 前置条件

正式 Marketplace 发布前，Dinotty 主仓库必须先接受通用 Native Artifact Signing RFC。该 RFC 至少定义：

- Ed25519 签名和 RFC 8785/JCS 规范化 JSON descriptor。
- 签名覆盖 `pluginId/version/target/sha256/size/minAppVersion/entry/publisherKeyId`；下载 URL 不作为信任因素。
- 由 Dinotty 内置 marketplace root 授权 publisher key，registry 不能自行引入新信任根。
- root 签名的 publisher key 轮换、撤销列表和最低安全版本策略。
- 默认禁止静默降级；用户显式回滚需要本地确认，已撤销版本即使签名正确也拒绝安装。
- Windows Authenticode、macOS 签名/公证和 Marketplace Ed25519 签名各自的职责。

RFC 和宿主实现完成前，`../dinotty-cloudflare-tunnel` 只能开发安装，不得标记为正式 Marketplace 可用。

### 11.2 Native 权限确认

安装或首次启用时必须展示并确认以下能力：执行签名 native binary、页面关闭后继续运行 managed process、访问 Cloudflare 公网服务、监听临时 loopback 端口、连接 Dinotty loopback origin，以及仅在用户点击复制时写剪贴板。

首版若尚未提供操作系统级 native sandbox，权限 UI 必须明确标注这些权限主要用于告知和授权，不能虚假声称已经从 OS 层阻止二进制访问其他网络或当前用户文件。未声明、用户拒绝或宿主不认识的 native 权限必须 fail closed。

安全解压必须明确限制：

- 压缩大小、解压总大小、单文件大小、文件数量和路径长度。
- 拒绝绝对路径、`..`、Windows drive/ADS/reserved name 和大小写冲突。
- 拒绝 symlink、hardlink、device、FIFO 和其他特殊 entry。
- 校验 manifest id/version、descriptor target、签名、选中 target entry 和入口普通文件属性。
- 临时目录校验完成后才原子替换；失败时回滚。

## 12. Dinotty 主程序的通用改造

插件独立鉴权不要求 Dinotty 增加任何 Auth Gateway 或 Cloudflare 专用能力，但正式分发原生插件仍需要完善通用插件宿主。

### 12.1 P0：正式发布前必须完成

| 编号 | 通用主程序修改 | 主要文件 | 原因 |
|---|---|---|---|
| P0-1 | `HostTarget` 和统一 binary resolver | `src/plugin/types.rs`、`helpers.rs`、`manager.rs`、`handlers.rs` | 精确选择平台入口并阻止路径逃逸 |
| P0-2 | Marketplace artifact 服务端安装 | `types.rs`、`handlers.rs`、Server/Tauri 路由、Marketplace UI | 浏览器只提交插件 ID，后端选择并验证 artifact |
| P0-3 | 重构 managed process 所有权和输出消费 | `types.rs`、`handlers.rs`、`manager.rs` | 避免 pipe 阻塞和 wait/kill mutex 锁等待 |
| P0-4 | lifetime pipe、graceful stop、更新前停止和宿主退出清理 | `manager.rs`、`handlers.rs`、Server/Tauri shutdown | 正常/异常宿主退出均清理 Tunnel、Gateway 和 Bridge |
| P0-5 | 注入稳定运行时目录、实际 origin 和宿主信息 | `handlers.rs`、插件开发文档 | 插件不推导 Dinotty 私有路径或假设端口 8999 |
| P0-6 | 实际校验 `minAppVersion` | `helpers.rs`、`manager.rs`、安装/扫描 handlers | 阻止旧宿主运行新插件 |
| P0-7 | native artifact 签名和发布者信任 | Marketplace/安装 UI/后端验证 | 权限声明与确认已完成；registry 哈希仍不能独立抵御 registry 篡改 |

managed process 必须由单一后端 task 拥有 `Child`，通过 channel 协调 wait、graceful stop 和 force kill，不能让 `wait().await` 持有停止接口需要的 mutex。stdout/stderr 必须分别持续 drain，并使用有界 ring buffer。

前端 `unloadPlugin()` 不得再无条件调用 `stopAll()`。浏览器页面不拥有 Supervisor 生命周期；只有显式用户操作、插件禁用/卸载/更新和宿主 shutdown 可以触发停止。

主程序启动 native plugin 时设置默认工作目录并注入不可覆盖的保留环境变量：

```text
DINOTTY_PLUGIN_ID
DINOTTY_PLUGIN_DIR
DINOTTY_PLUGIN_DATA_DIR
DINOTTY_HOST_TARGET
DINOTTY_ORIGIN
DINOTTY_HOST_VERSION
DINOTTY_HOST_MODE
DINOTTY_PARENT_PID
```

插件请求中的 `DINOTTY_*` 环境变量必须拒绝或由宿主覆盖。`DINOTTY_ORIGIN` 必须使用当前实际监听端口并固定为 IPv4 loopback URL；数据目录应由宿主以当前用户私有权限创建。lifetime pipe 的句柄/FD 通过宿主管理的继承机制传递，不接受普通插件 env 覆盖。

### 12.2 不进入 Dinotty 主仓库的内容

- `cloudflare-quick-tunnel` Cargo 依赖。
- Share Access Key、Gateway Session 和登录页面。
- Gateway/Bridge、头部清洗和 Preview 公网策略。
- Quick Tunnel、QUIC、Cap'n Proto 和 edge 发现。
- Cloudflare API、Token、账号、Access 或 DNS 配置。
- Tunnel 状态机、重连预算和随机 URL。
- Cloudflare 专用设置读写接口。

### 12.3 主程序验收标准

- 五个 HostTarget 选择正确入口，未知目标 fail closed。
- legacy `bin.entry` 插件继续运行。
- 绝对路径、`..`、插件目录外 symlink 和非普通文件被拒绝。
- Marketplace 只接受插件 ID，artifact 签名和哈希均由后端验证。
- native process 持续输出超过 pipe buffer 后仍可停止。
- 正常 shutdown frame 和宿主异常退出 EOF 都能触发清理；15 秒后可强制终止，不留下 Gateway 端口或进程。
- 浏览器关闭、热重载或单客户端 unload 不会停止全局 Supervisor。
- 更新运行中插件时先停止旧 PID，Windows 不出现 executable locked。
- `DINOTTY_PLUGIN_DATA_DIR` 在三个操作系统上权限和路径正确。
- 非默认 `--port` 下 `DINOTTY_ORIGIN` 使用实际 loopback 端口，插件请求不能覆盖它。
- `minAppVersion` 不满足时安装前拒绝。

## 13. 插件仓库目录

```text
dinotty-cloudflare-tunnel/
├── plugin.json
├── src/
│   └── main.ts
├── dist/
│   └── main.js
├── styles.css
├── native/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── vendor/
│   │   └── cloudflare-quick-tunnel/
│   │       ├── UPSTREAM.md
│   │       ├── Cargo.toml
│   │       └── src/
│   └── src/
│       ├── main.rs
│       ├── auth.rs
│       ├── gateway.rs
│       ├── bridge.rs
│       ├── control.rs
│       ├── doctor.rs
│       ├── state.rs
│       └── tunnel.rs
├── release/
│   ├── signing-policy.md
│   └── targets.json
└── README.md
```

开发包可以包含多个 `bin/<target>/`，正式 Marketplace artifact 只包含当前目标。

## 14. 分阶段实施计划

### Phase 0：协议、crate API 和独立鉴权验证

- 固定并审核 `cloudflare-quick-tunnel 0.3.1`。
- 在 `native/vendor/cloudflare-quick-tunnel` 建立受审最小 fork，记录上游精确 commit/source checksum，并固定插件仓库 release commit。
- 建立最小 Gateway，证明未认证请求不会建立 origin 连接。
- 验证 Share Access Key、Session Cookie、Host/Origin 和 WebSocket 鉴权。
- 在真实 edge 记录 Cloudflare header、HTTP、WebSocket 和 chunked 行为。
- 对 fork 的 Cloudflare metadata -> HTTP/1.1 重建层进行 fuzz/property tests，证明非法 framing 在到达 Gateway parser 前已被拒绝。
- 验证 UDP/7844 阻断、连接/重连中取消、单个/全部 reactor 退出和有界 shutdown。

通过条件：在 Dinotty Token 为空、loopback 白名单开启和 `trusted_proxies` 任意配置下，未认证公网请求仍全部被 Gateway 拒绝；任意网络阶段收到 shutdown 后均在 deadline 内退出；全部 reactor 耗尽后不自动申请新 URL。

### Phase 1：Dinotty 通用插件宿主改造

- 完成 HostTarget、平台入口和 Marketplace artifact descriptor/安装基础设施。
- 重构 managed process 所有权、输出 drain 和退出事件。
- 实现 lifetime pipe、graceful stop、更新前停止和正常/异常 shutdown 清理。
- 移除浏览器 unload 自动 stop-all 语义。
- 注入私有运行时目录、`DINOTTY_ORIGIN` 和保留环境变量。
- 校验 `minAppVersion`、artifact 签名和 native 权限确认。

通过条件：第 12.3 节全部通过。

### Phase 2：Supervisor、Gateway 和 Bridge

- 实现离线/长运行/在线控制命令，以及两阶段 `rotate-key-prepare/commit/cancel`。
- 实现 CSPRNG Access Key、摘要存储和 Gateway Session。
- 实现严格路由、Origin、Cookie、framing 和 header 清洗。
- 实现 Preview 默认拒绝和单次运行显式开启。
- 实现单实例锁、私有控制通道、状态文件和脱敏日志。
- 接入 Quick Tunnel，验证 Gateway 崩溃立即关闭 Tunnel。

通过条件：第 15.1 至 15.3 节安全测试全部通过。

### Phase 3：插件 UI 和并发生命周期

- 实现一次性密钥显示、轮换、Session 撤销和安全提示。
- 实现 generationId、防旧页面操作和多浏览器幂等命令。
- 实现状态、URL、Preview 开关和诊断 UI。
- 验证浏览器关闭不会停止 Tunnel。

### Phase 4：五目标构建和独立发布

- 完成并接受 Native Artifact Signing RFC；未完成时 Phase 4 阻塞。
- 构建五个声明目标。
- Windows 签名，macOS 签名/公证，Linux 检查动态依赖。
- 生成签名 artifact、SHA-256、SBOM 和 provenance。
- 测试 Marketplace 安装、升级、回滚、卸载和密钥清理。
- 在插件仓库发布版本，不与 Dinotty 主仓库版本绑定。

### Phase 5：稳定性和发布门槛

- 建立真实 edge canary。
- 完成依赖许可证和供应链审计。
- 验证网络切换、休眠、长时间 WebSocket 和大文件。
- 发布明确标注 Experimental/Temporary Share 的首版。

## 15. 验收测试

### 15.1 未认证公网访问

在以下 Dinotty 组合中重复测试：Token 有/无、loopback 白名单有/无、`trusted_proxies` 有/无、Server/Desktop。

| 请求 | 预期结果 |
|---|---|
| `GET /` | Gateway 登录页，不连接 Dinotty |
| `GET /api/settings` | 401，不连接 Dinotty |
| `GET /api/token` | 401，不连接 Dinotty |
| `GET /api/auto-token` | 401，不连接 Dinotty |
| WebSocket `/ws`、`/ws/sync` | Upgrade 前 401 |
| `/preview/8999` | 401，不连接 Preview |
| 大文件 POST | 读取小范围 header 后 401，不缓存请求体 |
| 伪造 XFF/CF IP | 仍为 401 |

需要使用 origin accept counter 或测试 listener 证明未认证请求没有建立 origin TCP 连接，而不能只检查最终状态码。

### 15.2 独立鉴权

- 正确 Access Key 建立 Gateway Session。
- 错误、截断、超长、Unicode 混淆和空密钥被拒绝。
- 登录 body 大小和 content type 限制生效。
- Cookie 包含 `Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/` 且无 Domain。
- Cookie 不能跨 Tunnel generation 复用。
- `rotate-key-prepare` 后旧 Key/Session 仍有效；candidate 明文只返回一次并按 TTL 过期。
- `rotate-key-commit` 原子切换；提交后旧密钥和全部旧 Session 立即失效，已有 WebSocket 和长流被主动关闭。
- prepare 输出丢失、UI 崩溃、cancel、重复 commit、错误/过期 candidate 和错误 generation 均不产生未定义状态。
- stop/restart 后旧密钥、Cookie 和 URL 均不可继续使用。
- 同一 keep-alive 连接上的每个 HTTP 请求都重新验证 Cookie，不能继承前一个请求的认证状态。
- 每 IP 和全局登录限速生效；缺失 CF IP 时仍 fail closed。
- Host 不匹配、Origin 缺失/伪造和跨站状态变更被拒绝。
- WebSocket Cookie 或 Origin 不合法时不能 Upgrade。
- `/api/auto-token` 即使 Gateway 已认证也按插件策略阻止。
- 已认证客户端访问静态资源后，未认证的新客户端仍只能得到登录页/401，不能命中 edge 缓存内容。
- `GET/HEAD + Accept: text/html` 未认证时重定向；XHR/API、非页面请求和 WebSocket 返回结构化 401，不返回登录 HTML。
- 第 6.4 节的 URI/header/body/并发/timeout 和限速默认值均有边界测试。

### 15.3 代理头和 HTTP 攻击

至少覆盖：

```text
X-Forwarded-For: 127.0.0.1
X-Forwarded-For: ::1
重复和非法 CF-Connecting-IP
header name/value 中 CR/LF/NUL
重复或冲突 Content-Length
Content-Length 与 Transfer-Encoding 同时存在
非法 Connection/Upgrade 组合
绝对 URI、异常 Host、超长 URI
未认证的大 body、slowloris 和 chunked body
Cookie 中伪造或重复 __Host-dinotty_share
```

任何来源头都不得改变鉴权结果。通过鉴权后，Gateway Cookie 和来源转发头不得泄漏到 Dinotty origin。

除公网畸形请求测试外，还必须直接构造 fork 的 Cloudflare `ConnectRequest` metadata，覆盖 CR/LF/NUL、重复 header、非法 header name、CL/TE 冲突和异常绝对 URI，证明第一层重建和 Gateway 第二层解析均 fail closed。

### 15.4 功能测试

- Gateway 登录、注销、轮换和撤销。
- Dinotty 第二层 Token 登录（需要时）、登出和 Session 续期。
- Terminal 输入输出、resize、重连和多标签。
- `/ws/sync`、file watcher、notification、history、monitor。
- 文件上传、下载、编辑和 workspace 操作。
- Preview 默认 403；显式开启后 HTTP/WebSocket 可用。
- 插件资源加载和允许的 native plugin 功能。
- 非 SSE streaming；SSE 作为 Cloudflare Quick Tunnel 外部限制在 UI/README 明确标记为不支持，不声称由 Gateway 自动识别全部 SSE。
- 同源浏览器功能通过；无 `Origin` 的状态变更请求、第三方 WebSocket 和 Agent 客户端按首版策略被拒绝。

### 15.5 生命周期测试

- prepared state 未启动时自动过期。
- Gateway 先 bind，Tunnel 后创建。
- Gateway/Bridge panic 时 Tunnel 立即关闭。
- Dinotty origin 暂时不可用后恢复。
- 单个 HA reactor 断开后在预算内重连，URL 和 generationId 不变。
- 全部 HA reactor 耗尽后清理 Gateway/Session/Tunnel 并进入 error，不自动申请新 URL。
- 在 DNS、Quick Tunnel API、QUIC dial、register、supervisor accept 和 reconnect backoff 各阶段触发 shutdown，均在内部 10 秒 deadline 内退出。
- 重复 shutdown、部分 reactor 已退出和 unregister 卡住时仍可在宿主 15 秒上限内强制清理。
- 多浏览器同时 start/stop/rotate/revoke。
- 旧页面不能操作新 generation。
- 浏览器关闭、热重载、插件禁用、更新和卸载。
- Dinotty 正常退出发送 shutdown frame；异常消失关闭 lifetime pipe 并由 EOF 触发清理。
- PID 被重用或 PID 检查失败不能阻止 lifetime EOF 清理；`DINOTTY_PARENT_PID` 不参与唯一性判断。
- 系统睡眠唤醒后普通 reactor 重连保持 URL；若全部耗尽则进入 error，不创建新 URL。
- stale lock、PID、state、control socket 和端口占用。

### 15.6 平台和分发测试

- Windows x86_64：路径空格、Named Pipe ACL、Defender、签名和进程终止。
- Linux x86_64/aarch64：musl、Unix socket 权限、低权限用户、容器/NAS。
- macOS Intel/Apple Silicon：签名、公证、Firewall 和可执行权限。
- native 权限完整展示；拒绝、缺失或未知权限时不执行二进制，UI 不把声明性权限误报为 OS sandbox。
- IPv4-only 和具有可用 IPv4 的双栈网络成功。
- IPv6-only、企业网络阻止 UDP/7844 或无可用 IPv4 时在有限时间内报告明确 unsupported/unreachable，不无限重连、不建立旁路直连。
- artifact bomb、路径穿越、link entry、错误 target、错误签名和 registry 篡改。

## 16. 监控与诊断

插件只展示：

- 当前临时公网 URL、generationId、版本和 edge。
- Tunnel/Gateway/origin 状态和运行时长。
- Gateway Session 数量、鉴权失败计数和最近轮换时间。
- streams、bytes、reconnects 和脱敏错误。
- HTTP/WebSocket 本地探测结果。

`doctor` 至少检查：

- HostTarget、artifact 和数据目录权限。
- 单实例锁、控制通道和 lifetime pipe。
- `DINOTTY_ORIGIN` 来自宿主保留环境、是精确 IPv4 loopback URL且端口可连接，但不读取 Dinotty Token。
- Gateway 本地未认证/已认证自检。
- DNS SRV、Quick Tunnel API、UDP/7844、QUIC 和证书。

诊断不得展示 Share Access Key、Gateway Session、控制 capability、Dinotty Token、Authorization、Cookie、完整头部/请求体或终端内容。

## 17. 回滚和事件响应

正常回滚：

1. Supervisor 撤销全部 Gateway Session。
2. shutdown Quick Tunnel。
3. 停止 Gateway/Bridge 并确认临时端口释放。
4. 清理 prepared/runtime state、control socket 和单实例锁。
5. 禁用或卸载插件。

不需要修改或回滚 Dinotty 的 `trusted_proxies`、`ip_whitelist`、Token 或 Preview 配置，因为插件从未改动它们。

怀疑 Share Access Key 泄露时：

1. 立即执行两阶段 rotate-key（prepare 后确认并 commit）或 stop。
2. 撤销全部 Gateway Session。
3. 检查脱敏鉴权失败和连接记录。
4. 若泄露期间存在已认证访问，按主机权限泄露处理；必要时轮换 Dinotty Token、Agent Token、SSH 凭据和其他可由终端访问的 secret。

停止 Supervisor 后 Quick Tunnel URL 应失效，不存在 Cloudflare Dashboard 资源需要删除。

## 18. 最终实施决策

- 插件代码存放在独立仓库 `../dinotty-cloudflare-tunnel`，与 Dinotty 主仓库独立发布。
- Plugin UI、Supervisor、Auth Gateway 和 Bridge 位于同一个插件仓库。
- 只支持匿名 Quick Tunnel，不支持 Named Tunnel。
- 使用基于 `cloudflare-quick-tunnel 0.3.1` 的纯 Rust 受审最小 fork，不安装或调用 `cloudflared`。
- Gateway 独立鉴权是所有公网业务请求的强制前置条件。
- Share Access Key 每次启动随机生成，不进入 URL，不持久化明文。
- 密钥轮换使用 prepare/commit/cancel 两阶段协议。
- Gateway Session 与 Dinotty Session 完全分离。
- 不要求或修改 `trusted_proxies`、`ip_whitelist`、Dinotty Token 和 Preview 设置。
- 不恢复真实 IP 给 Dinotty；来源 IP 仅在 Gateway 内用于限速和脱敏诊断。
- Preview 默认由 Gateway 阻止，只允许本次运行显式开启。
- Server 需要 Dinotty Token 时允许出现第二次登录，首版不做 SSO。
- 获取 Share Access Key 的用户视为临时完整操作者，不提供低权限承诺。
- 单个 reactor 只在同一 Tunnel 内有限重连；全部 reactor 耗尽后进入 error，不自动申请新 URL。
- 宿主注入不可覆盖的 `DINOTTY_ORIGIN`，并通过 lifetime pipe 约束 Supervisor 生命周期。
- 首版只承诺同源浏览器，支持 IPv4-only/有 IPv4 的双栈网络，不承诺 IPv6-only、Agent 客户端或 QUIC transport fallback。
- Cloudflare edge 可以观察应用明文流量；本插件提供访问控制，不提供端到端加密。
- reactor 状态/取消 API、managed process 生命周期、Native Artifact Signing RFC 和独立鉴权测试全部是正式发布 P0。
- 无法确认 Gateway 鉴权先于 Dinotty origin 连接、无法可靠监控/停止 reactor、artifact 信任不可验证或任一安全检查失败时，必须 fail closed。

## 19. 外部参考

- [`cloudflare-quick-tunnel` crate](https://crates.io/crates/cloudflare-quick-tunnel)
- [`cloudflare-quick-tunnel` source](https://github.com/lordmacu/cloudflare-quick-tunnel-rs)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)

## 20. Dinotty 仓库内部参考

- `src/auth/mod.rs:103`：主鉴权中间件；插件不得把它作为公网第一道鉴权。
- `src/auth/mod.rs:249`：当前真实来源 IP 解析；新方案不要求修改或使用它。
- `src/settings/mod.rs:407`：Desktop/Server 默认 loopback 白名单差异。
- `src/proxy/mod.rs:92`：Preview 核心鉴权；Gateway 仍需执行自己的 Preview 策略。
- `frontend/src/composables/usePluginLoader.ts:226`：managed process 客户端 API。
- `frontend/src/composables/usePluginLoader.ts:400`：当前 unload 会停止进程，必须改为宿主拥有生命周期。
- `src/plugin/types.rs:25`：当前单一 binary 入口。
- `src/plugin/helpers.rs:9`：manifest 校验入口。
- `src/plugin/manager.rs:42`：当前 managed process 停止实现。
- `src/plugin/handlers.rs:742`：managed process 启动和 wait 实现。
- `src/main.rs:824`：Server 插件路由入口。
- `src-tauri/src/embedded_server.rs:604`：Tauri 插件路由入口。

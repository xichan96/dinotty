# 安装

Dinotty 提供 macOS / Linux / Windows 桌面端、Linux 服务端 deb 包，以及移动端 PWA。所有产物都在 [GitHub Releases](https://github.com/xichan96/dinotty/releases) 发布。

::: tip 两种角色
- **桌面端**：Tauri 原生客户端，开箱即用，适合个人开发者在本地或局域网使用
- **服务端**：长期运行的 dinotty-server 进程，适合部署到服务器，被多端远程连接
:::

## 桌面端

### macOS

下载 `.dmg` 安装包，双击挂载后把 Dinotty 拖入 Applications 即可。

```bash
# 命令行安装示例
curl -LO https://github.com/xichan96/dinotty/releases/latest/download/Dinotty_<version>_aarch64.dmg
hdiutil attach Dinotty_<version>_aarch64.dmg
cp -R "/Volumes/Dinotty/Dinotty.app" /Applications/
hdiutil detach "/Volumes/Dinotty"
```

::: tip 已签名 + 公证
macOS 产物已通过 Apple Developer ID 签名并完成公证，首次打开无需执行 `xattr -cr` 解除限制。
:::

### Linux

桌面端提供两种格式：

| 格式 | 适用发行版 | 安装方式 |
|------|-----------|---------|
| `.deb` | Debian / Ubuntu / Linux Mint | `sudo dpkg -i dinotty_<version>_amd64.deb` |
| `.AppImage` | 大多数发行版 | `chmod +x Dinotty_*.AppImage && ./Dinotty_*.AppImage` |

`.AppImage` 是单文件可执行，无需安装；首次运行如果提示信任，需在文件属性里勾选「允许执行」。

### Windows

下载 NSIS 安装包（`Dinotty_<version>_x64-setup.exe`）双击安装，或使用 portable 版本（`Dinotty_<version>_x64-portable.exe`）免安装直接运行。

```powershell
# Portable 启动示例
.\Dinotty_<version>_x64-portable.exe
```

## 服务端 deb（Linux）

`dinotty-server` 是独立的 Rust 二进制，不依赖桌面端，适合部署到 VPS 或家用服务器。

```bash
# 一键下载安装最新版
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') \
  && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" \
  && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"

# 启动 / 开机自启
sudo systemctl enable --now dinotty

# 查看状态
systemctl status dinotty
journalctl -u dinotty -f
```

详细部署（systemd 配置、Docker、反向代理、Windows 服务化等）见 [部署指南](getting-started/deployment)。

## 移动端 PWA

移动端不提供原生 App，使用 PWA：

1. 在手机浏览器访问服务端 URL（如 `http://192.168.1.10:8999`）
2. 浏览器菜单选择「添加到主屏」/「安装应用」
3. 主屏图标点击即可全屏启动，体验接近原生 App

iOS Safari、Android Chrome、HarmonyOS 浏览器均支持。

## 首次启动

### 桌面端

首次打开桌面端会提示连接服务端：

- **连接到现有服务端**：填写服务端 URL 和访问 Token（如服务端已启用 Token 认证）
- **启动本地服务端**：桌面端会自动启动一个本地 dinotty-server 进程，适合单机使用

### 服务端

服务端默认监听 `0.0.0.0:8999`，启动后访问 `http://<server-ip>:8999` 即可。

```bash
# 指定端口
dinotty-server -p 3000

# 指定默认 shell
DINOTTY_SHELL=/bin/zsh dinotty-server
```

::: warning Token 认证
公网暴露的服务端**必须**配置 Token 认证。详见 [Token 权限系统](internals/token-system) 和 [访问安全设计](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/auth-security-design.md)。
:::

## 升级

升级时直接下载新版本覆盖安装即可，配置和工作区数据保留在：

| 平台 | 配置目录 |
|------|---------|
| macOS / Linux | `~/.config/dinotty/` |
| Windows | `%APPDATA%\dinotty\` |
| Linux 服务端（deb） | `/var/lib/dinotty/` |

Dinotty 默认会在每次桌面程序启动，或浏览器/PWA 页面重新加载并完成登录后，自动检查一次官方 GitHub Release；不会在程序运行期间定时检查。可在“设置 > 关于”最下方关闭“自动检查更新”，重新开启时会立即检查一次。只有稳定版高于当前版本且已发布超过 24 小时时，“设置 > 关于”才会显示新版本卡片；如果窗口处于可见前台，还会在启动阶段弹出一次提示，如果检查结果在后台返回，则在窗口重新进入前台时提示。点击提示会进入“设置 > 关于”，点击“前往下载”时，Web/PWA 会在浏览器新标签页打开，桌面程序会使用系统浏览器打开；Dinotty 不会自动下载或安装更新。断网、GitHub 限流或检查失败不会影响启动，也不会显示错误通知。

服务端 deb 升级：

```bash
sudo dpkg -i dinotty-server_<new-version>-1_amd64.deb
sudo systemctl restart dinotty
```

## 从源码构建

不使用预编译产物，可从源码构建：

```bash
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# 构建前端
cd frontend && pnpm install && pnpm run build && cd ..

# 运行服务端
cargo run

# 或构建桌面端
pnpm dlx @tauri-apps/cli build
```

详细构建步骤见 [部署指南](getting-started/deployment)。

## 下一步

- [部署指南](getting-started/deployment) - 服务端 systemd / Docker / 反向代理 / Windows 服务化
- [介绍](introduction) - 项目定位与核心特性
- [多端同步与 Mission Control](guide/multi-device-sync) - 三端连接与设备切换

# 部署指南

本文说明如何安装和部署构建产物。仓库维护者准备版本、创建 tag 和监控正式发布时，请参阅[发布指南](releasing.md)。

## 推荐发布流程（CI/CD）

发布和部署优先使用仓库里的 `Package` workflow（`.github/workflows/package.yml`），不要手动在本机跑构建脚本作为正式产物来源。

- 手动打包：进入 GitHub Actions → `Package` → `Run workflow`，选择 `dev` 或 `main`；手动运行只上传 Actions artifacts。
- 正式发布：在 `main` 上推送 `v*` tag；CI 会构建包并发布到 GitHub Release。
- CI 产物：`dinotty-macos` 包含 `.dmg`，`dinotty-linux` 包含桌面 `.deb` / `.AppImage` 和服务端 `dinotty-server_*.deb`，`dinotty-windows` 包含 NSIS 安装包和 portable `.exe`。
- 产物暂存：CI 会把包复制到 `dist/package-artifacts/` 后上传，手动运行的 artifacts 默认保留 14 天。

## 本地脚本定位

`./scripts/build.sh` 和 `./scripts/build-linux-deb.sh` 只用于本地修改代码后的临时构建、验证或排障；正式部署和发布请走上面的 CI/CD 流程。

```bash
# macOS，在仓库根目录运行；仅用于本地改代码后的临时构建
./scripts/build.sh native
./scripts/build.sh list

# 远程构建 Linux deb；仅用于本地改代码后的临时排障
./scripts/build-linux-deb.sh
```

## Linux systemd 部署（推荐使用 CI deb）

从 `Package` workflow 的 `dinotty-linux` artifact 或 GitHub Release 下载服务端 deb 后安装：

```bash
sudo apt install ./dinotty-server_*.deb

# 管理命令
systemctl status dinotty       # 查看状态
systemctl restart dinotty      # 重启
systemctl stop dinotty         # 停止
journalctl -u dinotty -f       # 查看实时日志

# 修改配置后重启
sudo vim /etc/dinotty/env      # 编辑端口、Token、日志级别
sudo systemctl restart dinotty
```

deb 安装后会部署 `dinotty-server`、systemd unit 和 `/etc/dinotty/env.example`，并启用/启动 `dinotty.service`。

如果只是本地改代码后的临时二进制验证，可以显式传入本地构建产物：

```bash
sudo bash deploy/systemd/install.sh --bin target/release/dinotty-server --token your-secret-token
sudo bash deploy/systemd/uninstall.sh
```

## Linux 桌面包

从 CI 的 `dinotty-linux` artifact 或 GitHub Release 获取桌面包：

```bash
# deb 安装包
sudo apt install ./Dinotty*.deb

# 或直接运行 AppImage
chmod +x ./Dinotty*.AppImage
./Dinotty*.AppImage
```

Dinotty 的 Linux 系统托盘功能为实验性功能，需要桌面环境提供 AppIndicator 宿主及相应动态库。GNOME 通常还需要启用 AppIndicator 扩展，KDE Plasma 通常可直接使用系统托盘。缺少宿主或动态库时，Dinotty 会记录诊断信息并继续正常运行，但不会隐藏主窗口；可从其他入口正常退出。应用不会自动安装动态库或桌面扩展。

桌面 `.deb` 和 AppImage 可在“设置 → 通用 → 启动”中启用当前用户登录自启动。登录后 Dinotty 只启动后台桌面进程和系统托盘，不会预先创建主窗口、WebView 或 PTY；通过托盘、全局快捷键或再次启动 Dinotty 才会打开窗口。Linux 使用 `${XDG_CONFIG_HOME:-$HOME/.config}/autostart/dinotty.desktop`，属于尽力支持：Dinotty 只保证生成有效的 XDG Desktop Entry，桌面环境是否执行仍取决于其自启动与 AppIndicator 支持。托盘不可用时不能启用，自启动时若托盘安装失败则进程安静退出。

AppImage 是不由系统包管理器维护的便携包。启用自启动前，Dinotty 会提示将镜像放在可信、固定且登录时可访问的位置；移动、改名、删除镜像或换用不同文件名的新版后，启动项仍会指向旧副本，应用不会自动扫描、迁移或清理。移除当前副本前应先关闭自启动；从新位置启动 Dinotty 后可选择“改用当前文件”，稳定符号链接也可以作为固定入口。卸载 `.deb` 不会以 root 扫描或删除各用户的记录；应在删除应用前从设置中关闭，或在确认该文件属于 Dinotty 后手工删除 `~/.config/autostart/dinotty.desktop`（使用自定义 `XDG_CONFIG_HOME` 时删除对应目录下的文件）。

## macOS 桌面包

从 CI 的 `dinotty-macos` artifact 或 GitHub Release 下载 `.dmg`，打开后按系统提示安装。

将 `.app` 放入 `/Applications` 或 `~/Applications` 后，可在“设置 → 通用 → 启动”中启用当前用户登录自启动。DMG、App Translocation、只读卷和其他位置不允许启用。记录保存在 `~/Library/LaunchAgents/com.dinotty.terminal.autostart.plist`；登录后仅保留托盘和后台能力，首次显式打开时才创建主窗口。

直接删除 `.app` 不会触发卸载钩子。删除前应先在设置中关闭自启动；如果应用已删除，可在确认内容属于 Dinotty 后手工删除上述 plist。

## Windows 桌面包

从 CI 的 `dinotty-windows` artifact 或 GitHub Release 下载：

- NSIS 安装包：适合正常安装和卸载。
- portable `.exe`：适合免安装测试。

Dinotty 运行时会持续注册一个系统托盘图标。Windows 决定该图标直接显示在时间旁还是收入 `^` 溢出区域，应用不会修改系统偏好：

- Windows 11：打开“设置 → 个性化 → 任务栏 → 其他系统托盘图标”，开启 Dinotty。
- Windows 10：打开“任务栏设置 → 选择哪些图标显示在任务栏上”，开启 Dinotty。
- NSIS 安装版与 portable 版的可执行文件路径不同，Windows 可能将它们视为两个独立条目，需要分别设置。

可在“设置 → 通用 → 启动”中启用当前用户登录自启动。Dinotty 将精确的当前 exe 路径和唯一的 `--background` 参数写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `Dinotty` 值；登录后不会自动打开主窗口。固定本地盘和可移动本地盘支持启用，网络映射盘、UNC、光盘、RAM disk 和未知卷不支持。portable 版不由安装程序维护，启用前会提示将 exe 放在可信、固定且登录时可访问的位置；移动、改名、删除文件或换用不同文件名的新版后，启动项仍会指向旧副本，应用不会自动迁移或清理。移除当前副本前应先关闭自启动；换用新副本后需从新副本重新配置，以接管旧记录。

NSIS 覆盖更新会保留自启动。普通卸载只在 Run 值为 `REG_SZ` 且仍精确指向本次安装目录时删除它；指向另一份 Dinotty、包含额外参数、类型异常或格式异常的值均保持不变。Windows 还可能在系统设置中抑制已配置的启动项，Dinotty 不修改 undocumented `StartupApproved` 状态。

关闭主窗口时可以选择隐藏到系统托盘、真正退出或取消。隐藏不会终止 PTY、终端会话和嵌入式服务；真正退出会尽力保存前端状态后清理会话。系统强制终止、断电或进程崩溃时无法保证完成保存。

该功能只处理用户登录后的桌面自启动，不创建 Windows Service，也不在登录前运行。

## Docker 部署

Docker 镜像当前仍按本地 Compose 流程构建：

```bash
cd deploy/docker

# 配置环境变量
cp .env.example .env
# 编辑 .env 设置 DINOTTY_TOKEN、WORKSPACE_DIR 等

# 构建并启动（支持 amd64 和 arm64）
docker compose up -d --build

# 管理命令
docker compose logs -f         # 查看日志
docker compose restart         # 重启
docker compose down            # 停止并移除

# 多架构构建并推送
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/dinotty:latest --push \
  -f deploy/docker/Dockerfile .
```

Windows 上可通过 Docker Desktop 使用 Linux 容器部署；`.env` 中的工作区路径需要按 Docker Desktop 的挂载路径填写。

## 在已有容器内安装 dinotty-server

如果不想构建专用镜像，而是直接在已有的 Debian/Ubuntu 容器里跑 `dinotty-server`，可以用 `supervisor` 守护进程。下面命令在容器内下载 v0.20.0 的 deb 并交给 supervisor 拉起：

```bash
apt update && apt install -y wget supervisor && \
wget https://github.com/xichan96/dinotty/releases/download/v0.20.0/dinotty-server_0.20.0-1_amd64.deb && \
(dpkg -i dinotty-server_0.20.0-1_amd64.deb || apt -f install -y) && \
rm -f dinotty-server_0.20.0-1_amd64.deb && \
echo -e "[program:dinotty-server]\ncommand=dinotty-server\nautostart=true\nautorestart=true\nstdout_logfile=/var/log/dinotty.log\nstderr_logfile=/var/log/dinotty.err.log" \
  > /etc/supervisor/conf.d/dinotty.conf && \
supervisord -c /etc/supervisor/supervisord.conf && \
supervisorctl update
```

要点：

- `dpkg -i ... || apt -f install -y` 在依赖缺失时自动补齐。
- `supervisord` 必须作为容器主进程（PID 1）常驻，否则容器会立即退出。
- 默认监听 `8999`；改端口在 supervisor 的 `command=dinotty-server -p <port>`，并在 `docker run -p` 同步映射。
- 想锁版本请把 URL 里的 `v0.20.0` 与文件名里的 `0.20.0` 替换为目标版本；获取最新版可参考 [安装页](../installation#服务端-deb-linux) 的 `VERSION=...` 片段。

最小化 Dockerfile 示例：

```dockerfile
FROM ubuntu:22.04

RUN apt update && apt install -y wget supervisor && \
    wget https://github.com/xichan96/dinotty/releases/download/v0.20.0/dinotty-server_0.20.0-1_amd64.deb && \
    (dpkg -i dinotty-server_0.20.0-1_amd64.deb || apt -f install -y) && \
    rm -f dinotty-server_0.20.0-1_amd64.deb

COPY <<'EOF' /etc/supervisor/conf.d/dinotty.conf
[program:dinotty-server]
command=dinotty-server
autostart=true
autorestart=true
stdout_logfile=/var/log/dinotty.log
stderr_logfile=/var/log/dinotty.err.log
EOF

EXPOSE 8999
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
```

::: warning Token 认证
公网暴露的容器务必配置 Token。可在 supervisor command 追加 `-t <token>`，或写入 `/etc/dinotty/env` 后 `supervisorctl restart dinotty-server`。详见 [Token 权限系统](/zh/internals/token-system)。
:::

## 跨平台包

跨平台桌面包由 `Package` workflow 的 matrix 统一生成：

| 平台 | CI 环境 | 产物 |
|------|---------|------|
| macOS | `macos-latest` | `.dmg` |
| Linux | `ubuntu-22.04` | 桌面 `.deb` / `.AppImage`、服务端 `dinotty-server_*.deb` |
| Windows | `windows-latest` | NSIS `.exe`、portable `.exe` |

## 配置说明

| 参数 | 方式 | 默认值 | 说明 |
|------|------|--------|------|
| 端口 | `--port` / `-p` | 8999 | 服务监听端口 |
| Token | `DINOTTY_TOKEN` 环境变量或配置文件 | 未配置 / 首次设置 | 访问认证令牌，为空时进入首次设置流程 |
| 日志级别 | `RUST_LOG` 环境变量 | info | trace / debug / info / warn / error |
| Shell | Unix: `SHELL`；Windows: `DINOTTY_SHELL` | 自动检测 | Windows 优先 `DINOTTY_SHELL`，再尝试 `pwsh.exe`、`powershell.exe`、`%ComSpec%` / `cmd.exe` |

### Shell 探测与 WSL

“设置 → 通用 → Shell”中的列表由 Dinotty 后端主机实时探测，而不是由浏览器所在设备决定。每次打开选择器都会重新探测；列表中的“已检测到”只表示可执行文件或 WSL 发行版已找到，不保证用户启动脚本一定能成功运行。修改只影响之后创建的本地终端和分屏，已经打开的终端不会切换 Shell。

Windows 主机安装了支持 `--distribution` 和 `--cd` 的 WSL，且至少注册了一个发行版时，可以选择默认发行版或指定发行版。Dinotty 通过系统目录中的 `wsl.exe` 启动它，并将发行版名称和工作目录作为独立参数传入。没有显式工作目录时，WSL 从 Linux 用户主目录 `~` 启动；有 Windows 工作区目录时，由 WSL 自己解释该 Windows 路径。

首版不会把 WSL 内的 Linux 路径映射回 Windows 文件工作区，也不会假定发行版使用 `/mnt/<盘符>`。因此，WSL 终端中的输入、调整大小、关闭、重连和分屏可正常使用，但文件工作区的“运行代码”操作会被禁用并给出提示。

### 配置与数据目录

| 平台 | 配置目录 | 插件目录 |
|------|----------|----------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Token、`settings.json`、审计日志和 webhook secrets 存放在配置目录；插件持久化数据存放在用户目录下的 `.dinotty/plugin-data`。

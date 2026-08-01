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

## macOS 桌面包

从 CI 的 `dinotty-macos` artifact 或 GitHub Release 下载 `.dmg`，打开后按系统提示安装。

## Windows 桌面包

从 CI 的 `dinotty-windows` artifact 或 GitHub Release 下载：

- NSIS 安装包：适合正常安装和卸载。
- portable `.exe`：适合免安装测试。

Dinotty 运行时会持续注册一个系统托盘图标。Windows 决定该图标直接显示在时间旁还是收入 `^` 溢出区域，应用不会修改系统偏好：

- Windows 11：打开“设置 → 个性化 → 任务栏 → 其他系统托盘图标”，开启 Dinotty。
- Windows 10：打开“任务栏设置 → 选择哪些图标显示在任务栏上”，开启 Dinotty。
- NSIS 安装版与 portable 版的可执行文件路径不同，Windows 可能将它们视为两个独立条目，需要分别设置。

关闭主窗口时可以选择隐藏到系统托盘、真正退出或取消。隐藏不会终止 PTY、终端会话和嵌入式服务；真正退出会尽力保存前端状态后清理会话。系统强制终止、断电或进程崩溃时无法保证完成保存。

如需开机自启，可以使用 Windows 任务计划程序、NSSM 或 WinSW 包装 portable 可执行文件。

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

### 配置与数据目录

| 平台 | 配置目录 | 插件目录 |
|------|----------|----------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Token、`settings.json`、审计日志和 webhook secrets 存放在配置目录；插件持久化数据存放在用户目录下的 `.dinotty/plugin-data`。

#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Dinotty 一键部署脚本 (Linux systemd)
# ============================================================

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/dinotty"
DATA_DIR="/var/lib/dinotty"
SERVICE_USER="dinotty"
SERVICE_NAME="dinotty"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

PORT="${DINOTTY_PORT:-8999}"
TOKEN="${DINOTTY_TOKEN:-}"
BIN_SOURCE=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

usage() {
    cat <<EOF
用法: $0 [选项]

选项:
  --bin <路径>     使用本地二进制文件（而非自动查找）
  --port <端口>    服务端口（默认 8999）
  --token <令牌>   认证 Token（留空则自动生成）
  -h, --help       显示帮助信息

示例:
  # 使用本地构建的二进制
  sudo $0 --bin ./target/release/dinotty-server

  # 指定端口和 Token
  sudo $0 --bin ./dist/dinotty-server-x86_64-unknown-linux-musl --port 9000 --token my-secret

环境变量:
  DINOTTY_PORT     服务端口
  DINOTTY_TOKEN    认证 Token
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bin)   BIN_SOURCE="$2"; shift 2 ;;
        --port)  PORT="$2"; shift 2 ;;
        --token) TOKEN="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) die "未知参数: $1" ;;
    esac
done

[[ "$(id -u)" -eq 0 ]] || die "请使用 sudo 运行此脚本"
command -v systemctl &>/dev/null || die "未检测到 systemd"

# 先停止服务（避免覆盖正在运行的二进制）
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

# 确定二进制文件来源
detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)  echo "x86_64-unknown-linux-musl" ;;
        aarch64|arm64) echo "aarch64-unknown-linux-musl" ;;
        *) die "不支持的架构: $arch" ;;
    esac
}

if [[ -n "$BIN_SOURCE" ]]; then
    [[ -f "$BIN_SOURCE" ]] || die "二进制文件不存在: $BIN_SOURCE"
    info "使用本地二进制: $BIN_SOURCE"
    cp "$BIN_SOURCE" "${INSTALL_DIR}/dinotty-server"
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
    TARGET="$(detect_arch)"
    LOCAL_BIN="${PROJECT_ROOT}/dist/dinotty-server-${TARGET}"

    if [[ -f "$LOCAL_BIN" ]]; then
        info "从项目 dist/ 安装: $LOCAL_BIN"
        cp "$LOCAL_BIN" "${INSTALL_DIR}/dinotty-server"
    else
        RELEASE_BIN="${PROJECT_ROOT}/target/release/dinotty-server"
        if [[ -f "$RELEASE_BIN" ]]; then
            info "从 target/release/ 安装: $RELEASE_BIN"
            cp "$RELEASE_BIN" "${INSTALL_DIR}/dinotty-server"
        else
            die "未找到二进制文件。请先构建:
  构建: ./scripts/build.sh native
  交叉编译: ./scripts/build.sh cross
或使用 --bin 指定路径"
        fi
    fi
fi

chmod +x "${INSTALL_DIR}/dinotty-server"
ok "二进制已安装到 ${INSTALL_DIR}/dinotty-server"

# 创建系统用户
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --home-dir "$DATA_DIR" --shell /bin/bash "$SERVICE_USER"
    ok "已创建系统用户: $SERVICE_USER"
else
    info "系统用户 $SERVICE_USER 已存在"
fi

# 创建数据目录（同时也是系统用户的 HOME）
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
ok "数据目录: $DATA_DIR（HOME=$DATA_DIR）"

# 创建配置目录
mkdir -p "$CONFIG_DIR"

if [[ -f "${CONFIG_DIR}/env" ]]; then
    info "配置文件已存在: ${CONFIG_DIR}/env（保留现有配置）"
    # 更新 Token（如果指定了新的）
    if [[ -n "$TOKEN" ]]; then
        sed -i "s|^DINOTTY_TOKEN=.*|DINOTTY_TOKEN=${TOKEN}|" "${CONFIG_DIR}/env"
        info "已更新 DINOTTY_TOKEN"
    fi
else
    cat > "${CONFIG_DIR}/env" <<EOF
DINOTTY_PORT=${PORT}
DINOTTY_TOKEN=${TOKEN}
RUST_LOG=info
SHELL=/bin/bash
EOF
    chmod 600 "${CONFIG_DIR}/env"
    ok "配置文件已创建: ${CONFIG_DIR}/env"
fi

# 安装 systemd 服务文件
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "${SCRIPT_DIR}/dinotty.service" "$SERVICE_FILE"
ok "systemd 服务文件已安装"

# 重新加载并启用
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" &>/dev/null
ok "已设置开机自启"

# 启动服务
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "重启服务..."
    systemctl restart "$SERVICE_NAME"
else
    info "启动服务..."
    systemctl start "$SERVICE_NAME"
fi

sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "服务已启动"
else
    die "服务启动失败，查看日志: journalctl -u $SERVICE_NAME -n 50"
fi

# 获取 Token
EFFECTIVE_TOKEN="$TOKEN"
if [[ -z "$EFFECTIVE_TOKEN" ]]; then
    EFFECTIVE_TOKEN=$(journalctl -u "$SERVICE_NAME" --no-pager -n 30 2>/dev/null \
        | grep -oP 'Auth token: \K.*' | tail -1 || true)
fi

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "0.0.0.0")

echo ""
echo "=========================================="
echo -e "  ${GREEN}Dinotty 部署成功!${NC}"
echo "=========================================="
echo ""
echo -e "  访问地址:  ${CYAN}http://${LAN_IP}:${PORT}/?token=${EFFECTIVE_TOKEN}${NC}"
echo ""
echo "  常用命令:"
echo "    查看状态:  systemctl status $SERVICE_NAME"
echo "    查看日志:  journalctl -u $SERVICE_NAME -f"
echo "    重启服务:  systemctl restart $SERVICE_NAME"
echo "    停止服务:  systemctl stop $SERVICE_NAME"
echo "    配置文件:  ${CONFIG_DIR}/env"
echo "    数据目录:  ${DATA_DIR}"
echo ""
echo "=========================================="

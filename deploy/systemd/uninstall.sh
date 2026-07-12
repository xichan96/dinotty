#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="dinotty"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/dinotty"
DATA_DIR="/var/lib/dinotty"
SERVICE_USER="dinotty"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }

[[ "$(id -u)" -eq 0 ]] || { echo -e "${RED}请使用 sudo 运行${NC}"; exit 1; }

echo "即将卸载 Dinotty..."
echo ""

# 停止并禁用服务
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl stop "$SERVICE_NAME"
    info "服务已停止"
fi

if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl disable "$SERVICE_NAME" 2>/dev/null
    info "已取消开机自启"
fi

# 删除服务文件
if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    rm "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    info "systemd 服务文件已删除"
fi

# 删除二进制
if [[ -f "${INSTALL_DIR}/dinotty-server" ]]; then
    rm "${INSTALL_DIR}/dinotty-server"
    info "二进制文件已删除"
fi

# 删除系统用户
if id "$SERVICE_USER" &>/dev/null; then
    userdel "$SERVICE_USER" 2>/dev/null || true
    info "系统用户已删除"
fi

# 询问是否删除运行时数据（日志、临时文件等）
echo ""
if [[ -t 0 ]]; then
    read -rp "是否删除运行时数据（日志、上传文件等）？[y/N] " confirm_data
else
    confirm_data=""
fi
if [[ "$confirm_data" =~ ^[Yy]$ ]]; then
    # 只删除运行时数据，保留用户设置（settings.json、token 等）
    rm -rf "$DATA_DIR/logs" 2>/dev/null || true
    rm -rf "$DATA_DIR/.config/dinotty/bg.webp" 2>/dev/null || true
    # 保留 .config/dinotty/settings.json 和 token
    info "运行时数据已删除（保留用户设置）"
else
    info "保留了运行时数据"
fi

# 询问是否删除用户设置（保存的命令、主题、书签等）
if [[ -t 0 ]]; then
    echo ""
    read -rp "是否删除用户设置（保存的命令、主题、书签等）？此操作不可恢复！[y/N] " confirm_settings
else
    confirm_settings=""
fi
if [[ "$confirm_settings" =~ ^[Yy]$ ]]; then
    rm -rf "$DATA_DIR/.config/dinotty" 2>/dev/null || true
    ok "用户设置已删除"
else
    info "保留了用户设置"
fi

# 删除系统配置目录中的 env 文件（保留空目录）
if [[ -f "${CONFIG_DIR}/env" ]]; then
    rm -f "${CONFIG_DIR}/env"
    info "系统配置已删除"
fi

ok "Dinotty 已完全卸载"

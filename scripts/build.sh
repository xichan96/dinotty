#!/usr/bin/env bash
# 使用方法（macOS，在仓库根目录运行）：
#   ./scripts/build.sh [COMMAND] [TARGET ...]
set -euo pipefail

BIN="dinotty-server"
DIST="dist"
FRONTEND_DIR="frontend"

PLATFORMS=(
    "x86_64-unknown-linux-musl"
    "aarch64-unknown-linux-musl"
    "x86_64-apple-darwin"
    "aarch64-apple-darwin"
)

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[ OK ]\033[0m  $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
die()   { echo -e "\033[1;31m[ERR ]\033[0m  $*" >&2; exit 1; }

usage() {
    cat <<EOF
Usage: $0 [COMMAND] [TARGET ...]

Commands:
  native      Build for the current host (release)
  cross       Cross-compile for all targets (or specified targets)
  all         native + cross
  frontend    Build frontend only
  desktop     Build Tauri desktop app
  list        List supported targets
  clean       Remove dist/ and target/
  help        Show this message

Runtime usage (after build):
  ./xterm-server                  # listen on default port 8999
  ./xterm-server --port 9000      # listen on port 9000
  ./xterm-server -p 9000          # same

Supported targets:
$(printf '  %s\n' "${PLATFORMS[@]}")
EOF
}

need() { command -v "$1" &>/dev/null || die "Required tool not found: $1 — install it first"; }

workspace_version() {
    need cargo
    need node
    cargo metadata --locked --no-deps --format-version 1 | node -e '
const metadata = JSON.parse(require("fs").readFileSync(0, "utf8"));
const memberIds = new Set(metadata.workspace_members);
const names = ["dinotty-server", "dinotty-desktop"];
const packages = metadata.packages.filter(pkg => memberIds.has(pkg.id) && names.includes(pkg.name));
const validNames = names.every(name => packages.filter(pkg => pkg.name === name).length === 1);
const versions = [...new Set(packages.map(pkg => pkg.version))];
if (!validNames || versions.length !== 1 || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(versions[0])) {
    console.error("Could not resolve one stable server/desktop workspace version");
    process.exit(1);
}
process.stdout.write(versions[0]);'
}

is_windows() { [[ "$1" == *"windows"* ]]; }

bin_name() {
    if is_windows "$1"; then echo "${BIN}.exe"; else echo "$BIN"; fi
}

strip_bin() {
    local file="$1" target="${2:-}"
    if [[ "$target" == *"linux"* ]] || [[ "$target" == *"darwin"* ]]; then
        if command -v llvm-strip &>/dev/null; then
            llvm-strip "$file" 2>/dev/null || warn "llvm-strip failed for $file, skipping"
        elif command -v strip &>/dev/null; then
            strip "$file" 2>/dev/null || warn "strip failed for $file, skipping"
        fi
    fi
}

build_frontend() {
    info "Building frontend..."
    need pnpm

    pushd "$FRONTEND_DIR" > /dev/null
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm build
    popd > /dev/null

    ok "Frontend built: $FRONTEND_DIR/dist/"
}

build_native() {
    local ver
    ver="$(workspace_version)"

    build_frontend

    info "Building native release (v$ver)..."
    need cargo

    cargo build --release -p dinotty-server

    mkdir -p "$DIST"
    local host; host="$(rustc -vV | awk '/^host:/{print $2}')"
    local bin; bin="$(bin_name "$host")"
    local src="target/release/$bin"
    local dest="$DIST/${BIN}-${host}"
    is_windows "$host" && dest="${dest}.exe"

    cp "$src" "$dest"
    strip_bin "$dest" "$host"
    ok "Native binary: $dest"
}

build_one_target() {
    local target="$1"
    info "  Target: $target"

    if ! rustup target list --installed | grep -q "^${target}$"; then
        info "  Installing Rust target $target..."
        rustup target add "$target"
    fi

    if command -v cargo-zigbuild &>/dev/null; then
        cargo zigbuild --release --target "$target" -p dinotty-server
    elif command -v cross &>/dev/null; then
        cross build --release --target "$target" -p dinotty-server
    else
        warn "Neither cargo-zigbuild nor cross found; trying plain cargo (may fail for cross targets)"
        cargo build --release --target "$target" -p dinotty-server
    fi

    mkdir -p "$DIST"
    local bin; bin="$(bin_name "$target")"
    local src="target/${target}/release/$bin"
    local dest="$DIST/${BIN}-${target}"
    is_windows "$target" && dest="${dest}.exe"

    cp "$src" "$dest"
    strip_bin "$dest" "$target"
    ok "Binary: $dest"
}

build_cross() {
    local ver
    ver="$(workspace_version)"

    build_frontend

    info "Cross-compiling (v$ver)..."
    need cargo
    need rustup

    local targets=()
    if [[ $# -gt 0 ]]; then
        targets=("$@")
    elif [[ -n "${CROSS_TARGETS:-}" ]]; then
        read -ra targets <<< "$CROSS_TARGETS"
    else
        targets=("${PLATFORMS[@]}")
    fi

    for target in "${targets[@]}"; do
        build_one_target "$target"
    done
}

build_desktop() {
    local ver
    ver="$(workspace_version)"

    build_frontend

    info "Building Tauri desktop app (v$ver)..."
    need cargo

    if ! command -v cargo-tauri &>/dev/null; then
        info "Installing tauri-cli..."
        cargo install tauri-cli --version "^2"
    fi

    cargo tauri build
    ok "Desktop app built (v$ver)"
}

cmd_list() {
    echo "Supported targets:"
    local idx=1
    for p in "${PLATFORMS[@]}"; do
        printf "  %2d) %s\n" "$idx" "$p"
        idx=$((idx + 1))
    done
}

cmd_clean() {
    info "Cleaning dist/, target/, and frontend/dist/..."
    rm -rf "$DIST"
    rm -rf "$FRONTEND_DIR/dist"
    cargo clean
    ok "Clean done"
}

case "${1:-}" in
    native)   build_native ;;
    cross)    shift; build_cross "$@" ;;
    all)      shift; build_native; build_cross "$@" ;;
    frontend) build_frontend ;;
    desktop)  build_desktop ;;
    list)     cmd_list ;;
    clean)    cmd_clean ;;
    help|-h|--help) usage ;;
    "") build_native ;;
    *) die "Unknown command: ${1:-} — run '$0 help' for usage" ;;
esac

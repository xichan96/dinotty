#!/usr/bin/env bash
# Usage (Linux, run from any directory):
#   bash ./scripts/build-appimage.sh
# Options:
#   --skip-install  Skip pnpm install --frozen-lockfile
#   --run           Start the AppImage after a successful build
#
# Ubuntu build dependencies (matching .github/workflows/package.yml):
#   sudo apt-get install -y build-essential curl file libayatana-appindicator3-dev \
#     libfuse2 libgtk-3-dev libjavascriptcoregtk-4.1-dev libssl-dev \
#     libsoup-3.0-dev libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev patchelf wget

set -Eeuo pipefail

skip_install=false
run_after_build=false
temp_dir=""

step() {
    printf '\n==> %s\n' "$1"
}

die() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: bash ./scripts/build-appimage.sh [OPTIONS]

Build the Dinotty Linux AppImage and copy it to dist/.

Options:
  --skip-install  Skip pnpm install --frozen-lockfile
  --run           Start the generated AppImage after building
  -h, --help      Show this help message
EOF
}

require_command() {
    local name="$1"
    local hint="$2"

    command -v "$name" >/dev/null 2>&1 || die "Command '$name' was not found. $hint"
}

cleanup() {
    if [[ -n "$temp_dir" && -d "$temp_dir" ]]; then
        rm -f -- "$temp_dir/tauri-config.json" "$temp_dir/build-start"
        rmdir -- "$temp_dir" 2>/dev/null || true
    fi
}

for argument in "$@"; do
    case "$argument" in
        --skip-install)
            skip_install=true
            ;;
        --run)
            run_after_build=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            die "Unknown option: $argument"
            ;;
    esac
done

[[ "$(uname -s)" == "Linux" ]] || die "AppImage packages must be built on Linux."

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
frontend_dir="$repo_root/frontend"
dist_dir="$repo_root/dist"

if [[ -n "${HOME:-}" && -d "$HOME/.cargo/bin" ]]; then
    case ":$PATH:" in
        *":$HOME/.cargo/bin:"*) ;;
        *) export PATH="$HOME/.cargo/bin:$PATH" ;;
    esac
fi

require_command cargo "Install the Rust toolchain and ensure Cargo is on PATH."
require_command cargo-tauri "Run: cargo install tauri-cli --version '^2'"
require_command node "Install Node.js 20 or newer."
require_command pnpm "Install pnpm, or enable Corepack and try again."
require_command rustc "Install the Rust toolchain and ensure rustc is on PATH."
require_command sha256sum "Install GNU coreutils."

cd -- "$repo_root"

step "Reading Cargo workspace metadata"
metadata_json="$(cargo metadata --locked --no-deps --format-version 1)" || \
    die "cargo metadata --locked failed."
metadata_fields="$(printf '%s' "$metadata_json" | node -e '
const metadata = JSON.parse(require("fs").readFileSync(0, "utf8"));
const memberIds = new Set(metadata.workspace_members);
const expectedNames = ["dinotty-server", "dinotty-desktop"];
const packages = metadata.packages.filter(
  (pkg) => memberIds.has(pkg.id) && expectedNames.includes(pkg.name),
);
const validNames = expectedNames.every(
  (name) => packages.filter((pkg) => pkg.name === name).length === 1,
);
const versions = [...new Set(packages.map((pkg) => pkg.version))];
if (
  !validNames ||
  versions.length !== 1 ||
  !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(versions[0]) ||
  typeof metadata.target_directory !== "string" ||
  metadata.target_directory.length === 0
) {
  console.error("Could not resolve one stable server/desktop version and target directory");
  process.exit(1);
}
process.stdout.write(`${versions[0]}\n${metadata.target_directory}\n`);
')" || die "Could not parse Cargo workspace metadata."

mapfile -t metadata_lines <<< "$metadata_fields"
[[ "${#metadata_lines[@]}" -eq 2 ]] || die "Cargo metadata returned unexpected output."
version="${metadata_lines[0]}"
target_dir="${metadata_lines[1]}"

if [[ "$skip_install" == false ]]; then
    step "Installing frontend dependencies"
    (
        cd -- "$frontend_dir"
        pnpm install --frozen-lockfile
    )
fi

step "Building frontend"
(
    cd -- "$frontend_dir"
    pnpm build
)

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dinotty-appimage.XXXXXX")"
trap cleanup EXIT
temporary_tauri_config="$temp_dir/tauri-config.json"
build_marker="$temp_dir/build-start"

# The frontend is built above. Disable the regular Tauri hook for this invocation
# so it does not run the frontend build a second time.
printf '%s\n' '{"build":{"beforeBuildCommand":null}}' > "$temporary_tauri_config"
touch -- "$build_marker"

step "Building Tauri AppImage"
# Tauri downloads AppImage-based helper tools. Extract-and-run keeps local builds
# working on hosts and containers where libfuse2 is intentionally unavailable.
if ! APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build \
    --bundles appimage \
    --ci \
    --config "$temporary_tauri_config" \
    -- \
    --locked; then
    die "AppImage build failed. On Ubuntu, install the dependencies listed at the top of this script."
fi

bundle_dir="$target_dir/release/bundle/appimage"
[[ -d "$bundle_dir" ]] || die "AppImage output directory was not created: $bundle_dir"

mapfile -d '' -t appimage_candidates < <(
    find "$bundle_dir" -maxdepth 1 -type f -name '*.AppImage' -newer "$build_marker" -print0
)
if [[ "${#appimage_candidates[@]}" -ne 1 ]]; then
    die "Expected exactly one AppImage from this build, found ${#appimage_candidates[@]} in $bundle_dir."
fi
appimage_path="${appimage_candidates[0]}"

rust_host="$(rustc -vV | awk '/^host:/{print $2; exit}')"
[[ -n "$rust_host" ]] || die "Could not determine the Rust host architecture."
case "$rust_host" in
    x86_64-*) appimage_arch="amd64" ;;
    aarch64-*) appimage_arch="aarch64" ;;
    armv7-*) appimage_arch="armhf" ;;
    i?86-*) appimage_arch="i386" ;;
    *) appimage_arch="${rust_host%%-*}" ;;
esac

mkdir -p -- "$dist_dir"
appimage_name="Dinotty_${version}_${appimage_arch}.AppImage"
dist_path="$dist_dir/$appimage_name"
cp -f -- "$appimage_path" "$dist_path"
chmod +x -- "$dist_path"

release_hash="$(sha256sum -- "$appimage_path" | awk '{print $1}')"
dist_hash="$(sha256sum -- "$dist_path" | awk '{print $1}')"
[[ "$release_hash" == "$dist_hash" ]] || \
    die "AppImage verification failed: the dist copy differs from the release bundle."

printf '\nAppImage created:\n  %s\n' "$dist_path"
printf 'SHA-256:\n  %s\n' "$dist_hash"

if [[ "$run_after_build" == true ]]; then
    step "Starting AppImage"
    "$dist_path" &
    printf 'Started process %s\n' "$!"
fi

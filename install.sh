#!/usr/bin/env bash
#
# MySQL UI one-click installer (Linux / macOS)
#
#   curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mysqlUI/main/install.sh | bash
#
# Options (environment variables):
#   VERSION=v0.1.0        install a specific release (default: latest)
#   INSTALL_DIR=/path     install directory (default: /usr/local/bin or ~/.local/bin)
#
set -euo pipefail

REPO="dolphinZzv/mysqlUI"
BIN_NAME="mysqlui"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- detect platform ----------------------------------------------------
os=""
case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) err "unsupported OS: $(uname -s). On Windows use install.ps1 instead." ;;
esac

arch=""
case "$(uname -m)" in
  x86_64 | amd64) arch="amd64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) err "unsupported architecture: $(uname -m)" ;;
esac

# ---- pick a download tool ----------------------------------------------
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
  fetch_stdout() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
  fetch_stdout() { wget -qO- "$1"; }
else
  err "curl or wget is required"
fi

# ---- resolve version ----------------------------------------------------
VERSION="${VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  info "Resolving latest release..."
  release_json="$(fetch_stdout "https://api.github.com/repos/${REPO}/releases/latest" || true)"
  VERSION="$(printf '%s' "$release_json" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
fi
[ -n "$VERSION" ] || err "could not determine the latest version (is a release published yet?)"

asset="${BIN_NAME}-${os}-${arch}"
base="https://github.com/${REPO}/releases/download/${VERSION}"
url="${base}/${asset}"

# ---- choose install directory ------------------------------------------
if [ -n "${INSTALL_DIR:-}" ]; then
  dir="$INSTALL_DIR"
elif [ -w /usr/local/bin ] 2>/dev/null; then
  dir="/usr/local/bin"
else
  dir="${HOME}/.local/bin"
fi
mkdir -p "$dir" || err "cannot create install directory: $dir"
dest="${dir}/${BIN_NAME}"

# ---- download -----------------------------------------------------------
info "Downloading ${asset} (${VERSION})..."
tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.sha" 2>/dev/null || true' EXIT

if ! fetch "$url" "$tmp"; then
  err "download failed: $url"
fi
[ -s "$tmp" ] || err "downloaded file is empty"

# ---- verify checksum (best effort) --------------------------------------
shacmd=""
if command -v sha256sum >/dev/null 2>&1; then
  shacmd="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  shacmd="shasum -a 256"
fi
if [ -n "$shacmd" ] && fetch "${base}/checksums.txt" "$tmp.sha" 2>/dev/null; then
  expected="$(grep " ${asset}\$" "$tmp.sha" | awk '{print $1}' | head -1 || true)"
  if [ -n "$expected" ]; then
    actual="$($shacmd "$tmp" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || err "checksum mismatch for ${asset}"
    info "Checksum verified."
  fi
fi

# ---- install ------------------------------------------------------------
chmod +x "$tmp"
if command -v install >/dev/null 2>&1; then
  install -m 0755 "$tmp" "$dest"
else
  mv "$tmp" "$dest"
fi
trap - EXIT
rm -f "$tmp" "$tmp.sha" 2>/dev/null || true

info "Installed to ${dest}"
"$dest" --version >/dev/null 2>&1 || true

case ":${PATH}:" in
  *":${dir}:"*) ;;
  *) warn "${dir} is not in your PATH. Add it with:"
     printf '    export PATH="%s:$PATH"\n' "$dir" ;;
esac

echo
info "Done. Start it with:"
echo "    ${BIN_NAME}"
echo "    # then open http://localhost:8787"

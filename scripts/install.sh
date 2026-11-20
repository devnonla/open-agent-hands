#!/usr/bin/env sh
set -eu

REPO="${AGENTHANDS_REPO:-devnonla/open-agent-hands}"
VERSION="${AGENTHANDS_VERSION:-latest}"
INSTALL_DIR="${AGENTHANDS_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

asset="agenthands-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading ${url}"
curl -fL --progress-bar "$url" -o "$tmp"
chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/agenthands"
trap - EXIT

if [ "$os" = "darwin" ]; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/agenthands" 2>/dev/null || true
fi

echo "Installed agenthands to $INSTALL_DIR/agenthands"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add $INSTALL_DIR to your PATH, e.g.: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc" ;;
esac
echo "Run: agenthands   (then open http://127.0.0.1:8429)"

#!/usr/bin/env sh
set -eu

REPO="${AGENTHANDS_REPO:-devnonla/open-agent-hands}"
VERSION="${AGENTHANDS_VERSION:-latest}"
INSTALL_DIR="${AGENTHANDS_INSTALL_DIR:-$HOME/.local/bin}"
WANT_APP="${AGENTHANDS_APP:-1}"
CLI_ONLY="${AGENTHANDS_CLI_ONLY:-0}"
APP_NAME="Open Agent Hands.app"

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

if [ -n "${AGENTHANDS_DOWNLOAD_URL:-}" ]; then
  base="$AGENTHANDS_DOWNLOAD_URL"
elif [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
mkdir -p "$INSTALL_DIR"

print_path_hint() {
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "Add $INSTALL_DIR to your PATH, e.g.: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc" ;;
  esac
}

install_app() {
  archive="$workdir/app.tar.gz"
  url="${base}/OpenAgentHands-darwin-${arch}.app.tar.gz"
  echo "Downloading ${url}"
  curl -fL --progress-bar "$url" -o "$archive" || return 1
  tar -xzf "$archive" -C "$workdir"
  [ -d "$workdir/$APP_NAME" ] || return 1

  apps_dir="${AGENTHANDS_APP_DIR:-/Applications}"
  if [ ! -w "$apps_dir" ]; then
    apps_dir="$HOME/Applications"
    mkdir -p "$apps_dir"
  fi
  app="$apps_dir/$APP_NAME"

  if pgrep -f "$APP_NAME/Contents/MacOS/agenthands-desktop" >/dev/null 2>&1; then
    osascript -e 'tell application "Open Agent Hands" to quit' >/dev/null 2>&1 || true
    sleep 2
  fi

  rm -rf "$app"
  mv "$workdir/$APP_NAME" "$app"
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

  rm -f "$INSTALL_DIR/agenthands"
  ln -s "$app/Contents/MacOS/agenthands" "$INSTALL_DIR/agenthands"

  echo "Installed $app"
  echo "Linked $INSTALL_DIR/agenthands -> the binary inside the app"
  print_path_hint
  open "$app"
  echo "Open Agent Hands is starting (menu bar icon). Dashboard: http://127.0.0.1:8429"
}

install_cli() {
  url="${base}/agenthands-${os}-${arch}"
  bin="$workdir/agenthands"
  echo "Downloading ${url}"
  curl -fL --progress-bar "$url" -o "$bin"
  chmod +x "$bin"
  rm -f "$INSTALL_DIR/agenthands"
  mv "$bin" "$INSTALL_DIR/agenthands"
  if [ "$os" = "darwin" ]; then
    xattr -d com.apple.quarantine "$INSTALL_DIR/agenthands" 2>/dev/null || true
  fi
  echo "Installed agenthands to $INSTALL_DIR/agenthands"
  print_path_hint
  echo "Run: agenthands   (then open http://127.0.0.1:8429)"
}

install_oahctl() {
  url="${base}/oahctl.js"
  echo "Downloading ${url}"
  if ! curl -fL --progress-bar "$url" -o "$workdir/oahctl"; then
    echo "The oahctl command line is not available for this release."
    return 0
  fi
  chmod +x "$workdir/oahctl"
  rm -f "$INSTALL_DIR/oahctl"
  mv "$workdir/oahctl" "$INSTALL_DIR/oahctl"
  echo "Installed oahctl to $INSTALL_DIR/oahctl"
  if ! command -v node >/dev/null 2>&1; then
    echo "oahctl runs on Node 18+. Install Node, or run it with Bun: bun $INSTALL_DIR/oahctl"
  fi
  echo "Next: oahctl login   (or oahctl login https://your-server --name vps)"
}

if [ "$CLI_ONLY" = "1" ]; then
  install_oahctl
  print_path_hint
  exit 0
fi

if [ "$os" = "darwin" ] && [ "$WANT_APP" != "0" ]; then
  if install_app; then
    install_oahctl
    exit 0
  fi
  echo "The desktop app is not available for this release. Installing the command line binary instead."
fi

install_cli
install_oahctl

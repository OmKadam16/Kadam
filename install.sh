#!/usr/bin/env bash
set -euo pipefail

log() {
  printf 'kadam-install: %s\n' "$*"
}

fail() {
  printf 'kadam-install: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 22.18 or newer is required."
command -v npm >/dev/null 2>&1 || fail "npm is required."

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(
      `Kadam requires Node.js 22.18 or newer; found ${process.versions.node}.`,
    );
    process.exit(1);
  }
' || exit 1

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

PACKAGE_SPEC="${KADAM_PACKAGE:-}"
PREFIX="${KADAM_PREFIX:-}"

if [[ -z "$PACKAGE_SPEC" ]]; then
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/package.json" ]]; then
    PACKAGE_SPEC="$SCRIPT_DIR"
  else
    PACKAGE_SPEC="kadam@latest"
    log "no checkout found; installing the published kadam package"
  fi
fi

if [[ -d "$PACKAGE_SPEC" && -f "$PACKAGE_SPEC/package.json" ]]; then
  log "building from $PACKAGE_SPEC"
  (
    cd "$PACKAGE_SPEC"
    npm install --no-audit --no-fund
    npm run build
  )
fi

install_args=(install --global --no-audit --no-fund)
if [[ -n "$PREFIX" ]]; then
  install_args+=(--prefix "$PREFIX")
fi

log "installing the kadam command"
npm "${install_args[@]}" "$PACKAGE_SPEC"

if [[ -n "$PREFIX" ]]; then
  KADAM_BIN="$PREFIX/bin/kadam"
else
  KADAM_BIN="$(npm prefix --global)/bin/kadam"
fi

[[ -x "$KADAM_BIN" ]] || fail "Installation finished, but $KADAM_BIN was not created."

log "installed $("$KADAM_BIN" --version)"

case ":$PATH:" in
  *":$(dirname "$KADAM_BIN"):"*) ;;
  *)
    log "Add $(dirname "$KADAM_BIN") to PATH, then run: kadam --help"
    ;;
esac

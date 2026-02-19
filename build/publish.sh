#!/usr/bin/env bash
set -euo pipefail

# SlyCode Publish Pipeline
#
# Runs: build → export → check → (manual npm publish)
#
# Usage:
#   ./build/publish.sh              # Build, export, check (no publish)
#   ./build/publish.sh --publish    # Build, export, check, then npm publish
#   ./build/publish.sh --dry-run    # Show what would happen without changes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse args
PUBLISH=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=true ;;
    --dry-run) DRY_RUN=true ;;
  esac
done

# Colors
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
RESET='\033[0m'

step() { echo -e "\n${BOLD}${CYAN}▸ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; exit 1; }

echo -e "\n${BOLD}SlyCode Publish Pipeline${RESET}"
echo "  Dev root: $DEV_ROOT"
if $DRY_RUN; then
  echo -e "  ${YELLOW}Mode: DRY RUN${RESET}"
fi
echo ""

# ── Step 1: Build ──────────────────────────────────────────────────────
step "Building packages..."

cd "$DEV_ROOT"
if $DRY_RUN; then
  echo "  Would run: npx tsx build/build-package.ts"
else
  npx tsx build/build-package.ts
fi
ok "Build complete"

# ── Step 2: Export ─────────────────────────────────────────────────────
step "Exporting to public repo..."

EXPORT_ARGS=""
if $DRY_RUN; then
  EXPORT_ARGS="--dry-run"
fi

node build/export.js $EXPORT_ARGS
ok "Export complete"

# ── Step 3: Safety checks ─────────────────────────────────────────────
step "Running safety checks..."

node build/check.js
ok "All checks passed"

# ── Step 4: Publish (optional) ─────────────────────────────────────────
if $PUBLISH; then
  if $DRY_RUN; then
    step "Would publish packages (dry-run)..."
    echo "  Would run: npm publish (in packages/slycode/ and packages/create-slycode/)"
    ok "Dry run — nothing published"
  else
    step "Publishing to npm..."

    PUB_ROOT="$(node -e "console.log(require('./build/export.config.js').defaultTarget)")"
    PUB_ROOT="$(cd "$DEV_ROOT" && cd "$PUB_ROOT" && pwd)"

    # Publish slycode
    echo "  Publishing slycode..."
    cd "$PUB_ROOT/packages/slycode"
    npm publish --access public
    ok "slycode published"

    # Publish create-slycode
    echo "  Publishing create-slycode..."
    cd "$PUB_ROOT/packages/create-slycode"
    npm publish --access public
    ok "create-slycode published"

    # Tag the version
    cd "$PUB_ROOT"
    VERSION="$(node -e "console.log(require('./packages/slycode/package.json').version)")"
    echo "  Tagging v${VERSION}..."
    git add -A
    git commit -m "Release v${VERSION}"
    git tag "v${VERSION}"
    ok "Tagged v${VERSION}"

    echo ""
    echo -e "${BOLD}${GREEN}Published successfully!${RESET}"
    echo "  Don't forget to: git push && git push --tags"
  fi
else
  echo ""
  echo -e "${BOLD}${GREEN}Pipeline complete.${RESET} Ready to publish."
  echo "  To publish: ./build/publish.sh --publish"
fi

echo ""

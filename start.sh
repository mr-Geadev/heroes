#!/usr/bin/env bash
set -e

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[heroes]${NC} $*"; }
warn()  { echo -e "${YELLOW}[heroes]${NC} $*"; }
error() { echo -e "${RED}[heroes]${NC} $*"; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
else
  NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -lt 18 ]; then
    error "Node.js >= 18 required (found $(node --version)). Run: nvm install 20"
  fi
  info "Node $(node --version) ✓"
fi

# ── 2. Dependencies ───────────────────────────────────────────────────────────
info "Installing server dependencies..."
npm install --prefix "$ROOT/server" --silent

info "Installing client dependencies..."
npm install --prefix "$ROOT/client" --silent

# ── 3. Cleanup on exit ───────────────────────────────────────────────────────
SERVER_PID=""
CLIENT_PID=""

cleanup() {
  echo ""
  info "Shutting down..."
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ── 4. Start server ───────────────────────────────────────────────────────────
info "Starting WebSocket server on :3001 ..."
npm run dev --prefix "$ROOT/server" &
SERVER_PID=$!

# ── 5. Start client ───────────────────────────────────────────────────────────
# --host 0.0.0.0 makes it reachable from outside the VPS
info "Starting Angular dev server on :4200 ..."
npm run start --prefix "$ROOT/client" -- --host 0.0.0.0 &
CLIENT_PID=$!

# ── 6. Wait for Angular to be ready ──────────────────────────────────────────
info "Waiting for Angular to compile..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:4200 &>/dev/null; then break; fi
  sleep 2
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  App is running!${NC}"
echo -e "${GREEN}  Client  → http://194.67.101.169:4200${NC}"
echo -e "${GREEN}  Server  → ws://194.67.101.169:3001${NC}"
echo -e "${GREEN}  Ctrl+C to stop${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

wait

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "  TVClaw · NanoClaw onboard"
echo "  -------------------------"
echo ""

node -e '
const m = +process.version.slice(1).split(".")[0];
if (m < 20) {
  console.error("Need Node.js 20 or newer (have " + process.version + ")");
  process.exit(1);
}
' || exit 1

if ! command -v docker >/dev/null 2>&1; then
  echo "Warning: docker not in PATH — install Docker before npm start (agents need it)."
  echo ""
fi

export HUSKY=0
npm install
npm run build

if [[ ! -f .env ]] || [[ ! -s .env ]]; then
  cp .env.example .env
  echo "Created .env — add ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN), then save."
  echo ""
fi

if command -v docker >/dev/null 2>&1 && [[ -f container/build.sh ]]; then
  echo "Building nanoclaw-agent Docker image (first time can take several minutes)..."
  (cd container && ./build.sh)
  echo ""
fi

echo "Next:"
echo "  1. Edit .env in this folder (API key or OAuth token)."
echo "  2. WhatsApp: run Claude Code here and use skill /add-whatsapp, or: npm run setup"
echo "  3. Start:    npm start"
echo "  4. TV:       install TVClaw APK, enable Accessibility, tap Start TV bridge (mDNS)."
echo ""
echo "Full notes: TVCLAW-ONBOARD.md"
echo ""

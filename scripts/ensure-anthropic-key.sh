#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KEYS_URL="https://console.anthropic.com/settings/keys"

has_auth() {
  [[ -f .env ]] || return 1
  if grep -qE '^[[:space:]]*ANTHROPIC_API_KEY=.+' .env 2>/dev/null; then
    return 0
  fi
  if grep -qE '^[[:space:]]*CLAUDE_CODE_OAUTH_TOKEN=.+' .env 2>/dev/null; then
    return 0
  fi
  return 1
}

open_keys_page() {
  if command -v open >/dev/null 2>&1; then
    open "$KEYS_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$KEYS_URL"
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$KEYS_URL"
  else
    echo "Open in a browser: $KEYS_URL"
  fi
}

if has_auth; then
  exit 0
fi

if [[ ! -f .env ]]; then
  [[ -f .env.example ]] && cp .env.example .env || touch .env
fi

echo ""
echo "  Anthropic API key"
echo "  -----------------"
echo "  NanoClaw reads ANTHROPIC_API_KEY from .env (or CLAUDE_CODE_OAUTH_TOKEN)."
echo ""
echo "  How to get a key:"
echo "    1. Open console.anthropic.com and sign in."
echo "    2. Settings → API keys → Create key."
echo "    3. Copy the key (starts with sk-ant-...)."
echo "    4. Billing: add credits if the console says balance is low."
echo ""
echo "  Press Enter alone to open the API keys page in your browser."
echo "  Or paste your key on this line and press Enter to save it."
read -r -p "> " first_line

if [[ -n "${first_line// }" ]]; then
  node scripts/write-anthropic-key.cjs "$first_line"
  echo "Saved ANTHROPIC_API_KEY to .env"
  exit 0
fi

open_keys_page
echo ""
read -r -s -p "Paste ANTHROPIC_API_KEY here, then Enter: " apikey
echo ""
if [[ -z "${apikey// }" ]]; then
  echo "No key saved. Edit .env and add ANTHROPIC_API_KEY=... before npm start."
  exit 0
fi
node scripts/write-anthropic-key.cjs "$apikey"
echo "Saved ANTHROPIC_API_KEY to .env"

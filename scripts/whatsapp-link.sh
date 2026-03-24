#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export HUSKY=0

bash scripts/ensure-anthropic-key.sh

if [[ ! -f src/channels/whatsapp.ts ]] || [[ ! -f src/whatsapp-auth.ts ]]; then
  echo "Merge WhatsApp, then enable it in src/channels/index.ts:"
  echo "  git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git"
  echo "  git fetch whatsapp && git merge whatsapp/main"
  echo "  import './whatsapp.js';"
  exit 1
fi

if ! grep -qE "^[[:space:]]*import[[:space:]]+['\"]\\.\\/whatsapp\\.js['\"]" src/channels/index.ts; then
  echo "Add to src/channels/index.ts:"
  echo "  import './whatsapp.js';"
  exit 1
fi

node -e 'if (+process.version.slice(1).split(".")[0] < 20) process.exit(1)' 2>/dev/null || {
  echo "Need Node.js 20+"
  exit 1
}

if [[ -n "${WHATSAPP_PHONE:-}" ]]; then
  npx tsx src/whatsapp-auth.ts --pairing-code --phone "$WHATSAPP_PHONE"
else
  npx tsx src/whatsapp-auth.ts
fi

if [[ -n "${WHATSAPP_SKIP_REGISTER:-}" ]]; then
  exit 0
fi

assistant="${ASSISTANT_NAME:-Andy}"
trigger="@${assistant}"
folder="${WHATSAPP_REGISTER_FOLDER:-tvclaw}"
name="${WHATSAPP_REGISTER_NAME:-TVClaw}"

run_register() {
  local jid="$1"
  npx tsx setup/index.ts --step register -- \
    --jid "$jid" \
    --name "$name" \
    --folder "$folder" \
    --trigger "$trigger" \
    --channel whatsapp \
    --is-main \
    --assistant-name "$assistant"
}

if [[ -n "${WHATSAPP_REGISTER_JID// }" ]]; then
  jid="${WHATSAPP_REGISTER_JID#"${WHATSAPP_REGISTER_JID%%[![:space:]]*}"}"
  jid="${jid%"${jid##*[![:space:]]}"}"
  run_register "$jid"
elif [[ -n "${WHATSAPP_SKIP_BOOTSTRAP:-}" ]]; then
  jid=""
  if [[ -t 0 ]]; then
    echo ""
    echo "Paste a group JID (…@g.us). To find it: npm start, message the group once, then:"
    echo "  sqlite3 store/messages.db \"SELECT jid, name FROM chats WHERE is_group=1 ORDER BY last_message_time DESC;\""
    read -r -p "JID or Enter to skip: " jid
  fi
  jid="${jid#"${jid%%[![:space:]]*}"}"
  jid="${jid%"${jid##*[![:space:]]}"}"
  if [[ -n "${jid// }" ]]; then
    run_register "$jid"
  fi
else
  npx tsx src/whatsapp-bootstrap-tvclaw.ts
fi

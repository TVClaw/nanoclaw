# TVClaw + NanoClaw — minimal path

## One command

```bash
cd nanoclaw
npm run onboard
```

Then either run **`npm run auth:key`** (prompt + opens [API keys](https://console.anthropic.com/settings/keys)) or edit `.env` yourself (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`), then:

```bash
npm start
```

That single process: WhatsApp/Telegram/etc. (once configured), mDNS TV brain, HTTP `8770` for health and APK.

If you have **not** added WhatsApp (or any channel) yet, `npm start` still runs in **TV-only mode**: no chat, but `POST /tv` and mDNS to the TV work. Add a channel and uncomment it in `src/channels/index.ts` when you want DMs.

## What `onboard` does

- `npm install` (skips git hooks so it never fails on fresh clones)
- `npm run build` (TypeScript)
- Creates `.env` from `.env.example` if missing
- `./container/build.sh` if Docker is available

## WhatsApp

NanoClaw does not bundle WhatsApp in core. After you merge [nanoclaw-whatsapp](https://github.com/qwibitai/nanoclaw-whatsapp) and `import './whatsapp.js'` in `src/channels/index.ts`, link the device:

```bash
npm run link:whatsapp
```

Pairing (no QR): `WHATSAPP_PHONE=9725XXXXXXXX npm run link:whatsapp` (digits only, country code, no `+`). Default: QR printed in this terminal. Or Claude Code **`/add-whatsapp`**.

After auth, **`npm run link:whatsapp`** (by default) creates a WhatsApp group named **TVClaw** (if needed), registers **only** that `…@g.us` chat as main, and leaves message-yourself **unregistered**. Override the name with `WHATSAPP_AGENT_GROUP_NAME`. Skip auto setup with `WHATSAPP_SKIP_BOOTSTRAP=1` (then you get an optional JID prompt). Register a specific JID instead with `WHATSAPP_REGISTER_JID='…@g.us'`. Skip any post-auth step with `WHATSAPP_SKIP_REGISTER=1`. Optional: `WHATSAPP_REGISTER_FOLDER` (default `tvclaw`), `WHATSAPP_REGISTER_NAME`.

Use your **main** chat (registered with `isMain`) for TV tools — `send_tv_command` is main-only. By default every registered chat (including main self-chat) only runs the agent when you send **`@<ASSISTANT_NAME>`** (or a WhatsApp @-mention of your number). Pass **`--no-trigger-required`** to `register` only if you want every message in that chat to wake the agent.

## TV (no brain IP in `.env`)

1. Build/install the Android app from `TVClaw/apps/client-android`.
2. On the TV: enable **Accessibility** for TVClaw, tap **Start TV bridge** (WebSocket server + `_tvclaw._tcp`).
3. The Mac discovers the TV over mDNS and connects automatically.

Optional on the TV `local.properties`: `tvclaw.brain.http.url=http://<mac-lan-ip>:8770` only for **Update app** from the Mac.

## Sanity checks

```bash
curl -s http://127.0.0.1:8770/health
curl -s -X POST http://127.0.0.1:8770/tv -H 'Content-Type: application/json' \
  -d '{"action":"SHOW_TOAST","params":{"message":"test"}}'
```

## LLM

Auth is read from `.env` by the credential proxy: **`ANTHROPIC_API_KEY`** or **`CLAUDE_CODE_OAUTH_TOKEN`**. The agent is **Claude** (Claude Agent SDK / Claude Code inside the container). For Anthropic-compatible endpoints, set **`ANTHROPIC_BASE_URL`** and **`ANTHROPIC_AUTH_TOKEN`** (see upstream [NanoClaw FAQ](https://github.com/qwibitai/nanoclaw)).

## Compared to OpenClaw

[OpenClaw](https://openclaw.ai/) uses `openclaw onboard` globally. This fork’s equivalent is **`npm run onboard`** inside the `nanoclaw` folder — same idea: deps, build, container image, `.env` stub.

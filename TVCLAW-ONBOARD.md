# TVClaw + NanoClaw — minimal path

## One command

```bash
cd nanoclaw
npm run onboard
```

Then edit `.env` (at least `ANTHROPIC_API_KEY=` or `CLAUDE_CODE_OAUTH_TOKEN=`), then:

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

NanoClaw does not bundle WhatsApp in core. After onboard, either:

- Open this repo in **Claude Code** and run skill **`/add-whatsapp`**, or  
- Run **`npm run setup`** and follow the prompts.

Use your **main** chat (registered with `isMain`) for TV tools — `send_tv_command` is main-only.

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

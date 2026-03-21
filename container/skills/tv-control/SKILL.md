---
name: tv-control
description: Control TVClaw Android TVs linked to NanoClaw. Use when the user wants to show on-screen messages, media control, open apps, or other TV actions via the main WhatsApp group agent.
---

# TV control (TVClaw)

The host browses mDNS for `_tvclaw._tcp` and opens outbound WebSockets to each TV. HTTP stays on 8770 for health, `POST /tv`, and serving the APK. TVs run a local WebSocket server and advertise via NSD—no TV IP in `.env`.

**Tool:** `send_tv_command` (MCP, **main group only**)

- `action`: protocol action string (`SHOW_TOAST`, `MEDIA_CONTROL`, `LAUNCH_APP`, `SEARCH`, `VISION_SYNC`, …).
- `params`: optional object. For `SHOW_TOAST`, use `{ "message": "your text" }`.

After changing MCP tools, rebuild the agent image: `./container/build.sh` from the NanoClaw repo root.

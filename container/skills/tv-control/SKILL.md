---
name: tv-control
description: Control TVClaw Android TVs linked to NanoClaw. Use when the user wants to show on-screen messages, media control, open apps, or other TV actions via the main WhatsApp group agent.
---

# TV control (TVClaw)

The host browses mDNS for `_tvclaw._tcp` and opens outbound WebSockets to each TV. **If no WebSocket is connected, commands do nothing** — the user must run **Connect bridge** on the TV app (same LAN). HTTP 8770 serves health, `POST /tv`, and the APK. No TV IP in `.env`.

**Tool:** `send_tv_command` (MCP, **main group only**). Arguments are a **discriminated union** on `action` (flat fields, not a nested `params` object).

Examples:

- Open Netflix: `action` = `LAUNCH_APP`, `app_id` = `netflix` (or `com.netflix.ninja`)
- Open YouTube: `action` = `LAUNCH_APP`, `app_id` = `youtube` (or `com.google.android.youtube.tv`)
- Open deep link in app: `action` = `OPEN_URL`, `url`, optional `app_id`
- Android TV home: `action` = `MEDIA_CONTROL`, `control` = `HOME`
- Toast: `action` = `SHOW_TOAST`, `message` = `Hello`
- Search inside an app: `action` = `SEARCH`, `app_id`, `query`
- Search globally on TV: `action` = `UNIVERSAL_SEARCH`, `query`
- D-pad navigation: `action` = `KEY_EVENT`, `keycode` = `DPAD_UP` | `DPAD_DOWN` | `DPAD_LEFT` | `DPAD_RIGHT` | `DPAD_CENTER` | `ENTER` | `BACK` | `HOME` | `MENU` | `CHANNEL_UP` | `CHANNEL_DOWN`
- Screenshot (ComputerUse): `action` = `VISION_SYNC` — returns a JPEG of the TV screen. Use tv-vision skill for visual navigation loops.

**For Netflix:** always use the netflix-deeplinks skill — resolve the title ID via web search and send `OPEN_URL` with `http://www.netflix.com/watch/<id>`. Never use `SEARCH` as the first attempt.

After changing MCP tools or this skill, rebuild the agent image: `bash container/build.sh` from the nanoclaw repo root.

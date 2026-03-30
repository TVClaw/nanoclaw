# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate channel fork, not bundled in core. Run `/add-whatsapp` (or `git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git && git fetch whatsapp main && (git merge whatsapp/main || { git checkout --theirs package-lock.json && git add package-lock.json && git merge --continue; }) && npm run build`) to install it. Existing auth credentials and groups are preserved.

## TV Vibe Pages

To show anything on the TV (news, games, stats, weather, etc.), output the HTML in `<vibe-page>` tags — system hosts and opens it automatically. No Write tool.

```
<vibe-page><!DOCTYPE html>...</vibe-page>
```

- Search only for live data (scores, prices, breaking news). Use training data otherwise. One search max.
- `body`: `margin:0;width:100vw;height:100vh;overflow:hidden;background:#0a0a0f;color:#fff`. Font ≥32px.
- **Scrollable content**: wrap in `<div id="sc" style="height:100vh;overflow-y:auto;scrollbar-width:none">`, scroll it with `window.addEventListener('keydown',handler,true)` — `true` (capture phase) is mandatory on Android TV.
- **Games**: DPAD input arrives via SSE relay. Connect: `const es=new EventSource('http://'+window.location.host+'/vibe-key-sse'); es.onmessage=e=>handleDir(e.data.trim());`. Each message data is `"up"/"down"/"left"/"right"`. Any direction starts/restarts the game. Also add keyboard fallback with `window.addEventListener('keydown',handler,true)`. Only element in body: `<canvas tabindex="0">`. Call `canvas.focus()` on load. Draw ALL UI (start screen, score, game over) on canvas — no HTML buttons or overlays.
- **App deep links**: NEVER use `http://` or `https://` URLs to open apps (Netflix, YouTube, etc.) — Android TV browsers block these as "App deeplink blocked". Always use the Android `intent://` URI scheme: `intent://www.netflix.com/watch/ID#Intent;scheme=https;package=com.netflix.ninja;S.browser_fallback_url=https%3A%2F%2Fwww.netflix.com%2Fwatch%2FID;end`. Common packages: Netflix=`com.netflix.ninja`, YouTube=`com.google.android.youtube.tv`, Prime Video=`com.amazon.amazonvideo.livingroom`.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

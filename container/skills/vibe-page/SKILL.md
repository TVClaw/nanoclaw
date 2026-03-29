---
name: vibe-page
description: Generate and display a custom web page on the TV. Use when the user asks for anything visual — stats, news, recommendations, games, dashboards, history, weather, stocks, or any other content — to be shown on the TV screen. Instructions are in the project CLAUDE.md under "TV Vibe Pages".
---

See project CLAUDE.md → **TV Vibe Pages** section for full instructions.

Key points:
- Output HTML inside `<vibe-page>` tags in your response — no Write tool needed
- DPAD scroll: `window.addEventListener('keydown', ..., true)` with capture=true
- DPAD games: same capture=true + `canvas.focus()` on load

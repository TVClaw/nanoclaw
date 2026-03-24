---
name: tv-vision
description: ComputerUse-like visual control of AndroidTV. Use when you need to see the screen, navigate UI, detect ads, confirm what is playing, or perform multi-step TV navigation.
---

# TV Vision (ComputerUse for AndroidTV)

Use this skill when you need to see the current TV screen and act on what you observe — similar to ComputerUse on desktop.

**Requires:** Android 12+ (API 31) on the TV, bridge connected.

## Core loop

```
VISION_SYNC → analyze screenshot → act (KEY_EVENT / OPEN_URL / MEDIA_CONTROL) → repeat
```

1. Call `send_tv_command` with `action: VISION_SYNC` — waits up to 30s and returns a JPEG screenshot.
2. Look at the image: identify what app is open, what is focused, what text is on screen.
3. Issue the appropriate action based on what you see.
4. Repeat if navigation requires multiple steps.

## Available navigation actions

| Action | Params | Use for |
|---|---|---|
| `KEY_EVENT` | `keycode: DPAD_UP/DOWN/LEFT/RIGHT` | Navigate focus between items |
| `KEY_EVENT` | `keycode: DPAD_CENTER` or `ENTER` | Select / confirm the focused item |
| `KEY_EVENT` | `keycode: BACK` | Go back one screen |
| `KEY_EVENT` | `keycode: HOME` | Return to Android TV home |
| `MEDIA_CONTROL` | `control: PLAY/PAUSE` | Play or pause |
| `OPEN_URL` | `url`, `app_id` | Deep-link directly to content |
| `LAUNCH_APP` | `app_id` | Open an app |

## Usage patterns

### Navigate to something on screen
1. `VISION_SYNC` — see the current screen
2. Determine how many D-pad presses are needed to reach the target
3. Issue `KEY_EVENT` actions as needed
4. `VISION_SYNC` again to confirm focus moved correctly
5. `KEY_EVENT ENTER` to select

### Ad detection loop
1. `VISION_SYNC` — capture screen
2. Analyze: does the image show an advertisement? Look for ad indicators (skip button, countdown, "Advertisement" text, sponsor logos)
3. If ad: wait and repeat (use `schedule_task` for polling)
4. If content resumed: notify user

### Confirm what is playing
1. `VISION_SYNC` — see the screen
2. Read the title, episode info, or progress bar from the screenshot
3. Report back to the user

### Navigate Netflix to a specific show (fallback when deep link fails)
1. `LAUNCH_APP` with `app_id: com.netflix.ninja`
2. `VISION_SYNC` — wait for Netflix to load
3. Navigate to search or use `SEARCH` action
4. `VISION_SYNC` — see results, navigate to the correct item
5. `KEY_EVENT ENTER` to open it

## Tips

- After any navigation action, wait ~1 second before taking another screenshot (screens animate).
- If the TV shows a loading spinner, retry `VISION_SYNC` after a short delay.
- If you see an unexpected screen (e.g., error dialog), use `BACK` to dismiss it.
- Use `SHOW_TOAST` to display status messages on the TV screen while working.
- Limit vision loops to ~10 iterations to avoid long delays; report to the user if stuck.

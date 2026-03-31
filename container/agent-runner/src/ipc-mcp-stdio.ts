/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const TV_DIR = path.join(IPC_DIR, 'tv');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

const tvMediaControl = z.enum([
  'PLAY',
  'PAUSE',
  'REWIND_30',
  'FAST_FORWARD_30',
  'MUTE',
  'HOME',
  'BACK',
]);

const tvKeyCode = z.enum([
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
  'DPAD_CENTER', 'ENTER', 'BACK', 'HOME', 'MENU',
  'CHANNEL_UP', 'CHANNEL_DOWN', 'VOLUME_UP', 'VOLUME_DOWN',
]);

const sendTvCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('LAUNCH_APP'),
    app_id: z
      .string()
      .min(1)
      .describe('App identifier: package name or short app name alias'),
  }),
  z.object({
    action: z.literal('OPEN_URL'),
    url: z.string().min(1),
    app_id: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('MEDIA_CONTROL'),
    control: tvMediaControl,
  }),
  z.object({
    action: z.literal('KEY_EVENT'),
    keycode: tvKeyCode.describe('D-pad or key to press: DPAD_UP/DOWN/LEFT/RIGHT/CENTER, ENTER, BACK, HOME, MENU, CHANNEL_UP/DOWN, VOLUME_UP/DOWN'),
  }),
  z.object({
    action: z.literal('SHOW_TOAST'),
    message: z.string().min(1),
  }),
  z.object({
    action: z.literal('SEARCH'),
    app_id: z.string().min(1),
    query: z.string().min(1),
  }),
  z.object({
    action: z.literal('UNIVERSAL_SEARCH'),
    query: z.string().min(1),
  }),
  z.object({
    action: z.literal('SLEEP_TIMER'),
    minutes: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('VISION_SYNC'),
  }).describe('Capture a screenshot of the TV screen. Returns a JPEG image. Use this to see what is on screen before navigating.'),
]);

type SendTvCommandArgs = z.infer<typeof sendTvCommandSchema>;

function tvCommandToPayload(args: SendTvCommandArgs): {
  action: string;
  params: Record<string, unknown>;
} {
  switch (args.action) {
    case 'LAUNCH_APP':
      return { action: 'LAUNCH_APP', params: { app_id: args.app_id } };
    case 'MEDIA_CONTROL':
      return { action: 'MEDIA_CONTROL', params: { control: args.control } };
    case 'KEY_EVENT':
      return { action: 'KEY_EVENT', params: { keycode: args.keycode } };
    case 'OPEN_URL':
      return {
        action: 'OPEN_URL',
        params: { url: args.url, ...(args.app_id ? { app_id: args.app_id } : {}) },
      };
    case 'SHOW_TOAST':
      return { action: 'SHOW_TOAST', params: { message: args.message } };
    case 'SEARCH':
      return {
        action: 'SEARCH',
        params: { app_id: args.app_id, query: args.query },
      };
    case 'UNIVERSAL_SEARCH':
      return { action: 'UNIVERSAL_SEARCH', params: { query: args.query } };
    case 'SLEEP_TIMER':
      return { action: 'SLEEP_TIMER', params: { value: args.minutes } };
    case 'VISION_SYNC':
      return { action: 'VISION_SYNC', params: {} };
  }
}

const VISION_SYNC_TIMEOUT_MS = 30_000;
const VISION_SYNC_POLL_MS = 500;

server.registerTool(
  'send_tv_command',
  {
    description:
      'Control TVClaw Android TVs (WebSocket). Main group only. The Mac must have an active WebSocket to the TV (user taps Connect bridge on the TV app, same LAN). If no TV is connected, the command is dropped and nothing happens on screen — tell the user to open the bridge, do not claim success.\n\nVISION_SYNC: captures a screenshot of the TV screen and returns it as an image. Use this to see what is currently on screen, then navigate with KEY_EVENT (DPAD_UP/DOWN/LEFT/RIGHT/CENTER, ENTER, BACK) or other actions.',
    inputSchema: sendTvCommandSchema,
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Only the main group can send TV commands.',
          },
        ],
        isError: true,
      };
    }

    // VISION_SYNC: async round-trip — write IPC with requestId, poll for response file
    if (args.action === 'VISION_SYNC') {
      const requestId = `vsync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const responsePath = path.join(TV_DIR, 'responses', `${requestId}.json`);
      const data = {
        type: 'tv_command',
        payload: { action: 'VISION_SYNC', params: { request_id: requestId } },
        requestId,
        groupFolder,
        timestamp: new Date().toISOString(),
      };
      writeIpcFile(TV_DIR, data);

      const deadline = Date.now() + VISION_SYNC_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, VISION_SYNC_POLL_MS));
        if (fs.existsSync(responsePath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
            fs.unlinkSync(responsePath);
            if (raw.jpeg_base64) {
              return {
                content: [
                  {
                    type: 'image' as const,
                    data: raw.jpeg_base64 as string,
                    mimeType: 'image/jpeg',
                  },
                ],
              };
            }
            if (raw.error) {
              return {
                content: [{ type: 'text' as const, text: `VISION_SYNC failed: ${raw.error}` }],
                isError: true,
              };
            }
          } catch (err) {
            return {
              content: [{ type: 'text' as const, text: `VISION_SYNC response parse error: ${err}` }],
              isError: true,
            };
          }
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'VISION_SYNC timeout: TV did not respond within 30 seconds. Is the bridge connected and does the TV run Android 12+?' }],
        isError: true,
      };
    }

    const payload = tvCommandToPayload(args);
    const data = {
      type: 'tv_command',
      payload,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TV_DIR, data);

    const body = JSON.stringify({
      action: payload.action,
      params: payload.params,
    });
    return {
      content: [
        {
          type: 'text' as const,
          text: `TV command queued on the Mac (delivered only if a TV WebSocket is connected — otherwise user must open TVClaw bridge on the TV). Body: ${body}`,
        },
      ],
    };
  },
);

const GAMES_IPC_DIR = path.join(IPC_DIR, 'games');
const CHECK_GAME_TIMEOUT_MS = 5_000;
const CHECK_GAME_POLL_MS = 100;

server.tool(
  'check_game',
  'Check if a built-in game is available before generating one. Returns the game URL and remote controller URL when found. Always call this first when the user wants to play a game — only generate a vibe-page if check_game returns exists=false.',
  {
    name: z.string().describe('Game name the user wants to play (e.g. "snake", "tetris")'),
  },
  async (args) => {
    const requestId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const responsePath = path.join(GAMES_IPC_DIR, 'responses', `${requestId}.json`);

    writeIpcFile(GAMES_IPC_DIR, { type: 'check_game', name: args.name, requestId });

    const deadline = Date.now() + CHECK_GAME_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, CHECK_GAME_POLL_MS));
      if (fs.existsSync(responsePath)) {
        const result = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
        fs.unlinkSync(responsePath);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ exists: false, error: 'timeout', requested: args.name }) }],
    };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('New schedule type'),
    schedule_value: z.string().optional().describe('New schedule value (see schedule_task for format)'),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (args.schedule_type === 'cron' || (!args.schedule_type && args.schedule_value)) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}".` }],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.schedule_type !== undefined) data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined) data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} update requested.` }] };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAMES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'games',
);

/** Returns list of available built-in game names (without .html). */
export function listGames(): string[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => f.replace('.html', ''));
}

/**
 * Returns the game name if the message is asking to play a built-in game,
 * otherwise null. Matching is intentionally loose — users say things like
 * "play snake", "let's play snake on tv", "open the snake game".
 */
export function matchBuiltinGame(message: string): string | null {
  const games = listGames();
  if (games.length === 0) return null;
  const lower = message.toLowerCase();
  for (const game of games) {
    if (lower.includes(game)) return game;
  }
  return null;
}

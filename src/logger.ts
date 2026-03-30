import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

const VERBOSE = process.argv.includes('--verbose');

/**
 * Timing helper — only emits when --verbose is passed.
 * Usage:
 *   const t = perfStart('my-label');
 *   ...work...
 *   perfEnd(t, 'my-label');        // prints elapsed ms
 *   perfStep(t, 'my-label', 'checkpoint'); // prints ms since last call
 */
export function perfStart(label: string): { t0: number; last: number; label: string } {
  const now = Date.now();
  if (VERBOSE) console.log(`[PERF] ▶ ${label} started`);
  return { t0: now, last: now, label };
}

export function perfStep(
  timer: { t0: number; last: number; label: string },
  step: string,
  extra?: Record<string, unknown>,
): void {
  if (!VERBOSE) return;
  const now = Date.now();
  const sinceStart = now - timer.t0;
  const sinceLast = now - timer.last;
  timer.last = now;
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  console.log(`[PERF] ${timer.label} › ${step} +${sinceLast}ms (total ${sinceStart}ms)${extraStr}`);
}

export function perfEnd(
  timer: { t0: number; last: number; label: string },
  extra?: Record<string, unknown>,
): void {
  if (!VERBOSE) return;
  const total = Date.now() - timer.t0;
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  console.log(`[PERF] ■ ${timer.label} done — total ${total}ms${extraStr}`);
}

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

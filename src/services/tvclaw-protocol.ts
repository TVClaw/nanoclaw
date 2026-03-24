export type ProtocolAction =
  | 'LAUNCH_APP'
  | 'OPEN_URL'
  | 'SEARCH'
  | 'UNIVERSAL_SEARCH'
  | 'MEDIA_CONTROL'
  | 'KEY_EVENT'
  | 'SLEEP_TIMER'
  | 'VISION_SYNC'
  | 'SHOW_TOAST';

export type MediaControl =
  | 'PLAY'
  | 'PAUSE'
  | 'REWIND_30'
  | 'FAST_FORWARD_30'
  | 'MUTE'
  | 'HOME'
  | 'BACK';

export interface ProtocolParams {
  app_id?: string;
  url?: string;
  query?: string;
  control?: MediaControl;
  keycode?: string;
  value?: string | number;
  message?: string;
  request_id?: string;
}

export interface ProtocolPayload {
  action: ProtocolAction;
  params: ProtocolParams;
}

function toSnakeAction(action: string): string {
  const t = action.trim();
  const withUnderscores = t
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_');
  return withUnderscores.toLowerCase();
}

export function normalizeTvAction(action: string): string {
  const snake = toSnakeAction(action);
  const parts = snake.split('_').filter(Boolean);
  let n = parts.map((p) => p.toUpperCase()).join('_');
  const compact = n.replace(/_/g, '');
  const aliases: Record<string, string> = {
    MEDIACONTROL: 'MEDIA_CONTROL',
    LAUNCHAPP: 'LAUNCH_APP',
    OPENURL: 'OPEN_URL',
    UNIVERSALSEARCH: 'UNIVERSAL_SEARCH',
    SLEEPTIMER: 'SLEEP_TIMER',
    SHOWTOAST: 'SHOW_TOAST',
    VISIONSYNC: 'VISION_SYNC',
    KEYEVENT: 'KEY_EVENT',
  };
  return aliases[compact] ?? n;
}

const KNOWN_CONTROLS = new Set([
  'PLAY',
  'PAUSE',
  'REWIND_30',
  'FAST_FORWARD_30',
  'MUTE',
  'HOME',
  'BACK',
]);

function normalizeControlString(c: string): MediaControl | undefined {
  const snake = normalizeTvAction(c);
  if (KNOWN_CONTROLS.has(snake)) {
    return snake as MediaControl;
  }
  const cu = c.trim().toUpperCase().replace(/-/g, '_');
  if (KNOWN_CONTROLS.has(cu)) {
    return cu as MediaControl;
  }
  return undefined;
}

/**
 * Normalize any Netflix URL variant to the only format that works on AndroidTV:
 * http://www.netflix.com/watch/<id>
 *
 * Handles:
 *   nflx://www.netflix.com/title/12345  → http://www.netflix.com/watch/12345
 *   https://www.netflix.com/title/12345 → http://www.netflix.com/watch/12345
 *   http://www.netflix.com/watch/12345  → unchanged
 */
function normalizeNetflixUrl(url: string): string {
  const netflixPattern = /^(?:nflx:|https?:)\/\/(?:www\.)?netflix\.com\/(?:title|watch)\/(\d+)/i;
  const match = url.match(netflixPattern);
  if (match) {
    return `http://www.netflix.com/watch/${match[1]}`;
  }
  return url;
}

function canonicalParamsForAction(
  action: string,
  p: ProtocolParams,
): ProtocolParams {
  switch (action) {
    case 'LAUNCH_APP':
      return p.app_id ? { app_id: p.app_id } : {};
    case 'OPEN_URL':
      return p.url ? { url: normalizeNetflixUrl(p.url), ...(p.app_id ? { app_id: p.app_id } : {}) } : {};
    case 'MEDIA_CONTROL':
      return p.control ? { control: p.control } : {};
    case 'SHOW_TOAST':
      return p.message ? { message: p.message } : {};
    case 'SEARCH':
      return p.app_id && p.query
        ? { app_id: p.app_id, query: p.query }
        : {};
    case 'UNIVERSAL_SEARCH':
      return p.query ? { query: p.query } : {};
    case 'KEY_EVENT':
      return p.keycode ? { keycode: p.keycode } : {};
    case 'VISION_SYNC':
      return p.request_id ? { request_id: p.request_id } : {};
    case 'SLEEP_TIMER':
      return typeof p.value === 'number' && Number.isFinite(p.value)
        ? { value: p.value }
        : {};
    default:
      return p;
  }
}

export function normalizeTvPayload(payload: ProtocolPayload): ProtocolPayload {
  const base = payload.params ?? {};
  const raw = base as Record<string, unknown>;
  const params: ProtocolParams = { ...base };
  const pickStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v.trim() !== '') {
        return v.trim();
      }
    }
    return undefined;
  };
  if (!params.app_id) {
    const a = pickStr('app_id', 'appId', 'package', 'package_name', 'packageName');
    if (a) params.app_id = a;
  }
  if (!params.query) {
    const q = pickStr('query', 'q', 'search', 'search_query', 'searchQuery');
    if (q) params.query = q;
  }
  if (!params.url) {
    const u = pickStr('url', 'uri', 'deep_link', 'deeplink', 'link');
    if (u) params.url = u;
  }
  if (!params.message) {
    const m = pickStr('message', 'text', 'msg', 'body');
    if (m) params.message = m;
  }
  if (params.value === undefined) {
    const n = (raw.value ?? raw.minutes) as unknown;
    if (typeof n === 'number' && Number.isFinite(n)) {
      params.value = n;
    } else if (typeof n === 'string' && n.trim() !== '') {
      const parsed = Number(n.trim());
      if (Number.isFinite(parsed)) params.value = parsed;
    }
  }
  if (!params.keycode) {
    const k = pickStr('keycode', 'key_code', 'key');
    if (k) params.keycode = k.toUpperCase();
  } else {
    params.keycode = params.keycode.toUpperCase();
  }
  if (!params.request_id) {
    const rid = pickStr('request_id', 'requestId');
    if (rid) params.request_id = rid;
  }
  const ctrlSource =
    (typeof params.control === 'string' && params.control.trim() !== ''
      ? params.control
      : undefined) ??
    pickStr('control', 'button', 'media_control', 'mediaControl');
  if (ctrlSource) {
    const nc = normalizeControlString(ctrlSource);
    if (nc) params.control = nc;
  }
  const action = normalizeTvAction(payload.action) as ProtocolAction;
  return {
    action,
    params: canonicalParamsForAction(action, params),
  };
}

export interface TVClawEnvelope {
  request_id: string;
  timestamp: string;
  payload: ProtocolPayload;
}

export function createTVClawEnvelope(payload: ProtocolPayload): TVClawEnvelope {
  return {
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function parseTVClawEnvelope(raw: unknown): TVClawEnvelope {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('envelope must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.request_id !== 'string' || o.request_id.length === 0) {
    throw new TypeError('request_id must be a non-empty string');
  }
  if (typeof o.timestamp !== 'string' || o.timestamp.length === 0) {
    throw new TypeError('timestamp must be a non-empty string');
  }
  if (o.payload === null || typeof o.payload !== 'object') {
    throw new TypeError('payload must be an object');
  }
  const p = o.payload as Record<string, unknown>;
  if (typeof p.action !== 'string') {
    throw new TypeError('payload.action must be a string');
  }
  if (
    p.params !== undefined &&
    (p.params === null || typeof p.params !== 'object')
  ) {
    throw new TypeError('payload.params must be an object when present');
  }
  return {
    request_id: o.request_id,
    timestamp: o.timestamp,
    payload: {
      action: p.action as ProtocolAction,
      params: (p.params ?? {}) as ProtocolParams,
    },
  };
}

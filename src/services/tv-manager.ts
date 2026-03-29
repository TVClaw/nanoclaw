import { randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bonjour, type Service } from 'bonjour-service';
import WebSocket from 'ws';
import {
  createTVClawEnvelope,
  normalizeTvPayload,
  type ProtocolPayload,
} from './tvclaw-protocol.js';
import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

export function normalizeTvHttpPath(reqUrl: string | undefined): string {
  const pathOnly = (reqUrl ?? '/').split('?')[0] ?? '/';
  let p = pathOnly.replace(/\/+/g, '/');
  if (p === '') p = '/';
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function parsePocPayload(raw: unknown): ProtocolPayload {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError();
  }
  const o = raw as Record<string, unknown>;
  const inner = o.payload !== undefined ? o.payload : o;
  if (inner === null || typeof inner !== 'object') {
    throw new TypeError();
  }
  const p = inner as Record<string, unknown>;
  if (typeof p.action !== 'string') {
    throw new TypeError();
  }
  const params =
    p.params !== undefined && p.params !== null && typeof p.params === 'object'
      ? (p.params as ProtocolPayload['params'])
      : {};
  return { action: p.action as ProtocolPayload['action'], params };
}

function resolveClientApkPath(): string | undefined {
  const fromEnv = process.env.TVCLAW_CLIENT_APK?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromNanoclawRepo = path.join(
    here,
    '..',
    '..',
    '..',
    'TVClaw',
    'apps',
    'client-android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk',
  );
  if (existsSync(fromNanoclawRepo)) {
    return fromNanoclawRepo;
  }
  return undefined;
}

function pickServiceHost(s: Service): string | null {
  const addrs = (s.addresses ?? []).filter(Boolean);
  const v4 = addrs.find((a) => !a.includes(':'));
  return v4 ?? addrs[0] ?? null;
}

function wsUrl(host: string, port: number): string {
  if (host.includes(':')) {
    return `ws://[${host}]:${port}`;
  }
  return `ws://${host}:${port}`;
}

function preferredLanIPv4(): string | null {
  const nets = networkInterfaces();
  const v4: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const e of list) {
      if (e.internal) continue;
      const fam = e.family as string | number;
      if (fam !== 'IPv4' && fam !== 4) continue;
      v4.push(e.address);
    }
  }
  const isPrivate = (ip: string) =>
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  return v4.find(isPrivate) ?? v4[0] ?? null;
}

function printTvclawLanBanner(httpPort: number, hasApk: boolean): void {
  const ip = preferredLanIPv4();
  if (!ip) {
    logger.warn(
      'Could not detect a LAN IPv4; use this machine’s IP manually for TV download URL',
    );
    return;
  }
  const base = `http://${ip}:${httpPort}`;
  if (process.env.NO_COLOR) {
    console.log(`TVClaw on LAN — ${base}/  APK: ${base}/tvclaw-client.apk`);
    return;
  }
  const b = '\x1b[1;33m';
  const r = '\x1b[0m';
  const line = `${b}══════════════════════════════════════════════════════════════${r}`;
  console.log(`\n${line}`);
  console.log(
    `${b} TVClaw on this Mac — open on your TV browser:${r}\n` +
      `   ${b}Home${r}  ${base}/\n` +
      (hasApk ? `   ${b}APK${r}   ${base}/tvclaw-client.apk\n` : ''),
  );
  console.log(`${line}\n`);
}

type TvTarget = {
  key: string;
  host: string;
  port: number;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

type PendingVisionSync = {
  responseFilePath: string;
};

const VIBE_PAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class TvManager {
  private readonly clients = new Set<WebSocket>();
  private httpServer: Server | null = null;
  private clientApkPath: string | undefined;
  private bonjour: Bonjour | null = null;
  private browser: ReturnType<Bonjour['find']> | null = null;
  private readonly targets = new Map<string, TvTarget>();
  private readonly pendingVisionSyncs = new Map<string, PendingVisionSync>();
  private readonly vibesDir = path.join(DATA_DIR, 'vibes');

  clientCount(): number {
    return this.clients.size;
  }

  registerVisionSync(requestId: string, responseFilePath: string): void {
    this.pendingVisionSyncs.set(requestId, { responseFilePath });
  }

  /** Host an HTML page and return its LAN URL. Page auto-deletes after 24h. */
  addVibePage(html: string): string {
    mkdirSync(this.vibesDir, { recursive: true });
    const id = randomUUID();
    const filePath = path.join(this.vibesDir, `${id}.html`);
    writeFileSync(filePath, html, 'utf8');
    setTimeout(() => {
      try {
        unlinkSync(filePath);
      } catch {}
    }, VIBE_PAGE_TTL_MS);
    const ip = preferredLanIPv4() ?? 'localhost';
    const httpPort = Number(process.env.TVCLAW_HTTP_PORT ?? 8770);
    return `http://${ip}:${httpPort}/vibes/${id}.html`;
  }

  private getVibePageHtml(pageId: string): string | null {
    // Prevent path traversal: only allow UUID.html filenames
    if (!/^[0-9a-f-]{36}\.html$/.test(pageId)) return null;
    const filePath = path.join(this.vibesDir, pageId);
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private onTvMessage(rawData: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawData);
    } catch {
      logger.debug({ rawData }, 'tvclaw: non-JSON message from TV, ignoring');
      return;
    }

    if (msg.type === 'vision_sync_response') {
      const requestId = msg.request_id as string | undefined;
      if (!requestId) return;

      const pending = this.pendingVisionSyncs.get(requestId);
      if (!pending) {
        logger.warn(
          { requestId },
          'tvclaw: vision_sync_response for unknown requestId',
        );
        return;
      }
      this.pendingVisionSyncs.delete(requestId);

      try {
        mkdirSync(path.dirname(pending.responseFilePath), { recursive: true });
        const tmp = `${pending.responseFilePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(msg));
        renameSync(tmp, pending.responseFilePath);
        logger.info({ requestId }, 'tvclaw: vision_sync_response written');
      } catch (err) {
        logger.error(
          { err, requestId },
          'tvclaw: failed to write vision response',
        );
      }
    }
  }

  sendToAll(payload: ProtocolPayload): number {
    const normalized = normalizeTvPayload(payload);
    const envelope = createTVClawEnvelope(normalized);
    const msg = JSON.stringify(envelope);
    const postBody = JSON.stringify({
      action: normalized.action,
      params: normalized.params,
    });
    logger.info(
      {
        tvPostBody: postBody,
        tvWebSocketJson: msg,
      },
      'tvclaw TV command (tvPostBody matches curl -d; tvWebSocketJson is sent on WebSocket)',
    );
    let n = 0;
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
        n++;
      }
    }
    return n;
  }

  private serviceKey(s: Service): string {
    return s.fqdn ?? `${s.name}:${s.port}:${s.type}`;
  }

  private clearTargetReconnect(t: TvTarget): void {
    if (t.reconnectTimer) {
      clearTimeout(t.reconnectTimer);
      t.reconnectTimer = null;
    }
  }

  private disposeTarget(key: string): void {
    const t = this.targets.get(key);
    if (!t) return;
    this.clearTargetReconnect(t);
    try {
      t.ws?.removeAllListeners();
      t.ws?.close();
    } catch {}
    if (t.ws) {
      this.clients.delete(t.ws);
    }
    t.ws = null;
    this.targets.delete(key);
  }

  private connectTarget(t: TvTarget): void {
    if (t.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.clearTargetReconnect(t);
    try {
      t.ws?.removeAllListeners();
      t.ws?.close();
    } catch {}
    if (t.ws) {
      this.clients.delete(t.ws);
    }
    t.ws = null;
    const url = wsUrl(t.host, t.port);
    const ws = new WebSocket(url);
    t.ws = ws;
    ws.on('open', () => {
      this.clients.add(ws);
      logger.info({ url }, 'tvclaw outbound WebSocket open');
    });
    ws.on('message', (data) => {
      this.onTvMessage(data.toString());
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      t.ws = null;
      if (!this.targets.has(t.key)) {
        return;
      }
      t.reconnectTimer = setTimeout(() => {
        t.reconnectTimer = null;
        if (this.targets.has(t.key)) {
          this.connectTarget(t);
        }
      }, 3000);
    });
    ws.on('error', (err) => {
      logger.debug({ err, url }, 'tvclaw outbound WebSocket error');
    });
  }

  private onServiceUp(s: Service): void {
    const host = pickServiceHost(s);
    if (host == null || !s.port) {
      logger.warn(
        { name: s.name },
        'tvclaw browse: service missing address or port',
      );
      return;
    }
    const key = this.serviceKey(s);
    let t = this.targets.get(key);
    if (!t) {
      t = {
        key,
        host,
        port: s.port,
        ws: null,
        reconnectTimer: null,
      };
      this.targets.set(key, t);
    } else {
      const hostPortChanged = t.host !== host || t.port !== s.port;
      t.host = host;
      t.port = s.port;
      if (hostPortChanged) {
        this.clearTargetReconnect(t);
        try {
          t.ws?.removeAllListeners();
          t.ws?.close();
        } catch {}
        if (t.ws) {
          this.clients.delete(t.ws);
        }
        t.ws = null;
      }
    }
    this.connectTarget(t);
  }

  private onServiceDown(s: Service): void {
    const key = this.serviceKey(s);
    this.disposeTarget(key);
    logger.info({ name: s.name }, 'tvclaw browse: service down');
  }

  start(): void {
    if (this.httpServer) {
      return;
    }
    const httpPort = Number(process.env.TVCLAW_HTTP_PORT ?? 8770);
    this.clientApkPath = resolveClientApkPath();

    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: 'tvclaw', protocol: 'tcp' });
    this.browser.on('up', (s: Service) => this.onServiceUp(s));
    this.browser.on('down', (s: Service) => this.onServiceDown(s));
    this.browser.on('error', (err: Error) => {
      logger.error({ err }, 'tvclaw bonjour browser error');
    });

    logger.info('tvclaw browsing _tvclaw._tcp (outbound WebSocket to TVs)');

    this.httpServer = createServer((req, res) => {
      const pathname = normalizeTvHttpPath(req.url);
      const m = req.method ?? 'GET';
      const read = m === 'GET' || m === 'HEAD';

      if (m === 'OPTIONS') {
        if (
          pathname === '/health' ||
          pathname === '/' ||
          pathname === '/tvclaw-client.apk' ||
          pathname.startsWith('/vibes/')
        ) {
          res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' });
          res.end();
          return;
        }
        if (pathname === '/tv') {
          res.writeHead(204, { Allow: 'POST, OPTIONS' });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }

      if (read && pathname === '/health') {
        res.writeHead(200);
        if (m === 'HEAD') res.end();
        else res.end('ok');
        return;
      }

      if (read && pathname === '/') {
        if (!this.clientApkPath) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (m === 'HEAD') res.end();
          else {
            res.end(
              'client apk not built (assembleDebug) or TVCLAW_CLIENT_APK unset',
            );
          }
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (m === 'HEAD') res.end();
        else {
          res.end(
            '<!DOCTYPE html><meta charset=utf-8><title>TVClaw</title>' +
              '<p><a href="/tvclaw-client.apk">Download TV client (APK)</a></p>',
          );
        }
        return;
      }

      if (read && pathname === '/tvclaw-client.apk') {
        if (!this.clientApkPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (m === 'HEAD') res.end();
          else res.end('apk not available');
          return;
        }
        const st = statSync(this.clientApkPath);
        if (m === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': st.size,
            'Content-Disposition': 'attachment; filename="tvclaw-client.apk"',
          });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': st.size,
          'Content-Disposition': 'attachment; filename="tvclaw-client.apk"',
        });
        createReadStream(this.clientApkPath)
          .pipe(res)
          .on('error', () => {
            if (!res.headersSent) {
              res.writeHead(500);
            }
            res.end();
          });
        return;
      }

      if (req.method === 'POST' && pathname === '/tv') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => {
          chunks.push(c as Buffer);
        });
        req.on('end', () => {
          try {
            const raw = JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as unknown;
            const payload = parsePocPayload(raw);
            const delivered = this.sendToAll(payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, tvs: delivered }));
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      const vibeMatch = /^\/vibes\/([^/]+)$/.exec(pathname);
      if (read && vibeMatch) {
        const html = this.getVibePageHtml(vibeMatch[1] ?? '');
        if (html === null) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (m !== 'HEAD') res.end('not found');
          else res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (m === 'HEAD') res.end();
        else res.end(html);
        return;
      }

      res.writeHead(404);
      res.end();
    });
    this.httpServer.listen(httpPort, () => {
      logger.info(
        { httpPort },
        `tvclaw brain http ${httpPort} (APK + POST /tv; TVs via mDNS _tvclaw._tcp)`,
      );
      if (this.clientApkPath) {
        logger.info(
          { httpPort },
          `tvclaw client apk http://<this-machine-lan-ip>:${httpPort}/tvclaw-client.apk`,
        );
      } else {
        logger.warn(
          'tvclaw client apk not served (build apps/client-android or set TVCLAW_CLIENT_APK)',
        );
      }
      printTvclawLanBanner(httpPort, !!this.clientApkPath);
    });
  }

  stop(): void {
    for (const key of [...this.targets.keys()]) {
      this.disposeTarget(key);
    }
    this.targets.clear();
    for (const c of this.clients) {
      try {
        c.close();
      } catch {}
    }
    this.clients.clear();
    try {
      this.browser?.stop();
    } catch {}
    this.browser = null;
    try {
      this.bonjour?.destroy();
    } catch {}
    this.bonjour = null;
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

let singleton: TvManager | null = null;

export function getTvManager(): TvManager {
  if (!singleton) {
    singleton = new TvManager();
  }
  return singleton;
}

export function parseTvHttpPayload(raw: unknown): ProtocolPayload {
  return parsePocPayload(raw);
}

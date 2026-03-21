import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bonjour, type Service } from 'bonjour-service';
import WebSocket from 'ws';
import {
  createTVClawEnvelope,
  type ProtocolPayload,
} from './tvclaw-protocol.js';
import { logger } from '../logger.js';

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

type TvTarget = {
  key: string;
  host: string;
  port: number;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

export class TvManager {
  private readonly clients = new Set<WebSocket>();
  private httpServer: Server | null = null;
  private clientApkPath: string | undefined;
  private bonjour: Bonjour | null = null;
  private browser: ReturnType<Bonjour['find']> | null = null;
  private readonly targets = new Map<string, TvTarget>();

  clientCount(): number {
    return this.clients.size;
  }

  sendToAll(payload: ProtocolPayload): void {
    const msg = JSON.stringify(createTVClawEnvelope(payload));
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    }
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
      const pathname = (req.url ?? '/').split('?')[0] ?? '/';

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200);
        res.end('ok');
        return;
      }

      if (req.method === 'GET' && pathname === '/') {
        if (!this.clientApkPath) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(
            'client apk not built (assembleDebug) or TVCLAW_CLIENT_APK unset',
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!DOCTYPE html><meta charset=utf-8><title>TVClaw</title>' +
            '<p><a href="/tvclaw-client.apk">Download TV client (APK)</a></p>',
        );
        return;
      }

      if (req.method === 'GET' && pathname === '/tvclaw-client.apk') {
        if (!this.clientApkPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('apk not available');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
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
            this.sendToAll(payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, tvs: this.clients.size }));
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });
    this.httpServer.listen(httpPort);

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

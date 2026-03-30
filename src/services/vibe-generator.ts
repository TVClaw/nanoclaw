/**
 * Fast vibe-page generator — calls the Anthropic API directly via the
 * credential proxy, bypassing the container entirely.
 * Latency: ~5–20s vs ~60–120s through the container.
 */
import { CREDENTIAL_PROXY_PORT, VIBE_MODEL } from '../config.js';
import { detectAuthMode } from '../credential-proxy.js';
import { logger, perfStart, perfStep, perfEnd } from '../logger.js';

const SYSTEM_PROMPT = `You generate web pages for TV display. Output complete HTML inside <vibe-page> tags, then one short line for the user. Be minimal — only as complex as the request needs.

TV rules (mandatory):
- body: margin:0;width:100vw;height:100vh;overflow:hidden;background:#0a0a0f;color:#fff. Font ≥32px.
- Scrollable content: wrap in <div id="sc" style="height:100vh;overflow-y:auto;scrollbar-width:none">. Scroll with window.addEventListener('keydown',e=>{if(e.key==='ArrowDown')document.getElementById('sc').scrollBy({top:300,behavior:'smooth'});if(e.key==='ArrowUp')document.getElementById('sc').scrollBy({top:-300,behavior:'smooth'});e.preventDefault();e.stopPropagation();},true)
- Games: DPAD input arrives via SSE relay from the TVClaw Android app. Connect with: const es=new EventSource('http://'+window.location.host+'/vibe-key-sse'); es.onmessage=e=>handleDir(e.data.trim()); es.onerror=()=>{es.close();setTimeout(connectSse,3000);}. Each message data is "up"/"down"/"left"/"right". Any direction starts/restarts the game. Also add keyboard fallback: window.addEventListener('keydown',handler,true). Only element in body: <canvas tabindex="0">. Call canvas.focus() on load. Draw ALL UI (start screen, score, game over) on canvas — no HTML buttons or overlays.
- No external resources except CDN chart lib if essential. Under 80 lines for simple requests, up to 150 for complex ones.
- YouTube/trailer links: use https://youtube.com/results?search_query=... — never search, never omit.
- App links (Netflix, YouTube, etc.): use intent:// URIs. Netflix example: intent://www.netflix.com/watch/ID#Intent;scheme=https;package=com.netflix.ninja;S.browser_fallback_url=https%3A%2F%2Fwww.netflix.com%2Fwatch%2FID;end`;

export interface VibeResult {
  html: string | null;
  text: string;
}

/** Returns true if the message is asking for something to be shown on the TV. */
export function isVibePageRequest(message: string): boolean {
  return (
    // Explicit TV surface words: "vibe", "tv page", "on tv", "on my tv", "on the tv", "for tv"
    /\bvibe\b|\btv\s+page\b|\b(on|for)\s+(my\s+|the\s+)?tv\b|\b(on|for)\s+(my\s+|the\s+)?television\b|\b(on|for)\s+(my\s+|the\s+)?(screen|display)\b/i.test(message) ||
    // Action verbs directed at TV: "show/display/put/play/open/run/launch/create/generate ... tv"
    /(show|display|put|play|open|run|launch|create|generate|render|stream).{0,60}(tv|television|screen|display)/i.test(message)
  );
}

/**
 * Generate a vibe page via a direct API call through the credential proxy.
 * No container, no agent loop — one HTTP round-trip.
 */
export async function generateVibePageDirect(
  userMessage: string,
): Promise<VibeResult | null> {
  const proxyUrl = `http://127.0.0.1:${CREDENTIAL_PROXY_PORT}`;
  const authMode = detectAuthMode();
  const model = VIBE_MODEL;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  // Credential proxy injects x-api-key (api-key mode) or replaces this header (oauth mode)
  if (authMode === 'oauth') {
    headers['authorization'] = 'Bearer placeholder';
  }

  const apiTimer = perfStart('vibe-generator-api');
  perfStep(apiTimer, 'sending request', { model, proxyUrl, authMode });
  try {
    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    perfStep(apiTimer, 'fetch() resolved', { status: res.status, ok: res.ok });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error(
        { status: res.status, body: errText },
        'Vibe generator API error',
      );
      perfEnd(apiTimer, { error: res.status });
      return null;
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    perfStep(apiTimer, 'response body parsed');

    const fullText = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    const match = fullText.match(/<vibe-page>([\s\S]*?)<\/vibe-page>/);
    const html = match ? (match[1] ?? '').trim() : null;
    const text = fullText
      .replace(/<vibe-page>[\s\S]*?<\/vibe-page>/g, '')
      .replace(/<internal>[\s\S]*?<\/internal>/g, '')
      .trim();

    // Token usage + cost estimate (Haiku: $0.80/MTok in, $4.00/MTok out)
    const tokIn = data.usage?.input_tokens ?? 0;
    const tokOut = data.usage?.output_tokens ?? 0;
    const costUsd = (tokIn * 0.0000008) + (tokOut * 0.000004);
    const costLine = `in=${tokIn} out=${tokOut} cost=$${costUsd.toFixed(5)}`;

    logger.info(
      { model, hasHtml: !!html, tokIn, tokOut, costUsd: costUsd.toFixed(5) },
      'Vibe generator response',
    );
    perfEnd(apiTimer, { hasHtml: !!html, htmlBytes: html?.length ?? 0, tokens: costLine });
    return { html, text };
  } catch (err) {
    logger.error({ err }, 'Vibe generator failed');
    perfEnd(apiTimer, { error: String(err) });
    return null;
  }
}

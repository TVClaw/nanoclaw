/**
 * Fast vibe-page generator — calls the Anthropic API directly via the
 * credential proxy, bypassing the container entirely.
 * Latency: ~5–20s vs ~60–120s through the container.
 */
import { CREDENTIAL_PROXY_PORT, NANOCLAW_MODEL } from '../config.js';
import { detectAuthMode } from '../credential-proxy.js';
import { logger } from '../logger.js';

const SYSTEM_PROMPT = `You generate web pages for TV display. Always output the complete HTML inside <vibe-page> tags in your response, followed by a one-line summary for the user.

TV rules (all mandatory):
- body: margin:0;width:100vw;height:100vh;overflow:hidden;background:#0a0a0f;color:#fff. Font ≥32px.
- Scrollable content: wrap in <div id="sc" style="height:100vh;overflow-y:auto;scrollbar-width:none">. Add: window.addEventListener('keydown',e=>{if(e.key==='ArrowDown')document.getElementById('sc').scrollBy({top:300,behavior:'smooth'});if(e.key==='ArrowUp')document.getElementById('sc').scrollBy({top:-300,behavior:'smooth'});e.preventDefault();e.stopPropagation();},true)
- Games: window.addEventListener('keydown',handler,true) — NOT document.addEventListener. canvas.tabIndex=0;canvas.focus() on DOMContentLoaded. e.preventDefault();e.stopPropagation() on ALL arrow keys unconditionally. Show a <button> for restart, never rely on Enter.
- Under 120 lines. No external resources except CDN chart lib if essential.
- For video/recap links: construct https://youtube.com/results?search_query=... URLs — never leave them out, never search for them.`;

export interface VibeResult {
  html: string | null;
  text: string;
}

/** Returns true if the message is asking for something to be shown on the TV. */
export function isVibePageRequest(message: string): boolean {
  return /\b(vibe|on tv|on the tv|for tv|for the tv|tv page|put on tv)\b|(show|display|put|generate|create).{0,50}(tv|television|screen)/i.test(
    message,
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
  const model = NANOCLAW_MODEL || 'claude-haiku-4-5-20251001';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  // Credential proxy injects x-api-key (api-key mode) or replaces this header (oauth mode)
  if (authMode === 'oauth') {
    headers['authorization'] = 'Bearer placeholder';
  }

  try {
    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error(
        { status: res.status, body: errText },
        'Vibe generator API error',
      );
      return null;
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

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

    logger.info(
      { model, hasHtml: !!html, textLen: text.length },
      'Vibe generator response',
    );
    return { html, text };
  } catch (err) {
    logger.error({ err }, 'Vibe generator failed');
    return null;
  }
}

import { describe, expect, it } from 'vitest';
import { normalizeTvHttpPath, parseTvHttpPayload } from './tv-manager.js';

describe('normalizeTvHttpPath', () => {
  it('maps empty and repeated slashes to root', () => {
    expect(normalizeTvHttpPath('/')).toBe('/');
    expect(normalizeTvHttpPath('//')).toBe('/');
    expect(normalizeTvHttpPath('///')).toBe('/');
    expect(normalizeTvHttpPath('')).toBe('/');
    expect(normalizeTvHttpPath(undefined)).toBe('/');
  });

  it('strips query and trailing slash on resources', () => {
    expect(normalizeTvHttpPath('/?x=1')).toBe('/');
    expect(normalizeTvHttpPath('/health')).toBe('/health');
    expect(normalizeTvHttpPath('/tvclaw-client.apk/')).toBe(
      '/tvclaw-client.apk',
    );
  });
});

describe('parseTvHttpPayload', () => {
  it('accepts nested payload', () => {
    const p = parseTvHttpPayload({
      payload: { action: 'SHOW_TOAST', params: { message: 'hi' } },
    });
    expect(p.action).toBe('SHOW_TOAST');
    expect(p.params.message).toBe('hi');
  });

  it('accepts top-level action and params', () => {
    const p = parseTvHttpPayload({
      action: 'SHOW_TOAST',
      params: { message: 'x' },
    });
    expect(p.action).toBe('SHOW_TOAST');
    expect(p.params.message).toBe('x');
  });
});

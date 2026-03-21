import { describe, expect, it } from 'vitest';
import { parseTvHttpPayload } from './tv-manager.js';

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

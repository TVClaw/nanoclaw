import { describe, expect, it } from 'vitest';
import {
  normalizeTvAction,
  normalizeTvPayload,
  type ProtocolPayload,
} from './tvclaw-protocol.js';

describe('normalizeTvAction', () => {
  it('normalizes casing and separators', () => {
    expect(normalizeTvAction('LAUNCH_APP')).toBe('LAUNCH_APP');
    expect(normalizeTvAction('launch_app')).toBe('LAUNCH_APP');
    expect(normalizeTvAction('launchApp')).toBe('LAUNCH_APP');
    expect(normalizeTvAction('media control')).toBe('MEDIA_CONTROL');
  });

  it('maps compact spellings', () => {
    expect(normalizeTvAction('launchapp')).toBe('LAUNCH_APP');
    expect(normalizeTvAction('mediacontrol')).toBe('MEDIA_CONTROL');
  });
});

describe('normalizeTvPayload', () => {
  it('aliases param keys for LAUNCH_APP', () => {
    const raw = {
      action: 'LAUNCH_APP',
      params: { package: 'com.netflix.ninja' },
    } as unknown as ProtocolPayload;
    const p = normalizeTvPayload(raw);
    expect(p.action).toBe('LAUNCH_APP');
    expect(p.params).toEqual({ app_id: 'com.netflix.ninja' });
  });

  it('drops alias keys after resolving app_id', () => {
    const raw = {
      action: 'LAUNCH_APP',
      params: {
        package: 'com.netflix.ninja',
        app_id: 'com.netflix.ninja',
      },
    } as unknown as ProtocolPayload;
    const p = normalizeTvPayload(raw);
    expect(p.params).toEqual({ app_id: 'com.netflix.ninja' });
  });

  it('normalizes MEDIA_CONTROL control string', () => {
    const raw = {
      action: 'mediaControl',
      params: { control: 'home' },
    } as unknown as ProtocolPayload;
    const p = normalizeTvPayload(raw);
    expect(p.action).toBe('MEDIA_CONTROL');
    expect(p.params.control).toBe('HOME');
  });
});

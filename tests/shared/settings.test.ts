import { describe, expect, it } from 'vitest';
import { DEFAULTS, missingKeys } from '../../src/shared/settings';

describe('missingKeys', () => {
  it('lists every required field that is empty or blank', () => {
    expect(missingKeys(DEFAULTS)).toEqual(['elevenKey', 'anthropicKey', 'voiceId']);
    expect(missingKeys({ ...DEFAULTS, elevenKey: '  ', anthropicKey: 'k', voiceId: 'v' })).toEqual(['elevenKey']);
  });

  it('returns nothing when all required fields are set', () => {
    expect(missingKeys({ ...DEFAULTS, elevenKey: 'a', anthropicKey: 'b', voiceId: 'c' })).toEqual([]);
  });

  it('defaults to Haiku 4.5 and captions on', () => {
    expect(DEFAULTS.model).toBe('claude-haiku-4-5-20251001');
    expect(DEFAULTS.captions).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { describeStatus, resetsAfterEdit, savedLabel, statsLine } from '../../src/popup/view';

describe('describeStatus', () => {
  it('blocks turning on while keys are missing', () => {
    const v = describeStatus('off', true, ['elevenKey']);
    expect(v.canToggle).toBe(false);
    expect(v.hint).toContain('chaves');
  });

  it('blocks turning on outside a Meet tab', () => {
    const v = describeStatus('off', false, []);
    expect(v.canToggle).toBe(false);
    expect(v.hint).toContain('Meet');
  });

  it('allows turning on from a Meet tab with all keys set', () => {
    expect(describeStatus('off', true, [])).toMatchObject({ label: 'Desligado', canToggle: true });
  });

  it('always allows turning off, even outside Meet or without keys', () => {
    for (const s of ['connecting', 'translating', 'failed'] as const) {
      expect(describeStatus(s, false, ['voiceId']).canToggle).toBe(true);
    }
  });

  it('shows the failure detail instead of the generic hint when there is one', () => {
    expect(describeStatus('failed', true, [], 'Chave do ElevenLabs inválida.').hint).toBe('Chave do ElevenLabs inválida.');
    expect(describeStatus('translating', true, [], 'ignored').hint).not.toBe('ignored');
  });

  it('describes each active state', () => {
    expect(describeStatus('connecting', true, []).label).toBe('Conectando…');
    expect(describeStatus('translating', true, []).label).toBe('Traduzindo PT → EN');
    expect(describeStatus('failed', true, []).label).toBe('Conexão caiu');
    expect(describeStatus('failed', true, []).hint).toContain('voltou ao normal');
    for (const s of ['off', 'connecting', 'translating', 'failed'] as const) {
      expect(describeStatus(s, true, []).hint.length).toBeLessThanOrEqual(42);
    }
  });

  it('resets a failed state when the settings are edited, and leaves the others alone', () => {
    expect(resetsAfterEdit('failed')).toBe(true);
    for (const s of ['off', 'connecting', 'translating'] as const) expect(resetsAfterEdit(s)).toBe(false);
  });

  it('confirms a save with the tail of the stored ElevenLabs key', () => {
    expect(savedLabel('sk_abcdefgh1234')).toBe('salvo · chave …1234');
    expect(savedLabel('')).toBe('salvo');
    expect(savedLabel('sk_abcdefgh1234')).not.toContain('abcdefgh');
  });

  it('formats the stage counters so a stalled stage is easy to spot', () => {
    expect(statsLine({ mic: 120, text: 5, translated: 3, voice: 40 })).toBe('mic 120 · texto 5 · trad 3 · voz 40');
    expect(statsLine({ mic: 0, text: 0, translated: 0, voice: 0 }).length).toBeLessThanOrEqual(42);
  });

  it('shows the counters instead of the generic hint while translating', () => {
    const c = { mic: 1, text: 2, translated: 3, voice: 4 };
    expect(describeStatus('translating', true, [], undefined, c).hint).toBe(statsLine(c));
    expect(describeStatus('translating', true, []).hint).toContain('Alt+T');
  });
});

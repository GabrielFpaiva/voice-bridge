import { describe, expect, it } from 'vitest';
import { describeFailure, diagnose } from '../../src/offscreen/errors';

describe('diagnose', () => {
  it('treats ElevenLabs auth errors as fatal', () => {
    for (const m of ['Invalid API key', 'You must be authenticated to use this endpoint.', 'stt token 401', 'stt token 400', 'stt token 403: API key is invalid.']) {
      expect(diagnose(new Error(m))).toEqual({ fatal: true, message: 'Chave do ElevenLabs inválida.' });
    }
  });

  it('treats Anthropic auth errors as fatal and names the right key', () => {
    expect(diagnose(new Error('translate 401'))).toEqual({ fatal: true, message: 'Chave da Anthropic inválida.' });
  });

  it('treats a missing voice and exhausted credits as fatal', () => {
    expect(diagnose(new Error('A voice with voice_id abc was not found.')).message).toBe('ID da voz não encontrado.');
    expect(diagnose(new Error('quota_exceeded: no credits left')).message).toBe('Créditos do ElevenLabs acabaram.');
  });

  it('treats everything else as transient and keeps the raw reason', () => {
    const d = diagnose(new Error('tts closed 1006'));
    expect(d.fatal).toBe(false);
    expect(d.message).toContain('tts closed 1006');
    expect(diagnose(new Error('translate 529')).fatal).toBe(false);
  });

  it('caps the raw reason so the popup does not overflow', () => {
    expect(diagnose(new Error('x'.repeat(300))).message.length).toBeLessThanOrEqual(80);
  });

  it('names the stage and the tail of the key that was actually used on key errors', () => {
    const keys = { elevenKey: 'sk_aaaa1234', anthropicKey: 'sk-ant-zzzz9876' };
    const e = describeFailure(new Error('stt token 400'), keys);
    expect(e).toContain('Chave do ElevenLabs inválida.');
    expect(e).toContain('stt token 400');
    expect(e).toContain('…1234');
    expect(e).not.toContain('sk_aaaa');
    expect(describeFailure(new Error('translate 401'), keys)).toContain('…9876');
  });

  it('leaves transient failures as they are', () => {
    expect(describeFailure(new Error('tts closed 1006'), { elevenKey: 'k', anthropicKey: 'k' })).toBe(
      'Conexão caiu: tts closed 1006',
    );
  });
});

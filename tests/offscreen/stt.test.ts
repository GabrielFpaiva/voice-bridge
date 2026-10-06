import { describe, expect, it } from 'vitest';
import { audioMessage, fetchScribeToken, parseSttMessage, sttUrl } from '../../src/offscreen/stt';

describe('stt protocol', () => {
  it('builds the realtime url with token, pt and vad commit', () => {
    const url = sttUrl('tok123');
    expect(url.startsWith('wss://api.elevenlabs.io/v1/speech-to-text/realtime?')).toBe(true);
    expect(url).toContain('model_id=scribe_v2_realtime');
    expect(url).toContain('audio_format=pcm_16000');
    expect(url).toContain('language_code=pt');
    expect(url).toContain('commit_strategy=vad');
    expect(url).toContain('token=tok123');
  });

  it('builds an input_audio_chunk message', () => {
    const m = JSON.parse(audioMessage(new Int16Array([1, 2])));
    expect(m.message_type).toBe('input_audio_chunk');
    expect(m.sample_rate).toBe(16000);
    expect(typeof m.audio_base_64).toBe('string');
  });

  it('parses partial, committed, error and other messages', () => {
    expect(parseSttMessage('{"message_type":"partial_transcript","text":"oi"}')).toEqual({ kind: 'partial', text: 'oi' });
    expect(parseSttMessage('{"message_type":"committed_transcript","text":"oi."}')).toEqual({ kind: 'committed', text: 'oi.' });
    expect(parseSttMessage('{"message_type":"auth_error","error":"bad key"}')).toEqual({ kind: 'error', message: 'bad key' });
    expect(parseSttMessage('{"message_type":"session_started"}')).toEqual({ kind: 'other' });
  });

  it('fetches a single-use token with the api key header', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ token: 'abc' }) };
    }) as unknown as typeof fetch;
    expect(await fetchScribeToken('KEY', fakeFetch)).toBe('abc');
    expect(seen!.url).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
    expect((seen!.init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
    expect(seen!.init.method).toBe('POST');
  });

  it('throws when the token request fails', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    await expect(fetchScribeToken('KEY', fakeFetch)).rejects.toThrow('401');
  });
});

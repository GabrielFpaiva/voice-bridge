import { describe, expect, it } from 'vitest';
import { pcm16ToBase64 } from '../../src/core/pcm';
import { bosMessage, parseTtsMessage, textMessage, ttsUrl } from '../../src/offscreen/tts';

describe('tts protocol', () => {
  it('builds the stream-input url with flash model and pcm_24000', () => {
    const url = ttsUrl('VOICE');
    expect(url.startsWith('wss://api.elevenlabs.io/v1/text-to-speech/VOICE/stream-input?')).toBe(true);
    expect(url).toContain('model_id=eleven_flash_v2_5');
    expect(url).toContain('output_format=pcm_24000');
    expect(url).toContain('inactivity_timeout=180');
  });

  it('builds the BOS message with a single space and the api key', () => {
    const m = JSON.parse(bosMessage('KEY'));
    expect(m.text).toBe(' ');
    expect(m['xi-api-key']).toBe('KEY');
    expect(m.voice_settings).toBeDefined();
  });

  it('builds text messages that always flush and end with a space', () => {
    expect(JSON.parse(textMessage('Hello there,'))).toEqual({ text: 'Hello there, ', flush: true });
    expect(JSON.parse(textMessage('Hi '))).toEqual({ text: 'Hi ', flush: true });
  });

  it('parses audio, final and error messages', () => {
    const audio = pcm16ToBase64(new Int16Array([1, 2, 3]));
    const a = parseTtsMessage(JSON.stringify({ audio }));
    expect(Array.from(a.audio!)).toEqual([1, 2, 3]);
    expect(parseTtsMessage('{"isFinal":true}')).toEqual({ final: true });
    expect(parseTtsMessage('{"audio":null}')).toEqual({});
    expect(parseTtsMessage('{"error":"quota","message":"out of credits"}')).toEqual({ error: 'out of credits' });
  });
});

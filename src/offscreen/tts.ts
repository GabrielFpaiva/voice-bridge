import { base64ToPcm16 } from '../core/pcm';
import type { Tts } from './ports';

export type TtsMessage = { audio?: Int16Array; final?: boolean; error?: string };

export function ttsUrl(voiceId: string): string {
  const q = new URLSearchParams({
    model_id: 'eleven_flash_v2_5',
    output_format: 'pcm_24000',
    inactivity_timeout: '180',
  });
  return `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?${q}`;
}

export function bosMessage(apiKey: string): string {
  return JSON.stringify({
    text: ' ',
    voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
    'xi-api-key': apiKey,
  });
}

export function textMessage(text: string): string {
  return JSON.stringify({ text: text.endsWith(' ') ? text : `${text} `, flush: true });
}

export function parseTtsMessage(raw: string): TtsMessage {
  const m = JSON.parse(raw);
  const out: TtsMessage = {};
  if (typeof m.audio === 'string' && m.audio.length) out.audio = base64ToPcm16(m.audio);
  if (m.isFinal) out.final = true;
  if (m.error) out.error = String(m.message ?? m.error);
  return out;
}

export class ElevenTts implements Tts {
  private ws?: WebSocket;
  private closing = false;
  private keepAlive?: ReturnType<typeof setInterval>;
  private audioCb: (p: Int16Array) => void = () => {};
  private errorCb: (e: Error) => void = () => {};

  constructor(private cfg: { apiKey: string; voiceId: string }) {}

  onAudio(cb: (p: Int16Array) => void) { this.audioCb = cb; }
  onError(cb: (e: Error) => void) { this.errorCb = cb; }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(ttsUrl(this.cfg.voiceId));
      this.ws = ws;
      ws.onopen = () => {
        ws.send(bosMessage(this.cfg.apiKey));
        this.keepAlive = setInterval(() => ws.send(JSON.stringify({ text: ' ' })), 15000);
        resolve();
      };
      ws.onerror = () => reject(new Error('tts socket error'));
      ws.onclose = (ev) => {
        if (!this.closing) this.errorCb(new Error(`tts closed ${ev.code}`));
      };
      ws.onmessage = (ev) => {
        const m = parseTtsMessage(String(ev.data));
        if (m.audio) this.audioCb(m.audio);
        if (m.error) this.errorCb(new Error(m.error));
      };
    });
  }

  speak(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(textMessage(text));
  }

  close(): void {
    this.closing = true;
    clearInterval(this.keepAlive);
    this.ws?.close();
  }
}

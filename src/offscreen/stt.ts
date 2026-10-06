import { pcm16ToBase64 } from '../core/pcm';
import type { Stt } from './ports';

export type SttMessage =
  | { kind: 'partial'; text: string }
  | { kind: 'committed'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'other' };

export function sttUrl(token: string): string {
  const q = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: 'pcm_16000',
    language_code: 'pt',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: '0.6',
    token,
  });
  return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`;
}

export function audioMessage(pcm: Int16Array): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: pcm16ToBase64(pcm),
    sample_rate: 16000,
  });
}

export function parseSttMessage(raw: string): SttMessage {
  const m = JSON.parse(raw);
  const type = String(m.message_type ?? '');
  if (type === 'partial_transcript') return { kind: 'partial', text: String(m.text ?? '') };
  if (type === 'committed_transcript') return { kind: 'committed', text: String(m.text ?? '') };
  if (type === 'error' || type.endsWith('_error')) {
    return { kind: 'error', message: String(m.error ?? m.message ?? type) };
  }
  return { kind: 'other' };
}

export async function fetchScribeToken(apiKey: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`stt token ${res.status}`);
  const json = (await res.json()) as { token: string };
  return json.token;
}

export class ElevenStt implements Stt {
  private ws?: WebSocket;
  private closing = false;
  private partialCb: (t: string) => void = () => {};
  private committedCb: (t: string) => void = () => {};
  private errorCb: (e: Error) => void = () => {};

  constructor(private apiKey: string) {}

  onPartial(cb: (t: string) => void) { this.partialCb = cb; }
  onCommitted(cb: (t: string) => void) { this.committedCb = cb; }
  onError(cb: (e: Error) => void) { this.errorCb = cb; }

  async connect(): Promise<void> {
    const token = await fetchScribeToken(this.apiKey);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(sttUrl(token));
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('stt socket error'));
      ws.onclose = (ev) => {
        if (!this.closing) this.errorCb(new Error(`stt closed ${ev.code}`));
      };
      ws.onmessage = (ev) => {
        const m = parseSttMessage(String(ev.data));
        if (m.kind === 'partial') this.partialCb(m.text);
        else if (m.kind === 'committed') this.committedCb(m.text);
        else if (m.kind === 'error') this.errorCb(new Error(m.message));
      };
    });
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(audioMessage(pcm));
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
  }
}

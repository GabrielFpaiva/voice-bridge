import { base64ToPcm16, pcm16ToBase64 } from '../core/pcm';
import type { ToBackground, ToOffscreen } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { Pipeline } from './pipeline';
import { ElevenStt } from './stt';
import { ClaudeTranslator } from './translate';
import { ElevenTts } from './tts';

const RETRY_MS = 3000;

let pipeline: Pipeline | null = null;
let wanted = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function send(msg: ToBackground): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function scheduleRetry(settings: Settings): void {
  if (!wanted) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void start(settings), RETRY_MS);
}

async function start(settings: Settings): Promise<void> {
  wanted = true;
  pipeline?.stop();
  send({ to: 'background', type: 'event', event: 'connecting' });
  const p = new Pipeline(
    new ElevenStt(settings.elevenKey),
    new ClaudeTranslator({ apiKey: settings.anthropicKey, model: settings.model }),
    new ElevenTts({ apiKey: settings.elevenKey, voiceId: settings.voiceId }),
    {
      audio: (pcm) =>
        send({ to: 'background', type: 'forward', msg: { type: 'audio', pcm: pcm16ToBase64(pcm) } }),
      caption: (text) => send({ to: 'background', type: 'forward', msg: { type: 'caption', text } }),
      failed: (err) => {
        console.warn('[voice-bridge] pipeline failed:', err.message);
        send({ to: 'background', type: 'event', event: 'error' });
        scheduleRetry(settings);
      },
    },
  );
  pipeline = p;
  if ((await p.start()) && pipeline === p) send({ to: 'background', type: 'event', event: 'connected' });
}

function stop(): void {
  wanted = false;
  clearTimeout(retryTimer);
  pipeline?.stop();
  pipeline = null;
}

chrome.runtime.onMessage.addListener((raw: ToOffscreen) => {
  if (raw?.to !== 'offscreen') return;
  if (raw.type === 'start') void start(raw.settings);
  else if (raw.type === 'stop') stop();
  else if (raw.type === 'mic') pipeline?.feed(base64ToPcm16(raw.pcm));
});

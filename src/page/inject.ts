import { AudioScheduler } from '../core/audio-scheduler';
import { base64ToPcm16, downsampleTo16k, int16ToFloat32, pcm16ToBase64 } from '../core/pcm';
import type { TabMsg } from '../shared/messages';

const TTS_RATE = 24000;

interface Graph {
  ctx: AudioContext;
  micGain: GainNode;
  bus: GainNode;
}

let graph: Graph | null = null;
let translating = false;
let activeMicCleanup: (() => void) | null = null;
const scheduler = new AudioScheduler();
const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

function getGraph(): Graph {
  if (graph) return graph;
  const ctx = new AudioContext();
  const micGain = ctx.createGain();
  micGain.gain.value = translating ? 0 : 1;
  graph = { ctx, micGain, bus: ctx.createGain() };
  return graph;
}

function attachMic(g: Graph, stream: MediaStream): () => void {
  const src = g.ctx.createMediaStreamSource(stream);
  src.connect(g.micGain);
  const proc = g.ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (ev) => {
    if (!translating) return;
    const pcm = downsampleTo16k(ev.inputBuffer.getChannelData(0), g.ctx.sampleRate);
    window.postMessage({ __vb: 'page', type: 'mic', pcm: pcm16ToBase64(pcm) }, location.origin);
  };
  src.connect(proc);
  proc.connect(g.ctx.destination);
  return () => {
    src.disconnect();
    proc.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
}

navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
  if (!constraints?.audio) return realGetUserMedia(constraints);
  const real = await realGetUserMedia(constraints);
  try {
    const g = getGraph();
    void g.ctx.resume();

    const dest = g.ctx.createMediaStreamDestination();
    g.micGain.connect(dest);
    g.bus.connect(dest);
    activeMicCleanup?.();
    const cleanupMic = attachMic(g, new MediaStream(real.getAudioTracks()));
    activeMicCleanup = cleanupMic;

    const outTrack = dest.stream.getAudioTracks()[0];
    const originalStop = outTrack.stop.bind(outTrack);
    outTrack.stop = () => {
      originalStop();
      cleanupMic();
      if (activeMicCleanup === cleanupMic) activeMicCleanup = null;
      g.micGain.disconnect(dest);
      g.bus.disconnect(dest);
    };

    const realTrack = real.getAudioTracks()[0];
    if (realTrack) {
      // Meet compares the track it gets back with the device it asked for; mirror the real one.
      Object.defineProperty(outTrack, 'label', { value: realTrack.label });
      const baseSettings = outTrack.getSettings.bind(outTrack);
      outTrack.getSettings = () => ({ ...baseSettings(), ...realTrack.getSettings() });
      realTrack.addEventListener('ended', () => {
        originalStop();
        outTrack.dispatchEvent(new Event('ended'));
      });
    }

    const out = new MediaStream([outTrack]);
    real.getVideoTracks().forEach((v) => out.addTrack(v));
    return out;
  } catch (err) {
    console.warn('[voice-bridge] could not build audio graph, passing the real mic through', err);
    return real;
  }
};

function resumeContext(): void {
  void graph?.ctx.resume();
}

// A context created before any click on the page starts suspended and stays silent (no
// onaudioprocess, no output) until the page itself gets a user gesture.
window.addEventListener('pointerdown', resumeContext, true);
window.addEventListener('keydown', resumeContext, true);

function setMode(on: boolean): void {
  translating = on;
  if (on) resumeContext();
  if (!on) scheduler.reset();
  if (graph) graph.micGain.gain.setTargetAtTime(on ? 0 : 1, graph.ctx.currentTime, 0.01);
}

function playChunk(b64: string): void {
  const g = graph;
  if (!g || !translating) return;
  const f32 = int16ToFloat32(base64ToPcm16(b64));
  if (f32.length === 0) return;
  const buf = g.ctx.createBuffer(1, f32.length, TTS_RATE);
  buf.copyToChannel(f32, 0);
  const { startAt, rate } = scheduler.plan(g.ctx.currentTime, buf.duration);
  const src = g.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(g.bus);
  src.start(startAt);
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__vb !== 'ext') return;
  const m = e.data.msg as TabMsg;
  if (m.type === 'mode') setMode(m.translating);
  else if (m.type === 'audio') playChunk(m.pcm);
});

(window as unknown as { __vbTest: () => void }).__vbTest = () => {
  if (!graph) {
    console.warn('[voice-bridge] entre na chamada primeiro (nenhum microfone pedido ainda)');
    return;
  }
  const g = graph;
  setMode(true);
  const osc = g.ctx.createOscillator();
  osc.frequency.value = 440;
  osc.connect(g.bus);
  osc.start();
  osc.stop(g.ctx.currentTime + 2);
  osc.onended = () => setMode(false);
};

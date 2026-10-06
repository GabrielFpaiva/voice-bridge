import { describe, expect, it } from 'vitest';
import { Pipeline } from '../../src/offscreen/pipeline';
import type { Stt, Translator, Tts } from '../../src/offscreen/ports';

class FakeStt implements Stt {
  partialCb = (_: string) => {};
  committedCb = (_: string) => {};
  errorCb = (_: Error) => {};
  sent: Int16Array[] = [];
  closed = false;
  connectError?: Error;
  async connect() { if (this.connectError) throw this.connectError; }
  sendAudio(p: Int16Array) { this.sent.push(p); }
  onPartial(cb: (t: string) => void) { this.partialCb = cb; }
  onCommitted(cb: (t: string) => void) { this.committedCb = cb; }
  onError(cb: (e: Error) => void) { this.errorCb = cb; }
  close() { this.closed = true; }
}

class FakeTts implements Tts {
  spoken: string[] = [];
  audioCb = (_: Int16Array) => {};
  errorCb = (_: Error) => {};
  closed = false;
  async connect() {}
  speak(t: string) { this.spoken.push(t); }
  onAudio(cb: (p: Int16Array) => void) { this.audioCb = cb; }
  onError(cb: (e: Error) => void) { this.errorCb = cb; }
  close() { this.closed = true; }
}

function setup(translate?: Translator['translate']) {
  const stt = new FakeStt();
  const tts = new FakeTts();
  const calls: { chunk: string; history: string[] }[] = [];
  const translator: Translator = {
    translate: translate ?? (async (chunk, history) => { calls.push({ chunk, history }); return `EN:${chunk}`; }),
  };
  const captions: string[] = [];
  const audio: Int16Array[] = [];
  const failures: Error[] = [];
  const pipeline = new Pipeline(stt, translator, tts, {
    audio: (p) => audio.push(p),
    caption: (t) => captions.push(t),
    failed: (e) => failures.push(e),
  });
  return { stt, tts, calls, captions, audio, failures, pipeline };
}

describe('Pipeline', () => {
  it('translates stable chunks and speaks them in order, with captions', async () => {
    const f = setup();
    f.stt.partialCb('Olá pessoal, tudo bem com');
    await f.pipeline.whenIdle();
    expect(f.tts.spoken).toEqual(['EN:Olá pessoal,']);
    expect(f.captions).toEqual(['EN:Olá pessoal,']);
  });

  it('flushes the rest on committed transcript', async () => {
    const f = setup();
    f.stt.partialCb('Olá pessoal, tudo bem com');
    f.stt.committedCb('Olá pessoal, tudo bem com vocês?');
    await f.pipeline.whenIdle();
    expect(f.tts.spoken).toEqual(['EN:Olá pessoal,', 'EN:tudo bem com vocês?']);
  });

  it('passes the last 3 source chunks as history', async () => {
    const f = setup();
    for (const c of ['um dois,', 'três quatro,', 'cinco seis,', 'sete oito,']) f.stt.committedCb(c);
    await f.pipeline.whenIdle();
    expect(f.calls[3].history).toEqual(['um dois,', 'três quatro,', 'cinco seis,']);
    expect(f.calls[0].history).toEqual([]);
  });

  it('forwards tts audio and mic frames', () => {
    const f = setup();
    const pcm = new Int16Array([1, 2]);
    f.tts.audioCb(pcm);
    f.pipeline.feed(pcm);
    expect(f.audio).toEqual([pcm]);
    expect(f.stt.sent).toEqual([pcm]);
  });

  it('does not speak an empty translation', async () => {
    const f = setup(async () => '');
    f.stt.committedCb('oi pessoal');
    await f.pipeline.whenIdle();
    expect(f.tts.spoken).toEqual([]);
    expect(f.captions).toEqual([]);
  });

  it('fails once when translation throws, closes everything and stops speaking', async () => {
    let n = 0;
    const f = setup(async (chunk) => {
      if (++n === 2) throw new Error('boom');
      return `EN:${chunk}`;
    });
    f.stt.committedCb('um dois,');
    f.stt.committedCb('três quatro,');
    f.stt.committedCb('cinco seis,');
    await f.pipeline.whenIdle();
    expect(f.tts.spoken).toEqual(['EN:um dois,']);
    expect(f.failures.map((e) => e.message)).toEqual(['boom']);
    expect(f.stt.closed && f.tts.closed).toBe(true);
  });

  it('fails once when stt or tts report an error', () => {
    const f = setup();
    f.stt.errorCb(new Error('stt down'));
    f.tts.errorCb(new Error('tts down'));
    expect(f.failures.map((e) => e.message)).toEqual(['stt down']);
  });

  it('start() returns false and reports failure when a connection fails', async () => {
    const f = setup();
    f.stt.connectError = new Error('no net');
    expect(await f.pipeline.start()).toBe(false);
    expect(f.failures.map((e) => e.message)).toEqual(['no net']);
  });

  it('start() returns true when everything connects', async () => {
    expect(await setup().pipeline.start()).toBe(true);
  });

  it('stop() closes connections, ignores later input and does not report a failure', async () => {
    const f = setup();
    f.pipeline.stop();
    f.stt.committedCb('oi pessoal');
    f.pipeline.feed(new Int16Array([1]));
    await f.pipeline.whenIdle();
    expect(f.tts.spoken).toEqual([]);
    expect(f.stt.sent).toEqual([]);
    expect(f.failures).toEqual([]);
    expect(f.stt.closed && f.tts.closed).toBe(true);
  });
});

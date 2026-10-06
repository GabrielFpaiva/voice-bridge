# Voice Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão do Chrome que traduz a fala do Gabriel de português para inglês em tempo real no Google Meet, com a voz clonada dele no ElevenLabs.

**Architecture:** Um script na página do Meet (`world: MAIN`) troca `getUserMedia` por uma saída de áudio própria e toca o inglês nela. Um offscreen document (único contexto com rede) roda STT → tradução → TTS e devolve o PCM pelo service worker. A lógica de decisão (chunker, fila de áudio, máquina de estados, PCM) fica em `src/core/`, pura e testada.

**Tech Stack:** TypeScript, Manifest V3, esbuild (bundle), Vitest (testes), ElevenLabs Scribe v2 Realtime + TTS WebSocket (Flash v2.5), Claude Haiku 4.5.

**Spec:** `docs/superpowers/specs/2026-10-06-voice-bridge-design.md`

## Global Constraints

- Apenas PT → EN, apenas a fala do Gabriel, apenas `https://meet.google.com/*`.
- Sem backend, login ou cobrança; chaves em `chrome.storage.local`, nunca na página do Meet.
- A página do Meet não faz chamadas de rede (CSP); toda rede roda no offscreen document.
- O offscreen document só tem a API `chrome.runtime` (sem `chrome.storage`): configurações chegam pela mensagem `start`.
- Modelo de tradução padrão: `claude-haiku-4-5-20251001`. Modelo TTS: `eleven_flash_v2_5`. STT: `scribe_v2_realtime`.
- PCM de entrada do STT: 16 kHz mono Int16. PCM de saída do TTS: `pcm_24000` mono Int16.
- Atalho: `Alt+T`. Selo: cinza/vazio = desligado, amarelo = conectando, verde = traduzindo, vermelho = falha.
- Commits atômicos, mensagens em inglês, sem trailer `Co-Authored-By` (o hook do Gabriel barra a chamada).
- YAGNI: sem seletor de idioma, histórico, múltiplas vozes, Zoom/Teams.

## Review Focus

- Fala longa sem pontuação: o chunker precisa fechar um pedaço a cada 5 palavras estáveis, nunca esperar a frase acabar.
- O Scribe revisa o texto e o `committed` chega com menos palavras do que já foi emitido: não pode repetir nem emitir lixo.
- Falha de tradução/TTS no meio da frase: a pipeline morre uma vez só, não fala mais nada e o microfone real volta.
- Tradução vazia do Haiku: não manda texto vazio ao TTS.
- O Meet pede o microfone de novo ou chama `track.stop()` (troca de dispositivo): a nova faixa funciona e o microfone real é liberado.

---

## File Structure

```
voice-bridge/
  package.json, tsconfig.json, vitest.config.ts, build.mjs, .gitignore
  public/manifest.json, public/offscreen.html, public/options.html
  src/core/state.ts            máquina de estados (off/connecting/translating/failed)
  src/core/chunker.ts          decide quando fechar um pedaço para traduzir
  src/core/audio-scheduler.ts  decide quando tocar cada pedaço de áudio e a que velocidade
  src/core/pcm.ts              downsample, Int16<->Float32, base64
  src/shared/messages.ts       tipos das mensagens entre contextos
  src/shared/settings.ts       configurações + validação de chaves
  src/page/inject.ts           (MAIN) troca o getUserMedia, grafo de áudio, toca o inglês
  src/content/relay.ts         (ISOLATED) ponte página <-> extensão + legenda
  src/background/index.ts      ícone, selo, atalho, estado, offscreen doc
  src/offscreen/ports.ts       interfaces Stt, Translator, Tts
  src/offscreen/stt.ts         Scribe Realtime
  src/offscreen/translate.ts   Claude Haiku
  src/offscreen/tts.ts         ElevenLabs TTS WebSocket
  src/offscreen/pipeline.ts    orquestra stt -> chunker -> translate -> tts
  src/offscreen/index.ts       recebe mensagens, cria a pipeline, retry
  src/options/index.ts         página de opções
  tests/core/*.test.ts, tests/offscreen/*.test.ts, tests/shared/*.test.ts
  README.md                    roteiro de teste manual
```

---

### Task 1: Scaffold e máquina de estados

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/core/state.ts`
- Test: `tests/core/state.test.ts`

**Interfaces:**
- Produces: `type Status = 'off' | 'connecting' | 'translating' | 'failed'`; `type StateEvent = { type: 'toggle' | 'connected' | 'error' | 'retry' }`; `next(s: Status, e: StateEvent): Status`; `isPassthrough(s: Status): boolean`.

- [ ] **Step 1: Scaffold do projeto**

```bash
cd "/Users/g7/Desktop/job/psb/01 - Projects/voice-bridge"
npm init -y
npm i -D typescript vitest esbuild @types/chrome
```

Substituir `package.json` por (mantendo as versões que o npm instalou em `devDependencies`):

```json
{
  "name": "voice-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

(Reaplicar o bloco `devDependencies` gerado pelo npm dentro desse JSON.)

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
```

`.gitignore`:

```
node_modules
dist
```

- [ ] **Step 2: Write the failing test**

`tests/core/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPassthrough, next } from '../../src/core/state';

describe('state machine', () => {
  it('off -> connecting on toggle', () => {
    expect(next('off', { type: 'toggle' })).toBe('connecting');
  });

  it('connecting -> translating on connected', () => {
    expect(next('connecting', { type: 'connected' })).toBe('translating');
  });

  it('connecting or translating -> failed on error', () => {
    expect(next('connecting', { type: 'error' })).toBe('failed');
    expect(next('translating', { type: 'error' })).toBe('failed');
  });

  it('failed -> connecting on retry, and stays connecting on repeated retry', () => {
    expect(next('failed', { type: 'retry' })).toBe('connecting');
    expect(next('connecting', { type: 'retry' })).toBe('connecting');
  });

  it('toggle from any active state goes to off', () => {
    expect(next('connecting', { type: 'toggle' })).toBe('off');
    expect(next('translating', { type: 'toggle' })).toBe('off');
    expect(next('failed', { type: 'toggle' })).toBe('off');
  });

  it('ignores events that make no sense in the current state', () => {
    expect(next('off', { type: 'connected' })).toBe('off');
    expect(next('off', { type: 'error' })).toBe('off');
    expect(next('translating', { type: 'connected' })).toBe('translating');
  });

  it('only passes the real mic through when not translating', () => {
    expect(isPassthrough('off')).toBe(true);
    expect(isPassthrough('connecting')).toBe(true);
    expect(isPassthrough('failed')).toBe(true);
    expect(isPassthrough('translating')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/core/state.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/core/state"

- [ ] **Step 4: Write minimal implementation**

`src/core/state.ts`:

```ts
export type Status = 'off' | 'connecting' | 'translating' | 'failed';
export type StateEvent = { type: 'toggle' | 'connected' | 'error' | 'retry' };

export function next(s: Status, e: StateEvent): Status {
  if (e.type === 'toggle') return s === 'off' ? 'connecting' : 'off';
  if (s === 'off') return s;
  if (e.type === 'connected') return s === 'connecting' ? 'translating' : s;
  if (e.type === 'error') return 'failed';
  if (e.type === 'retry') return 'connecting';
  return s;
}

export function isPassthrough(s: Status): boolean {
  return s !== 'translating';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/state.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/core/state.ts tests/core/state.test.ts
git commit -m "feat: scaffold project and add status state machine"
```

---

### Task 2: Chunker

**Files:**
- Create: `src/core/chunker.ts`
- Test: `tests/core/chunker.test.ts`

**Interfaces:**
- Produces: `class Chunker { push(partial: string): string[]; commit(final: string): string[] }`. `push` recebe o texto parcial acumulado do trecho atual e devolve os pedaços novos prontos para traduzir; a última palavra do parcial nunca é emitida (pode mudar). `commit` recebe o texto final do trecho, devolve o resto não emitido (no máximo 1 pedaço) e zera o estado.

- [ ] **Step 1: Write the failing test**

`tests/core/chunker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Chunker } from '../../src/core/chunker';

describe('Chunker', () => {
  it('closes a chunk at a comma after at least 2 stable words', () => {
    const c = new Chunker();
    expect(c.push('Olá pessoal, tudo bem com')).toEqual(['Olá pessoal,']);
  });

  it('never emits the last word of a partial (it may still change)', () => {
    const c = new Chunker();
    expect(c.push('Olá pessoal,')).toEqual([]);
    expect(c.push('Olá pessoal, tudo')).toEqual(['Olá pessoal,']);
  });

  it('does not re-emit what was already emitted', () => {
    const c = new Chunker();
    c.push('Olá pessoal, tudo bem com');
    expect(c.push('Olá pessoal, tudo bem com vocês')).toEqual([]);
  });

  it('closes a chunk every 5 stable words when there is no punctuation', () => {
    const c = new Chunker();
    const text = 'eu queria falar sobre o projeto que a gente começou semana passada e agora';
    expect(c.push(text)).toEqual(['eu queria falar sobre o', 'projeto que a gente começou']);
  });

  it('closes immediately at sentence end even with a single word', () => {
    const c = new Chunker();
    expect(c.push('Sim. Então')).toEqual(['Sim.']);
  });

  it('commit returns the unemitted rest as one chunk and resets', () => {
    const c = new Chunker();
    c.push('Olá pessoal, tudo bem com');
    expect(c.commit('Olá pessoal, tudo bem com vocês?')).toEqual(['tudo bem com vocês?']);
    expect(c.push('Novo trecho aqui agora')).toEqual([]);
    expect(c.commit('Novo trecho aqui agora.')).toEqual(['Novo trecho aqui agora.']);
  });

  it('commit with fewer words than already emitted returns nothing and resets', () => {
    const c = new Chunker();
    c.push('um dois três quatro cinco seis');
    expect(c.commit('um dois')).toEqual([]);
    expect(c.commit('')).toEqual([]);
  });

  it('handles empty and whitespace-only input', () => {
    const c = new Chunker();
    expect(c.push('')).toEqual([]);
    expect(c.push('   ')).toEqual([]);
    expect(c.commit('   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/chunker.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/core/chunker"

- [ ] **Step 3: Write minimal implementation**

`src/core/chunker.ts`:

```ts
const MAX_WORDS = 5;
const MIN_WORDS_AT_COMMA = 2;
const SENTENCE_END = /[.!?…]$/;
const SOFT_BREAK = /[,;:]$/;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export class Chunker {
  private emitted = 0;

  push(partial: string): string[] {
    const all = words(partial);
    const stable = all.slice(0, -1);
    const out: string[] = [];
    let start = this.emitted;
    for (let i = start; i < stable.length; i++) {
      const size = i - start + 1;
      const w = stable[i];
      const closes =
        SENTENCE_END.test(w) || (SOFT_BREAK.test(w) && size >= MIN_WORDS_AT_COMMA) || size >= MAX_WORDS;
      if (closes) {
        out.push(stable.slice(start, i + 1).join(' '));
        start = i + 1;
      }
    }
    this.emitted = start;
    return out;
  }

  commit(final: string): string[] {
    const rest = words(final).slice(this.emitted);
    this.emitted = 0;
    return rest.length ? [rest.join(' ')] : [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/chunker.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/chunker.ts tests/core/chunker.test.ts
git commit -m "feat: add chunker that splits partial transcripts into translatable pieces"
```

---

### Task 3: PCM e agendador de áudio

**Files:**
- Create: `src/core/pcm.ts`, `src/core/audio-scheduler.ts`
- Test: `tests/core/pcm.test.ts`, `tests/core/audio-scheduler.test.ts`

**Interfaces:**
- Produces (`pcm.ts`): `downsampleTo16k(input: Float32Array, inRate: number): Int16Array`; `int16ToFloat32(pcm: Int16Array): Float32Array`; `pcm16ToBase64(pcm: Int16Array): string`; `base64ToPcm16(b64: string): Int16Array`.
- Produces (`audio-scheduler.ts`): `class AudioScheduler { constructor(maxBacklogSec = 2.5, fastRate = 1.1); plan(now: number, durationSec: number): { startAt: number; rate: number }; reset(): void }`.

- [ ] **Step 1: Write the failing tests**

`tests/core/pcm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { base64ToPcm16, downsampleTo16k, int16ToFloat32, pcm16ToBase64 } from '../../src/core/pcm';

describe('pcm', () => {
  it('downsamples 48k to 16k by averaging', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(1600);
    expect(Math.abs(out[0] - 16384)).toBeLessThanOrEqual(1);
  });

  it('keeps 16k input the same length', () => {
    expect(downsampleTo16k(new Float32Array(160), 16000).length).toBe(160);
  });

  it('clamps out-of-range samples', () => {
    const out = downsampleTo16k(new Float32Array([2, -2]), 16000);
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('round-trips through base64', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    expect(Array.from(base64ToPcm16(pcm16ToBase64(pcm)))).toEqual(Array.from(pcm));
  });

  it('converts int16 to float32 in [-1, 1]', () => {
    const f = int16ToFloat32(new Int16Array([16384, -32768, 0]));
    expect(f[0]).toBeCloseTo(0.5, 3);
    expect(f[1]).toBe(-1);
    expect(f[2]).toBe(0);
  });
});
```

`tests/core/audio-scheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AudioScheduler } from '../../src/core/audio-scheduler';

describe('AudioScheduler', () => {
  it('plays the first chunk immediately at normal rate', () => {
    expect(new AudioScheduler().plan(10, 1)).toEqual({ startAt: 10, rate: 1 });
  });

  it('queues chunks back to back', () => {
    const s = new AudioScheduler();
    s.plan(0, 1);
    expect(s.plan(0, 1)).toEqual({ startAt: 1, rate: 1 });
  });

  it('speeds up when the backlog exceeds the limit', () => {
    const s = new AudioScheduler(2.5, 1.1);
    s.plan(0, 1);
    s.plan(0, 1);
    s.plan(0, 2);
    const p = s.plan(0, 2);
    expect(p.startAt).toBe(4);
    expect(p.rate).toBe(1.1);
    expect(s.plan(0, 1).startAt).toBeCloseTo(4 + 2 / 1.1, 5);
  });

  it('starts at now again after a silence', () => {
    const s = new AudioScheduler();
    s.plan(0, 1);
    expect(s.plan(5, 1)).toEqual({ startAt: 5, rate: 1 });
  });

  it('reset clears the queue', () => {
    const s = new AudioScheduler();
    s.plan(0, 10);
    s.reset();
    expect(s.plan(1, 1)).toEqual({ startAt: 1, rate: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/pcm.test.ts tests/core/audio-scheduler.test.ts`
Expected: FAIL, imports not found

- [ ] **Step 3: Write minimal implementation**

`src/core/pcm.ts`:

```ts
export function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const avg = end > start ? sum / (end - start) : 0;
    const c = Math.max(-1, Math.min(1, avg));
    out[i] = c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
  }
  return out;
}

export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] < 0 ? pcm[i] / 32768 : pcm[i] / 32767;
  return out;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToPcm16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}
```

`src/core/audio-scheduler.ts`:

```ts
export class AudioScheduler {
  private nextFree = 0;

  constructor(
    private maxBacklogSec = 2.5,
    private fastRate = 1.1,
  ) {}

  plan(now: number, durationSec: number): { startAt: number; rate: number } {
    const startAt = Math.max(now, this.nextFree);
    const backlog = startAt - now;
    const rate = backlog > this.maxBacklogSec ? this.fastRate : 1;
    this.nextFree = startAt + durationSec / rate;
    return { startAt, rate };
  }

  reset(): void {
    this.nextFree = 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core`
Expected: PASS (todos os testes de `core`)

- [ ] **Step 5: Commit**

```bash
git add src/core/pcm.ts src/core/audio-scheduler.ts tests/core/pcm.test.ts tests/core/audio-scheduler.test.ts
git commit -m "feat: add pcm helpers and audio playback scheduler"
```

---

### Task 4: Primeiro marco — microfone falso no Meet

Valida o maior risco: o Meet aceitar o microfone trocado e um participante ouvir o áudio que a extensão gera. Aqui o áudio é um tom de teste; a voz de verdade vem nas tasks seguintes.

**Files:**
- Create: `build.mjs`, `public/manifest.json`
- Create: `src/shared/messages.ts`, `src/page/inject.ts`, `src/content/relay.ts`
- Create: `src/background/index.ts` (stub mínimo, substituído na Task 8), `public/offscreen.html`, `src/offscreen/index.ts` (stub), `public/options.html`, `src/options/index.ts` (stubs)

**Interfaces:**
- Consumes: `AudioScheduler`, `downsampleTo16k`, `int16ToFloat32`, `base64ToPcm16`, `pcm16ToBase64` (Task 3).
- Produces (`messages.ts`):

```ts
export type TabMsg =
  | { type: 'mode'; translating: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'caption'; text: string };
```

Mensagens entre a página e o relay: `window.postMessage({ __vb: 'page', type: 'mic', pcm })` (página → relay) e `window.postMessage({ __vb: 'ext', msg: TabMsg })` (relay → página). O console da página expõe `__vbTest()` para tocar um tom de 2 s pela saída falsa.

- [ ] **Step 1: Build script**

`build.mjs`:

```js
import { context, build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const entries = {
  background: 'src/background/index.ts',
  page: 'src/page/inject.ts',
  relay: 'src/content/relay.ts',
  offscreen: 'src/offscreen/index.ts',
  options: 'src/options/index.ts',
};

const options = {
  entryPoints: entries,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
```

- [ ] **Step 2: Manifest e páginas**

`public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Voice Bridge",
  "version": "0.1.0",
  "description": "Traduz sua fala PT -> EN em tempo real no Google Meet, com a sua voz.",
  "permissions": ["storage", "offscreen"],
  "host_permissions": [
    "https://meet.google.com/*",
    "https://api.elevenlabs.io/*",
    "https://api.anthropic.com/*"
  ],
  "background": { "service_worker": "background.js" },
  "action": { "default_title": "Voice Bridge" },
  "options_page": "options.html",
  "commands": {
    "toggle": {
      "suggested_key": { "default": "Alt+T" },
      "description": "Liga/desliga a tradução"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["page.js"],
      "world": "MAIN",
      "run_at": "document_start"
    },
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["relay.js"],
      "run_at": "document_start"
    }
  ]
}
```

`public/offscreen.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<script src="offscreen.js"></script>
```

`public/options.html` (provisório, completado na Task 5):

```html
<!doctype html>
<meta charset="utf-8" />
<title>Voice Bridge</title>
<script src="options.js"></script>
```

Stubs (uma linha cada, para o build passar):

`src/background/index.ts`, `src/offscreen/index.ts`, `src/options/index.ts`:

```ts
export {};
```

- [ ] **Step 3: Tipos de mensagem**

`src/shared/messages.ts`:

```ts
export type TabMsg =
  | { type: 'mode'; translating: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'caption'; text: string };
```

- [ ] **Step 4: Script da página**

`src/page/inject.ts`:

```ts
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
const scheduler = new AudioScheduler();
const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

function getGraph(): Graph {
  if (graph) return graph;
  const ctx = new AudioContext();
  graph = { ctx, micGain: ctx.createGain(), bus: ctx.createGain() };
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
  const g = getGraph();
  void g.ctx.resume();

  const dest = g.ctx.createMediaStreamDestination();
  g.micGain.connect(dest);
  g.bus.connect(dest);
  const cleanupMic = attachMic(g, new MediaStream(real.getAudioTracks()));

  const outTrack = dest.stream.getAudioTracks()[0];
  const originalStop = outTrack.stop.bind(outTrack);
  outTrack.stop = () => {
    originalStop();
    cleanupMic();
    g.micGain.disconnect(dest);
    g.bus.disconnect(dest);
  };

  const out = new MediaStream([outTrack]);
  real.getVideoTracks().forEach((v) => out.addTrack(v));
  return out;
};

function setMode(on: boolean): void {
  translating = on;
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
```

- [ ] **Step 5: Relay (ponte e legenda)**

`src/content/relay.ts`:

```ts
import type { TabMsg } from '../shared/messages';

let captionEl: HTMLDivElement | null = null;
let captionTimer: number | undefined;

async function showCaption(text: string): Promise<void> {
  const { captions } = await chrome.storage.local.get({ captions: true });
  if (!captions) return;
  if (!captionEl) {
    captionEl = document.createElement('div');
    captionEl.style.cssText =
      'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:60vw;' +
      'padding:8px 14px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;' +
      'font:16px system-ui,sans-serif;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(captionEl);
  }
  captionEl.textContent = text;
  captionEl.style.display = 'block';
  window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => {
    if (captionEl) captionEl.style.display = 'none';
  }, 5000);
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__vb !== 'page') return;
  chrome.runtime.sendMessage({ to: 'offscreen', type: 'mic', pcm: e.data.pcm }).catch(() => {});
});

chrome.runtime.onMessage.addListener((raw) => {
  if (raw?.to !== 'tab') return;
  const { to: _to, ...msg } = raw;
  const m = msg as TabMsg;
  if (m.type === 'caption') {
    void showCaption(m.text);
    return;
  }
  window.postMessage({ __vb: 'ext', msg: m }, location.origin);
});
```

- [ ] **Step 6: Build e typecheck**

Run: `npm run build && npm run typecheck`
Expected: build sem erro, `dist/` com `manifest.json`, `page.js`, `relay.js`, `background.js`, `offscreen.js`, `options.js`; typecheck sem erro.

- [ ] **Step 7: Verificação manual (critério do marco)**

1. Em `chrome://extensions` ligue o Modo do desenvolvedor, "Carregar sem compactação", escolha `dist/`.
2. Abra `https://meet.google.com/new` numa janela, permita o microfone e entre na reunião. Copie o link.
3. Abra o link em **outra janela/perfil** e entre como segundo participante.
4. Na primeira janela, abra o DevTools, console, e rode `__vbTest()`.
5. Esperado: o segundo participante ouve um tom de 2 s e, depois, volta a ouvir sua voz normal quando você fala. Durante o tom, falar não deve passar.
6. Teste o mudo do Meet na primeira janela: ao mutar, o segundo participante não ouve nada.
7. Anote o resultado no `README.md` (Task 8). Se o Meet rejeitar o microfone (sem áudio, erro no console), **pare**: o resto do plano depende disso.

- [ ] **Step 8: Commit**

```bash
git add build.mjs public src
git commit -m "feat: replace Meet microphone with an injectable audio output and test tone"
```

---

### Task 5: Configurações e página de opções

**Files:**
- Create: `src/shared/settings.ts`
- Modify: `public/options.html`, `src/options/index.ts`
- Test: `tests/shared/settings.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Settings {
  elevenKey: string;
  anthropicKey: string;
  voiceId: string;
  model: string;
  captions: boolean;
}
export const DEFAULTS: Settings;
export function loadSettings(): Promise<Settings>;
export function missingKeys(s: Settings): string[];
```

- [ ] **Step 1: Write the failing test**

`tests/shared/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/settings.test.ts`
Expected: FAIL, import not found

- [ ] **Step 3: Write minimal implementation**

`src/shared/settings.ts`:

```ts
export interface Settings {
  elevenKey: string;
  anthropicKey: string;
  voiceId: string;
  model: string;
  captions: boolean;
}

export const DEFAULTS: Settings = {
  elevenKey: '',
  anthropicKey: '',
  voiceId: '',
  model: 'claude-haiku-4-5-20251001',
  captions: true,
};

const REQUIRED = ['elevenKey', 'anthropicKey', 'voiceId'] as const;

export function missingKeys(s: Settings): string[] {
  return REQUIRED.filter((k) => !s[k].trim());
}

export async function loadSettings(): Promise<Settings> {
  return (await chrome.storage.local.get(DEFAULTS)) as Settings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/settings.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Página de opções**

`public/options.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Voice Bridge</title>
<style>
  body { font: 14px system-ui, sans-serif; max-width: 480px; margin: 32px auto; }
  label { display: block; margin: 12px 0 4px; }
  input[type=text], input[type=password] { width: 100%; padding: 6px; box-sizing: border-box; }
  button { margin-top: 16px; padding: 6px 14px; }
  #status { margin-left: 8px; color: #1a7f37; }
</style>
<h1>Voice Bridge</h1>
<label>Chave ElevenLabs <input id="elevenKey" type="password" /></label>
<label>Chave Anthropic <input id="anthropicKey" type="password" /></label>
<label>ID da voz clonada (inglês) <input id="voiceId" type="text" /></label>
<label>Modelo de tradução <input id="model" type="text" /></label>
<label><input id="captions" type="checkbox" /> Mostrar legenda do inglês no Meet</label>
<button id="save">Salvar</button><span id="status"></span>
<script src="options.js"></script>
```

`src/options/index.ts`:

```ts
import { DEFAULTS, loadSettings, type Settings } from '../shared/settings';

const keys = Object.keys(DEFAULTS) as (keyof Settings)[];
const el = (id: string) => document.getElementById(id) as HTMLInputElement;

void loadSettings().then((s) => {
  for (const k of keys) {
    if (k === 'captions') el(k).checked = s.captions;
    else el(k).value = s[k] as string;
  }
});

el('save').addEventListener('click', async () => {
  const s: Settings = {
    elevenKey: el('elevenKey').value.trim(),
    anthropicKey: el('anthropicKey').value.trim(),
    voiceId: el('voiceId').value.trim(),
    model: el('model').value.trim() || DEFAULTS.model,
    captions: el('captions').checked,
  };
  await chrome.storage.local.set(s);
  const status = document.getElementById('status')!;
  status.textContent = 'Salvo';
  setTimeout(() => (status.textContent = ''), 1500);
});
```

Nota: `el('save')` é um `<button>`; o cast para `HTMLInputElement` só serve para `addEventListener`, que existe em qualquer elemento.

- [ ] **Step 6: Build, typecheck e commit**

Run: `npm run build && npm run typecheck && npx vitest run`
Expected: tudo verde. Abra as opções da extensão no Chrome, salve valores, recarregue a página e confirme que persistem.

```bash
git add src/shared/settings.ts src/options/index.ts public/options.html tests/shared/settings.test.ts
git commit -m "feat: add settings storage and options page"
```

---

### Task 6: Clientes de rede (STT, tradução, TTS)

**Files:**
- Create: `src/offscreen/ports.ts`, `src/offscreen/stt.ts`, `src/offscreen/translate.ts`, `src/offscreen/tts.ts`
- Test: `tests/offscreen/stt.test.ts`, `tests/offscreen/translate.test.ts`, `tests/offscreen/tts.test.ts`

**Interfaces:**
- Consumes: `pcm16ToBase64`, `base64ToPcm16` (Task 3).
- Produces (`ports.ts`):

```ts
export interface Stt {
  connect(): Promise<void>;
  sendAudio(pcm: Int16Array): void;
  onPartial(cb: (text: string) => void): void;
  onCommitted(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
  close(): void;
}
export interface Translator {
  translate(chunk: string, history: string[]): Promise<string>;
}
export interface Tts {
  connect(): Promise<void>;
  speak(text: string): void;
  onAudio(cb: (pcm: Int16Array) => void): void;
  onError(cb: (err: Error) => void): void;
  close(): void;
}
```

- Produces (`stt.ts`): `sttUrl(token: string): string`, `audioMessage(pcm: Int16Array): string`, `parseSttMessage(raw: string): SttMessage`, `fetchScribeToken(apiKey: string, fetchFn?: typeof fetch): Promise<string>`, `class ElevenStt implements Stt` (`constructor(apiKey: string)`).
- Produces (`translate.ts`): `SYSTEM_PROMPT`, `buildUserPrompt(chunk: string, history: string[]): string`, `class ClaudeTranslator implements Translator` (`constructor(cfg: { apiKey: string; model: string; fetchFn?: typeof fetch })`).
- Produces (`tts.ts`): `ttsUrl(voiceId: string): string`, `bosMessage(apiKey: string): string`, `textMessage(text: string): string`, `parseTtsMessage(raw: string): TtsMessage`, `class ElevenTts implements Tts` (`constructor(cfg: { apiKey: string; voiceId: string })`).

Decisão de implementação (desvio da spec, mais simples e igual em atraso): a tradução **não** usa streaming de tokens. Os pedaços têm ~5 palavras e o ElevenLabs TTS só começa a gerar com `flush`, então streamar tokens não adianta. O `ClaudeTranslator` devolve a frase completa e o TTS recebe com `flush: true`.

- [ ] **Step 1: Interfaces**

`src/offscreen/ports.ts`: conteúdo exatamente como em **Interfaces** acima.

- [ ] **Step 2: Write the failing tests**

`tests/offscreen/stt.test.ts`:

```ts
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
```

`tests/offscreen/translate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildUserPrompt, ClaudeTranslator } from '../../src/offscreen/translate';

describe('translator', () => {
  it('builds a prompt with context only when there is history', () => {
    expect(buildUserPrompt('tudo bem', [])).toBe('<fragment>tudo bem</fragment>');
    expect(buildUserPrompt('tudo bem', ['oi', 'pessoal'])).toBe(
      '<context>oi pessoal</context>\n<fragment>tudo bem</fragment>',
    );
  });

  it('calls the messages api with the right headers and trims the answer', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: ' Hello there, ' }] }) };
    }) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    expect(await t.translate('olá pessoal,', ['oi'])).toBe('Hello there,');
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    const h = seen!.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('K');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(seen!.init.body as string);
    expect(body.model).toBe('m1');
    expect(body.messages[0].content).toContain('<fragment>olá pessoal,</fragment>');
  });

  it('returns an empty string when the answer has no text', async () => {
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ content: [] }) })) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    expect(await t.translate('x', [])).toBe('');
  });

  it('throws on http errors', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 529 })) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    await expect(t.translate('x', [])).rejects.toThrow('529');
  });
});
```

`tests/offscreen/tts.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/offscreen`
Expected: FAIL, imports not found

- [ ] **Step 4: Write minimal implementation**

`src/offscreen/stt.ts`:

```ts
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
```

`src/offscreen/translate.ts`:

```ts
import type { Translator } from './ports';

export const SYSTEM_PROMPT =
  'You are a live interpreter for a video call. Translate the Brazilian Portuguese text inside ' +
  '<fragment> into natural, casual spoken English. Output only the English translation, never ' +
  'explanations. The fragment may be an unfinished sentence: translate it as it is, without ' +
  'completing it. Use <context> only to keep names and terms consistent, and never translate it.';

export function buildUserPrompt(chunk: string, history: string[]): string {
  const ctx = history.length ? `<context>${history.join(' ')}</context>\n` : '';
  return `${ctx}<fragment>${chunk}</fragment>`;
}

export class ClaudeTranslator implements Translator {
  constructor(private cfg: { apiKey: string; model: string; fetchFn?: typeof fetch }) {}

  async translate(chunk: string, history: string[]): Promise<string> {
    const f = this.cfg.fetchFn ?? fetch;
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(chunk, history) }],
      }),
    });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    const json = (await res.json()) as { content?: { text?: string }[] };
    return (json.content?.[0]?.text ?? '').trim();
  }
}
```

`src/offscreen/tts.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/offscreen && npm run typecheck`
Expected: PASS e typecheck sem erro

- [ ] **Step 6: Commit**

```bash
git add src/offscreen/ports.ts src/offscreen/stt.ts src/offscreen/translate.ts src/offscreen/tts.ts tests/offscreen
git commit -m "feat: add STT, translation and TTS clients"
```

---

### Task 7: Pipeline

**Files:**
- Create: `src/offscreen/pipeline.ts`
- Test: `tests/offscreen/pipeline.test.ts`

**Interfaces:**
- Consumes: `Chunker` (Task 2); `Stt`, `Translator`, `Tts` (Task 6).
- Produces:

```ts
export interface PipelineOutput {
  audio(pcm: Int16Array): void;
  caption(text: string): void;
  failed(err: Error): void;
}
export class Pipeline {
  constructor(stt: Stt, translator: Translator, tts: Tts, out: PipelineOutput);
  start(): Promise<boolean>;   // true se conectou e continua viva
  feed(pcm: Int16Array): void;
  stop(): void;
  whenIdle(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test**

`tests/offscreen/pipeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/offscreen/pipeline.test.ts`
Expected: FAIL, import not found

- [ ] **Step 3: Write minimal implementation**

`src/offscreen/pipeline.ts`:

```ts
import { Chunker } from '../core/chunker';
import type { Stt, Translator, Tts } from './ports';

export interface PipelineOutput {
  audio(pcm: Int16Array): void;
  caption(text: string): void;
  failed(err: Error): void;
}

const HISTORY_SIZE = 3;

export class Pipeline {
  private chunker = new Chunker();
  private history: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private dead = false;

  constructor(
    private stt: Stt,
    private translator: Translator,
    private tts: Tts,
    private out: PipelineOutput,
  ) {
    stt.onPartial((t) => this.enqueue(this.chunker.push(t)));
    stt.onCommitted((t) => this.enqueue(this.chunker.commit(t)));
    stt.onError((e) => this.fail(e));
    tts.onError((e) => this.fail(e));
    tts.onAudio((p) => {
      if (!this.dead) this.out.audio(p);
    });
  }

  async start(): Promise<boolean> {
    try {
      await Promise.all([this.stt.connect(), this.tts.connect()]);
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
    }
    return !this.dead;
  }

  feed(pcm: Int16Array): void {
    if (!this.dead) this.stt.sendAudio(pcm);
  }

  stop(): void {
    if (this.dead) return;
    this.dead = true;
    this.stt.close();
    this.tts.close();
  }

  whenIdle(): Promise<void> {
    return this.chain;
  }

  private enqueue(chunks: string[]): void {
    for (const chunk of chunks) {
      this.chain = this.chain
        .then(() => this.run(chunk))
        .catch((e) => this.fail(e instanceof Error ? e : new Error(String(e))));
    }
  }

  private async run(chunk: string): Promise<void> {
    if (this.dead) return;
    const en = await this.translator.translate(chunk, this.history.slice(-HISTORY_SIZE));
    this.history.push(chunk);
    if (this.dead || !en) return;
    this.out.caption(en);
    this.tts.speak(en);
  }

  private fail(err: Error): void {
    if (this.dead) return;
    this.stop();
    this.out.failed(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck`
Expected: PASS em toda a suíte

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/pipeline.ts tests/offscreen/pipeline.test.ts
git commit -m "feat: add translation pipeline orchestrator"
```

---

### Task 8: Offscreen, background e ponta a ponta

**Files:**
- Modify: `src/shared/messages.ts`, `src/offscreen/index.ts`, `src/background/index.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `Pipeline` (Task 7); `ElevenStt`, `ClaudeTranslator`, `ElevenTts` (Task 6); `next`, `Status` (Task 1); `loadSettings`, `missingKeys`, `Settings` (Task 5); `base64ToPcm16`, `pcm16ToBase64` (Task 3).
- Produces (`messages.ts`, substitui o arquivo):

```ts
import type { Settings } from './settings';

export type TabMsg =
  | { type: 'mode'; translating: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'caption'; text: string };

export type ToOffscreen =
  | { to: 'offscreen'; type: 'start'; settings: Settings }
  | { to: 'offscreen'; type: 'stop' }
  | { to: 'offscreen'; type: 'mic'; pcm: string };

export type ToBackground =
  | { to: 'background'; type: 'event'; event: 'connecting' | 'connected' | 'error' }
  | { to: 'background'; type: 'forward'; msg: TabMsg };
```

- [ ] **Step 1: Mensagens**

Substituir `src/shared/messages.ts` pelo conteúdo de **Interfaces** acima.

- [ ] **Step 2: Offscreen document**

`src/offscreen/index.ts`:

```ts
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
  if (await p.start() && pipeline === p) send({ to: 'background', type: 'event', event: 'connected' });
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
```

- [ ] **Step 3: Background (service worker)**

`src/background/index.ts`:

```ts
import { next, type StateEvent, type Status } from '../core/state';
import type { TabMsg, ToBackground, ToOffscreen } from '../shared/messages';
import { loadSettings, missingKeys } from '../shared/settings';

const MEET = 'https://meet.google.com/';

interface Saved {
  status: Status;
  tabId?: number;
}

async function getSaved(): Promise<Saved> {
  const { vb } = await chrome.storage.session.get({ vb: { status: 'off' } });
  return vb as Saved;
}

async function setSaved(s: Saved): Promise<void> {
  await chrome.storage.session.set({ vb: s });
}

const BADGE: Record<Status, { text: string; color: string }> = {
  off: { text: '', color: '#888888' },
  connecting: { text: '…', color: '#d29922' },
  translating: { text: 'ON', color: '#1a7f37' },
  failed: { text: '!', color: '#cf222e' },
};

function sendToOffscreen(msg: ToOffscreen): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function sendToTab(tabId: number | undefined, msg: TabMsg): void {
  if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { to: 'tab', ...msg }).catch(() => {});
}

async function apply(event: StateEvent): Promise<Saved> {
  const saved = await getSaved();
  const status = next(saved.status, event);
  const updated = { ...saved, status };
  await setSaved(updated);
  await chrome.action.setBadgeText({ text: BADGE[status].text });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE[status].color });
  if (status !== saved.status) sendToTab(updated.tabId, { type: 'mode', translating: status === 'translating' });
  return updated;
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Keeps the realtime translation connections alive while a call is open.',
  });
}

async function stopAll(): Promise<void> {
  const saved = await getSaved();
  if (saved.status !== 'off') await apply({ type: 'toggle' });
  sendToOffscreen({ to: 'offscreen', type: 'stop' });
}

async function toggle(tab?: chrome.tabs.Tab): Promise<void> {
  const saved = await getSaved();
  if (saved.status !== 'off') {
    await stopAll();
    return;
  }
  if (!tab?.id || !tab.url?.startsWith(MEET)) return;
  const settings = await loadSettings();
  if (missingKeys(settings).length) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  await setSaved({ status: 'off', tabId: tab.id });
  await apply({ type: 'toggle' });
  await ensureOffscreen();
  sendToOffscreen({ to: 'offscreen', type: 'start', settings });
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle') return;
  const t = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  await toggle(t);
});

chrome.runtime.onMessage.addListener((raw: ToBackground) => {
  if (raw?.to !== 'background') return;
  void (async () => {
    if (raw.type === 'event') {
      const map = { connecting: 'retry', connected: 'connected', error: 'error' } as const;
      await apply({ type: map[raw.event] });
    } else if (raw.type === 'forward') {
      sendToTab((await getSaved()).tabId, raw.msg);
    }
  })();
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const saved = await getSaved();
  if (tabId === saved.tabId && info.status === 'loading' && saved.status !== 'off') await stopAll();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const saved = await getSaved();
  if (tabId === saved.tabId && saved.status !== 'off') await stopAll();
});
```

Nota: o estado `connecting` vindo do offscreen mapeia para o evento `retry`, que a máquina aceita em qualquer estado ativo (`failed → connecting`, `connecting → connecting`). Na primeira conexão o estado já é `connecting` (o toggle o colocou lá).

- [ ] **Step 4: Typecheck, testes e build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: tudo verde

- [ ] **Step 5: README com o roteiro manual**

`README.md`:

```markdown
# Voice Bridge

Extensão do Chrome (uso pessoal) que traduz sua fala PT -> EN no Google Meet, com a sua voz do ElevenLabs.

## Instalar

1. `npm install && npm run build`
2. `chrome://extensions` -> Modo do desenvolvedor -> Carregar sem compactação -> pasta `dist/`
3. Abra as opções da extensão e preencha: chave ElevenLabs, chave Anthropic, ID da voz clonada (inglês).

## Usar

Entre numa reunião do Meet e aperte `Alt+T` (ou clique no ícone). Selo verde `ON` = traduzindo. De novo para desligar.

## Roteiro de teste manual

Precisa de duas janelas/perfis na mesma reunião (você e um "participante").

1. Marco 1 (sem APIs): no console do Meet rode `__vbTest()`. O participante ouve um tom de 2 s. Mudo do Meet silencia tudo.
2. Tradução: `Alt+T`, fale em português. O participante ouve inglês na sua voz e a legenda aparece. Meça o atraso (alvo: 1 a 1,5 s).
3. Desligar: `Alt+T` de novo. O participante volta a ouvir você normal, sem corte na chamada.
4. Falha: com a tradução ligada, desligue o wifi. Selo vermelho `!`, o seu microfone real volta a passar. Religue o wifi: volta sozinho para `ON` em ~3 s.
5. Recarregar a aba do Meet com a tradução ligada: a extensão volta para desligada (selo some).
6. Trocar o microfone nas configurações do Meet: o áudio continua saindo e a luz do microfone antigo apaga.
7. Ficar 3+ minutos calado com a tradução ligada e voltar a falar: continua funcionando (keepalive do TTS).
8. Falar uma frase longa sem pausar: o inglês sai aos pedaços, sem esperar a frase acabar.

## Resultado dos testes manuais

(preencher após rodar: data, atraso medido, o que quebrou)
```

- [ ] **Step 6: Verificação manual ponta a ponta**

Rodar o roteiro do `README.md` inteiro. Corrigir o que quebrar com commits separados (`fix: ...`). Em especial conferir: (a) o Scribe aceita `language_code=pt` e `vad_silence_threshold_secs`; (b) áudio do TTS chega alinhado em amostras (sem ruído); (c) o keepalive `{"text":" "}` mantém a conexão; (d) o atraso medido. Preencher a seção de resultados do README.

- [ ] **Step 7: Commit**

```bash
git add src README.md
git commit -m "feat: wire offscreen pipeline and background controller end to end"
```

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

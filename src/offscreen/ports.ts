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

export type TabMsg =
  | { type: 'mode'; translating: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'caption'; text: string };

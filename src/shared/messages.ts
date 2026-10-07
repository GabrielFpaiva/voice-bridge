import type { Settings } from './settings';

export interface Counts {
  mic: number;
  text: number;
  translated: number;
  voice: number;
}

export type TabMsg =
  | { type: 'mode'; translating: boolean }
  | { type: 'audio'; pcm: string }
  | { type: 'caption'; text: string };

export type ToOffscreen =
  | { to: 'offscreen'; type: 'start'; settings: Settings }
  | { to: 'offscreen'; type: 'stop' }
  | { to: 'offscreen'; type: 'mic'; pcm: string };

export type ToBackground =
  | { to: 'background'; type: 'toggle'; tab?: { id: number; url?: string } }
  | { to: 'background'; type: 'reset' }
  | { to: 'background'; type: 'event'; event: 'connecting' | 'connected' | 'error'; detail?: string }
  | { to: 'background'; type: 'forward'; msg: TabMsg }
  | { to: 'background'; type: 'stats'; counts: Counts };

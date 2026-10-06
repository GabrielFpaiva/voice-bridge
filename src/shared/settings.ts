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

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

export const MODELS = [{ id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }] as const;

export function resolveModel(id: string): string {
  return MODELS.some((m) => m.id === id) ? id : DEFAULTS.model;
}

const REQUIRED = ['elevenKey', 'anthropicKey', 'voiceId'] as const;

export function missingKeys(s: Settings): string[] {
  return REQUIRED.filter((k) => !s[k].trim());
}

export async function loadSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get(DEFAULTS)) as Settings;
  return { ...s, model: resolveModel(s.model) };
}

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

import type { Status } from '../core/state';
import type { ToBackground } from '../shared/messages';
import { DEFAULTS, loadSettings, MODELS, missingKeys, resolveModel, type Settings } from '../shared/settings';
import { describeStatus, resetsAfterEdit, savedLabel } from './view';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const byte = el<HTMLButtonElement>('byte');
const MEET = 'https://meet.google.com/';

let settings: Settings = DEFAULTS;
let status: Status = 'off';
let detail: string | undefined;
let meetTab: chrome.tabs.Tab | undefined;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

function render(): void {
  const v = describeStatus(status, !!meetTab, missingKeys(settings), detail);
  byte.dataset.status = status;
  byte.disabled = !v.canToggle;
  byte.setAttribute('aria-label', status === 'off' ? 'Ligar tradução' : 'Desligar tradução');
  el('status').textContent = v.label;
  el('hint').textContent = v.hint;
}

async function readStatus(): Promise<void> {
  const { vb } = await chrome.storage.session.get({ vb: { status: 'off' } });
  ({ status, detail } = vb as { status: Status; detail?: string });
}

function readForm(): Settings {
  return {
    elevenKey: el<HTMLInputElement>('elevenKey').value.trim(),
    anthropicKey: el<HTMLInputElement>('anthropicKey').value.trim(),
    voiceId: el<HTMLInputElement>('voiceId').value.trim(),
    model: resolveModel(el<HTMLSelectElement>('model').value),
    captions: el<HTMLInputElement>('captions').checked,
  };
}

function fillForm(s: Settings): void {
  el<HTMLInputElement>('elevenKey').value = s.elevenKey;
  el<HTMLInputElement>('anthropicKey').value = s.anthropicKey;
  el<HTMLInputElement>('voiceId').value = s.voiceId;
  el<HTMLSelectElement>('model').value = s.model;
  el<HTMLInputElement>('captions').checked = s.captions;
}

function sendToggle(): void {
  const tab = meetTab?.id === undefined ? undefined : { id: meetTab.id, url: meetTab.url };
  const msg: ToBackground = { to: 'background', type: 'toggle', tab };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function saveForm(): Promise<void> {
  settings = readForm();
  await chrome.storage.local.set(settings);
}

byte.addEventListener('click', async () => {
  await saveForm();
  sendToggle();
});

// Save on every edit: the popup can close (click outside) before a 'change' event ever fires.
let editTimer: ReturnType<typeof setTimeout> | undefined;
function onEdit(): void {
  clearTimeout(editTimer);
  editTimer = setTimeout(async () => {
    await saveForm();
    if (resetsAfterEdit(status)) {
      const msg: ToBackground = { to: 'background', type: 'reset' };
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
    el('saved').textContent = savedLabel(settings.elevenKey);
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (el('saved').textContent = ''), 2500);
    render();
  }, 150);
}
el('form').addEventListener('input', onEdit);
el('form').addEventListener('change', onEdit);

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'session') return;
  await readStatus();
  render();
});

function fillModels(): void {
  const select = el<HTMLSelectElement>('model');
  for (const m of MODELS) select.add(new Option(m.label, m.id));
}

async function init(): Promise<void> {
  fillModels();
  [settings] = await Promise.all([loadSettings(), readStatus()]);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  meetTab = tab?.url?.startsWith(MEET) ? tab : undefined;
  fillForm(settings);
  render();
}

void init();

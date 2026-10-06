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

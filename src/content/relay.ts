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

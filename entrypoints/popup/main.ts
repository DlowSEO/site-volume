import { browser } from 'wxt/browser';
import {
  DEFAULT_LEVEL, gainToPos, getSettings, getSiteLevel, hostOf, originsFor, pct, posToGain, siteKey,
  type EngineStatus, type Level, type Msg, type Settings,
} from '@/utils/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ICON_ON = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>';

let tabId = -1;
let host: string | null = null;
let level: Level = { ...DEFAULT_LEVEL };
let settings: Settings;
let remember = false;

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? -1;
  host = hostOf(tab?.url);
  settings = await getSettings();

  if (!host || tabId < 0) return showUnsupported();
  $('host').textContent = host;
  $('rememberHost').textContent = host;
  if (tab?.favIconUrl) ($('favicon') as HTMLImageElement).src = tab.favIconUrl;

  remember = await browser.permissions.contains({ origins: originsFor(host) });
  const res = (await browser.runtime.sendMessage({ type: 'popup:state', tabId } satisfies Msg)) as
    | { level: Level; status: EngineStatus | null }
    | undefined;
  if (!res || res.status === null) return showUnsupported();
  level = res.level;

  buildPresets();
  render();
  renderNotice(res.status);
  bind();
  void renderOthers();
}

function showUnsupported() {
  $('controls').hidden = true;
  $('unsupported').hidden = false;
  void renderOthers();
}

// ---------- Rendering ----------
function render() {
  const max = settings.maxBoost;
  const slider = $<HTMLInputElement>('slider');
  slider.value = String(Math.round(gainToPos(Math.min(level.v, max), max)));
  slider.classList.toggle('boost', level.v > 1 && !level.m);
  const out = $('value');
  out.textContent = level.m ? 'Muted' : `${pct(level.v)}%`;
  out.className = level.m ? 'muted' : level.v > 1 ? 'boost' : '';
  $('mute').innerHTML = level.m ? ICON_OFF : ICON_ON;
  $('mute').setAttribute('aria-pressed', String(level.m));
  $('maxLabel').textContent = `${pct(max)}%`;
  $<HTMLInputElement>('remember').checked = remember;
  $('rememberHint').textContent = remember
    ? 'Saved. Applies automatically every time you visit.'
    : 'Off: this setting lasts until you close the tab.';
  $('unlock').hidden = settings.maxBoost >= 6;
  document.querySelectorAll<HTMLButtonElement>('#presets button').forEach((b) => {
    const p = Number(b.dataset.v);
    b.setAttribute('aria-pressed', String(!level.m && pct(level.v) === p));
  });
}

function renderNotice(s: EngineStatus | null) {
  const n = $('notice');
  let text = '';
  if (s) {
    if (s.needsGesture && (level.v > 1 || level.m)) text = 'Click anywhere on the page once to switch boost on (Chrome blocks audio changes until you interact with a page).';
    else if (s.fallback > 0 && level.v > 1) text = "This site's audio can't be boosted past 100% (protected or third-party stream). Lowering the volume still works.";
    else if (s.media === 0) text = 'No sound playing here yet. Your setting applies as soon as it starts.';
  }
  n.textContent = text;
  n.hidden = !text;
}

function buildPresets() {
  const wrap = $('presets');
  wrap.innerHTML = '';
  const vals = settings.maxBoost >= 6 ? [50, 100, 200, 400] : [50, 100, 150, 200];
  for (const v of vals) {
    const b = document.createElement('button');
    b.textContent = `${v}%`;
    b.dataset.v = String(v);
    b.onclick = () => set({ v: v / 100, m: false });
    wrap.append(b);
  }
}

// ---------- Actions ----------
let pending: Level | null = null;
let inflight = false;
async function set(next: Level) {
  level = next;
  render();
  pending = next;
  if (inflight) return; // coalesce rapid slider moves
  inflight = true;
  while (pending) {
    const l = pending;
    pending = null;
    await browser.runtime.sendMessage({ type: 'popup:set', tabId, level: l, remember } satisfies Msg);
  }
  inflight = false;
  setTimeout(refreshStatus, 500);
}

async function refreshStatus() {
  try {
    const s = (await browser.tabs.sendMessage(tabId, { type: 'engine:status' } satisfies Msg)) as EngineStatus;
    renderNotice(s);
  } catch { /* ignore */ }
}

function bind() {
  const slider = $<HTMLInputElement>('slider');
  slider.addEventListener('input', () => {
    let v = posToGain(Number(slider.value), settings.maxBoost);
    // Gentle snap to 100% so it's easy to get back to normal.
    if (Math.abs(v - 1) < 0.03) v = 1;
    set({ v: Math.round(v * 100) / 100, m: false });
  });

  // Mouse wheel anywhere in the popup: 2% steps, Shift for 10%.
  document.addEventListener('wheel', (e) => {
    if ((e.target as HTMLElement).closest('#otherList')) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.1 : 0.02) * (e.deltaY > 0 || e.deltaX > 0 ? -1 : 1);
    const v = Math.min(settings.maxBoost, Math.max(0, Math.round((level.v + step) * 100) / 100));
    set({ v, m: false });
  }, { passive: false });

  $('mute').onclick = () => set({ ...level, m: !level.m });

  $<HTMLInputElement>('remember').addEventListener('change', async (e) => {
    const box = e.target as HTMLInputElement;
    if (!host) return;
    const origins = originsFor(host);
    if (box.checked) {
      // The permission prompt can close the popup, so leave a note for the background to finish the job.
      await browser.storage.session.set({ pendingRemember: { host, level } });
      const granted = await browser.permissions.request({ origins });
      remember = granted;
      if (granted) await browser.runtime.sendMessage({ type: 'popup:set', tabId, level, remember: true } satisfies Msg);
    } else {
      remember = false;
      await browser.storage.sync.remove(siteKey(host));
      await browser.permissions.remove({ origins });
    }
    render();
  });

  $('unlock').onclick = () => { $('unlockWarn').hidden = false; $('unlock').hidden = true; };
  $('unlockNo').onclick = () => { $('unlockWarn').hidden = true; render(); };
  $('unlockYes').onclick = async () => {
    settings = { ...settings, maxBoost: 6 };
    await browser.storage.sync.set({ settings });
    $('unlockWarn').hidden = true;
    buildPresets();
    render();
  };
}

// ---------- Other tabs playing sound ----------
async function renderOthers() {
  const tabs = (await browser.tabs.query({ audible: true })).filter((t) => t.id !== tabId);
  const muted = (await browser.tabs.query({ muted: true })).filter((t) => t.id !== tabId && !tabs.some((a) => a.id === t.id));
  const all = [...tabs, ...muted];
  const list = $('otherList');
  list.innerHTML = '';
  $('others').hidden = all.length === 0;
  for (const t of all) {
    if (t.id == null) continue;
    const id = t.id;
    const li = document.createElement('li');
    const h = hostOf(t.url); // only known for sites the user has allowed
    const muteBtn = document.createElement('button');
    muteBtn.className = 'icon';
    muteBtn.style.cssText = 'width:16px;height:16px;border:0;background:none';
    muteBtn.innerHTML = t.mutedInfo?.muted ? ICON_OFF : ICON_ON;
    muteBtn.title = t.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab';
    muteBtn.onclick = async () => {
      await browser.tabs.update(id, { muted: !t.mutedInfo?.muted });
      void renderOthers();
    };
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || h || 'Tab playing sound';
    title.title = 'Go to tab';
    title.onclick = () => {
      void browser.tabs.update(id, { active: true });
      if (t.windowId != null) void browser.windows.update(t.windowId, { focused: true });
    };
    const pctEl = document.createElement('span');
    pctEl.className = 'pct';
    li.append(muteBtn, title, pctEl);

    if (h) {
      const saved = (await getSiteLevel(h)) ?? DEFAULT_LEVEL;
      pctEl.textContent = saved.m ? 'Muted' : `${pct(saved.v)}%`;
      const s = document.createElement('input');
      s.type = 'range'; s.min = '0'; s.max = '1000';
      s.value = String(Math.round(gainToPos(Math.min(saved.v, settings.maxBoost), settings.maxBoost)));
      s.oninput = () => {
        const v = Math.round(posToGain(Number(s.value), settings.maxBoost) * 100) / 100;
        pctEl.textContent = `${pct(v)}%`;
        void browser.runtime.sendMessage({ type: 'popup:set', tabId: id, level: { v, m: false }, remember: true } satisfies Msg);
      };
      li.append(s);
    }
    list.append(li);
  }
}

void init();

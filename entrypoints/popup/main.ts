import { browser } from 'wxt/browser';
import {
  ALL_SITES, CAN_FORCE, DEFAULT_LEVEL, gainToPos, getSettings, getSiteLevel, getTabLevel, hostOf,
  originsFor, pct, posToGain, tabKey, type EngineStatus, type Level, type Msg, type Settings, type TabLevel,
} from '@/utils/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PATH_ON = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z';
const PATH_OFF = 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z';
/** Speaker icon built with DOM APIs (store linters reject HTML strings). */
function icon(muted: boolean): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', muted ? PATH_OFF : PATH_ON);
  svg.append(path);
  return svg;
}

let tabId = -1;
let host: string | null = null;
let level: Level = { ...DEFAULT_LEVEL };
let settings: Settings;
let remember = false;
let lastStatus: EngineStatus | null = null;

async function isRemembered(h: string) {
  return !!(await getSiteLevel(h)) && (await browser.permissions.contains({ origins: originsFor(h) }));
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? -1;
  host = hostOf(tab?.url);
  settings = await getSettings();

  if (!host || tabId < 0) return showUnsupported();
  $('host').textContent = host;
  $('rememberHost').textContent = host;
  if (tab?.favIconUrl) ($('favicon') as HTMLImageElement).src = tab.favIconUrl;
  $('forceRow').hidden = !CAN_FORCE;

  remember = await isRemembered(host);
  const res = (await browser.runtime.sendMessage({ type: 'popup:state', tabId } satisfies Msg)) as
    | { level: Level; status: EngineStatus | null }
    | undefined;
  if (!res || res.status === null) return showUnsupported();
  level = res.level;

  buildPresets();
  render();
  // Show the user's actual mute shortcut (it differs on Mac and can be changed).
  void browser.commands.getAll().then((cmds) => {
    const k = cmds.find((c) => c.name === 'toggle-mute')?.shortcut;
    $('mute').title = k ? `Mute (${k})` : 'Mute';
  });
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
  $('mute').replaceChildren(icon(level.m));
  $('mute').setAttribute('aria-pressed', String(level.m));
  $('maxLabel').textContent = `${pct(max)}%`;
  $<HTMLInputElement>('remember').checked = remember;
  $<HTMLInputElement>('even').checked = !!level.c;
  $<HTMLInputElement>('force').checked = !!level.f;
  $('forceHint').hidden = !level.f;
  $('rememberHint').textContent = remember
    ? 'Saved. Applies automatically every time you visit.'
    : 'Off: applies to this tab only, while you stay on this site.';
  $('unlock').hidden = settings.maxBoost >= 6 || !$('unlockWarn').hidden;
  document.querySelectorAll<HTMLButtonElement>('#presets button').forEach((b) => {
    b.setAttribute('aria-pressed', String(!level.m && pct(level.v) === Number(b.dataset.v)));
  });
}

function renderNotice(s: EngineStatus | null) {
  lastStatus = s;
  const n = $('notice');
  const action = $<HTMLButtonElement>('noticeAction');
  let text = '';
  action.hidden = true;
  if (s) {
    if (s.forced) text = 'Force boost is on for this tab.';
    else if (level.f && s.forced === false) text = "Force boost couldn't start on this tab. Reopen this popup to try again.";
    else if (s.needsGesture && !level.m && (level.v > 1 || level.c))
      text = 'Click anywhere on the page once to switch boost on (Chrome blocks audio changes until you interact with a page).';
    else if (s.fallback > 0 && (level.v > 1 || level.c)) {
      text = s.routed > 0
        ? "Some audio on this page (embedded or protected media) can't be boosted the normal way."
        : "This site's audio can't be boosted the normal way (protected or third-party stream). Lowering the volume still works.";
      if (CAN_FORCE) {
        action.textContent = 'Use Force boost';
        action.hidden = false;
        action.onclick = () => void toggleForce(true);
      }
    } else if (s.media === 0 && !level.f) text = 'No sound playing here yet. Your setting applies as soon as it starts.';
  }
  $('noticeText').textContent = text;
  n.hidden = !text;
}

function buildPresets() {
  const wrap = $('presets');
  wrap.replaceChildren();
  const vals = settings.maxBoost >= 6 ? [50, 100, 200, 400] : [50, 100, 150, 200];
  for (const v of vals) {
    const b = document.createElement('button');
    b.textContent = `${v}%`;
    b.dataset.v = String(v);
    b.onclick = () => set({ ...level, v: v / 100, m: false });
    wrap.append(b);
  }
}

// ---------- Actions ----------
async function toggleForce(on: boolean) {
  if (on) {
    // Request straight from the click (no awaits before it, or Chrome drops the user gesture).
    // Already granted → resolves true with no prompt. If the prompt closes the popup,
    // the note below means reopening the popup starts Force boost.
    void browser.storage.session.set({ [tabKey(tabId)]: { level: { ...level, f: true }, host } satisfies TabLevel });
    if (!(await browser.permissions.request({ permissions: ['tabCapture'] }))) {
      await browser.storage.session.set({ [tabKey(tabId)]: { level, host } satisfies TabLevel });
      render();
      return;
    }
  }
  await set({ ...level, f: on });
}

let pending: Level | null = null;
let inflight = false;
async function set(next: Level) {
  level = next;
  render();
  pending = next;
  if (inflight) return; // coalesce rapid slider moves
  inflight = true;
  let st: EngineStatus | null = null;
  try {
    while (pending) {
      const l = pending;
      pending = null;
      st = (await browser.runtime.sendMessage({ type: 'popup:set', tabId, level: l, remember } satisfies Msg)) as EngineStatus | null;
    }
  } catch {
    st = null; // background restarted mid-message; the next change retries
  } finally {
    inflight = false;
  }
  if (st) renderNotice(st);
  setTimeout(refreshStatus, 600);
}

async function refreshStatus() {
  if (lastStatus?.forced) return;
  try {
    const s = (await browser.tabs.sendMessage(tabId, { type: 'engine:status' } satisfies Msg)) as EngineStatus;
    renderNotice({ ...s, forced: level.f ? lastStatus?.forced : undefined });
  } catch { /* ignore */ }
}

function bind() {
  const slider = $<HTMLInputElement>('slider');
  // Arrow keys work as soon as the popup opens.
  slider.focus();
  // The native range has 1000 tiny steps; make the keyboard move in useful ones instead.
  slider.addEventListener('keydown', (e) => {
    const small = e.shiftKey ? 0.1 : 0.02;
    const max = settings.maxBoost;
    let v: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = level.v + small;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = level.v - small;
    else if (e.key === 'PageUp') v = level.v + 0.1;
    else if (e.key === 'PageDown') v = level.v - 0.1;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = max;
    if (v === null) return;
    e.preventDefault();
    set({ ...level, v: Math.min(max, Math.max(0, Math.round(v * 100) / 100)), m: false });
  });
  slider.addEventListener('input', () => {
    let v = posToGain(Number(slider.value), settings.maxBoost);
    if (Math.abs(v - 1) < 0.03) v = 1; // gentle snap to 100%
    set({ ...level, v: Math.round(v * 100) / 100, m: false });
  });

  // Mouse wheel anywhere in the popup: 2% steps, Shift for 10%.
  // Trackpads send dozens of tiny wheel events per swipe, so step once per ~one wheel notch of movement.
  let wheelAcc = 0;
  let wheelIdle: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('wheel', (e) => {
    if ((e.target as Element | null)?.closest?.('#otherList')) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1; // lines / pages → px
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
    wheelAcc += d;
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => (wheelAcc = 0), 200);
    if (Math.abs(wheelAcc) < 50) return;
    const step = (e.shiftKey ? 0.1 : 0.02) * (wheelAcc > 0 ? -1 : 1);
    wheelAcc = 0;
    const v = Math.min(settings.maxBoost, Math.max(0, Math.round((level.v + step) * 100) / 100));
    set({ ...level, v, m: false });
  }, { passive: false });

  $('mute').onclick = () => set({ ...level, m: !level.m });
  $<HTMLInputElement>('even').onchange = (e) => set({ ...level, c: (e.target as HTMLInputElement).checked });
  $<HTMLInputElement>('force').onchange = (e) => void toggleForce((e.target as HTMLInputElement).checked);

  $<HTMLInputElement>('remember').addEventListener('change', async (e) => {
    const box = e.target as HTMLInputElement;
    if (!host) return;
    const origins = originsFor(host);
    if (box.checked) {
      // Request straight from the click (no awaits before it, or Chrome drops the user gesture).
      // The permission prompt can close the popup, so leave a note for the background to finish.
      void browser.storage.session.set({ pendingRemember: { host, level } });
      remember = await browser.permissions.request({ origins });
      if (remember) await browser.runtime.sendMessage({ type: 'popup:set', tabId, level, remember: true } satisfies Msg);
      void browser.storage.session.remove('pendingRemember');
    } else {
      remember = false;
      await browser.runtime.sendMessage({ type: 'popup:forget', tabId } satisfies Msg);
      // Drop the site's own permission (does nothing if "all sites" was granted).
      await browser.permissions.remove({ origins }).catch(() => {});
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

  $('allowAllNo').onclick = () => { $('allowAll').hidden = true; };
  $('allowAllYes').onclick = async () => {
    const ok = await browser.permissions.request({ origins: ALL_SITES });
    $('allowAll').hidden = true;
    if (ok) setTimeout(() => void renderOthers(), 300);
  };
}

// ---------- Other tabs playing sound ----------
async function renderOthers() {
  const audible = (await browser.tabs.query({ audible: true })).filter((t) => t.id !== tabId);
  const muted = (await browser.tabs.query({ muted: true })).filter((t) => t.id !== tabId && !audible.some((a) => a.id === t.id));
  const all = [...audible, ...muted];
  const list = $('otherList');
  list.replaceChildren();
  $('others').hidden = all.length === 0;
  for (const t of all) {
    if (t.id == null) continue;
    const id = t.id;
    const li = document.createElement('li');
    const h = hostOf(t.url); // only visible for sites we have access to
    const muteBtn = document.createElement('button');
    muteBtn.className = 'icon';
    muteBtn.style.cssText = 'width:16px;height:16px;border:0;background:none';
    muteBtn.replaceChildren(icon(!!t.mutedInfo?.muted));
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
    li.append(muteBtn, title);

    if (h) {
      const saved = await getSiteLevel(h);
      const rem = !!saved;
      let cur: Level = (await getTabLevel(id, h)) ?? saved ?? DEFAULT_LEVEL;
      const pctEl = document.createElement('span');
      pctEl.className = 'pct';
      pctEl.textContent = cur.m ? 'Muted' : `${pct(cur.v)}%`;
      const s = document.createElement('input');
      s.type = 'range'; s.min = '0'; s.max = '1000';
      s.setAttribute('aria-label', `Volume for ${t.title ?? h}`);
      s.value = String(Math.round(gainToPos(Math.min(cur.v, settings.maxBoost), settings.maxBoost)));
      s.oninput = () => {
        let v = posToGain(Number(s.value), settings.maxBoost);
        if (Math.abs(v - 1) < 0.03) v = 1;
        cur = { ...cur, v: Math.round(v * 100) / 100, m: false };
        pctEl.textContent = `${pct(cur.v)}%`;
        sendOther();
      };
      // Coalesce rapid moves: one message in flight per tab, the latest value always sent.
      let busy = false, again = false;
      const sendOther = async () => {
        if (busy) { again = true; return; }
        busy = true;
        do {
          again = false;
          await browser.runtime.sendMessage({ type: 'popup:set', tabId: id, level: cur, remember: rem } satisfies Msg).catch(() => {});
        } while (again);
        busy = false;
      };
      li.append(pctEl, s);
    } else {
      const allow = document.createElement('button');
      allow.className = 'allow';
      allow.textContent = 'Allow';
      allow.title = 'Control this tab from here';
      allow.onclick = () => { $('allowAll').hidden = false; };
      li.append(allow);
    }
    list.append(li);
  }
}

// ---------- Review prompt ----------
// Store ratings drive installs. Ask once, politely, only after someone has clearly found it useful.
const REVIEW_URL = import.meta.env.FIREFOX
  ? 'https://addons.mozilla.org/firefox/addon/site-volume/reviews/'
  : import.meta.env.EDGE
    ? `https://microsoftedge.microsoft.com/addons/detail/${browser.runtime.id}`
    : `https://chromewebstore.google.com/detail/${browser.runtime.id}/reviews`;

interface Usage { opens: number; first: number; done?: boolean }
async function maybeAskForReview() {
  const { usage } = (await browser.storage.local.get('usage')) as { usage?: Usage };
  const u: Usage = usage ?? { opens: 0, first: Date.now() };
  u.opens++;
  await browser.storage.local.set({ usage: u });
  const days = (Date.now() - u.first) / 86_400_000;
  if (u.done || u.opens < 12 || days < 3) return;
  const box = $('review');
  box.hidden = false;
  const finish = () => {
    box.hidden = true;
    void browser.storage.local.set({ usage: { ...u, done: true } });
  };
  $<HTMLAnchorElement>('reviewLink').href = REVIEW_URL;
  $('reviewLink').onclick = finish;
  $('reviewNo').onclick = finish;
}

void init();
void maybeAskForReview();

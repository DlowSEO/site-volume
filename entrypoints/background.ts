import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  ABSOLUTE_MAX, CAN_FORCE, DEFAULT_LEVEL, badgeText, clamp, dynMode, getSettings, getSiteLevel,
  getTabLevel, hostOf, originsFor, siteKey, tabKey, type DynMode, type EngineGlobals, type EngineStatus, type Level,
  type Msg, type TabLevel,
} from '@/utils/shared';

const ENGINE_ID = 'site-volume-engine';
const ENGINE_FILE = '/content-scripts/engine.js' as const;
const HELPER_ID = 'site-volume-main-world';
const HELPER_FILE = '/content-scripts/main-world.js' as const;
const NEUTRAL: Level = { v: 1, m: false };

export default defineBackground(() => {
  // ---------- Content script registration follows the sites the user has allowed ----------
  async function syncRegistration() {
    const { origins = [] } = await browser.permissions.getAll();
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [ENGINE_ID, HELPER_ID] });
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    if (!origins.length) return;
    await browser.scripting.registerContentScripts([
      {
        id: ENGINE_ID,
        js: [ENGINE_FILE],
        matches: origins,
        allFrames: true,
        runAt: 'document_start',
        // Firefox doesn't persist registrations; we re-register on every startup anyway.
        persistAcrossSessions: !import.meta.env.FIREFOX,
      },
    ]);
    // Optional extra: catches `new Audio().play()` that never joins the page. Registered separately
    // so a browser without main-world support still gets the engine.
    await browser.scripting
      .registerContentScripts([
        {
          id: HELPER_ID,
          js: [HELPER_FILE],
          matches: origins,
          allFrames: true,
          runAt: 'document_start',
          world: 'MAIN',
          persistAcrossSessions: !import.meta.env.FIREFOX,
        },
      ])
      .catch(() => {});
  }
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void syncRegistration();
    // First install only: show how to pin the icon and get started.
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  });
  browser.runtime.onStartup.addListener(() => void syncRegistration());
  browser.permissions.onAdded.addListener(async (p) => {
    await syncRegistration();
    // Finish a "Remember" the popup started (the permission prompt may have closed the popup).
    const { pendingRemember } = await browser.storage.session.get('pendingRemember');
    if (pendingRemember) {
      const { host, level } = pendingRemember as { host: string; level: Level };
      if (await browser.permissions.contains({ origins: originsFor(host) })) saveSite(host, level);
      await browser.storage.session.remove('pendingRemember');
    }
    // Inject straight away into already-open tabs of the newly allowed site(s).
    for (const pattern of p.origins ?? []) {
      const tabs = await browser.tabs.query({ url: pattern });
      for (const t of tabs) if (t.id != null) await inject(t.id);
    }
  });
  browser.permissions.onRemoved.addListener(() => void syncRegistration());

  // ---------- Per-tab state (session storage survives service-worker restarts) ----------
  async function setTabLevel(tabId: number, l: Level, host: string | null) {
    await browser.storage.session.set({ [tabKey(tabId)]: { level: l, host } satisfies TabLevel });
  }

  // ---------- Saved site levels (chrome.storage.sync allows ~120 writes a minute) ----------
  // Dragging the slider with Remember on would hit that limit within seconds and make every later
  // change fail, so writes are throttled to one per second per site; the last value always lands.
  const pendingSaves = new Map<string, { level: Level; timer?: ReturnType<typeof setTimeout>; last: number }>();
  function saveSite(host: string, level: Level) {
    const p = pendingSaves.get(host) ?? { level, last: 0 };
    p.level = level;
    pendingSaves.set(host, p);
    if (p.timer) return;
    const flush = () => {
      p.timer = undefined;
      p.last = Date.now();
      const item = { [siteKey(host)]: p.level };
      // Sync storage full (about 500 sites)? Keep it on this computer instead.
      browser.storage.sync.set(item).then(
        () => browser.storage.local.remove(siteKey(host)),
        () => browser.storage.local.set(item),
      ).catch(() => {});
    };
    const wait = 1000 - (Date.now() - p.last);
    if (wait <= 0) flush();
    else p.timer = setTimeout(flush, wait);
  }
  async function forgetSite(host: string) {
    const p = pendingSaves.get(host);
    if (p?.timer) clearTimeout(p.timer);
    pendingSaves.delete(host);
    await browser.storage.sync.remove(siteKey(host)).catch(() => {});
    await browser.storage.local.remove(siteKey(host)).catch(() => {});
  }
  browser.tabs.onRemoved.addListener((id) => {
    void stopCapture(id);
    void browser.storage.session.remove([tabKey(id), `cap:${id}`]);
  });

  async function levelFor(tabId: number, url?: string): Promise<Level> {
    // This tab's latest level on this site wins (it's always current; the synced copy is throttled).
    const host = hostOf(url);
    return (await getTabLevel(tabId, host)) ?? (host ? await getSiteLevel(host) : null) ?? DEFAULT_LEVEL;
  }

  async function setBadge(tabId: number, l: Level, forced = false) {
    const color = l.m ? '#6b7280' : forced ? '#7c3aed' : l.v > 1 ? '#c2410c' : '#2563eb';
    await browser.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
    await browser.action.setBadgeText({ tabId, text: badgeText(l) }).catch(() => {});
  }

  async function inject(tabId: number) {
    try {
      await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: [ENGINE_FILE] });
      // Late injection: only media played after this point is caught, which is fine for new Audio().
      await browser.scripting
        .executeScript({ target: { tabId, allFrames: true }, files: [HELPER_FILE], world: 'MAIN' })
        .catch(() => {});
      return true;
    } catch {
      return false; // chrome:// pages, Web Store, no access
    }
  }

  /** Adds up what each frame's engine reported; null when no frame has the engine. */
  function total(frames: { result?: unknown }[]): EngineStatus | null {
    let sum: EngineStatus | null = null;
    for (const f of frames) {
      const s = f.result as EngineStatus | null | undefined;
      if (!s) continue;
      sum = sum
        ? { media: sum.media + s.media, routed: sum.routed + s.routed, fallback: sum.fallback + s.fallback,
            needsGesture: sum.needsGesture || s.needsGesture }
        : { ...s };
    }
    return sum;
  }

  /** Applies a level in every frame we can reach and returns the whole page's status. */
  async function sendEngine(tabId: number, level: Level, mode: DynMode) {
    const run = () =>
      browser.scripting
        .executeScript({
          target: { tabId, allFrames: true },
          func: (l: Level, m: DynMode) => (window as unknown as EngineGlobals).__siteVolumeApply?.(l, m) ?? null,
          args: [level, mode],
        })
        .then(total, () => null);
    // No engine yet (activeTab-only site): inject it, then try again.
    return (await run()) ?? ((await inject(tabId)) ? run() : null);
  }

  async function frameStatus(tabId: number) {
    return browser.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: () => (window as unknown as EngineGlobals).__siteVolumeStatus?.() ?? null,
      })
      .then(total, () => null);
  }

  // ---------- Force boost (tab capture, Chromium only) ----------
  const isCapturing = async (tabId: number) =>
    !!(await browser.storage.session.get(`cap:${tabId}`))[`cap:${tabId}`];

  async function ensureOffscreen() {
    if (await browser.offscreen.hasDocument()) return;
    await browser.offscreen.createDocument({
      url: '/offscreen.html',
      reasons: ['USER_MEDIA' as Browser.offscreen.Reason],
      justification: 'Plays tab audio back with a volume boost when the user turns on Force boost.',
    });
  }

  async function startCapture(tabId: number, level: Level, mode: ReturnType<typeof dynMode>) {
    try {
      // Only allowed right after the user invokes the extension on this tab (popup / shortcut).
      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
      await ensureOffscreen();
      const r = (await browser.runtime.sendMessage({
        type: 'offscreen:start', tabId, streamId, level, mode,
      } satisfies Msg)) as { ok: boolean } | undefined;
      if (!r?.ok) return false;
      await browser.storage.session.set({ [`cap:${tabId}`]: true });
      return true;
    } catch {
      return false;
    }
  }

  async function stopCapture(tabId: number) {
    if (!CAN_FORCE || !(await isCapturing(tabId))) return;
    await browser.runtime.sendMessage({ type: 'offscreen:stop', tabId } satisfies Msg).catch(() => {});
    await browser.storage.session.remove(`cap:${tabId}`);
    // Close the offscreen document when nothing is being captured.
    const left = (await browser.runtime.sendMessage({ type: 'offscreen:list' } satisfies Msg).catch(() => [])) as number[];
    if (!left?.length && (await browser.offscreen.hasDocument())) await browser.offscreen.closeDocument();
  }

  // ---------- Apply a level to a tab ----------
  async function applyToTab(tabId: number, level: Level): Promise<EngineStatus | null> {
    const settings = await getSettings();
    const mode = dynMode(level, settings);

    if (CAN_FORCE && level.f) {
      let capturing = await isCapturing(tabId);
      if (capturing) {
        const r = (await browser.runtime
          .sendMessage({ type: 'offscreen:apply', tabId, level, mode } satisfies Msg)
          .catch(() => null)) as { ok: boolean } | null;
        capturing = !!r?.ok;
        if (!capturing) await browser.storage.session.remove(`cap:${tabId}`);
      }
      if (!capturing) capturing = await startCapture(tabId, level, mode);
      if (capturing) {
        await setBadge(tabId, level, true);
        const st = await sendEngine(tabId, NEUTRAL, 'off'); // page untouched; capture does the work
        return { ...(st ?? { media: 0, routed: 0, fallback: 0, needsGesture: false }), forced: true };
      }
      // Couldn't start (needs the user to open the popup on this tab) → normal engine meanwhile.
    } else if (CAN_FORCE) {
      await stopCapture(tabId);
    }

    await setBadge(tabId, level);
    const st = await sendEngine(tabId, level, mode);
    return st && CAN_FORCE && level.f ? { ...st, forced: false } : st;
  }

  async function setLevel(tabId: number, level: Level, remember: boolean) {
    const { maxBoost } = await getSettings();
    level = { ...level, v: clamp(level.v, 0, Math.min(maxBoost, ABSOLUTE_MAX)) };
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const host = hostOf(tab?.url);
    await setTabLevel(tabId, level, host);
    if (remember && host) {
      saveSite(host, level);
      // Every open tab of this site follows.
      const tabs = await browser.tabs.query({ url: originsFor(host) }).catch(() => []);
      for (const t of tabs)
        if (t.id != null && t.id !== tabId) {
          const id = t.id;
          void setTabLevel(id, level, host).then(() => applyToTab(id, level));
        }
    }
    return applyToTab(tabId, level);
  }

  // ---------- Messages ----------
  browser.runtime.onMessage.addListener((raw: unknown, sender: Browser.runtime.MessageSender, sendResponse) => {
    const msg = raw as Msg;
    const tabId = sender.tab?.id;
    const handle = async () => {
      switch (msg.type) {
        case 'engine:hello': {
          if (tabId == null || sender.frameId !== 0) {
            // Sub-frames just follow whatever the top frame gets.
            const level = tabId != null ? await levelFor(tabId, sender.tab?.url) : DEFAULT_LEVEL;
            const capturing = tabId != null && (await isCapturing(tabId));
            return { level: capturing ? NEUTRAL : level, mode: capturing ? 'off' : dynMode(level, await getSettings()) };
          }
          const level = await levelFor(tabId, sender.tab?.url);
          // New page in a captured tab: keep capturing only if this site wants Force boost.
          if (await isCapturing(tabId)) {
            if (level.f) {
              await applyToTab(tabId, level);
              return { level: NEUTRAL, mode: 'off' };
            }
            await stopCapture(tabId);
          }
          await setBadge(tabId, level);
          return { level, mode: dynMode(level, await getSettings()) };
        }
        case 'offscreen:stop': // capture ended on its own (tab closed / navigated away)
          if (!sender.tab) await browser.storage.session.remove(`cap:${msg.tabId}`);
          return undefined;
        case 'popup:forget': {
          const tab = await browser.tabs.get(msg.tabId).catch(() => null);
          const host = hostOf(tab?.url);
          if (host) await forgetSite(host);
          return undefined;
        }
        case 'popup:set':
          return setLevel(msg.tabId, msg.level, msg.remember);
        case 'popup:state': {
          const tab = await browser.tabs.get(msg.tabId).catch(() => null);
          const level = await levelFor(msg.tabId, tab?.url);
          const status = await applyToTab(msg.tabId, level); // also injects via activeTab / starts Force boost
          return { level, status };
        }
        case 'popup:status':
          return frameStatus(msg.tabId);
      }
      return undefined;
    };
    if (!['engine:hello', 'offscreen:stop', 'popup:set', 'popup:state', 'popup:status', 'popup:forget'].includes(msg.type))
      return;
    if (msg.type === 'offscreen:stop' && sender.tab) return;
    // Always answer, even on an error, so the popup never waits forever.
    void handle().then(sendResponse, (e: unknown) => {
      console.warn('Site Volume:', msg.type, e);
      sendResponse(null);
    });
    return true; // async response
  });

  // ---------- Keyboard shortcuts ----------
  browser.commands.onCommand.addListener(async (command, tab) => {
    const t = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (t?.id == null) return;
    const host = hostOf(t.url);
    const remember = host ? !!(await getSiteLevel(host)) && (await browser.permissions.contains({ origins: originsFor(host) })) : false;
    const cur = await levelFor(t.id, t.url);
    const { maxBoost } = await getSettings();
    let next: Level = cur;
    if (command === 'volume-up') next = { ...cur, v: clamp(Math.round((cur.v + 0.1) * 10) / 10, 0, maxBoost), m: false };
    if (command === 'volume-down') next = { ...cur, v: clamp(Math.round((cur.v - 0.1) * 10) / 10, 0, maxBoost), m: false };
    if (command === 'toggle-mute') next = { ...cur, m: !cur.m };
    await setLevel(t.id, next, remember);
  });
});

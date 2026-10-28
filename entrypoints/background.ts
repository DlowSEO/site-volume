import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  ABSOLUTE_MAX, DEFAULT_LEVEL, badgeText, clamp, getSettings, getSiteLevel, hostOf,
  originsFor, siteKey, type EngineStatus, type Level, type Msg,
} from '@/utils/shared';

const ENGINE_ID = 'site-volume-engine';
const ENGINE_FILE = '/content-scripts/engine.js' as const;

export default defineBackground(() => {
  // ---------- Content script registration follows the sites the user has allowed ----------
  async function syncRegistration() {
    const { origins = [] } = await browser.permissions.getAll();
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [ENGINE_ID] });
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [ENGINE_ID] });
    if (!origins.length) return;
    await browser.scripting.registerContentScripts([
      {
        id: ENGINE_ID,
        js: [ENGINE_FILE],
        matches: origins,
        allFrames: true,
        runAt: 'document_start',
        persistAcrossSessions: true,
      },
    ]);
  }
  browser.runtime.onInstalled.addListener(() => void syncRegistration());
  browser.runtime.onStartup.addListener(() => void syncRegistration());
  browser.permissions.onAdded.addListener(async (p) => {
    await syncRegistration();
    // Finish a "Remember" the popup started (the permission prompt may have closed the popup).
    const { pendingRemember } = await browser.storage.session.get('pendingRemember');
    if (pendingRemember) {
      const { host, level } = pendingRemember as { host: string; level: Level };
      if (await browser.permissions.contains({ origins: originsFor(host) }))
        await browser.storage.sync.set({ [siteKey(host)]: level });
      await browser.storage.session.remove('pendingRemember');
    }
    // Inject straight away into already-open tabs of the newly allowed site(s).
    for (const pattern of p.origins ?? []) {
      const tabs = await browser.tabs.query({ url: pattern });
      for (const t of tabs) if (t.id != null) await inject(t.id);
    }
  });
  browser.permissions.onRemoved.addListener(() => void syncRegistration());

  // ---------- Per-tab state (survives service-worker restarts) ----------
  const tabKey = (id: number) => `tab:${id}`;
  async function getTabLevel(tabId: number): Promise<Level | null> {
    const r = await browser.storage.session.get(tabKey(tabId));
    return (r[tabKey(tabId)] as Level) ?? null;
  }
  async function setTabLevel(tabId: number, l: Level) {
    await browser.storage.session.set({ [tabKey(tabId)]: l });
  }
  browser.tabs.onRemoved.addListener((id) => void browser.storage.session.remove([tabKey(id), `status:${id}`]));

  async function levelFor(tabId: number, url?: string): Promise<Level> {
    const host = hostOf(url);
    const site = host ? await getSiteLevel(host) : null;
    return site ?? (await getTabLevel(tabId)) ?? DEFAULT_LEVEL;
  }

  async function setBadge(tabId: number, l: Level) {
    await browser.action.setBadgeBackgroundColor({ tabId, color: l.m ? '#6b7280' : l.v > 1 ? '#c2410c' : '#2563eb' });
    await browser.action.setBadgeText({ tabId, text: badgeText(l) });
  }

  async function inject(tabId: number) {
    try {
      await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: [ENGINE_FILE] });
      return true;
    } catch {
      return false; // chrome:// pages, Web Store, no access
    }
  }

  async function applyToTab(tabId: number, level: Level): Promise<EngineStatus | null> {
    const { limiter } = await getSettings();
    await setBadge(tabId, level);
    const msg: Msg = { type: 'engine:apply', level, limiter };
    try {
      return (await browser.tabs.sendMessage(tabId, msg)) as EngineStatus;
    } catch {
      // Not injected yet (activeTab-only site) → inject and retry once.
      if (!(await inject(tabId))) return null;
      try {
        return (await browser.tabs.sendMessage(tabId, msg)) as EngineStatus;
      } catch {
        return null;
      }
    }
  }

  async function setLevel(tabId: number, level: Level, remember: boolean) {
    const { maxBoost } = await getSettings();
    level = { v: clamp(level.v, 0, Math.min(maxBoost, ABSOLUTE_MAX)), m: level.m };
    await setTabLevel(tabId, level);
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const host = hostOf(tab?.url);
    if (remember && host) {
      await browser.storage.sync.set({ [siteKey(host)]: level });
      // Every open tab of this site follows.
      const tabs = await browser.tabs.query({ url: originsFor(host) }).catch(() => []);
      for (const t of tabs) if (t.id != null && t.id !== tabId) void applyToTab(t.id, level);
    }
    return applyToTab(tabId, level);
  }

  // ---------- Messages ----------
  browser.runtime.onMessage.addListener((raw: unknown, sender: Browser.runtime.MessageSender, sendResponse) => {
    const msg = raw as Msg;
    const tabId = sender.tab?.id;
    (async () => {
      switch (msg.type) {
        case 'engine:hello': {
          if (tabId == null) return sendResponse(undefined);
          const level = await levelFor(tabId, sender.tab?.url);
          await setBadge(tabId, level);
          const { limiter } = await getSettings();
          return sendResponse({ level, limiter });
        }
        case 'engine:report': {
          // Only the top frame or any frame with media is interesting; keep the "most media" report.
          if (tabId != null && msg.status.media > 0)
            await browser.storage.session.set({ [`status:${tabId}`]: msg.status });
          return sendResponse(undefined);
        }
        case 'popup:set':
          return sendResponse(await setLevel(msg.tabId, msg.level, msg.remember));
        case 'popup:state': {
          const tab = await browser.tabs.get(msg.tabId).catch(() => null);
          const level = await levelFor(msg.tabId, tab?.url);
          const status = await applyToTab(msg.tabId, level); // also ensures injection via activeTab
          return sendResponse({ level, status });
        }
      }
    })();
    return true; // async response
  });

  // ---------- Keyboard shortcuts ----------
  browser.commands.onCommand.addListener(async (command, tab) => {
    const t = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (t?.id == null) return;
    const host = hostOf(t.url);
    const remember = host ? await browser.permissions.contains({ origins: originsFor(host) }) : false;
    const cur = await levelFor(t.id, t.url);
    const { maxBoost } = await getSettings();
    let next: Level = cur;
    if (command === 'volume-up') next = { v: clamp(Math.round((cur.v + 0.1) * 10) / 10, 0, maxBoost), m: false };
    if (command === 'volume-down') next = { v: clamp(Math.round((cur.v - 0.1) * 10) / 10, 0, maxBoost), m: false };
    if (command === 'toggle-mute') next = { ...cur, m: !cur.m };
    await setLevel(t.id, next, remember);
  });
});

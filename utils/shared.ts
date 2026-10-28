// Shared types, storage helpers and the slider curve.
import { browser } from 'wxt/browser';

export interface Level {
  /** Gain multiplier: 1 = 100%, 2 = 200%, 6 = 600% */
  v: number;
  /** Muted */
  m: boolean;
  /** Even out volume (compressor + make-up gain) */
  c?: boolean;
  /** Force boost: capture the whole tab (works on any site, may affect full screen) */
  f?: boolean;
}

export interface Settings {
  /** Highest boost the slider allows (2 = 200% default, 6 = 600% once unlocked) */
  maxBoost: number;
  /** Soft limiter on boosted audio to prevent clipping / distortion */
  limiter: boolean;
}

export interface EngineStatus {
  media: number; // media elements seen
  routed: number; // elements running through our gain (boost available)
  fallback: number; // elements we can only control up to 100%
  needsGesture: boolean; // browser autoplay rules: waiting for a click on the page
  forced?: boolean; // tab is being handled by Force boost (tab capture)
}

export type DynMode = 'off' | 'limit' | 'even';

export const DEFAULT_LEVEL: Level = { v: 1, m: false };
export const DEFAULT_SETTINGS: Settings = { maxBoost: 2, limiter: true };
export const ABSOLUTE_MAX = 6;
/** Force boost needs chrome.tabCapture + offscreen documents (Chromium only). */
export const CAN_FORCE = !import.meta.env.FIREFOX;

export type Msg =
  | { type: 'engine:hello' }
  | { type: 'engine:apply'; level: Level; mode: DynMode }
  | { type: 'engine:status' }
  | { type: 'engine:report'; status: EngineStatus }
  | { type: 'popup:set'; tabId: number; level: Level; remember: boolean }
  | { type: 'popup:state'; tabId: number }
  | { type: 'popup:forget'; tabId: number }
  | { type: 'offscreen:start'; tabId: number; streamId: string; level: Level; mode: DynMode }
  | { type: 'offscreen:apply'; tabId: number; level: Level; mode: DynMode }
  | { type: 'offscreen:stop'; tabId: number }
  | { type: 'offscreen:list' };

export const siteKey = (host: string) => `site:${host}`;
export const tabKey = (id: number) => `tab:${id}`;

export function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Origin patterns covering a host with and without www. */
export function originsFor(host: string): string[] {
  return [`*://${host}/*`, `*://www.${host}/*`];
}
export const ALL_SITES = ['https://*/*', 'http://*/*'];

export async function getSettings(): Promise<Settings> {
  const r = await browser.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...((r.settings as Partial<Settings>) ?? {}) };
}

export async function getSiteLevel(host: string): Promise<Level | null> {
  const k = siteKey(host);
  const r = await browser.storage.sync.get(k);
  return (r[k] as Level) ?? null;
}

export async function getTabLevel(tabId: number): Promise<Level | null> {
  const r = await browser.storage.session.get(tabKey(tabId));
  return (r[tabKey(tabId)] as Level) ?? null;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export const isNeutral = (l: Level) => !l.m && l.v === 1 && !l.c;

export function dynMode(l: Level, s: Settings): DynMode {
  return l.c ? 'even' : s.limiter ? 'limit' : 'off';
}

/**
 * Slider curve. Position 0..1000.
 * - First 600 steps cover 0–100% on a perceptual curve (loudness is logarithmic,
 *   so equal steps feel even instead of "10% too quiet, 20% too loud").
 * - Remaining 400 steps cover 100%–max linearly.
 */
const KNEE = 600;
const EXP = 1.6;
export function posToGain(pos: number, max: number): number {
  if (pos <= KNEE) return Math.pow(pos / KNEE, EXP);
  return 1 + ((pos - KNEE) / (1000 - KNEE)) * (max - 1);
}
export function gainToPos(g: number, max: number): number {
  if (g <= 1) return Math.pow(g, 1 / EXP) * KNEE;
  return KNEE + ((g - 1) / (max - 1)) * (1000 - KNEE);
}

export const pct = (g: number) => Math.round(g * 100);

export function badgeText(l: Level): string {
  if (l.m || l.v === 0) return 'M';
  const p = pct(l.v);
  return p === 100 ? (l.c ? '≈' : '') : String(p);
}

/**
 * Audio engine — runs inside the page (isolated world), in every frame we have access to.
 *
 * Why not chrome.tabCapture by default? Capturing the tab is what breaks full screen and shows
 * "this tab's content is being shared" in other extensions. Instead we route each
 * <video>/<audio> element through Web Audio:  element → gain → dynamics → speakers.
 * (Tab capture is still available as an opt-in "Force boost" per site.)
 *
 * Safety rules, because getting these wrong produces silence ("it cut off all my sound"):
 *  1. Cross-origin media without CORS, and DRM-protected media, output silence through Web Audio.
 *     For those we never route; we fall back to element.volume (max 100%) and tell the popup.
 *  2. An AudioContext the browser hasn't allowed to start is silent. We only route once the
 *     context is actually running; until then we wait for a click/keypress on the page.
 *  3. We only decide once an element is actually playing, so the real source and any DRM keys
 *     are attached.
 *
 * At 100%, unmuted, with "even out" off, we don't touch the page at all.
 */
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createOutputStage } from '@/utils/audio';
import { MEDIA_EVENT } from '@/utils/events';
import { isNeutral, type DynMode, type EngineGlobals, type EngineStatus, type Level, type Msg } from '@/utils/shared';

type Hook =
  | { kind: 'routed'; gain: GainNode }
  | { kind: 'fallback'; baseVolume: number; ours: number };

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  allFrames: true,
  runAt: 'document_start',
  main() {
    const w = window as unknown as EngineGlobals;
    if (w.__siteVolume) return; // already injected into this frame
    w.__siteVolume = true;

    let level: Level = { v: 1, m: false };
    let mode: DynMode = 'limit';
    let ctx: AudioContext | null = null;
    let out: ReturnType<typeof createOutputStage> | null = null;
    let waitingForGesture = false;
    const hooks = new WeakMap<HTMLMediaElement, Hook>();
    const seen = new Set<WeakRef<HTMLMediaElement>>();
    const busy = new WeakSet<HTMLMediaElement>();

    const target = () => (level.m ? 0 : level.v);

    function routable(el: HTMLMediaElement): boolean {
      const src = el.currentSrc || el.src;
      if (!src) return false;
      if (el.mediaKeys) return false; // DRM (Netflix, Prime, Disney+, Spotify…) is silent through Web Audio
      // Chromium refuses to capture exactly the media Web Audio would play as silence: anything whose
      // data came from another origin without CORS, including a same-origin URL that redirects to a
      // CDN (which the URL checks below can't see). Firefox has no unprefixed captureStream.
      const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
      if (typeof capture === 'function') {
        try {
          capture.call(el).getTracks().forEach((t) => t.stop());
          return true;
        } catch {
          return false;
        }
      }
      if (src.startsWith('blob:') || src.startsWith('data:')) return true; // MSE players (YouTube, Twitch…)
      try {
        if (new URL(src, location.href).origin === location.origin) return true;
      } catch {
        return false;
      }
      return el.crossOrigin !== null && el.readyState >= 1; // cross-origin is only safe with CORS
    }

    function getCtx(): AudioContext {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'playback' });
        out = createOutputStage(ctx);
        out.set(mode);
        // If the browser lets the context start later than we waited, upgrade to boost then.
        ctx.onstatechange = () => {
          if (ctx?.state === 'running') return void applyAll();
          // Routed media goes silent if the context stops (e.g. audio device change).
          // Try to resume straight away; failing that, on the next click/keypress.
          if (ctx && ctx.state !== 'closed' && routedCount() > 0)
            void contextRunning().then((ok) => ok || waitForGesture());
        };
      }
      return ctx;
    }

    async function contextRunning(): Promise<boolean> {
      const c = getCtx();
      if (c.state === 'running') return true;
      const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
        .userActivation?.hasBeenActive;
      if (activated === false) return false; // resume() would hang without a user gesture
      try {
        await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1000))]);
      } catch {
        /* ignore */
      }
      return (c.state as AudioContextState) === 'running';
    }

    function routedCount() {
      let n = 0;
      for (const r of seen) {
        const el = r.deref();
        if (el && hooks.get(el)?.kind === 'routed') n++;
      }
      return n;
    }

    function waitForGesture() {
      if (waitingForGesture) return;
      waitingForGesture = true;
      const go = () => {
        waitingForGesture = false;
        removeEventListener('pointerdown', go, true);
        removeEventListener('keydown', go, true);
        void applyAll();
      };
      addEventListener('pointerdown', go, true);
      addEventListener('keydown', go, true);
    }

    async function applyTo(el: HTMLMediaElement) {
      if (busy.has(el)) return; // a routing attempt is already in flight for this element
      busy.add(el);
      try {
        await applyToInner(el);
      } finally {
        busy.delete(el);
      }
      // Level may have changed while we were waiting on the AudioContext.
      const h = hooks.get(el);
      if (h?.kind === 'routed' && ctx) h.gain.gain.setTargetAtTime(target(), ctx.currentTime, 0.03);
    }

    async function applyToInner(el: HTMLMediaElement) {
      const t = target();
      const hook = hooks.get(el);

      if (hook?.kind === 'routed') {
        if (ctx && ctx.state !== 'running') void contextRunning();
        hook.gain.gain.setTargetAtTime(t, ctx!.currentTime, 0.03); // smooth, no clicks
        return;
      }

      if (isNeutral(level)) {
        // Give back control of anything we were holding in fallback mode.
        if (hook?.kind === 'fallback' && el.volume === hook.ours) el.volume = hook.baseVolume;
        hooks.delete(el);
        return;
      }

      if (el.paused || el.readyState < 2) return; // decide once it's really playing

      const canRoute = routable(el);
      if (canRoute && (await contextRunning())) {
        try {
          const c = getCtx();
          const source = c.createMediaElementSource(el);
          const gain = c.createGain();
          gain.gain.value = t;
          source.connect(gain).connect(out!.input);
          if (hook?.kind === 'fallback' && el.volume === hook.ours) el.volume = hook.baseVolume;
          hooks.set(el, { kind: 'routed', gain });
          return;
        } catch {
          // Already captured by the page's own Web Audio graph, etc. → fall back.
        }
      } else if (canRoute) {
        waitForGesture();
      }

      // Fallback: plain element volume, capped at 100%.
      const base = hook?.kind === 'fallback' ? hook.baseVolume : el.volume;
      const ours = Math.min(1, base * t);
      el.volume = ours;
      hooks.set(el, { kind: 'fallback', baseVolume: base, ours });
    }

    function track(el: HTMLMediaElement) {
      for (const r of seen) if (r.deref() === el) return;
      seen.add(new WeakRef(el));
      el.addEventListener('playing', () => void applyTo(el));
      // The page changed its own volume while we hold the element at a fallback level:
      // treat that as the new base so we don't undo the page's volume control.
      el.addEventListener('volumechange', () => {
        const h = hooks.get(el);
        if (h?.kind === 'fallback' && el.volume !== h.ours) {
          h.baseVolume = el.volume;
          h.ours = Math.min(1, el.volume * target());
          el.volume = h.ours;
        }
      });
      void applyTo(el);
    }

    function scan(root: ParentNode = document) {
      root.querySelectorAll<HTMLMediaElement>('video, audio').forEach(track);
    }

    // Players built as web components keep their <video> inside a shadow root, where neither
    // querySelectorAll nor the document-level 'play' listener reaches. Look inside open shadow
    // roots, but only once the user actually wants a change on this page.
    const shadowRoots = new WeakSet<ShadowRoot>();
    function watchShadow(sr: ShadowRoot) {
      if (shadowRoots.has(sr)) return;
      shadowRoots.add(sr);
      sr.addEventListener('play', onPlay, true);
      observer.observe(sr, { childList: true, subtree: true });
    }
    function scanDeep(root: ParentNode = document) {
      scan(root);
      for (const el of root.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (sr) {
          watchShadow(sr);
          scanDeep(sr);
        }
      }
    }

    async function applyAll() {
      out?.set(mode);
      if (!isNeutral(level)) scanDeep();
      for (const r of [...seen]) {
        const el = r.deref();
        if (!el) seen.delete(r);
        else await applyTo(el);
      }
    }

    function status(): EngineStatus {
      let media = 0, routed = 0, fallback = 0;
      for (const r of seen) {
        const el = r.deref();
        if (!el) continue;
        media++;
        const h = hooks.get(el);
        if (h?.kind === 'routed') routed++;
        else if (h?.kind === 'fallback') fallback++;
      }
      return { media, routed, fallback, needsGesture: waitingForGesture };
    }

    // Catch media as it appears. 'play' doesn't bubble but is visible in the capture phase.
    function onPlay(e: Event) {
      if (e.target instanceof HTMLMediaElement) track(e.target);
    }
    document.addEventListener('play', onPlay, true);
    // Media the page plays without adding it to the document (new Audio().play()),
    // announced by the main-world helper.
    document.addEventListener(MEDIA_EVENT, (e) => {
      const el = (e as FocusEvent).relatedTarget;
      if (el instanceof HTMLMediaElement) track(el);
    });
    const observer = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (n instanceof HTMLMediaElement) track(n);
          else if (n instanceof Element && n.firstElementChild) {
            if (isNeutral(level)) scan(n);
            else scanDeep(n);
          }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan());
    scan();

    // Called by the background in every frame at once (see EngineGlobals).
    w.__siteVolumeApply = async (l, m) => {
      level = l;
      mode = m;
      await applyAll(); // answer once routing has settled so the popup shows an accurate status
      return status();
    };
    w.__siteVolumeStatus = status;

    // Ask the background for this site's saved level.
    browser.runtime
      .sendMessage({ type: 'engine:hello' } satisfies Msg)
      .then((r: unknown) => {
        const res = r as { level: Level; mode: DynMode } | undefined;
        if (!res) return;
        level = res.level;
        mode = res.mode;
        void applyAll();
      })
      .catch(() => {});
  },
});

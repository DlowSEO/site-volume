/**
 * Tiny helper that runs in the page's own JavaScript world.
 *
 * Some sites play sound with `new Audio(url).play()` and never add the element to the page, so
 * the engine (which looks for <audio>/<video> in the page) can't see it. This wraps
 * HTMLMediaElement.play: when a detached element starts playing, it's handed to the engine via
 * an event's relatedTarget (DOM nodes can cross between the page and extension worlds; plain
 * JavaScript objects can't). Nothing else on the page changes.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';

import { MEDIA_EVENT } from '@/utils/events';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start',
  main() {
    const w = window as unknown as { __siteVolumeMain?: boolean };
    if (w.__siteVolumeMain) return;
    w.__siteVolumeMain = true;

    const proto = HTMLMediaElement.prototype;
    const originalPlay = proto.play;
    const announced = new WeakSet<HTMLMediaElement>();

    Object.defineProperty(proto, 'play', {
      configurable: true,
      writable: true,
      value: function play(this: HTMLMediaElement) {
        try {
          if (!this.isConnected && !announced.has(this)) {
            announced.add(this);
            document.dispatchEvent(new FocusEvent(MEDIA_EVENT, { relatedTarget: this }));
          }
        } catch {
          /* never get in the way of playback */
        }
        return originalPlay.call(this);
      },
    });
  },
});

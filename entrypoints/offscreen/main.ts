/**
 * Force boost: plays a captured tab's audio back through gain → dynamics → speakers.
 * Lives in an offscreen document because service workers can't use getUserMedia / Web Audio.
 * (Capturing a tab silences its normal output, so this playback is what the user hears.)
 */
import { browser } from 'wxt/browser';
import { createOutputStage } from '@/utils/audio';
import type { DynMode, Level, Msg } from '@/utils/shared';

interface Capture {
  stream: MediaStream;
  ctx: AudioContext;
  gain: GainNode;
  out: ReturnType<typeof createOutputStage>;
}
const caps = new Map<number, Capture>();
const target = (l: Level) => (l.m ? 0 : l.v);

async function start(tabId: number, streamId: string, level: Level, mode: DynMode) {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  } as unknown as MediaStreamConstraints);
  const ctx = new AudioContext({ latencyHint: 'playback' });
  const out = createOutputStage(ctx);
  out.set(mode);
  const gain = ctx.createGain();
  gain.gain.value = target(level);
  ctx.createMediaStreamSource(stream).connect(gain).connect(out.input);
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    stop(tabId);
    void browser.runtime.sendMessage({ type: 'offscreen:stop', tabId } satisfies Msg).catch(() => {});
  });
  caps.set(tabId, { stream, ctx, gain, out });
}

function apply(tabId: number, level: Level, mode: DynMode) {
  const c = caps.get(tabId);
  if (!c) return false;
  c.out.set(mode);
  c.gain.gain.setTargetAtTime(target(level), c.ctx.currentTime, 0.03);
  return true;
}

function stop(tabId: number) {
  const c = caps.get(tabId);
  if (!c) return;
  c.stream.getTracks().forEach((t) => t.stop());
  void c.ctx.close();
  caps.delete(tabId);
}

browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as Msg;
  switch (msg.type) {
    case 'offscreen:start':
      start(msg.tabId, msg.streamId, msg.level, msg.mode).then(
        () => sendResponse({ ok: true }),
        (e: unknown) => sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    case 'offscreen:apply':
      sendResponse({ ok: apply(msg.tabId, msg.level, msg.mode) });
      return;
    case 'offscreen:stop':
      stop(msg.tabId);
      sendResponse({ ok: true });
      return;
    case 'offscreen:list':
      sendResponse([...caps.keys()]);
      return;
  }
});

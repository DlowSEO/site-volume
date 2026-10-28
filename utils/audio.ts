import type { DynMode } from './shared';

/**
 * Output stage shared by the in-page engine and Force boost:
 *   [sources/gains] → compressor → make-up gain → speakers
 * - limit: fast hard-knee limiter just under 0 dBFS (stops boosted audio clipping)
 * - even:  gentle compressor + make-up gain, so quiet speech and loud ads end up closer together
 * - off:   transparent
 */
export function createOutputStage(ctx: BaseAudioContext) {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);
  makeup.connect(ctx.destination);

  function set(mode: DynMode) {
    const t = ctx.currentTime;
    const p =
      mode === 'even'
        ? { th: -32, knee: 12, ratio: 5, atk: 0.01, rel: 0.35, out: 2.2 }
        : mode === 'limit'
          ? { th: -3, knee: 0, ratio: 20, atk: 0.002, rel: 0.15, out: 1 }
          : { th: 0, knee: 0, ratio: 1, atk: 0.003, rel: 0.25, out: 1 };
    comp.threshold.setValueAtTime(p.th, t);
    comp.knee.setValueAtTime(p.knee, t);
    comp.ratio.setValueAtTime(p.ratio, t);
    comp.attack.setValueAtTime(p.atk, t);
    comp.release.setValueAtTime(p.rel, t);
    makeup.gain.setTargetAtTime(p.out, t, 0.05);
  }
  set('limit');
  return { input: comp as AudioNode, set };
}

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
  if (import.meta.env.MODE === 'e2e') attachTestMeter(ctx, makeup);

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
    // Chrome's DynamicsCompressorNode adds its own automatic make-up gain
    // (0.6 × the gain reduction a full-scale signal would get). Cancel it, so "limit" is
    // transparent below the threshold and our own make-up gain is the only boost.
    const autoMakeupDb = -0.6 * reductionAt0dB(p.th, p.knee, p.ratio);
    makeup.gain.setTargetAtTime(p.out * Math.pow(10, -autoMakeupDb / 20), t, 0.05);
  }
  set('limit');
  return { input: comp as AudioNode, set };
}

/**
 * Gain change (dB, ≤ 0) the compressor gives a 0 dBFS input, which Chromium bases its automatic
 * make-up gain on. Hard-knee approximation; close enough for our soft knee (checked by measurement).
 */
function reductionAt0dB(th: number, _knee: number, ratio: number): number {
  if (ratio <= 1 || th >= 0) return 0;
  return th - th / ratio; // output level at 0 dB in → gain change
}

/** Automated tests only: publish the output level (RMS) on <html data-sv-rms> so a test can measure it. */
function attachTestMeter(ctx: BaseAudioContext, node: AudioNode) {
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  node.connect(an);
  const buf = new Float32Array(an.fftSize);
  setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    if (typeof document !== 'undefined') document.documentElement.dataset.svRms = String(Math.sqrt(sum / buf.length));
  }, 100);
}

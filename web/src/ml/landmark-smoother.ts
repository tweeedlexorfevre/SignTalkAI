/**
 * Adaptive temporal smoothing for MediaPipe landmarks.
 *
 * A fixed moving average makes a signing hand visibly lag behind the video.
 * This is a small One Euro filter instead: stationary landmarks are strongly
 * smoothed, while the cut-off rises with movement so intentional gestures stay
 * responsive. Missing landmarks remain missing; we never invent a hand or a
 * face point for the recogniser.
 */
import { FRAME_LENGTH, type Frame } from './landmarks';

export interface LandmarkSmootherOptions {
  /** Lowest cut-off frequency in Hz for a nearly still landmark. */
  minCutoff: number;
  /** How quickly the filter opens up as a landmark moves. */
  beta: number;
  /** Cut-off frequency in Hz for the velocity estimate. */
  derivativeCutoff: number;
  /** Forget a point after this long without a measurement. */
  missingResetMs: number;
  /** Forget every point after a pause in the video stream. */
  streamResetMs: number;
}

const DEFAULTS: LandmarkSmootherOptions = {
  minCutoff: 1.6,
  beta: 0.16,
  derivativeCutoff: 1.0,
  missingResetMs: 180,
  streamResetMs: 500,
};

function alpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSeconds);
}

/** Stateful filter; use one instance for one continuous camera stream. */
export class LandmarkSmoother {
  private readonly values = new Float32Array(FRAME_LENGTH).fill(Number.NaN);
  private readonly derivatives = new Float32Array(FRAME_LENGTH).fill(0);
  private readonly seenAt = new Float64Array(FRAME_LENGTH).fill(Number.NEGATIVE_INFINITY);
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  private readonly options: LandmarkSmootherOptions;

  constructor(options: Partial<LandmarkSmootherOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  reset(): void {
    this.values.fill(Number.NaN);
    this.derivatives.fill(0);
    this.seenAt.fill(Number.NEGATIVE_INFINITY);
    this.lastFrameAt = Number.NEGATIVE_INFINITY;
  }

  filter(frame: Frame, timestampMs: number): Frame {
    if (timestampMs - this.lastFrameAt > this.options.streamResetMs) this.reset();
    this.lastFrameAt = timestampMs;
    const out = new Float32Array(frame);
    for (let i = 0; i < FRAME_LENGTH; i++) {
      const next = frame[i] ?? Number.NaN;
      const previous = this.values[i] ?? Number.NaN;
      const lastSeen = this.seenAt[i] ?? Number.NEGATIVE_INFINITY;
      if (!Number.isFinite(next)) {
        // Keep the state briefly so a one-frame MediaPipe dropout does not
        // cause the returning landmark to jump, but preserve the dropout in
        // output so downstream presence checks remain truthful.
        if (timestampMs - lastSeen > this.options.missingResetMs) {
          this.values[i] = Number.NaN;
          this.derivatives[i] = 0;
        }
        continue;
      }
      const dt = (timestampMs - lastSeen) / 1000;
      if (!Number.isFinite(previous) || !(dt > 0) || dt > this.options.missingResetMs / 1000) {
        this.values[i] = next;
        this.derivatives[i] = 0;
        this.seenAt[i] = timestampMs;
        continue;
      }
      const rawDerivative = (next - previous) / dt;
      const derivativeAlpha = alpha(this.options.derivativeCutoff, dt);
      const derivative =
        derivativeAlpha * rawDerivative + (1 - derivativeAlpha) * (this.derivatives[i] ?? 0);
      const positionAlpha = alpha(this.options.minCutoff + this.options.beta * Math.abs(derivative), dt);
      const filtered = positionAlpha * next + (1 - positionAlpha) * previous;
      this.values[i] = filtered;
      this.derivatives[i] = derivative;
      this.seenAt[i] = timestampMs;
      out[i] = filtered;
    }
    return out;
  }
}

/**
 * Continuous recognition of the user's own gestures, for fluent signing.
 *
 * The plain pipeline waits until the hands rest or drop (a pause) before it
 * classifies a sign, so signs made one after another without a pause merge
 * into one. The spotter instead looks at the last moments of motion all the
 * time: every STRIDE_MS it embeds a few windows that end "now" (their lengths
 * follow how long the user's recorded takes were) and compares them with the
 * gestures of the chosen set. A gesture is accepted when a window clears that
 * gesture's own threshold (derived from how alike its recorded takes are) by a
 * margin over the runner-up; the word is sent as soon as the match peaks, and
 * the frames it used are dropped so the next sign starts fresh.
 *
 * When signing stops and nothing was spotted during it, the whole burst is
 * classified once with the lenient matcher, exactly like the slow pipeline,
 * so a single careful sign still works.
 */
import { modelInput, type ModelInput } from '../ml/features';
import { handsMissing, type Frame } from '../ml/landmarks';
import type { ModelMeta } from '../ml/meta';
import { cosine } from '../ml/prototypes';
import { handSpeed } from '../ml/segmenter';

export interface SpotGesture {
  id: string;
  name: string;
  proto: Float32Array;
  /** Similarity a window needs to count as this gesture. */
  threshold: number;
  /** Typical length of this gesture's recorded takes (ms). */
  duration: number;
}

export interface SpotIndex {
  gestures: SpotGesture[];
  /** Window lengths (ms) to try, from the recorded takes' durations. */
  windows: number[];
}

export type SpotEvent =
  | { type: 'activity'; active: boolean }
  | { type: 'word'; id: string; name: string; similarity: number; fast: boolean }
  | { type: 'unsure'; id: string; name: string; similarity: number };

export interface SpotterHooks {
  infer: (input: ModelInput) => Promise<{ embedding: Float32Array }>;
  /** The gestures to look for right now (the active set). */
  index: () => SpotIndex;
  /** Lenient whole-burst match, used when nothing was spotted during a burst. */
  matchBurst: (
    embedding: Float32Array,
  ) =>
    | { kind: 'match' | 'not-sure'; gesture: { id: string; name: string }; similarity: number }
    | { kind: 'empty' };
  emit: (event: SpotEvent) => void;
}

const STRIDE_MS = 150;
/** Motion (shoulder widths / s) that counts as signing; as in the segmenter. */
const MOVE_SPEED = 0.6;
/** No hands, or no motion, for this long ends a burst of signing. */
const QUIET_MS = 350;
/** Frames kept before motion starts (hands entering the sign). */
const PREROLL_MS = 200;
/** Longest burst kept for the whole-burst fallback. */
const MAX_BURST_MS = 4000;
/** A spotted match is sent once it stops improving, or after this long. */
const HOLD_MS = 400;
/** Unspotted signing after the last word shorter than this is the tail of that word. */
const MIN_TAIL_MS = 300;
/** Window must be at least this share of its nominal length after the last cut. */
const MIN_FILL = 0.7;

interface Sample {
  frame: Frame;
  t: number;
}

interface Pending {
  id: string;
  name: string;
  similarity: number;
  ratio: number;
  /** End time of the best window so far: frames up to here belong to this sign. */
  endT: number;
  firstT: number;
  hits: number;
}

export class GestureSpotter {
  private buffer: Sample[] = [];
  private last: Sample | null = null;
  private speed = 0;
  private active = false;
  private lastMotion = 0;
  private lastHands = 0;
  private cutT = -Infinity;
  private burstStart = 0;
  private burstSpotted = false;
  private pending: Pending | null = null;
  /** The last word sent: the rest of a long sign must not count as the same word again. */
  private lastWord: { id: string; t: number } | null = null;
  private busy = false;
  private nextTick = 0;
  private stride = STRIDE_MS;
  private generation = 0;
  private stopped = false;

  constructor(
    private readonly meta: ModelMeta,
    private readonly hooks: SpotterHooks,
  ) {}

  reset(): void {
    this.generation++;
    this.buffer = [];
    this.last = null;
    this.speed = 0;
    this.pending = null;
    this.burstSpotted = false;
    this.cutT = -Infinity;
    if (this.active) {
      this.active = false;
      this.hooks.emit({ type: 'activity', active: false });
    }
  }

  stop(): void {
    this.stopped = true;
    this.reset();
  }

  push(frame: Frame, t: number): void {
    if (this.stopped) return;
    const present = !handsMissing(frame);
    const sample = { frame, t };
    if (present && this.last && !handsMissing(this.last.frame))
      this.speed = 0.5 * this.speed + 0.5 * handSpeed(this.last, sample);
    else if (!present) this.speed = 0;
    this.last = sample;
    if (present) this.lastHands = t;
    const moving = present && this.speed >= MOVE_SPEED;
    if (moving) this.lastMotion = t;

    if (!this.active) {
      // Keep a short pre-roll while waiting for motion.
      this.buffer = present ? [...this.buffer, sample].filter((s) => t - s.t <= PREROLL_MS) : [];
      if (!moving) return;
      this.active = true;
      this.burstStart = this.buffer[0]?.t ?? t;
      this.burstSpotted = false;
      this.cutT = -Infinity;
      this.pending = null;
      this.nextTick = t + this.stride;
      this.hooks.emit({ type: 'activity', active: true });
      return;
    }

    if (present) this.buffer.push(sample);
    const keepFrom = Math.max(t - MAX_BURST_MS, this.cutT);
    while (this.buffer.length && (this.buffer[0]?.t ?? t) < keepFrom) this.buffer.shift();

    if (t - this.lastHands >= QUIET_MS || t - this.lastMotion >= QUIET_MS) {
      void this.endBurst();
      return;
    }
    if (t >= this.nextTick && !this.busy) {
      this.nextTick = t + this.stride;
      void this.tick(t);
    }
  }

  /** Frames of the buffer inside [from, to]. */
  private window(from: number, to: number): Sample[] {
    return this.buffer.filter((s) => s.t >= from && s.t <= to);
  }

  private input(samples: Sample[]): ModelInput | null {
    if (samples.length < 4) return null;
    const first = samples[0]?.t ?? 0;
    const last = samples[samples.length - 1]?.t ?? first;
    const fps = last > first ? ((samples.length - 1) * 1000) / (last - first) : 30;
    const input = modelInput(
      samples.map((s) => s.frame),
      fps,
      this.meta,
    );
    return input.frames >= this.meta.minFrames ? input : null;
  }

  private async tick(now: number): Promise<void> {
    const index = this.hooks.index();
    if (!index.gestures.length) return;
    const generation = this.generation;
    this.busy = true;
    const started = performance.now();
    try {
      let best: (Pending & { second: number }) | null = null;
      for (const length of index.windows) {
        const from = now - length;
        const samples = this.window(Math.max(from, this.cutT), now);
        const span = (samples[samples.length - 1]?.t ?? 0) - (samples[0]?.t ?? 0);
        if (span < length * MIN_FILL) continue;
        const input = this.input(samples);
        if (!input) continue;
        const { embedding } = await this.hooks.infer(input);
        if (generation !== this.generation || this.stopped) return;
        const scored = index.gestures
          .map((g) => ({ g, s: cosine(embedding, g.proto) }))
          .sort((a, b) => b.s - a.s);
        const top = scored[0];
        if (!top) continue;
        const second = scored[1]?.s ?? -1;
        const recent = this.lastWord;
        if (recent?.id === top.g.id && now - recent.t < top.g.duration * 0.8) continue;
        if (top.s < top.g.threshold || top.s - second < this.meta.teach.margin) continue;
        const ratio = top.s / top.g.threshold;
        if (!best || ratio > best.ratio)
          best = {
            id: top.g.id,
            name: top.g.name,
            similarity: top.s,
            ratio,
            endT: now,
            firstT: now,
            hits: 1,
            second,
          };
      }
      this.decide(best, now);
    } catch {
      /* a failed inference only skips this tick */
    } finally {
      this.busy = false;
      // Keep up on slow devices: never ask for more than ~2/3 of the time.
      this.stride = Math.max(STRIDE_MS, (performance.now() - started) * 1.5);
    }
  }

  private decide(best: Pending | null, now: number): void {
    const p = this.pending;
    if (best && p && best.id === p.id) {
      p.hits++;
      if (best.similarity >= p.similarity) {
        p.similarity = best.similarity;
        p.ratio = best.ratio;
        p.endT = now;
        if (now - p.firstT < HOLD_MS) return;
      }
      // The match stopped improving (or has been held long enough): send it.
      this.send(p, true);
      return;
    }
    if (best && p && best.ratio <= p.ratio + 0.05) {
      // Another, weaker candidate: the pending sign is over.
      this.send(p, true);
      return;
    }
    if (best && p) {
      // A clearly better candidate replaces a weak early guess.
      this.pending = best;
      return;
    }
    if (best) {
      this.pending = best;
      return;
    }
    // Nothing matches now: a pending sign has ended.
    if (p && (p.hits >= 2 || p.ratio >= 1.15)) this.send(p, true);
    else if (p && now - p.firstT >= HOLD_MS) this.pending = null;
  }

  private send(p: Pending, fast: boolean): void {
    this.pending = null;
    this.burstSpotted = true;
    this.cutT = p.endT;
    this.buffer = this.buffer.filter((s) => s.t > p.endT);
    this.lastWord = { id: p.id, t: p.endT };
    this.hooks.emit({ type: 'word', id: p.id, name: p.name, similarity: p.similarity, fast });
  }

  private async endBurst(): Promise<void> {
    this.active = false;
    this.hooks.emit({ type: 'activity', active: false });
    // A candidate that already cleared its strict threshold is sent now.
    if (this.pending) this.send(this.pending, true);
    const spotted = this.burstSpotted;
    const quietFrom = Math.min(this.lastMotion, this.lastHands) + 1;
    // Whatever was signed after the last spotted word (or the whole burst).
    const samples = this.window(Math.max(this.burstStart, this.cutT), quietFrom);
    const span = (samples[samples.length - 1]?.t ?? 0) - (samples[0]?.t ?? 0);
    const lastWord = this.lastWord;
    this.buffer = [];
    this.cutT = -Infinity;
    const input = this.input(samples);
    if (!input || (spotted && span < MIN_TAIL_MS)) return;
    const generation = this.generation;
    try {
      const { embedding } = await this.hooks.infer(input);
      if (generation !== this.generation || this.stopped) return;
      const match = this.hooks.matchBurst(embedding);
      if (match.kind === 'empty') return;
      const gesture = this.hooks.index().gestures.find((g) => g.id === match.gesture.id);
      // After spotted words, the tail must be a whole sign, not the end of the last one.
      if (spotted) {
        if (match.kind !== 'match' || !gesture || span < gesture.duration * 0.6) return;
        if (lastWord?.id === gesture.id && span < gesture.duration * 0.8) return;
      }
      const { id, name } = match.gesture;
      if (match.kind === 'match') {
        this.lastWord = { id, t: quietFrom };
        this.hooks.emit({ type: 'word', id, name, similarity: match.similarity, fast: false });
      } else this.hooks.emit({ type: 'unsure', id, name, similarity: match.similarity });
    } catch {
      /* skip */
    }
  }
}

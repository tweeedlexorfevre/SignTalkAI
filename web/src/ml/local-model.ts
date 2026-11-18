export type LocalKind = 'krsl' | 'rsl' | 'bukva';
export interface LocalLabel {
  id: string;
  ru: string;
  kk: string | null;
}
export interface LocalMeta {
  classes: number;
  threshold: number;
  experimental: boolean;
  /** 'probabilities' when the model already ends in softmax (Bukva). */
  output?: 'logits' | 'probabilities';
}
export interface LocalGuess {
  index: number;
  probability: number;
}
export function topGuesses(logits: Float32Array, probabilities = false): LocalGuess[] {
  if (!logits.length || !logits.every(Number.isFinite)) throw Error('Invalid logits');
  const max = Math.max(...logits);
  const exp = probabilities ? Array.from(logits) : Array.from(logits, (v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  return exp
    .map((v, index) => ({ index, probability: v / sum }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}
/** RGB canvas bytes -> Easy Sign's exact 1,C,T,H,W, RGB / 255 contract. */
export function putRgbFrame(
  target: Float32Array,
  rgba: Uint8ClampedArray,
  frame: number,
  pixels = 224 * 224,
  count = 32,
): void {
  if (
    frame < 0 ||
    frame >= count ||
    rgba.length !== pixels * 4 ||
    target.length !== 3 * count * pixels
  )
    throw Error('Invalid RGB frame');
  for (let p = 0; p < pixels; p++)
    for (let c = 0; c < 3; c++)
      target[(c * count + frame) * pixels + p] = (rgba[p * 4 + c] ?? 0) / 255;
}
/** Bukva (ai-forever) input: 8 frames, 1,T,C,H,W, ImageNet mean/std on 0..255 RGB. */
export const BUKVA_FRAMES = 8;
export const BUKVA_SIZE = 224;
const BUKVA_MEAN = [123.675, 116.28, 103.53] as const;
const BUKVA_STD = [58.395, 57.12, 57.375] as const;
export function putBukvaFrame(
  target: Float32Array,
  rgba: Uint8ClampedArray,
  frame: number,
  pixels = BUKVA_SIZE * BUKVA_SIZE,
  count = BUKVA_FRAMES,
): void {
  if (
    frame < 0 ||
    frame >= count ||
    rgba.length !== pixels * 4 ||
    target.length !== 3 * count * pixels
  )
    throw Error('Invalid RGB frame');
  const base = frame * 3 * pixels;
  for (let c = 0; c < 3; c++) {
    const mean = BUKVA_MEAN[c] ?? 0;
    const std = BUKVA_STD[c] ?? 1;
    const offset = base + c * pixels;
    for (let p = 0; p < pixels; p++) target[offset + p] = ((rgba[p * 4 + c] ?? 0) - mean) / std;
  }
}
/** Letterbox rectangle used by the upstream demo: keep aspect, grey (114) borders. */
export function letterbox(
  width: number,
  height: number,
  size = BUKVA_SIZE,
): { x: number; y: number; w: number; h: number } {
  if (!(width > 0 && height > 0)) throw Error('Invalid frame size');
  const r = Math.min(size / width, size / height);
  const w = Math.round(width * r);
  const h = Math.round(height * r);
  const pad = (free: number) => Math.max(0, Math.round(free / 2 - 0.1));
  return { x: pad(size - w), y: pad(size - h), w, h };
}
export class LocalModel {
  private probabilities = false;
  private worker: Worker;
  private serial = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (v: Float32Array | null) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker = new Worker(new URL('./local-model.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; ok: boolean; error?: string; logits?: Float32Array }>,
    ) => {
      const m = event.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.logits ?? null);
      else p.reject(Error(m.error ?? 'Model error'));
    };
    this.worker.onerror = () => {
      this.dispose();
    };
  }
  private request(
    message: Record<string, unknown>,
    data?: Float32Array,
  ): Promise<Float32Array | null> {
    if (this.closed) return Promise.reject(Error('Model closed'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('Model timeout'));
        this.dispose();
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, data ? [data.buffer] : []);
    });
  }
  async load(kind: LocalKind): Promise<{ labels: LocalLabel[]; meta: LocalMeta }> {
    const base = import.meta.env.BASE_URL;
    const [labels, meta] = await Promise.all(
      ['labels', 'meta'].map(async (file) => {
        const r = await fetch(`${base}models/${kind}/${file}.json`);
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      }),
    );
    if (
      !Array.isArray(labels) ||
      !meta ||
      typeof meta !== 'object' ||
      !('classes' in meta) ||
      labels.length !== meta.classes
    )
      throw Error('Invalid model metadata');
    await this.request({ type: 'load', kind, base });
    this.probabilities = (meta as LocalMeta).output === 'probabilities';
    return { labels: labels as LocalLabel[], meta: meta as LocalMeta };
  }
  async infer(data: Float32Array): Promise<LocalGuess[]> {
    const logits = await this.request({ type: 'run', data }, data);
    if (!logits) throw Error('Missing output');
    return topGuesses(logits, this.probabilities);
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('Model closed'));
    }
    this.pending.clear();
  }
}

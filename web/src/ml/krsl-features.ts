/** KRSL10 v1: pooled normalized 21-point hand shapes, matching tools/train_krsl.py. */
import { LEFT_HAND_START, RIGHT_HAND_START, type Frame } from './landmarks';
export type HandXY = readonly (readonly number[])[];
export function handsFromFrame(frame: Frame): number[][][] {
  const hands: number[][][] = [];
  for (const start of [LEFT_HAND_START, RIGHT_HAND_START]) {
    const hand = Array.from({ length: 21 }, (_, i) => [
      frame[(start + i) * 3] ?? NaN,
      frame[(start + i) * 3 + 1] ?? NaN,
    ]);
    if (hand.every((p) => p.every(Number.isFinite))) hands.push(hand);
  }
  return hands;
}
export function krslFeatures(tokens: readonly HandXY[]): Float32Array | null {
  const shapes: number[][] = [];
  for (const hand of tokens) {
    if (
      hand.length !== 21 ||
      hand.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
    )
      continue;
    const xy = hand as readonly (readonly [number, number])[];
    const wrist = xy[0];
    const middle = xy[9];
    const index = xy[5];
    const pinky = xy[17];
    if (!wrist || !middle || !index || !pinky) continue;
    const scale = Math.hypot(middle[0] - wrist[0], middle[1] - wrist[1]);
    if (scale < 0.005) continue;
    const mirror = index[0] > pinky[0] ? -1 : 1;
    shapes.push(
      xy.flatMap((p) => [
        Math.max(-5, Math.min(5, ((p[0] - wrist[0]) / scale) * mirror)),
        Math.max(-5, Math.min(5, (p[1] - wrist[1]) / scale)),
      ]),
    );
  }
  if (shapes.length < 3) return null;
  const out = new Float32Array(168);
  for (let i = 0; i < 42; i++) {
    const values = shapes.map((s) => s[i] ?? NaN);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    out[i] = mean;
    out[42 + i] = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    out[84 + i] = Math.min(...values);
    out[126 + i] = Math.max(...values);
  }
  return out;
}

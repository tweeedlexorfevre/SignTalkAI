/**
 * A small skeleton animation of one recorded take, so a user can look
 * through what was recorded for a gesture. Only landmark coordinates are kept
 * (never video): both hands and the upper body, at most PREVIEW_FRAMES frames.
 *
 * Layout of one frame (must match server/api.mjs PREVIEW_VALUES): (x, y) for
 * 21 left-hand points, 21 right-hand points, then the pose points in
 * PREVIEW_POSE; null where the tracker did not see a point.
 */
import {
  HAND_CONNECTIONS,
  LEFT_HAND_START,
  N_HAND,
  POSE_START,
  RIGHT_HAND_START,
  type Frame,
} from '../ml/landmarks';
import type { Segment } from '../ml/segmenter';

export interface TakePreview {
  fps: number;
  frames: (number | null)[][];
}

export const PREVIEW_FRAMES = 24;
/** Nose, shoulders, elbows, wrists (MediaPipe pose indices). */
export const PREVIEW_POSE = [0, 11, 12, 13, 14, 15, 16] as const;
const POINTS: number[] = [
  ...Array.from({ length: N_HAND }, (_, i) => LEFT_HAND_START + i),
  ...Array.from({ length: N_HAND }, (_, i) => RIGHT_HAND_START + i),
  ...PREVIEW_POSE.map((p) => POSE_START + p),
];
export const PREVIEW_VALUES = POINTS.length * 2;

const round = (v: number | undefined): number | null =>
  v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;

/** Up to PREVIEW_FRAMES evenly spaced frames of the segment. */
export function makePreview(segment: Segment): TakePreview | null {
  const source = segment.frames;
  if (!source.length) return null;
  const count = Math.min(PREVIEW_FRAMES, source.length);
  const frames: (number | null)[][] = [];
  for (let k = 0; k < count; k++) {
    const frame = source[Math.round((k * (source.length - 1)) / Math.max(1, count - 1))];
    if (!frame) continue;
    frames.push(POINTS.flatMap((p) => [round(frame[p * 3]), round(frame[p * 3 + 1])]));
  }
  const duration = segment.durationMs > 0 ? segment.durationMs : (source.length / 30) * 1000;
  const fps = Math.min(60, Math.max(1, (frames.length / duration) * 1000));
  return { fps: Math.round(fps * 100) / 100, frames };
}

type Point = readonly [number, number] | null;

function point(frame: readonly (number | null)[], i: number): Point {
  const x = frame[i * 2];
  const y = frame[i * 2 + 1];
  return x == null || y == null ? null : [x, y];
}

/** Bounding box of every point in the animation, so it is drawn centred and large. */
function bounds(preview: TakePreview) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of preview.frames)
    for (let i = 0; i < POINTS.length; i++) {
      const p = point(f, i);
      if (!p) continue;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export interface PreviewColors {
  body: string;
  left: string;
  right: string;
  joint: string;
}

/** Draws frame `index` of the preview into the canvas (mirrored like the camera view). */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  preview: TakePreview,
  index: number,
  colors: PreviewColors,
  mirror = true,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const box = bounds(preview);
  const frame = preview.frames[index % preview.frames.length];
  if (!box || !frame) return;
  const pad = 0.12;
  const spanX = Math.max(box.maxX - box.minX, 0.05);
  const spanY = Math.max(box.maxY - box.minY, 0.05);
  const scale = Math.min((width * (1 - 2 * pad)) / spanX, (height * (1 - 2 * pad)) / spanY);
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanY * scale) / 2;
  const at = (i: number): Point => {
    const p = point(frame, i);
    if (!p) return null;
    const x = ox + (p[0] - box.minX) * scale;
    return [mirror ? width - x : x, oy + (p[1] - box.minY) * scale];
  };
  const line = (a: Point, b: Point) => {
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Upper body: shoulders, arms, and the head as a circle around the nose.
  const pose = (p: (typeof PREVIEW_POSE)[number]) => at(2 * N_HAND + PREVIEW_POSE.indexOf(p));
  ctx.strokeStyle = colors.body;
  ctx.lineWidth = 3;
  for (const [a, b] of [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ] as const)
    line(pose(a), pose(b));
  const nose = pose(0);
  const ls = pose(11);
  const rs = pose(12);
  if (nose && ls && rs) {
    ctx.beginPath();
    ctx.arc(nose[0], nose[1], Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [offset, color] of [
    [0, colors.left],
    [N_HAND, colors.right],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    for (const [a, b] of HAND_CONNECTIONS) line(at(offset + a), at(offset + b));
    ctx.fillStyle = colors.joint;
    for (let i = 0; i < N_HAND; i++) {
      const p = at(offset + i);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** For tests and replays: a preview frame back into a full landmark frame. */
export function previewFrame(values: readonly (number | null)[], length: number): Frame {
  const frame = new Float32Array(length).fill(Number.NaN);
  POINTS.forEach((p, i) => {
    frame[p * 3] = values[i * 2] ?? Number.NaN;
    frame[p * 3 + 1] = values[i * 2 + 1] ?? Number.NaN;
  });
  return frame;
}

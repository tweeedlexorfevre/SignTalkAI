import { LEFT_HAND_START, RIGHT_HAND_START, type Frame } from '../ml/landmarks';
import type { FeatureSet } from '../ml/features';
import type { Delegate } from '../ml/tracker-core';

export const SCHEMA_VERSION = 'signtalk.hands.v1' as const;
export const CONSENT_VERSION = 'local-hands-2026-11-17' as const;
export const MAX_SAMPLES = 200;
export const CAPTURE_MS = 2500;
export const MAX_FRAMES = 180;
export type SignLanguage = 'krsl' | 'rsl' | 'asl';
export interface SampleLabel {
  language: SignLanguage;
  classId: string;
  ru: string;
  kk: string;
}
export type Point = [number, number, number] | null;
export type Hand = Point[] | null;
export interface HandFrame {
  tMs: number;
  left: Hand;
  right: Hand;
  poses: number;
}
export interface Quality {
  frames: number;
  handFrames: number;
  handCoverage: number;
  observedFps: number;
  maxGapMs: number;
  issues: ('few-frames' | 'hands-missing' | 'slow-tracker' | 'gap' | 'multiple-people')[];
}
export interface DatasetSample {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  recordedAt: string;
  label: SampleLabel;
  participantId: string;
  sessionId: string;
  consent: {
    version: typeof CONSENT_VERSION;
    acceptedAt: string;
    scope: 'local-landmarks-and-export';
  };
  source: 'camera';
  camera: { width: number; height: number; frameRate: number | null };
  tracker: {
    library: '@mediapipe/tasks-vision';
    version: string;
    featureSet: FeatureSet;
    delegate: Delegate;
    landmarkModel: string;
  };
  coordinates: 'mediapipe-normalized-xyz-unmirrored';
  featureVersion: 'raw-hands-xyz-v1';
  durationMs: number;
  frames: HandFrame[];
  quality: Quality;
}

export function validLabel(label: SampleLabel): boolean {
  return (
    ['krsl', 'rsl', 'asl'].includes(label.language) &&
    /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(label.classId) &&
    [label.ru, label.kk].every((s) => s.trim().length > 0 && s.length <= 100)
  );
}

function hand(frame: Frame, start: number): Hand {
  const points: Point[] = Array.from({ length: 21 }, (_, i) => {
    const at = (start + i) * 3;
    const xyz = [frame[at], frame[at + 1], frame[at + 2]];
    return xyz.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? (xyz as [number, number, number])
      : null;
  });
  return points.some((p) => p !== null) ? points : null;
}

/** Timestamps are camera acquisition times, not worker delivery times. */
export class HandCapture {
  readonly frames: HandFrame[] = [];
  constructor(readonly startedAt: number) {}
  add(frame: Frame, t: number, poses: number): void {
    const tMs = Math.round((t - this.startedAt) * 1000) / 1000;
    if (
      !Number.isFinite(tMs) ||
      tMs < 0 ||
      tMs > CAPTURE_MS ||
      this.frames.length >= MAX_FRAMES ||
      tMs <= (this.frames.at(-1)?.tMs ?? -1)
    )
      return;
    this.frames.push({
      tMs,
      left: hand(frame, LEFT_HAND_START),
      right: hand(frame, RIGHT_HAND_START),
      poses,
    });
  }
}

export function assessQuality(frames: readonly HandFrame[], durationMs: number): Quality {
  const fullHand = (h: Hand) => h !== null && h.length === 21 && h.every((p) => p !== null);
  const handFrames = frames.filter((f) => fullHand(f.left) || fullHand(f.right)).length;
  const handCoverage = frames.length ? handFrames / frames.length : 0;
  const span = (frames.at(-1)?.tMs ?? 0) - (frames[0]?.tMs ?? 0);
  const observedFps = span > 0 ? ((frames.length - 1) * 1000) / span : 0;
  const gaps = frames.map((f, i) => f.tMs - (frames[i - 1]?.tMs ?? 0));
  const maxGapMs = Math.max(0, durationMs - (frames.at(-1)?.tMs ?? 0), ...gaps);
  const issues: Quality['issues'] = [];
  if (frames.length < 12 || handFrames < 12) issues.push('few-frames');
  if (handCoverage < 0.6) issues.push('hands-missing');
  if (observedFps < 5) issues.push('slow-tracker');
  if (maxGapMs > 600) issues.push('gap');
  if (frames.some((f) => f.poses > 1)) issues.push('multiple-people');
  return { frames: frames.length, handFrames, handCoverage, observedFps, maxGapMs, issues };
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const date = (v: unknown) => short(v, 40) && Number.isFinite(Date.parse(v));
function validHand(h: unknown): boolean {
  return (
    h === null ||
    (Array.isArray(h) &&
      h.length === 21 &&
      h.every(
        (p: unknown) =>
          p === null ||
          (Array.isArray(p) &&
            p.length === 3 &&
            p.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))),
      ))
  );
}

/** Reject corrupt/foreign records without silently deleting participant data. */
export function readSample(raw: unknown): DatasetSample | null {
  if (
    !record(raw) ||
    raw['schemaVersion'] !== SCHEMA_VERSION ||
    !short(raw['id'], 100) ||
    !date(raw['recordedAt']) ||
    !short(raw['participantId'], 64) ||
    !short(raw['sessionId'], 100) ||
    raw['source'] !== 'camera' ||
    raw['coordinates'] !== 'mediapipe-normalized-xyz-unmirrored' ||
    raw['featureVersion'] !== 'raw-hands-xyz-v1' ||
    raw['durationMs'] !== CAPTURE_MS
  )
    return null;
  const label = raw['label'];
  const camera = raw['camera'];
  if (
    !record(camera) ||
    !Number.isInteger(camera['width']) ||
    !Number.isInteger(camera['height']) ||
    (camera['width'] as number) <= 0 ||
    (camera['height'] as number) <= 0 ||
    !(
      camera['frameRate'] === null ||
      (typeof camera['frameRate'] === 'number' &&
        Number.isFinite(camera['frameRate']) &&
        camera['frameRate'] > 0)
    )
  )
    return null;
  if (
    !record(label) ||
    !short(label['classId'], 64) ||
    !short(label['ru'], 100) ||
    !short(label['kk'], 100) ||
    !validLabel(label as unknown as SampleLabel)
  )
    return null;
  const consent = raw['consent'];
  if (
    !record(consent) ||
    consent['version'] !== CONSENT_VERSION ||
    !date(consent['acceptedAt']) ||
    consent['scope'] !== 'local-landmarks-and-export'
  )
    return null;
  const tracker = raw['tracker'];
  if (
    !record(tracker) ||
    tracker['library'] !== '@mediapipe/tasks-vision' ||
    !short(tracker['version'], 30) ||
    !short(tracker['landmarkModel'], 200) ||
    !['hands_pose', 'hands_pose_lips'].includes(String(tracker['featureSet'])) ||
    !['GPU', 'CPU'].includes(String(tracker['delegate']))
  )
    return null;
  const frames = raw['frames'];
  if (!Array.isArray(frames) || frames.length > MAX_FRAMES) return null;
  let previous = -1;
  for (const f of frames as unknown[]) {
    if (
      !record(f) ||
      typeof f['tMs'] !== 'number' ||
      !Number.isFinite(f['tMs']) ||
      f['tMs'] <= previous ||
      f['tMs'] < 0 ||
      f['tMs'] > CAPTURE_MS ||
      !validHand(f['left']) ||
      !validHand(f['right']) ||
      !Number.isInteger(f['poses']) ||
      (f['poses'] as number) < 0 ||
      (f['poses'] as number) > 2
    )
      return null;
    previous = f['tMs'];
  }
  const quality = assessQuality(frames as HandFrame[], CAPTURE_MS);
  if (quality.issues.length) return null;
  return { ...raw, quality } as unknown as DatasetSample;
}

export function exportDataset(
  samples: readonly DatasetSample[],
  exportedAt = new Date().toISOString(),
): string {
  if (samples.length > MAX_SAMPLES || samples.some((s) => !readSample(s)))
    throw Error('Invalid dataset');
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      application: 'SignTalk AI',
      containsVideo: false,
      containsAudio: false,
      splitPolicy: 'participantId: keep each participant in only one of train/validation/test',
      samples: samples.map((s) => readSample(s)),
    },
    null,
    2,
  );
}

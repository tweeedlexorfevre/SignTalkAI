import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MS,
  HandCapture,
  assessQuality,
  exportDataset,
  readSample,
  validLabel,
  type DatasetSample,
} from './schema';
import { LEFT_HAND_START, emptyFrame } from '../ml/landmarks';
import { sample } from '../test-support/dataset';

describe('dataset contract', () => {
  it('keeps raw xyz, missing hands, acquisition times and participant split metadata across JSON', () => {
    const original = sample();
    const exported = JSON.parse(exportDataset([original])) as {
      samples: DatasetSample[];
      splitPolicy: string;
      containsVideo: boolean;
    };
    expect(readSample(exported.samples[0])).toEqual(original);
    expect(exported.samples[0]?.frames[0]).toMatchObject({ tMs: 0, right: null });
    expect(exported.samples[0]?.frames[0]?.left?.[0]?.[2]).toBeCloseTo(-0.02);
    expect(exported.splitPolicy).toContain('participantId');
    expect(exported.containsVideo).toBe(false);
    expect(exported.samples[0]?.frames[0]).not.toHaveProperty('face');
  });
  it('drops late, repeated, nonfinite and out-of-window timestamps', () => {
    const capture = new HandCapture(1000);
    for (const t of [900, 1010, 1010, NaN, 1009, 1100, 4000]) capture.add(emptyFrame(), t, 0);
    expect(capture.frames.map((f) => f.tMs)).toEqual([10, 100]);
  });
  it('represents a partially missing hand as null points, never NaN or zero imputation', () => {
    const capture = new HandCapture(0);
    const frame = emptyFrame();
    frame.set([0.2, 0.4, 0], LEFT_HAND_START * 3);
    capture.add(frame, 1, 1);
    expect(capture.frames[0]?.left?.[0]).toEqual([expect.closeTo(0.2), expect.closeTo(0.4), 0]);
    expect(capture.frames[0]?.left?.[1]).toBeNull();
    expect(capture.frames[0]?.right).toBeNull();
  });
  it('rejects empty, brief, low coverage, slow, gapped and crowded captures', () => {
    expect(assessQuality([], CAPTURE_MS).issues).toContain('hands-missing');
    const good = sample();
    expect(good.quality.issues).toEqual([]);
    expect(assessQuality(good.frames.slice(0, 3), CAPTURE_MS).issues).toContain('few-frames');
    expect(
      assessQuality(
        good.frames.filter((_, i) => i % 12 === 0),
        CAPTURE_MS,
      ).issues,
    ).toContain('slow-tracker');
    expect(
      assessQuality(
        good.frames.filter((f) => f.tMs < 500 || f.tMs > 1500),
        CAPTURE_MS,
      ).issues,
    ).toContain('gap');
    expect(
      assessQuality(
        good.frames.map((f) => ({ ...f, left: null })),
        CAPTURE_MS,
      ).issues,
    ).toContain('hands-missing');
    expect(
      assessQuality(
        good.frames.map((f) => ({ ...f, poses: 2 })),
        CAPTURE_MS,
      ).issues,
    ).toContain('multiple-people');
  });
  it('recomputes quality and rejects corrupt coordinates, consent, schema, timestamps and labels', () => {
    const original = sample();
    expect(readSample({ ...original, quality: null })?.quality).toEqual(original.quality);
    for (const corrupt of [
      { ...original, schemaVersion: 'v999' },
      { ...original, consent: null },
      { ...original, participantId: '' },
      { ...original, frames: [original.frames[0], original.frames[0]] },
      { ...original, frames: original.frames.map((f) => ({ ...f, left: [[Infinity, 0, 0]] })) },
      { ...original, label: { ...original.label, classId: '../invalid' } },
    ])
      expect(readSample(corrupt)).toBeNull();
    expect(() => exportDataset([{ ...original, frames: [] }])).toThrow();
    expect(validLabel({ ...original.label, kk: '' })).toBe(false);
  });
});

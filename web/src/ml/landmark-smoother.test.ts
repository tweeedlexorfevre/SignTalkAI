import { describe, expect, it } from 'vitest';
import { emptyFrame, RIGHT_HAND_START } from './landmarks';
import { LandmarkSmoother } from './landmark-smoother';

const point = (x: number) => {
  const frame = emptyFrame();
  frame[RIGHT_HAND_START * 3] = x;
  frame[RIGHT_HAND_START * 3 + 1] = 0.4;
  frame[RIGHT_HAND_START * 3 + 2] = 0;
  return frame;
};

describe('LandmarkSmoother', () => {
  it('damps a small one-frame landmark wobble', () => {
    const smoother = new LandmarkSmoother();
    smoother.filter(point(0.5), 0);
    smoother.filter(point(0.5), 33);
    const filtered = smoother.filter(point(0.56), 66);
    expect(filtered[RIGHT_HAND_START * 3]).toBeGreaterThan(0.5);
    expect(filtered[RIGHT_HAND_START * 3]).toBeLessThan(0.56);
  });

  it('does not fabricate a point during a MediaPipe dropout', () => {
    const smoother = new LandmarkSmoother();
    smoother.filter(point(0.5), 0);
    const missing = smoother.filter(emptyFrame(), 33);
    expect(Number.isNaN(missing[RIGHT_HAND_START * 3])).toBe(true);
  });

  it('forgets stale coordinates after a long stream pause', () => {
    const smoother = new LandmarkSmoother();
    smoother.filter(point(0.2), 0);
    const afterPause = smoother.filter(point(0.8), 700);
    expect(afterPause[RIGHT_HAND_START * 3]).toBeCloseTo(0.8);
  });
});

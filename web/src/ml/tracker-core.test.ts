import { expect, it, vi } from 'vitest';
import { Segmenter, type SegmentEvent } from './segmenter';
import { createTracker } from './tracker-core';

vi.mock('@mediapipe/tasks-vision', () => {
  const point = (x: number, y: number) => ({ x, y, z: 0 });
  const pose = Array.from({ length: 33 }, () => point(0.5, 0.6));
  pose[11] = point(0.62, 0.6);
  pose[12] = point(0.38, 0.6);
  return {
    FilesetResolver: { forVisionTasks: () => Promise.resolve({}) },
    HandLandmarker: {},
    PoseLandmarker: {},
    HolisticLandmarker: {
      createFromOptions: () =>
        Promise.resolve({
          detectForVideo: (_: unknown, t: number) => ({
            leftHandLandmarks: [],
            rightHandLandmarks: [
              Array.from({ length: 21 }, (_, i) => point((t < 400 ? 0.3 : 0.32) + i * 0.003, 0.4)),
            ],
            poseLandmarks: [pose],
            faceLandmarks: [],
          }),
          close() {},
        }),
    },
  };
});

it('lets the segmenter recognize a short hand movement followed by a hold', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(new Uint8Array([0])))),
  );
  try {
    const tracker = await createTracker({ featureSet: 'hands_pose_lips', delegate: 'CPU' });
    const segmenter = new Segmenter();
    const events: SegmentEvent[] = [];
    const video = {} as HTMLVideoElement;
    for (let i = 0; i < 35; i++) {
      const t = (i * 1000) / 30;
      const event = segmenter.push(tracker.detect(video, t).frame, t);
      if (event) events.push(event);
    }
    expect(events.map(({ type }) => type)).toEqual(['start', 'end']);
    tracker.close();
  } finally {
    vi.unstubAllGlobals();
  }
});

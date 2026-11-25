import { afterEach, expect, it, vi } from 'vitest';
import type { Tracker } from './tracker-core';
import type { TrackerWorkerOut } from './tracker-protocol';

const mocks = vi.hoisted(() => {
  const detect = vi.fn(() => ({ frame: new Float32Array(1629), poses: 1, hands: 1 }));
  const close = vi.fn();
  const createTracker = vi.fn((): Promise<Tracker> =>
    Promise.resolve({ delegate: 'CPU', detect, close }),
  );
  return { detect, close, createTracker };
});

vi.mock('./tracker-core', () => ({ createTracker: mocks.createTracker }));

import { TrackerClient } from './tracker-client';

function readyVideo(): HTMLVideoElement {
  return {
    readyState: 2,
    videoWidth: 640,
    requestVideoFrameCallback: () => 0,
  } as unknown as HTMLVideoElement;
}

afterEach(() => {
  mocks.detect.mockClear();
  mocks.close.mockClear();
  mocks.createTracker.mockClear();
  vi.unstubAllGlobals();
});

it('uses the page-thread tracker when a mobile browser cannot create video ImageBitmaps', async () => {
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('createImageBitmap', undefined);
  vi.stubGlobal('performance', { now: () => 100 });
  const tracker = await TrackerClient.create('hands_pose_lips');
  const received = vi.fn();
  tracker.start(readyVideo(), received);
  expect(mocks.createTracker).toHaveBeenCalledWith({
    featureSet: 'hands_pose_lips',
    delegate: 'GPU',
  });
  expect(mocks.detect).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenCalledWith(expect.objectContaining({ poses: 1 }));
  tracker.dispose();
  expect(mocks.close).toHaveBeenCalledTimes(1);
});

it('closes a fallback tracker that finishes loading after the call ends', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: TrackerWorkerOut }) => void) | null = null;
      postMessage() {
        this.onmessage?.({ data: { type: 'ready', delegate: 'GPU' } });
      }
      terminate() {}
    },
  );
  vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('cannot read video frame')));
  let finishLoading: ((tracker: Tracker) => void) | undefined;
  mocks.createTracker.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishLoading = resolve;
      }),
  );
  const tracker = await TrackerClient.create('hands_pose_lips');
  const received = vi.fn();
  tracker.start(readyVideo(), received);
  await vi.waitFor(() => {
    expect(mocks.createTracker).toHaveBeenCalledTimes(1);
  });
  tracker.dispose();
  finishLoading?.({ delegate: 'CPU', detect: mocks.detect, close: mocks.close });
  await vi.waitFor(() => {
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  expect(received).not.toHaveBeenCalled();
});

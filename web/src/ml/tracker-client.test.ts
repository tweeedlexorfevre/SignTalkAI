import { afterEach, expect, it, vi } from 'vitest';
import { TrackerClient } from './tracker-client';
import type { TrackerWorkerIn, TrackerWorkerOut } from './tracker-protocol';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: TrackerWorkerOut }) => void) | null = null;
  onerror = null;
  messages: TrackerWorkerIn[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: TrackerWorkerIn) {
    this.messages.push(message);
    if (message.type === 'init')
      queueMicrotask(() => {
        this.reply({ type: 'ready', delegate: 'CPU' });
      });
  }
  reply(message: TrackerWorkerOut) {
    this.onmessage?.({ data: message });
  }
  terminate() {}
}

function video() {
  const callbacks: (() => void)[] = [];
  return {
    callbacks,
    element: {
      readyState: 2,
      videoWidth: 640,
      requestVideoFrameCallback: (f: () => void) => callbacks.push(f),
    } as unknown as HTMLVideoElement,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

it('closes a pending bitmap instead of sending it after camera stop', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const close = vi.fn();
  const bitmap = { close } as unknown as ImageBitmap;
  let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined;
  vi.stubGlobal(
    'createImageBitmap',
    () =>
      new Promise<ImageBitmap>((resolve) => {
        resolveBitmap = resolve;
      }),
  );
  const tracker = await TrackerClient.create('hands_pose_lips');
  tracker.start(video().element, vi.fn());
  tracker.stop();
  resolveBitmap?.(bitmap);
  await Promise.resolve();
  expect(close).toHaveBeenCalled();
  expect(FakeWorker.last.messages.filter((m) => m.type === 'frame')).toHaveLength(0);
});

it('rejects old worker results and old scheduled callbacks after a restart', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const create = vi.fn(() => Promise.resolve({ close: vi.fn() }));
  vi.stubGlobal('createImageBitmap', create);
  let now = 100;
  vi.stubGlobal('performance', { now: () => now });
  const tracker = await TrackerClient.create('hands_pose_lips');
  const source = video();
  const oldListener = vi.fn();
  const newListener = vi.fn();
  tracker.start(source.element, oldListener);
  await Promise.resolve();
  tracker.stop();
  now = 200;
  tracker.start(source.element, newListener);
  FakeWorker.last.reply({
    type: 'landmarks',
    t: 100,
    ms: 5,
    poses: 1,
    hands: 0,
    frame: new Float32Array(1629),
  });
  expect(newListener).not.toHaveBeenCalled();
  source.callbacks[0]?.();
  expect(create).toHaveBeenCalledTimes(1);
  source.callbacks[1]?.();
  await Promise.resolve();
  FakeWorker.last.reply({
    type: 'landmarks',
    t: 200,
    ms: 5,
    poses: 1,
    hands: 0,
    frame: new Float32Array(1629),
  });
  expect(newListener).toHaveBeenCalledTimes(1);
  expect(oldListener).not.toHaveBeenCalled();
  tracker.dispose();
});

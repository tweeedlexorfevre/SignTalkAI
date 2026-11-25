/**
 * Page-side handle on MediaPipe. Normally it feeds camera frames to a worker,
 * one at a time. Older mobile browsers cannot transfer a video frame to a
 * worker, so it transparently falls back to the same tracker on the page
 * thread rather than silently disabling sign translation during a call.
 */
import type { FeatureSet } from './features';
import type { TrackedFrame } from './recognizer';
import type { Delegate, Tracker } from './tracker-core';
import type { TrackerWorkerIn, TrackerWorkerOut } from './tracker-protocol';

export interface TrackerFrame extends TrackedFrame {
  ms: number;
}

/** A transient capture or detection error should only drop that frame. */
const MAX_CONSECUTIVE_FRAME_ERRORS = 3;

async function createPageTracker(featureSet: FeatureSet): Promise<Tracker> {
  const { createTracker } = await import('./tracker-core');
  return createTracker({ featureSet, delegate: 'GPU' });
}

export class TrackerClient {
  private running = false;
  private disposed = false;
  private busy = false;
  private frameErrors = 0;
  private generation = 0;
  private startedAt = 0;
  private onFrame: ((frame: TrackerFrame) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private mainTracker: Tracker | null = null;
  private failure: Error | null = null;

  private constructor(
    private worker: Worker | null,
    private readonly featureSet: FeatureSet,
    private _delegate: Delegate,
  ) {
    if (!worker) return;
    worker.onmessage = (event: MessageEvent<TrackerWorkerOut>) => {
      if (this.worker !== worker) return;
      const msg = event.data;
      if (msg.type === 'landmarks') {
        this.busy = false;
        if (this.running && msg.t >= this.startedAt) {
          this.frameErrors = 0;
          this.onFrame?.({ frame: msg.frame, t: msg.t, poses: msg.poses, ms: msg.ms });
        }
      } else if (msg.type === 'frame-error') {
        this.busy = false;
        if (this.running && msg.t >= this.startedAt) this.onWorkerFrameError(worker);
      }
    };
    worker.onerror = worker.onmessageerror = () => {
      this.fallbackToMainThread(worker);
    };
  }

  get delegate(): Delegate {
    return this._delegate;
  }

  private static async createOnMainThread(featureSet: FeatureSet): Promise<TrackerClient> {
    const tracker = await createPageTracker(featureSet);
    const client = new TrackerClient(null, featureSet, tracker.delegate);
    client.mainTracker = tracker;
    return client;
  }

  static async create(featureSet: FeatureSet): Promise<TrackerClient> {
    // iOS Safari may expose Worker but not support ImageBitmap(video). In that
    // case MediaPipe still works on the page thread and sees the WebRTC camera.
    if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') {
      return this.createOnMainThread(featureSet);
    }
    let worker: Worker | undefined;
    try {
      const created = new Worker(new URL('./tracker.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker = created;
      const reply = await new Promise<TrackerWorkerOut>((resolve, reject) => {
        created.onmessage = (event: MessageEvent<TrackerWorkerOut>) => {
          resolve(event.data);
        };
        created.onerror = (event) => {
          reject(new Error(event.message || 'the landmark worker failed to start'));
        };
        created.onmessageerror = () => {
          reject(new Error('could not read the landmark worker reply'));
        };
        const msg: TrackerWorkerIn = { type: 'init', featureSet, delegate: 'GPU' };
        created.postMessage(msg);
      });
      if (reply.type !== 'ready')
        throw new Error(reply.type === 'init-error' ? reply.message : 'unexpected reply');
      return new TrackerClient(worker, featureSet, reply.delegate);
    } catch {
      worker?.terminate();
      return this.createOnMainThread(featureSet);
    }
  }

  /** Track `video` until stop(); frames that arrive while one is being processed are skipped. */
  start(
    video: HTMLVideoElement,
    onFrame: (frame: TrackerFrame) => void,
    onError?: (error: Error) => void,
  ): void {
    this.stop();
    if (this.disposed) return;
    if (this.failure) {
      onError?.(this.failure);
      return;
    }
    const generation = this.generation;
    this.startedAt = performance.now();
    this.onFrame = onFrame;
    this.onError = onError ?? null;
    this.running = true;
    const tick = () => {
      if (!this.running || generation !== this.generation) return;
      if (typeof video.requestVideoFrameCallback === 'function')
        video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
      if (!this.busy && video.readyState >= 2 && video.videoWidth > 0) {
        if (this.mainTracker) this.detectOnMainThread(this.mainTracker, video);
        else if (this.worker) void this.detectInWorker(this.worker, video, generation);
      }
    };
    tick();
  }

  stop(): void {
    this.generation++;
    this.running = false;
    this.frameErrors = 0;
    this.onFrame = null;
    this.onError = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.mainTracker?.close();
    this.mainTracker = null;
  }

  private detectOnMainThread(tracker: Tracker, video: HTMLVideoElement): void {
    const t = performance.now();
    let detected: ReturnType<Tracker['detect']>;
    try {
      detected = tracker.detect(video, t);
    } catch (error) {
      this.fail(error);
      return;
    }
    this.onFrame?.({ frame: detected.frame, t, poses: detected.poses, ms: performance.now() - t });
  }

  private async detectInWorker(
    worker: Worker,
    video: HTMLVideoElement,
    generation: number,
  ): Promise<void> {
    this.busy = true;
    const t = performance.now();
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(video);
      if (!this.running || generation !== this.generation || this.worker !== worker) {
        bitmap.close();
        if (this.worker === worker) this.busy = false;
        return;
      }
      const msg: TrackerWorkerIn = { type: 'frame', bitmap, t };
      worker.postMessage(msg, [bitmap]);
    } catch {
      bitmap?.close();
      if (this.worker !== worker) return;
      this.busy = false;
      if (this.running && generation === this.generation) this.onWorkerFrameError(worker);
    }
  }

  private onWorkerFrameError(worker: Worker): void {
    this.frameErrors++;
    if (this.frameErrors >= MAX_CONSECUTIVE_FRAME_ERRORS) this.fallbackToMainThread(worker);
  }

  private fallbackToMainThread(worker: Worker): void {
    if (this.worker !== worker) return;
    worker.terminate();
    this.worker = null;
    this.busy = false;
    void createPageTracker(this.featureSet).then(
      (tracker) => {
        if (this.disposed) {
          tracker.close();
          return;
        }
        this.mainTracker = tracker;
        this._delegate = tracker.delegate;
      },
      (error: unknown) => {
        if (!this.disposed) this.fail(error);
      },
    );
  }

  private fail(error: unknown): void {
    this.failure = error instanceof Error ? error : new Error(String(error));
    const onError = this.onError;
    this.stop();
    onError?.(this.failure);
  }
}

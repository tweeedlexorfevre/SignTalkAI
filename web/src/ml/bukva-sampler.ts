/**
 * Feeds a playing <video> to the Bukva fingerspelling model: samples frames at
 * ~15 fps (the upstream demo keeps every 2nd frame of a 30 fps camera),
 * letterboxes them to 224×224 and runs overlapping 8-frame windows.
 * Raw (unmirrored) camera pixels are used, like the upstream demo.
 */
import { BUKVA_FRAMES, BUKVA_SIZE, letterbox, putBukvaFrame, type LocalGuess } from './local-model';

const SAMPLE_MS = 1000 / 15;
/** New frames between two windows (windows overlap by half). */
const STRIDE = BUKVA_FRAMES / 2;
const PIXELS = BUKVA_SIZE * BUKVA_SIZE;

export class BukvaSampler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private frames: Float32Array[] = [];
  private fresh = 0;
  private busy = false;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly infer: (input: Float32Array) => Promise<LocalGuess[]>,
    private readonly onResult: (guesses: LocalGuess[], ms: number) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    if (this.running) return;
    const canvas = document.createElement('canvas');
    canvas.width = BUKVA_SIZE;
    canvas.height = BUKVA_SIZE;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!this.ctx) throw Error('Canvas unavailable');
    this.running = true;
    this.frames = [];
    this.fresh = 0;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.frames = [];
  }

  private tick = (): void => {
    if (!this.running) return;
    const due = performance.now() + SAMPLE_MS;
    try {
      this.sample();
    } catch (error) {
      this.stop();
      this.onError(error);
      return;
    }
    this.timer = setTimeout(this.tick, Math.max(0, due - performance.now()));
  };

  private sample(): void {
    const v = this.video;
    const ctx = this.ctx;
    if (!ctx || !v.videoWidth || v.readyState < 2) return;
    const box = letterbox(v.videoWidth, v.videoHeight);
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, BUKVA_SIZE, BUKVA_SIZE);
    ctx.drawImage(v, box.x, box.y, box.w, box.h);
    const frame = new Float32Array(3 * PIXELS);
    putBukvaFrame(frame, ctx.getImageData(0, 0, BUKVA_SIZE, BUKVA_SIZE).data, 0, PIXELS, 1);
    this.frames.push(frame);
    if (this.frames.length > BUKVA_FRAMES) this.frames.shift();
    this.fresh++;
    if (this.frames.length < BUKVA_FRAMES || this.fresh < STRIDE || this.busy) return;
    this.fresh = 0;
    this.busy = true;
    const input = new Float32Array(BUKVA_FRAMES * 3 * PIXELS);
    this.frames.forEach((f, i) => {
      input.set(f, i * 3 * PIXELS);
    });
    const began = performance.now();
    this.infer(input)
      .then((guesses) => {
        if (this.running) this.onResult(guesses, Math.round(performance.now() - began));
      })
      .catch((error: unknown) => {
        if (!this.running) return;
        this.stop();
        this.onError(error);
      })
      .finally(() => {
        this.busy = false;
      });
  }
}

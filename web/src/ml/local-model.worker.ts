import * as ort from 'onnxruntime-web/wasm';
import { isTrustedOrigin } from './worker-guard';
type Kind = 'krsl' | 'rsl' | 'bukva';
const SHAPES: Record<Kind, number[]> = {
  krsl: [1, 168],
  rsl: [1, 3, 32, 224, 224],
  bukva: [1, 8, 3, 224, 224],
};
const ctx = self as unknown as {
  location: { origin: string };
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown, transfers?: Transferable[]) => void;
};
let model: ort.InferenceSession | null = null;
let kind: Kind = 'krsl';
async function handle(event: MessageEvent): Promise<void> {
  if (!isTrustedOrigin(event.origin, ctx.location.origin)) return;
  const msg = event.data as {
    id?: number;
    type?: string;
    kind?: Kind;
    base?: string;
    data?: Float32Array;
  };
  if (!Number.isSafeInteger(msg.id)) return;
  try {
    if (msg.type === 'load') {
      if (
        (msg.kind !== 'krsl' && msg.kind !== 'rsl' && msg.kind !== 'bukva') ||
        typeof msg.base !== 'string' ||
        !msg.base.startsWith('/')
      )
        throw Error('Invalid model request');
      kind = msg.kind;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `${msg.base}vendor/ort/`;
      ort.env.logLevel = 'error';
      const response = await fetch(`${msg.base}models/${kind}/model.onnx`);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      model = await ort.InferenceSession.create(await response.arrayBuffer(), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3,
      });
      ctx.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'run') {
      const shape = SHAPES[kind];
      const size = shape.reduce((a, b) => a * b, 1);
      if (
        !model ||
        !(msg.data instanceof Float32Array) ||
        msg.data.length !== size ||
        !msg.data.every(Number.isFinite)
      )
        throw Error('Invalid model input');
      const input = new ort.Tensor('float32', msg.data, shape);
      const inputName = model.inputNames[0];
      const outputName = model.outputNames[0];
      if (!inputName || !outputName) throw Error('Invalid model contract');
      const result = await model.run({ [inputName]: input });
      const data = result[outputName]?.data;
      if (!(data instanceof Float32Array)) throw Error('Invalid model output');
      const logits = data.slice();
      ctx.postMessage({ id: msg.id, ok: true, logits }, [logits.buffer]);
    }
  } catch (error) {
    ctx.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
ctx.onmessage = (event) => {
  void handle(event);
};

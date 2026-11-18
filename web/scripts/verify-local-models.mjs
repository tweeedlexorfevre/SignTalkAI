// Exact web WASM backend: smoke check, not gesture accuracy evaluation.
import * as ort from 'onnxruntime-web/wasm';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('../public/vendor/ort/', import.meta.url).href;
const reports = [];
const DIMS = { bukva: [1, 8, 3, 224, 224] };
const OUTPUTS = { bukva: 34 };
for (const kind of ['bukva']) {
  const model = await ort.InferenceSession.create(
    await readFile(fileURLToPath(new URL(`../public/models/${kind}/model.onnx`, import.meta.url))),
    { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
  );
  const dims = DIMS[kind];
  const count = dims.reduce((a, b) => a * b, 1);
  const data = new Float32Array(count);
  const started = performance.now();
  const result = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', data, dims) });
  const logits = result[model.outputNames[0]].data;
  if (logits.length !== OUTPUTS[kind] || !logits.every(Number.isFinite))
    throw Error(`${kind}: bad output`);
  reports.push({
    kind,
    backend: 'onnxruntime-web / WASM',
    input: 'zero RGB tensor, operator smoke test only',
    outputs: logits.length,
    ms: Math.round(performance.now() - started),
  });
  await model.release();
}
console.log(JSON.stringify(reports, null, 2));
await writeFile(
  new URL('../../docs/WASM_CHECK.json', import.meta.url),
  JSON.stringify(reports, null, 2),
);

// Writes .br and .gz copies of the compressible files in the build output, for
// server/static.mjs to send to browsers that accept them. The point is the ML
// runtime: the MediaPipe and onnxruntime .wasm files drop from ~15 MB to ~2.5 MB
// each. A copy is kept only when it saves at least 5%.
//
//   node scripts/precompress.mjs [dir]     (default: web/dist)
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.wasm',
  '.onnx',
  '.task',
]);
const MIN_SIZE = 1024;
const MAX_RATIO = 0.95;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

async function compress(path) {
  const data = await readFile(path);
  const [br, gzipped] = await Promise.all([
    brotli(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_LGWIN]: constants.BROTLI_MAX_WINDOW_BITS,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    }),
    gz(data, { level: 9 }),
  ]);
  const kept = [];
  for (const [suffix, out] of [
    ['.br', br],
    ['.gz', gzipped],
  ]) {
    if (out.length <= data.length * MAX_RATIO) {
      await writeFile(path + suffix, out);
      kept.push(`${suffix.slice(1)} ${(out.length / 1e6).toFixed(1)} MB`);
    } else {
      await rm(path + suffix, { force: true });
    }
  }
  return { size: data.length, kept };
}

const dir = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url));
const started = Date.now();
const jobs = [];
for await (const path of files(dir)) {
  if (!EXTENSIONS.has(extname(path))) continue;
  if ((await stat(path)).size < MIN_SIZE) continue;
  jobs.push(compress(path).then((r) => ({ path, ...r })));
}
const results = await Promise.all(jobs);
for (const { path, size, kept } of results.sort((a, b) => b.size - a.size).slice(0, 8))
  console.log(
    `  ${relative(dir, path)} ${(size / 1e6).toFixed(1)} MB -> ${kept.join(', ') || 'kept as is'}`,
  );
console.log(
  `precompressed ${results.length} files in ${((Date.now() - started) / 1000).toFixed(0)} s`,
);

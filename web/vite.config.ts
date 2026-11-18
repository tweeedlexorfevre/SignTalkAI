import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildCsp } from './src/csp.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import packageInfo from './package.json' with { type: 'json' };
const { version } = packageInfo;
const buildId = `${version}-${Date.now()}`;
function buildVersion(): Plugin {
  return {
    name: 'signtalk:version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'app-version.json',
        source: JSON.stringify({ version, buildId }),
      });
    },
  };
}

// GitHub Pages serves the site from /<repo>/.
const BASE = '/';

// ORT imports this public ES module at runtime. Vite's dev import-analysis
// otherwise rejects its ?import request. Serve only this pinned runtime raw;
// production already serves it as a static file.
function runtimeModules(): Plugin {
  return {
    name: 'signtalk:runtime-modules',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/vendor/ort/ort-wasm-simd-threaded.mjs') {
          next();
          return;
        }
        try {
          const path = fileURLToPath(
            new URL('./public/vendor/ort/ort-wasm-simd-threaded.mjs', import.meta.url),
          );
          res.setHeader('Content-Type', 'text/javascript');
          void readFile(path)
            .then((data) => {
              res.end(data);
            })
            .catch(next);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

/**
 * Adds the CSP meta tag to builds only (production and the e2e test build).
 * The dev server injects inline scripts for hot reload, which the policy
 * would block.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'gesturesign:csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp() },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [runtimeModules(), react(), tailwindcss(), contentSecurityPolicy(), buildVersion()],
  define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
  resolve: {
    // onnxruntime-web's "extern wasm" builds load their WASM runtime from
    // ort.env.wasm.wasmPaths (public/vendor/ort) instead of bundling a copy.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep every asset a file; inlined data: URIs would need a looser CSP.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5330,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5331', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:5331', ws: true },
    },
  },
  preview: { port: 5331, strictPort: true },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});

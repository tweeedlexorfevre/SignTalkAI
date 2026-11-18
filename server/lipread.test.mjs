import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';

async function withApp(env, run) {
  const app = createApp({ env });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await run(base);
  } finally {
    await app.close();
  }
}

test('lip reading reports offline when the Python service is not running', async () => {
  await withApp({ LIPREAD_URL: 'http://127.0.0.1:9' }, async (base) => {
    const status = await (await fetch(`${base}/api/lipread/status`)).json();
    assert.equal(status.online, false);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
    const r = await fetch(`${base}/api/lipread/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: webm,
    });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'lipread_offline' });
  });
});

test('lip reading rejects non-video uploads before contacting the service', async () => {
  await withApp({ LIPREAD_URL: 'http://127.0.0.1:9' }, async (base) => {
    const r = await fetch(`${base}/api/lipread/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(r.status, 400);
  });
});

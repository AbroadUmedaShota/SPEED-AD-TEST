import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserAcceptanceWorker } from './shared-browser-worker.mjs';

function context(options = {}) {
  const marker = Object.hasOwn(options, 'marker')
    ? options.marker
    : 'support-contact-shared-browser-v1';
  const enabled = Object.hasOwn(options, 'enabled') ? options.enabled : 'enabled';
  const calls = { reads: 0, batches: 0, puts: 0, shared: 0 };
  const env = {
    LOCAL_BROWSER_HARNESS: enabled,
    DB: {
      prepare() {
        calls.reads += 1;
        return { bind() { return this; }, async first() { return marker ? { marker } : null; } };
      },
      async batch() { calls.batches += 1; },
    },
    ATTACHMENTS: { async put() { calls.puts += 1; } },
  };
  const worker = createBrowserAcceptanceWorker({
    async fetch() { calls.shared += 1; return new Response('ok'); },
  });
  return { calls, env, worker };
}

test('wrong host rejects before D1 and R2', async () => {
  const item = context();
  const response = await item.worker.fetch(new Request('https://wrong.example/api/session'), item.env);
  assert.equal(response.status, 403);
  assert.deepEqual(item.calls, { reads: 0, batches: 0, puts: 0, shared: 0 });
});

test('missing local marker rejects before D1 and R2', async () => {
  const item = context({ enabled: undefined });
  const response = await item.worker.fetch(new Request('http://127.0.0.1/api/session'), item.env);
  assert.equal(response.status, 403);
  assert.deepEqual(item.calls, { reads: 0, batches: 0, puts: 0, shared: 0 });
});

test('wrong database sentinel rejects before mutation and R2', async () => {
  const item = context({ marker: 'different-database' });
  const response = await item.worker.fetch(new Request('http://127.0.0.1/api/session'), item.env);
  assert.equal(response.status, 403);
  assert.deepEqual(item.calls, { reads: 1, batches: 0, puts: 0, shared: 0 });
});

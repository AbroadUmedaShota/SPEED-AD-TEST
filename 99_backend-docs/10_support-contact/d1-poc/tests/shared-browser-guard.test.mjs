import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createBrowserAcceptanceWorker } from './shared-browser-worker.mjs';

function context(options = {}) {
  const marker = Object.hasOwn(options, 'marker')
    ? options.marker
    : 'support-contact-shared-browser-v1';
  const enabled = Object.hasOwn(options, 'enabled') ? options.enabled : 'enabled';
  const calls = { reads: 0, batches: 0, puts: 0, shared: 0 };
  const batchSizes = [];
  const env = {
    LOCAL_BROWSER_HARNESS: enabled,
    DB: {
      prepare() {
        calls.reads += 1;
        return { bind() { return this; }, async first() { return marker ? { marker } : null; } };
      },
      async batch(statements) { calls.batches += 1; batchSizes.push(statements.length); },
    },
    ATTACHMENTS: { async put() { calls.puts += 1; } },
  };
  const worker = createBrowserAcceptanceWorker({
    async fetch() { calls.shared += 1; return new Response('ok'); },
  });
  return { batchSizes, calls, env, worker };
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

test('first allowed request bootstraps 55 cases once and later requests reuse it', async () => {
  const item = context();
  let response = await item.worker.fetch(new Request('http://127.0.0.1/api/session'), item.env);
  assert.equal(response.status, 200);
  response = await item.worker.fetch(new Request('http://127.0.0.1/api/cases'), item.env);
  assert.equal(response.status, 200);
  assert.deepEqual(item.batchSizes, [63]);
  assert.equal(item.calls.batches, 1);
  assert.equal(item.calls.puts, 1);
  assert.equal(item.calls.shared, 2);
});

test('PowerShell readiness uses a unique loopback TCP listener without HTTP polling', async () => {
  const script = await readFile(path.join(import.meta.dirname, 'run-shared-browser-acceptance.ps1'), 'utf8');
  assert.match(script, /\[int\]\$Port = 0/);
  assert.match(script, /TcpListener/);
  assert.match(script, /TcpClient/);
  assert.equal(script.includes('Invoke-WebRequest'), false);
  for (const stage of ['build', 'migration', 'process', 'listen', 'bootstrap', 'JWT', 'browser']) {
    assert.ok(script.includes(`Set-Stage '${stage}'`), `missing failure stage: ${stage}`);
  }
});

test('browser acceptance waits for observable DOM states instead of fixed delays', async () => {
  const script = await readFile(path.join(import.meta.dirname, 'run-shared-browser-acceptance.ps1'), 'utf8');
  assert.doesNotMatch(script, /Invoke-AgentBrowser @\('wait', '\d+'/);
  for (const state of [
    'authenticated bootstrap did not complete',
    '保存結果を確認できませんでした',
    '保存しました。',
    "textContent === '対応中'",
    '再読込後も保持する下書き',
    '$authCleared',
  ]) {
    assert.ok(script.includes(state), `missing observable browser state: ${state}`);
  }
  assert.match(script, /visible synthetic action labels/);
  assert.match(script, /document\.querySelectorAll\('#actions button'\)/);
});

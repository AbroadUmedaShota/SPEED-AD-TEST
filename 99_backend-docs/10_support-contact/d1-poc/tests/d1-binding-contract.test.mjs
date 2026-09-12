import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const configPath = path.join(projectDir, 'wrangler.jsonc');
const commandEnvironment = {
  ...process.env,
  CI: '1',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
};

let server;
let baseUrl;
let persistenceDir;
let serverOutput = '';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Wrangler exited before startup.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/__test/snapshot`);
      if (response.ok) return;
    } catch {
      // The local workerd socket is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Wrangler.\n${serverOutput}`);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

async function resetDatabase() {
  const result = await requestJson('/__test/reset', { method: 'POST' });
  assert.equal(result.status, 200);
}

function appendNote(requestId, expectedVersion, extraHeaders = {}, note) {
  return requestJson('/api/cases/case-local-1/actions/note', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-poc-actor': 'operator-a',
      ...extraHeaders,
    },
    body: JSON.stringify({
      requestId,
      expectedVersion,
      note: note ?? `synthetic note ${requestId}`,
    }),
  });
}

function requestWithHost(host) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: '/__test/snapshot',
      headers: { host },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.once('error', reject);
    request.end();
  });
}

test.before(async () => {
  persistenceDir = await mkdtemp(path.join(os.tmpdir(), 'contact-d1-poc-'));
  const migration = spawnSync(process.execPath, [
    wranglerBin,
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--persist-to',
    persistenceDir,
    '--config',
    configPath,
  ], {
    cwd: projectDir,
    env: commandEnvironment,
    encoding: 'utf8',
  });
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [
    wranglerBin,
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    persistenceDir,
    '--config',
    configPath,
    '--show-interactive-dev-session=false',
  ], {
    cwd: projectDir,
    env: commandEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collectOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  };
  server.stdout.on('data', collectOutput);
  server.stderr.on('data', collectOutput);
  await waitForServer();
});

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => {
      server.once('exit', resolve);
      setTimeout(resolve, 5_000);
    });
  }
  if (persistenceDir) await rm(persistenceDir, { recursive: true, force: true });
});

test('CAS mismatch followed by a NOT NULL guard rolls back the whole D1 batch', async () => {
  await resetDatabase();
  const result = await appendNote('request-stale', 2);
  assert.equal(result.status, 409);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 1);
  assert.equal(snapshot.body.cases[0].last_request_id, null);
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
});

test('concurrent writers produce one winner and reconcile the loser without orphan rows', async () => {
  await resetDatabase();
  const results = await Promise.all([
    appendNote('request-race-a', 1, { 'x-poc-race-barrier': 'different-ids' }),
    appendNote('request-race-b', 1, { 'x-poc-race-barrier': 'different-ids' }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 2);
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
  assert.equal(snapshot.body.requests[0].request_id, snapshot.body.events[0].request_id);
});

test('same ID and payload race replays one committed receipt', async () => {
  await resetDatabase();
  const headers = { 'x-poc-race-barrier': 'same-payload' };
  const results = await Promise.all([
    appendNote('request-race-same', 1, headers, 'same synthetic note'),
    appendNote('request-race-same', 1, headers, 'same synthetic note'),
  ]);
  assert.deepEqual(results.map(({ status }) => status), [200, 200]);
  assert.deepEqual(results[0].body, results[1].body);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
});

test('same ID with different payloads produces one success and one idempotency conflict', async () => {
  await resetDatabase();
  const headers = { 'x-poc-race-barrier': 'different-payload' };
  const results = await Promise.all([
    appendNote('request-race-conflict', 1, headers, 'first synthetic note'),
    appendNote('request-race-conflict', 1, headers, 'second synthetic note'),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(results.find(({ status }) => status === 409).body.error, 'idempotency_conflict');

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
});

test('retry after an acknowledgement loss returns the stored receipt without duplicate history', async () => {
  await resetDatabase();
  const first = await appendNote('request-ack-loss', 1, { 'x-poc-drop-ack': '1' });
  assert.equal(first.status, 503);

  const retry = await appendNote('request-ack-loss', 1);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.requestId, 'request-ack-loss');
  assert.equal(retry.body.toVersion, 2);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 2);
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
  assert.equal(snapshot.body.requests[0].response_json, JSON.stringify(retry.body));
});

test('injected event failure rolls back request and case update in local D1', async () => {
  await resetDatabase();
  const enabled = await requestJson('/__test/fault', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(enabled.status, 200);

  const failed = await appendNote('request-fault', 1);
  assert.equal(failed.status, 503);
  const failedSnapshot = await requestJson('/__test/snapshot');
  assert.equal(failedSnapshot.body.cases[0].version, 1);
  assert.deepEqual(failedSnapshot.body.requests, []);
  assert.deepEqual(failedSnapshot.body.events, []);

  await requestJson('/__test/fault', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  const retry = await appendNote('request-fault', 1);
  assert.equal(retry.status, 200);
});

test('non-loopback Host is rejected before test or action routing', async () => {
  const result = await requestWithHost('example.invalid');
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'local PoC only');
});

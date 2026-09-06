import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const configPath = path.join(projectDir, 'wrangler.mvp.jsonc');
const actor = 'operator-a@example.invalid';
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

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Wrangler exited.\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/__test/snapshot`);
      if (response.ok) return;
    } catch {
      // Local workerd has not opened the socket yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Wrangler.\n${serverOutput}`);
}

async function resetDatabase() {
  const response = await requestJson('/__test/reset', { method: 'POST' });
  assert.equal(response.status, 200);
}

function authenticatedGet(pathname) {
  return requestJson(pathname, { headers: { 'x-mvp-actor': actor } });
}

function action(name, payload, actorEmail = actor, extraHeaders = {}, caseId = 'case-mvp-1') {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (actorEmail) headers['x-mvp-actor'] = actorEmail;
  return requestJson(`/api/cases/${caseId}/actions/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

function testCommand(pathname, body) {
  return requestJson(`/__test/${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  persistenceDir = await mkdtemp(path.join(os.tmpdir(), 'contact-d1-mvp-'));
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
  const collectOutput = chunk => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  };
  server.stdout.on('data', collectOutput);
  server.stderr.on('data', collectOutput);
  await waitForServer();
});

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => {
      server.once('exit', resolve);
      setTimeout(resolve, 5_000);
    });
  }
  if (persistenceDir) await rm(persistenceDir, { recursive: true, force: true });
});

test('migration creates exactly the five formal MVP tables', async () => {
  await resetDatabase();
  const snapshot = await requestJson('/__test/snapshot');
  assert.deepEqual(snapshot.body.tables, [
    'contact_api_requests',
    'contact_attachments',
    'contact_case_events',
    'contact_cases',
    'contact_operators',
  ]);
  assert.equal(snapshot.body.operators.length, 2);
  assert.equal(snapshot.body.cases.length, 1);
});

test('unassigned case can be assigned, started and noted with contiguous history', async () => {
  await resetDatabase();

  const initialList = await authenticatedGet('/api/cases');
  assert.equal(initialList.status, 200);
  assert.equal(initialList.body.cases[0].assignee_email, null);
  assert.equal(initialList.body.cases[0].status, '未対応');
  assert.equal(initialList.body.cases[0].version, 1);

  const assigned = await action('assign-self', { requestId: 'vertical-assign', expectedVersion: 1 });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.toVersion, 2);
  assert.deepEqual(assigned.body.changes, { assigneeEmail: actor });

  const started = await action('start', { requestId: 'vertical-start', expectedVersion: 2 });
  assert.equal(started.status, 200);
  assert.equal(started.body.toVersion, 3);
  assert.deepEqual(started.body.changes, { status: '対応中' });

  const noted = await action('note', {
    requestId: 'vertical-note',
    expectedVersion: 3,
    note: '合成案件の確認内容を記録しました。',
  });
  assert.equal(noted.status, 200);
  assert.equal(noted.body.toVersion, 4);

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.assignee_email, actor);
  assert.equal(detail.body.case.status, '対応中');
  assert.equal(detail.body.case.version, 4);

  const history = await authenticatedGet('/api/cases/case-mvp-1/events');
  assert.deepEqual(history.body.events.map(event => event.event_type), [
    'assigned',
    'started',
    'note_added',
  ]);
  assert.deepEqual(history.body.events.map(event => event.to_version), [2, 3, 4]);
  assert.ok(history.body.events.every(event => event.actor_email === actor));
});

test('stale version rejects the action without request or history orphan rows', async () => {
  await resetDatabase();
  const stale = await action('assign-self', { requestId: 'stale-assign', expectedVersion: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'version_conflict');
  assert.equal(stale.body.currentVersion, 1);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 1);
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
});

test('same note request replays one receipt and creates one event', async () => {
  await resetDatabase();
  const payload = { requestId: 'retry-note', expectedVersion: 1, note: '同じ合成メモ' };
  const first = await action('note', payload);
  const retry = await action('note', payload);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, first.body);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
  assert.equal(snapshot.body.cases[0].version, 2);
});

test('deterministic post-preflight assignment race rolls back the loser without orphan rows', async () => {
  await resetDatabase();
  const results = await Promise.all([
    action('assign-self', { requestId: 'assign-race-a', expectedVersion: 1 }, actor,
      { 'x-mvp-race-barrier': 'assignment-race' }),
    action('assign-self', { requestId: 'assign-race-b', expectedVersion: 1 },
      'operator-b@example.invalid', { 'x-mvp-race-barrier': 'assignment-race' }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
  assert.equal(snapshot.body.cases[0].version, 2);
  assert.equal(snapshot.body.cases[0].last_request_id, snapshot.body.requests[0].request_id);
  assert.equal(snapshot.body.events[0].request_id, snapshot.body.requests[0].request_id);
});

test('event constraint failure rolls back request, case update and history', async () => {
  await resetDatabase();
  const failed = await action('note', {
    requestId: 'failed-event',
    expectedVersion: 1,
    note: '保存されない合成メモ',
  }, actor, { 'x-mvp-fail-event': '1' });
  assert.equal(failed.status, 503);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 1);
  assert.equal(snapshot.body.cases[0].last_request_id, null);
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
});

test('assign-self only accepts an unassigned unresolved case', async () => {
  await resetDatabase();
  const first = await action('assign-self', { requestId: 'first-assign', expectedVersion: 1 });
  assert.equal(first.status, 200);
  const second = await action('assign-self', { requestId: 'second-assign', expectedVersion: 2 });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'state_conflict');

  await resetDatabase();
  await testCommand('case-status', { status: '対応済み' });
  const resolved = await action('assign-self', { requestId: 'resolved-assign', expectedVersion: 1 });
  assert.equal(resolved.status, 409);
  assert.equal(resolved.body.error, 'state_conflict');
});

test('a different active operator can update a case assigned to another operator', async () => {
  await resetDatabase();
  const assigned = await action('assign-self', { requestId: 'owner-assign', expectedVersion: 1 });
  assert.equal(assigned.status, 200);
  const note = await action('note', {
    requestId: 'other-operator-note',
    expectedVersion: 2,
    note: '別の許可担当者による合成メモ',
  }, 'operator-b@example.invalid');
  assert.equal(note.status, 200);
  assert.equal(note.body.actorEmail, 'operator-b@example.invalid');

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].assignee_email, actor);
  assert.equal(snapshot.body.cases[0].version, 3);
});

test('all six existing statuses are preserved when an active operator appends a note', async () => {
  const statuses = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
  for (const [index, status] of statuses.entries()) {
    await resetDatabase();
    const configured = await testCommand('case-status', { status });
    assert.equal(configured.status, 200);
    const note = await action('note', {
      requestId: `status-note-${index}`,
      expectedVersion: 1,
      note: `${status}を維持する合成メモ`,
    });
    assert.equal(note.status, 200);
    const snapshot = await requestJson('/__test/snapshot');
    assert.equal(snapshot.body.cases[0].status, status);
    assert.equal(snapshot.body.cases[0].version, 2);
  }
});

test('same request ID with different payload, actor, version or case is rejected', async () => {
  await resetDatabase();
  const original = {
    requestId: 'immutable-request',
    expectedVersion: 1,
    note: '元の合成メモ',
  };
  assert.equal((await action('note', original)).status, 200);

  const variants = [
    action('note', { ...original, note: '変更した合成メモ' }),
    action('note', original, 'operator-b@example.invalid'),
    action('note', { ...original, expectedVersion: 2 }),
    action('note', original, actor, {}, 'case-other'),
  ];
  const results = await Promise.all(variants);
  assert.ok(results.every(response => response.status === 409));
  assert.ok(results.every(response => response.body.error === 'idempotency_conflict'));
});

test('retry after a simulated acknowledgement loss returns the immutable receipt once', async () => {
  await resetDatabase();
  const payload = { requestId: 'ack-loss-note', expectedVersion: 1, note: 'ACK損失の合成メモ' };
  const lost = await action('note', payload, actor, { 'x-mvp-drop-ack': '1' });
  assert.equal(lost.status, 503);
  const retry = await action('note', payload);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.requestId, payload.requestId);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 1);
  assert.equal(snapshot.body.events.length, 1);
  assert.equal(snapshot.body.requests[0].response_json, JSON.stringify(retry.body));
});

test('missing principal is rejected before parsing or echoing a sensitive draft', async () => {
  await resetDatabase();
  const secretDraft = '端末メモリだけに残す機微な下書き';
  const rejected = await requestJson('/api/cases/case-mvp-1/actions/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{ "note": "${secretDraft}"`,
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, 'not_allowed');
  assert.equal(JSON.stringify(rejected.body).includes(secretDraft), false);

  const snapshot = await requestJson('/__test/snapshot');
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
  assert.equal(snapshot.body.cases[0].version, 1);
});

test('disabled operator is rejected before an invalid sensitive body is parsed', async () => {
  await resetDatabase();
  const disabled = await testCommand('operator-active', { email: actor, active: false });
  assert.equal(disabled.status, 200);
  const secretDraft = '無効化後に送信しない機微な下書き';
  const rejected = await requestJson('/api/cases/case-mvp-1/actions/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mvp-actor': actor },
    body: `{ "note": "${secretDraft}"`,
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, 'not_allowed');
  assert.equal(JSON.stringify(rejected.body).includes(secretDraft), false);

  const snapshot = await requestJson('/__test/snapshot');
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
  assert.equal(snapshot.body.cases[0].version, 1);
});

test('actor spoofing and unsupported action fields are rejected', async () => {
  await resetDatabase();
  const spoofed = await action('assign-self', {
    requestId: 'spoofed-assign',
    expectedVersion: 1,
    actorEmail: 'operator-b@example.invalid',
  });
  assert.equal(spoofed.status, 400);
  assert.equal(spoofed.body.error, 'invalid_command');

  const unsupported = await action('resolve', {
    requestId: 'not-yet-implemented',
    expectedVersion: 1,
  });
  assert.equal(unsupported.status, 404);
});

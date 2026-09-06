import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

function runWrangler(arguments_, cwd = projectDir) {
  return spawnSync(process.execPath, [wranglerBin, ...arguments_], {
    cwd,
    env: commandEnvironment,
    encoding: 'utf8',
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

async function prepareInProgressCase() {
  const assigned = await action('assign-self', {
    requestId: 'prepare-assign',
    expectedVersion: 1,
  });
  assert.equal(assigned.status, 200);
  const started = await action('start', {
    requestId: 'prepare-start',
    expectedVersion: 2,
  });
  assert.equal(started.status, 200);
}

function todayInTokyo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

test('migration 0002 upgrades populated 0001 data without changing legacy receipt or history', async () => {
  const upgradeDir = await mkdtemp(path.join(os.tmpdir(), 'contact-d1-upgrade-'));
  const migrationDir = path.join(upgradeDir, 'migrations');
  const stateDir = path.join(upgradeDir, 'state');
  const upgradeConfig = path.join(upgradeDir, 'wrangler.json');
  try {
    await mkdir(migrationDir);
    await copyFile(
      path.join(projectDir, 'migrations-mvp', '0001_contact_mvp.sql'),
      path.join(migrationDir, '0001_contact_mvp.sql'),
    );
    await writeFile(upgradeConfig, JSON.stringify({
      name: 'support-contact-d1-upgrade-test',
      compatibility_date: '2026-09-06',
      send_metrics: false,
      d1_databases: [{
        binding: 'DB',
        database_name: 'support-contact-d1-upgrade-test',
        database_id: '00000000-0000-0000-0000-000000000000',
        migrations_dir: './migrations',
        remote: false,
      }],
    }, null, 2));

    const firstMigration = runWrangler([
      'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir,
      '--config', upgradeConfig,
    ], upgradeDir);
    assert.equal(firstMigration.status, 0, `${firstMigration.stdout}\n${firstMigration.stderr}`);

    const actorEmail = 'operator-a@example.invalid';
    const requestId = 'legacy-upgrade-request';
    const note = '0001に保存した合成メモ';
    const createdAt = '2026-09-06T02:00:00.000Z';
    const payloadHash = createHash('sha256')
      .update(JSON.stringify([actorEmail, 'note', 'case-upgrade-1', 1, note]))
      .digest('hex');
    const receipt = {
      requestId,
      eventId: 'legacy-upgrade-event',
      caseId: 'case-upgrade-1',
      action: 'note',
      eventType: 'note_added',
      actorEmail,
      fromVersion: 1,
      toVersion: 2,
      note,
      changes: {},
      createdAt,
    };
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    const seedSql = [
      `INSERT INTO contact_operators (email, display_name, active, created_at, updated_at)
       VALUES (${quote(actorEmail)}, '担当者A', 1, ${quote(createdAt)}, ${quote(createdAt)});`,
      `INSERT INTO contact_cases
       (case_id, received_at, category, subject, customer_name, customer_email, message,
        status, priority, version, created_at, updated_at)
       VALUES ('case-upgrade-1', ${quote(createdAt)}, '操作案内', '合成upgrade', '合成利用者',
        'customer@example.invalid', '合成データ', '対応中', '中', 1,
        ${quote(createdAt)}, ${quote(createdAt)});`,
      `INSERT INTO contact_api_requests
       (request_id, actor_email, action, case_id, expected_version, payload_hash,
        response_json, created_at)
       VALUES (${quote(requestId)}, ${quote(actorEmail)}, 'note', 'case-upgrade-1', 1,
        ${quote(payloadHash)}, ${quote(JSON.stringify(receipt))}, ${quote(createdAt)});`,
      `UPDATE contact_cases SET version = 2, last_request_id = ${quote(requestId)}
       WHERE case_id = 'case-upgrade-1';`,
      `INSERT INTO contact_case_events
       (event_id, request_id, case_id, event_type, actor_email, from_version,
        to_version, note, changes_json, created_at)
       VALUES ('legacy-upgrade-event', ${quote(requestId)}, 'case-upgrade-1', 'note_added',
        ${quote(actorEmail)}, 1, 2, ${quote(note)}, '{}', ${quote(createdAt)});`,
    ].join('\n');
    const seedFile = path.join(upgradeDir, 'seed.sql');
    await writeFile(seedFile, seedSql);
    const seeded = runWrangler([
      'd1', 'execute', 'DB', '--local', '--persist-to', stateDir,
      '--config', upgradeConfig, '--file', seedFile, '--yes',
    ], upgradeDir);
    assert.equal(seeded.status, 0, `${seeded.stdout}\n${seeded.stderr}`);

    await copyFile(
      path.join(projectDir, 'migrations-mvp', '0002_wait_management.sql'),
      path.join(migrationDir, '0002_wait_management.sql'),
    );
    const secondMigration = runWrangler([
      'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir,
      '--config', upgradeConfig,
    ], upgradeDir);
    assert.equal(secondMigration.status, 0, `${secondMigration.stdout}\n${secondMigration.stderr}`);

    const checked = runWrangler([
      'd1', 'execute', 'DB', '--local', '--persist-to', stateDir,
      '--config', upgradeConfig, '--json', '--command',
      `SELECT c.case_id, c.version, c.last_request_id, c.wait_target, c.wait_reason,
        r.payload_hash, r.response_json,
        (SELECT COUNT(*) FROM contact_case_events e WHERE e.case_id = c.case_id) AS event_count
       FROM contact_cases c JOIN contact_api_requests r
         ON r.request_id = c.last_request_id WHERE c.case_id = 'case-upgrade-1';
       PRAGMA foreign_key_check;`,
    ], upgradeDir);
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    const output = JSON.parse(checked.stdout);
    const row = output[0].results[0];
    assert.equal(row.case_id, 'case-upgrade-1');
    assert.equal(row.version, 2);
    assert.equal(row.last_request_id, requestId);
    assert.equal(row.wait_target, null);
    assert.equal(row.wait_reason, null);
    assert.equal(row.payload_hash, payloadHash);
    assert.equal(row.response_json, JSON.stringify(receipt));
    assert.equal(row.event_count, 1);
    assert.deepEqual(output[1].results, []);
  } finally {
    await rm(upgradeDir, { recursive: true, force: true });
  }
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

test('a receipt written with the c4ecb97 hash format still replays after migration 0002', async () => {
  await resetDatabase();
  const seeded = await testCommand('seed-legacy-note', {});
  assert.equal(seeded.status, 200);
  const replay = await action('note', seeded.body.payload);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.requestId, 'legacy-note-request');
  assert.equal(replay.body.eventId, 'legacy-note-event');

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

test('start requires an assigned unresolved case', async () => {
  await resetDatabase();
  const rejected = await action('start', { requestId: 'unassigned-start', expectedVersion: 1 });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'state_conflict');
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].status, '未対応');
  assert.equal(snapshot.body.cases[0].version, 1);
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
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

test('actor spoofing and unknown actions are rejected', async () => {
  await resetDatabase();
  const spoofed = await action('assign-self', {
    requestId: 'spoofed-assign',
    expectedVersion: 1,
    actorEmail: 'operator-b@example.invalid',
  });
  assert.equal(spoofed.status, 400);
  assert.equal(spoofed.body.error, 'invalid_command');

  const unsupported = await action('delete', {
    requestId: 'not-yet-implemented',
    expectedVersion: 1,
  });
  assert.equal(unsupported.status, 404);
});

test('another allowed operator can put an assigned case into customer wait', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const waited = await action('wait-customer', {
    requestId: 'wait-customer-1',
    expectedVersion: 3,
    note: 'お客様へ合成案内を行い、返信を待ちます。',
    nextAction: '返信内容を確認する',
    followupAt: '2099-12-31',
  }, 'operator-b@example.invalid');
  assert.equal(waited.status, 200);
  assert.equal(waited.body.eventType, 'wait_customer');
  assert.equal(waited.body.actorEmail, 'operator-b@example.invalid');

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.status, '顧客確認待ち');
  assert.equal(detail.body.case.assignee_email, actor);
  assert.equal(detail.body.case.next_action, '返信内容を確認する');
  assert.equal(detail.body.case.followup_at, '2099-12-31');
  assert.equal(detail.body.case.wait_target, 'customer');
  assert.equal(detail.body.case.wait_reason, 'お客様へ合成案内を行い、返信を待ちます。');
});

test('internal wait keeps target, reason, next action and follow-up date together', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const waited = await action('wait-internal', {
    requestId: 'wait-internal-1',
    expectedVersion: 3,
    confirmationTarget: '開発',
    note: '合成エラー条件の確認を依頼しました。',
    nextAction: '調査結果を確認して案内する',
    followupAt: '2099-12-31',
  });
  assert.equal(waited.status, 200);
  assert.equal(waited.body.eventType, 'wait_internal');

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.status, '引継ぎ待ち');
  assert.equal(detail.body.case.wait_target, '開発');
  assert.equal(detail.body.case.wait_reason, '合成エラー条件の確認を依頼しました。');
  assert.equal(detail.body.case.next_action, '調査結果を確認して案内する');
  assert.equal(detail.body.case.followup_at, '2099-12-31');
});

test('hold maps its resume condition to the next action without losing the reason', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const held = await action('hold', {
    requestId: 'hold-1',
    expectedVersion: 3,
    reason: '合成環境の準備待ちです。',
    resumeCondition: '合成環境の準備完了を確認する',
    followupAt: '2099-12-31',
  });
  assert.equal(held.status, 200);
  assert.equal(held.body.eventType, 'held');

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.status, '保留');
  assert.equal(detail.body.case.wait_target, null);
  assert.equal(detail.body.case.wait_reason, '合成環境の準備待ちです。');
  assert.equal(detail.body.case.next_action, '合成環境の準備完了を確認する');
  assert.equal(detail.body.case.followup_at, '2099-12-31');
});

test('today and exact maximum text lengths are accepted at their boundaries', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const today = todayInTokyo();
  const held = await action('hold', {
    requestId: 'hold-boundaries',
    expectedVersion: 3,
    reason: '理'.repeat(4000),
    resumeCondition: '再'.repeat(200),
    followupAt: today,
  });
  assert.equal(held.status, 200);
  assert.equal(held.body.note.length, 4000);
  assert.equal(held.body.changes.nextAction.length, 200);
  assert.equal(held.body.changes.followupAt, today);
});

test('wait actions reject missing, malformed, oversized and past conditions without mutation', async () => {
  const cases = [
    ['wait-customer', {
      requestId: 'invalid-wait-1', expectedVersion: 3, note: '',
      nextAction: '確認する', followupAt: '2099-12-31',
    }],
    ['wait-customer', {
      requestId: 'invalid-wait-2', expectedVersion: 3, note: '案内済み',
      nextAction: 'x'.repeat(201), followupAt: '2099-12-31',
    }],
    ['wait-internal', {
      requestId: 'invalid-wait-3', expectedVersion: 3, confirmationTarget: '開発',
      note: '確認依頼', nextAction: '回答確認', followupAt: '2099-02-30',
    }],
    ['wait-internal', {
      requestId: 'invalid-wait-4', expectedVersion: 3, confirmationTarget: '',
      note: '確認依頼', nextAction: '回答確認', followupAt: '2099-12-31',
    }],
    ['wait-internal', {
      requestId: 'invalid-wait-5', expectedVersion: 3, confirmationTarget: '任意入力先',
      note: '確認依頼', nextAction: '回答確認', followupAt: '2099-12-31',
    }],
    ['hold', {
      requestId: 'invalid-hold-1', expectedVersion: 3, reason: '保留',
      resumeCondition: '', followupAt: '2099-12-31',
    }],
    ['hold', {
      requestId: 'invalid-hold-2', expectedVersion: 3, reason: '保留',
      resumeCondition: '再確認', followupAt: '2000-01-01',
    }],
  ];

  for (const [name, payload] of cases) {
    await resetDatabase();
    await prepareInProgressCase();
    const rejected = await action(name, payload);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'invalid_command');
    const snapshot = await requestJson('/__test/snapshot');
    assert.equal(snapshot.body.cases[0].status, '対応中');
    assert.equal(snapshot.body.cases[0].version, 3);
    assert.equal(snapshot.body.requests.length, 2);
    assert.equal(snapshot.body.events.length, 2);
  }
});

test('wait action requires an assigned in-progress case', async () => {
  await resetDatabase();
  const rejected = await action('wait-customer', {
    requestId: 'premature-wait',
    expectedVersion: 1,
    note: 'まだ開始していません。',
    nextAction: '対応を開始する',
    followupAt: '2099-12-31',
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'state_conflict');
  const snapshot = await requestJson('/__test/snapshot');
  assert.deepEqual(snapshot.body.requests, []);
  assert.deepEqual(snapshot.body.events, []);
});

test('same wait request replays once and rejects changed conditions under the same ID', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const payload = {
    requestId: 'wait-replay',
    expectedVersion: 3,
    note: '返信待ちの合成メモ',
    nextAction: '返信を確認する',
    followupAt: '2099-12-31',
  };
  const first = await action('wait-customer', payload);
  const replay = await action('wait-customer', payload);
  const conflict = await action('wait-customer', { ...payload, nextAction: '別の対応' });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 3);
  assert.equal(snapshot.body.events.length, 3);
  assert.equal(snapshot.body.cases[0].version, 4);
});

test('deterministic wait race commits one operation and rolls the loser back', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const shared = {
    expectedVersion: 3,
    note: '待ち競合の合成メモ',
    nextAction: '次の確認を行う',
    followupAt: '2099-12-31',
  };
  const results = await Promise.all([
    action('wait-customer', { ...shared, requestId: 'wait-race-customer' }, actor,
      { 'x-mvp-race-barrier': 'wait-race' }),
    action('wait-internal', {
      ...shared,
      requestId: 'wait-race-internal',
      confirmationTarget: '開発',
    }, 'operator-b@example.invalid', { 'x-mvp-race-barrier': 'wait-race' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 3);
  assert.equal(snapshot.body.events.length, 3);
  assert.equal(snapshot.body.cases[0].version, 4);
  assert.equal(snapshot.body.cases[0].last_request_id,
    snapshot.body.requests.find(request => request.expected_version === 3).request_id);
});

test('wait history failure rolls back all current wait fields and receipt', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const failed = await action('hold', {
    requestId: 'hold-failure',
    expectedVersion: 3,
    reason: '失敗注入用の合成理由',
    resumeCondition: '失敗後に再確認する',
    followupAt: '2099-12-31',
  }, actor, { 'x-mvp-fail-event': '1' });
  assert.equal(failed.status, 503);

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].status, '対応中');
  assert.equal(snapshot.body.cases[0].next_action, null);
  assert.equal(snapshot.body.cases[0].followup_at, null);
  assert.equal(snapshot.body.cases[0].wait_target, null);
  assert.equal(snapshot.body.cases[0].wait_reason, null);
  assert.equal(snapshot.body.cases[0].version, 3);
  assert.equal(snapshot.body.requests.length, 2);
  assert.equal(snapshot.body.events.length, 2);
});

test('assigned in-progress case resolves with result and final note', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const resolved = await action('resolve', {
    requestId: 'resolve-basic',
    expectedVersion: 3,
    resolutionCode: '解決',
    finalNote: '合成案件の案内と確認が完了しました。',
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.eventType, 'resolved');
  assert.equal(resolved.body.changes.status, '対応済み');
  assert.equal(resolved.body.changes.clearedPending, null);

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.status, '対応済み');
  assert.equal(detail.body.case.assignee_email, actor);
  assert.equal(detail.body.case.resolution_code, '解決');
  assert.equal(detail.body.case.resolved_by, actor);
  assert.ok(detail.body.case.resolved_at);
  assert.equal(detail.body.case.version, 4);
});

test('resolve requires an explicit completion note before clearing pending conditions', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const waited = await action('wait-customer', {
    requestId: 'resolve-wait',
    expectedVersion: 3,
    note: '合成返信を待っています。',
    nextAction: '返信内容を確認する',
    followupAt: '2099-12-31',
  });
  assert.equal(waited.status, 200);

  const rejected = await action('resolve', {
    requestId: 'resolve-without-completion',
    expectedVersion: 4,
    resolutionCode: '案内完了',
    finalNote: '最終案内を記録しました。',
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, 'state_conflict');

  const resolved = await action('resolve', {
    requestId: 'resolve-with-completion',
    expectedVersion: 4,
    resolutionCode: '案内完了',
    finalNote: '最終案内を記録しました。',
    pendingClosureNote: 'お客様から解決確認を受領しました。',
  });
  assert.equal(resolved.status, 200);
  assert.deepEqual(resolved.body.changes.clearedPending, {
    nextAction: '返信内容を確認する',
    followupAt: '2099-12-31',
    waitTarget: 'customer',
    waitReason: '合成返信を待っています。',
    completionNote: 'お客様から解決確認を受領しました。',
  });

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.next_action, null);
  assert.equal(detail.body.case.followup_at, null);
  assert.equal(detail.body.case.wait_target, null);
  assert.equal(detail.body.case.wait_reason, null);
});

test('reopen requires a reason and preserves the previous resolution in history', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const resolved = await action('resolve', {
    requestId: 'reopen-resolve',
    expectedVersion: 3,
    resolutionCode: '対応不要',
    finalNote: '合成確認により対応不要と判断しました。',
  });
  assert.equal(resolved.status, 200);
  const reopened = await action('reopen', {
    requestId: 'reopen-case',
    expectedVersion: 4,
    reason: '追加の合成問い合わせを受けたため再開します。',
  }, 'operator-b@example.invalid');
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.actorEmail, 'operator-b@example.invalid');
  assert.equal(reopened.body.changes.status, '対応中');
  assert.equal(reopened.body.changes.previousResolution.resolutionCode, '対応不要');
  assert.equal(reopened.body.changes.previousResolution.resolvedBy, actor);
  assert.ok(reopened.body.changes.previousResolution.resolvedAt);

  const detail = await authenticatedGet('/api/cases/case-mvp-1');
  assert.equal(detail.body.case.status, '対応中');
  assert.equal(detail.body.case.assignee_email, actor);
  assert.equal(detail.body.case.resolution_code, null);
  assert.equal(detail.body.case.resolved_at, null);
  assert.equal(detail.body.case.resolved_by, null);
});

test('resolve, reopen and resolve again retain both resolution events', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  assert.equal((await action('resolve', {
    requestId: 'cycle-resolve-1', expectedVersion: 3, resolutionCode: '案内完了',
    finalNote: '1回目の合成案内を完了しました。',
  })).status, 200);
  assert.equal((await action('reopen', {
    requestId: 'cycle-reopen', expectedVersion: 4,
    reason: '追加確認が必要になりました。',
  })).status, 200);
  assert.equal((await action('resolve', {
    requestId: 'cycle-resolve-2', expectedVersion: 5, resolutionCode: '解決',
    finalNote: '追加確認後に解決しました。',
  })).status, 200);

  const history = await authenticatedGet('/api/cases/case-mvp-1/events');
  assert.deepEqual(history.body.events.map(event => event.event_type), [
    'assigned', 'started', 'resolved', 'reopened', 'resolved',
  ]);
  assert.deepEqual(history.body.events.slice(2).map(event => event.note), [
    '1回目の合成案内を完了しました。',
    '追加確認が必要になりました。',
    '追加確認後に解決しました。',
  ]);
  assert.deepEqual(history.body.events.map(event => event.to_version), [2, 3, 4, 5, 6]);
});

test('resolve and reopen reject invalid inputs and invalid states without mutation', async () => {
  const invalidResolvePayloads = [
    { requestId: 'bad-resolve-1', expectedVersion: 3, resolutionCode: '継続対応', finalNote: '確認' },
    { requestId: 'bad-resolve-2', expectedVersion: 3, resolutionCode: '解決', finalNote: '' },
  ];
  for (const payload of invalidResolvePayloads) {
    await resetDatabase();
    await prepareInProgressCase();
    const rejected = await action('resolve', payload);
    assert.equal(rejected.status, 400);
    const snapshot = await requestJson('/__test/snapshot');
    assert.equal(snapshot.body.cases[0].status, '対応中');
    assert.equal(snapshot.body.cases[0].version, 3);
  }

  await resetDatabase();
  await prepareInProgressCase();
  const unnecessaryCompletion = await action('resolve', {
    requestId: 'unnecessary-completion', expectedVersion: 3,
    resolutionCode: '解決', finalNote: '通常の解決メモです。',
    pendingClosureNote: '解除対象がないため保存しないメモ',
  });
  assert.equal(unnecessaryCompletion.status, 409);
  assert.equal(unnecessaryCompletion.body.error, 'state_conflict');

  await resetDatabase();
  const unassigned = await action('resolve', {
    requestId: 'unassigned-resolve', expectedVersion: 1,
    resolutionCode: '解決', finalNote: '未割当です。',
  });
  assert.equal(unassigned.status, 409);
  assert.equal(unassigned.body.error, 'state_conflict');

  await resetDatabase();
  await prepareInProgressCase();
  const active = await action('reopen', {
    requestId: 'active-reopen', expectedVersion: 3, reason: 'まだ対応中です。',
  });
  assert.equal(active.status, 409);
  assert.equal(active.body.error, 'state_conflict');
  const blank = await action('reopen', {
    requestId: 'blank-reopen', expectedVersion: 3, reason: '',
  });
  assert.equal(blank.status, 400);

});

test('reopen rejects each incomplete legacy resolution field without mutation', async () => {
  for (const field of ['resolution_code', 'resolved_at', 'resolved_by']) {
    await resetDatabase();
    await prepareInProgressCase();
    const resolved = await action('resolve', {
      requestId: `legacy-${field}-resolve`, expectedVersion: 3,
      resolutionCode: '解決', finalNote: '旧データ欠損検証用の合成解決です。',
    });
    assert.equal(resolved.status, 200);
    const configured = await testCommand('clear-resolution-field', { field });
    assert.equal(configured.status, 200);

    const before = await requestJson('/__test/snapshot');
    assert.equal(before.body.cases[0].assignee_email, actor);
    assert.equal(before.body.cases[0].status, '対応済み');
    assert.equal(before.body.cases[0][field], null);

    const rejected = await action('reopen', {
      requestId: `incomplete-${field}-reopen`, expectedVersion: 4,
      reason: '解決情報が不足しているため再開できません。',
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, 'state_conflict');

    const after = await requestJson('/__test/snapshot');
    assert.deepEqual(after.body.cases, before.body.cases);
    assert.deepEqual(after.body.requests, before.body.requests);
    assert.deepEqual(after.body.events, before.body.events);
    assert.equal(after.body.cases[0].version, 4);
    assert.equal(after.body.requests.length, 3);
    assert.equal(after.body.events.length, 3);
  }
});

test('resolve replay is idempotent and changed resolution under the same ID is rejected', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const payload = {
    requestId: 'resolve-replay', expectedVersion: 3,
    resolutionCode: '解決', finalNote: '合成解決を記録しました。',
  };
  const first = await action('resolve', payload);
  const replay = await action('resolve', payload);
  const conflict = await action('resolve', { ...payload, resolutionCode: '案内完了' });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 3);
  assert.equal(snapshot.body.events.length, 3);
  assert.equal(snapshot.body.cases[0].version, 4);
});

test('pending completion note participates in resolve idempotency', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  assert.equal((await action('wait-customer', {
    requestId: 'resolve-hash-wait', expectedVersion: 3,
    note: '合成返信を待っています。', nextAction: '返信内容を確認する',
    followupAt: '2099-12-31',
  })).status, 200);
  const payload = {
    requestId: 'resolve-pending-replay', expectedVersion: 4,
    resolutionCode: '解決', finalNote: '待機後の合成解決です。',
    pendingClosureNote: 'お客様から解決確認を受領しました。',
  };
  const first = await action('resolve', payload);
  const replay = await action('resolve', payload);
  const changed = await action('resolve', {
    ...payload,
    pendingClosureNote: '異なる待機解除理由です。',
  });
  const omitted = await action('resolve', {
    requestId: payload.requestId,
    expectedVersion: payload.expectedVersion,
    resolutionCode: payload.resolutionCode,
    finalNote: payload.finalNote,
  });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
  assert.equal(omitted.status, 409);
  assert.equal(omitted.body.error, 'idempotency_conflict');

  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].version, 5);
  assert.equal(snapshot.body.requests.length, 4);
  assert.equal(snapshot.body.events.length, 4);
});

test('deterministic resolve race commits one result and rolls back the loser', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const results = await Promise.all([
    action('resolve', {
      requestId: 'resolve-race-a', expectedVersion: 3,
      resolutionCode: '解決', finalNote: '担当者Aの合成解決です。',
    }, actor, { 'x-mvp-race-barrier': 'resolve-race' }),
    action('resolve', {
      requestId: 'resolve-race-b', expectedVersion: 3,
      resolutionCode: '案内完了', finalNote: '担当者Bの合成解決です。',
    }, 'operator-b@example.invalid', { 'x-mvp-race-barrier': 'resolve-race' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 3);
  assert.equal(snapshot.body.events.length, 3);
  assert.equal(snapshot.body.cases[0].status, '対応済み');
  assert.equal(snapshot.body.cases[0].version, 4);
});

test('resolve history failure rolls back resolution and receipt', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const failed = await action('resolve', {
    requestId: 'resolve-failure', expectedVersion: 3,
    resolutionCode: '解決', finalNote: '保存されない合成解決です。',
  }, actor, { 'x-mvp-fail-event': '1' });
  assert.equal(failed.status, 503);
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].status, '対応中');
  assert.equal(snapshot.body.cases[0].resolution_code, null);
  assert.equal(snapshot.body.cases[0].resolved_at, null);
  assert.equal(snapshot.body.cases[0].version, 3);
  assert.equal(snapshot.body.requests.length, 2);
  assert.equal(snapshot.body.events.length, 2);
});

test('reopen replay is idempotent and a changed reason under the same ID is rejected', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  assert.equal((await action('resolve', {
    requestId: 'reopen-replay-resolve', expectedVersion: 3,
    resolutionCode: '解決', finalNote: '再開再送用の合成解決です。',
  })).status, 200);
  const payload = {
    requestId: 'reopen-replay', expectedVersion: 4,
    reason: '追加確認のため再開します。',
  };
  const first = await action('reopen', payload);
  const replay = await action('reopen', payload);
  const conflict = await action('reopen', { ...payload, reason: '別の再開理由です。' });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 4);
  assert.equal(snapshot.body.events.length, 4);
  assert.equal(snapshot.body.cases[0].version, 5);
});

test('deterministic reopen race commits one reason and rolls back the loser', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  assert.equal((await action('resolve', {
    requestId: 'reopen-race-resolve', expectedVersion: 3,
    resolutionCode: '解決', finalNote: '再開競合用の合成解決です。',
  })).status, 200);
  const results = await Promise.all([
    action('reopen', {
      requestId: 'reopen-race-a', expectedVersion: 4, reason: '担当者Aの再開理由です。',
    }, actor, { 'x-mvp-race-barrier': 'reopen-race' }),
    action('reopen', {
      requestId: 'reopen-race-b', expectedVersion: 4, reason: '担当者Bの再開理由です。',
    }, 'operator-b@example.invalid', { 'x-mvp-race-barrier': 'reopen-race' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.requests.length, 4);
  assert.equal(snapshot.body.events.length, 4);
  assert.equal(snapshot.body.cases[0].status, '対応中');
  assert.equal(snapshot.body.cases[0].version, 5);
});

test('reopen history failure rolls back the current resolution and receipt', async () => {
  await resetDatabase();
  await prepareInProgressCase();
  const resolved = await action('resolve', {
    requestId: 'reopen-failure-resolve', expectedVersion: 3,
    resolutionCode: '案内完了', finalNote: '再開失敗用の合成解決です。',
  });
  assert.equal(resolved.status, 200);
  const failed = await action('reopen', {
    requestId: 'reopen-failure', expectedVersion: 4,
    reason: '保存されない再開理由です。',
  }, actor, { 'x-mvp-fail-event': '1' });
  assert.equal(failed.status, 503);
  const snapshot = await requestJson('/__test/snapshot');
  assert.equal(snapshot.body.cases[0].status, '対応済み');
  assert.equal(snapshot.body.cases[0].resolution_code, '案内完了');
  assert.equal(snapshot.body.cases[0].resolved_at, resolved.body.createdAt);
  assert.equal(snapshot.body.cases[0].resolved_by, actor);
  assert.equal(snapshot.body.cases[0].version, 4);
  assert.equal(snapshot.body.requests.length, 3);
  assert.equal(snapshot.body.events.length, 3);
});

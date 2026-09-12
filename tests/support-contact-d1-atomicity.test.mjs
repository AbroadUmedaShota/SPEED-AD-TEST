import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { appendNote, handleNoteRequest, SQL } from
  '../99_backend-docs/10_support-contact/d1-poc/atomicNote.mjs';
import { openSqlite, snapshot } from './helpers/support-contact-sqlite.mjs';

const command = (patch = {}) => ({
  caseId: 'case-1', requestId: 'request-1', expectedVersion: 1,
  note: 'Synthetic local note', ...patch,
});

function setup(t) {
  const context = openSqlite();
  t.after(() => context.sqlite.close());
  return context;
}

function assertSingleCommit(sqlite, caseId = 'case-1') {
  const data = snapshot(sqlite);
  assert.equal(data.poc_requests.length, 1);
  assert.equal(data.poc_events.length, 1);
  assert.equal(data.poc_cases.find(row => row.case_id === caseId).version, 2);
  assert.equal(data.poc_events[0].request_id, data.poc_requests[0].request_id);
  assert.equal(data.poc_events[0].to_version, 2);
}

test('success commits case, history and immutable receipt together', async t => {
  const { sqlite, adapter } = setup(t);
  const result = await appendNote(adapter, 'demo-a', command());
  assert.equal(result.status, 200);
  assertSingleCommit(sqlite);
  const data = snapshot(sqlite);
  assert.equal(data.poc_cases[0].status, '未対応');
  assert.equal(data.poc_events[0].note, command().note);
  assert.equal(data.poc_requests[0].note, command().note);
  assert.equal(data.poc_requests[0].created_at, result.body.createdAt);
  assert.deepEqual(JSON.parse(data.poc_requests[0].response_json), result.body);
});

test('missing case: foreign key rejects the request and writes nothing', async t => {
  const { sqlite, adapter } = setup(t);
  const before = snapshot(sqlite);
  assert.equal((await appendNote(adapter, 'demo-a', command({ caseId: 'missing' }))).status, 404);
  assert.deepEqual(snapshot(sqlite), before);
});

test('stale and future versions both leave all three tables unchanged', async t => {
  const { sqlite, adapter } = setup(t);
  await appendNote(adapter, 'demo-a', command());
  const before = snapshot(sqlite);
  for (const version of [1, 3]) {
    const result = await appendNote(adapter, 'demo-b',
      command({ expectedVersion: version, requestId: 'loser-' + version }));
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'version_conflict');
    assert.deepEqual(snapshot(sqlite), before);
  }
});

test('same ID and canonical payload replays, including after later updates', async t => {
  const { sqlite, adapter } = setup(t);
  const first = await appendNote(adapter, 'demo-a', command());
  await appendNote(adapter, 'demo-b', command({ requestId: 'next', expectedVersion: 2 }));
  const before = snapshot(sqlite);
  const reordered = { note: command().note, expectedVersion: 1, requestId: 'request-1', caseId: 'case-1' };
  assert.deepEqual(await appendNote(adapter, 'demo-a', reordered), first);
  assert.deepEqual(snapshot(sqlite), before);
});

test('same ID with different note, case, version or actor is rejected', async t => {
  const { sqlite, adapter } = setup(t);
  await appendNote(adapter, 'demo-a', command());
  const before = snapshot(sqlite);
  for (const [actor, patch] of [
    ['demo-a', { note: 'Different content' }], ['demo-a', { caseId: 'case-2' }],
    ['demo-a', { expectedVersion: 2 }], ['demo-b', {}],
  ]) {
    const result = await appendNote(adapter, actor, command(patch));
    assert.deepEqual(result, { status: 409, body: { error: 'idempotency_conflict' } });
    assert.deepEqual(snapshot(sqlite), before);
  }
});

test('SQL failure during event insert rolls back case and receipt, then retry commits once', async t => {
  const { sqlite, adapter } = setup(t);
  const before = snapshot(sqlite);
  sqlite.exec(`CREATE TRIGGER fail_event BEFORE INSERT ON poc_events
    BEGIN SELECT RAISE(ABORT, 'injected history failure'); END;`);
  assert.equal((await appendNote(adapter, 'demo-a', command())).status, 503);
  assert.deepEqual(snapshot(sqlite), before);
  sqlite.exec('DROP TRIGGER fail_event');
  const success = await appendNote(adapter, 'demo-a', command());
  assert.equal(success.status, 200);
  assert.deepEqual(await appendNote(adapter, 'demo-a', command()), success);
  assertSingleCommit(sqlite);
});

test('request insert failure leaves case and history unchanged', async t => {
  const { sqlite, adapter } = setup(t);
  const before = snapshot(sqlite);
  sqlite.exec(`CREATE TRIGGER fail_request BEFORE INSERT ON poc_requests
    BEGIN SELECT RAISE(ABORT, 'injected request failure'); END;`);
  assert.equal((await appendNote(adapter, 'demo-a', command())).status, 503);
  assert.deepEqual(snapshot(sqlite), before);
});

test('commit acknowledgement loss returns the stored receipt without a second event', async t => {
  const { sqlite, adapter } = setup(t);
  const brokenAck = { ...adapter, async batch(statements) {
    await adapter.batch(statements);
    throw new Error('ack lost');
  } };
  const first = await appendNote(brokenAck, 'demo-a', command());
  assert.equal(first.status, 200);
  assert.deepEqual(await appendNote(adapter, 'demo-a', command()), first);
  assertSingleCommit(sqlite);
});

test('unknown commit result plus unreadable receipt returns 503, retry recovers', async t => {
  const { sqlite, adapter } = setup(t);
  let committed = false;
  const broken = {
    prepare(sql) {
      if (committed) throw new Error('read unavailable');
      return adapter.prepare(sql);
    },
    async batch(statements) {
      await adapter.batch(statements);
      committed = true;
      throw new Error('ack unavailable');
    },
  };
  assert.equal((await appendNote(broken, 'demo-a', command())).status, 503);
  assertSingleCommit(sqlite);
  const before = snapshot(sqlite);
  assert.equal((await appendNote(adapter, 'demo-a', command())).status, 200);
  assert.deepEqual(snapshot(sqlite), before);
});

test('read failure before mutation returns 503 and writes nothing', async t => {
  const { sqlite } = setup(t);
  const before = snapshot(sqlite);
  const result = await appendNote({ prepare() { throw new Error('offline'); } }, 'demo-a', command());
  assert.equal(result.status, 503);
  assert.deepEqual(snapshot(sqlite), before);
});

test('unknown/disabled actors cannot write or retrieve a prior success receipt', async t => {
  const { sqlite, adapter } = setup(t);
  await appendNote(adapter, 'demo-a', command());
  sqlite.exec("UPDATE poc_operators SET active = 0 WHERE actor_id = 'demo-a'");
  const before = snapshot(sqlite);
  for (const actor of ['unknown', 'disabled', 'demo-a', null]) {
    assert.equal((await appendNote(adapter, actor, command())).status, 403);
    assert.deepEqual(snapshot(sqlite), before);
  }
});

test('invalid payloads and unapproved fields cannot change state', async t => {
  const { sqlite, adapter } = setup(t);
  const before = snapshot(sqlite);
  for (const patch of [
    { note: '' }, { note: ' ' }, { note: 'a'.repeat(4001) }, { note: 'a\0b' },
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: Number.MAX_SAFE_INTEGER },
    { status: '対応済み' }, { actorId: 'demo-b' }, { action: 'resolve' },
    { requestId: "injection';--" },
  ]) {
    assert.equal((await appendNote(adapter, 'demo-a', command(patch))).status, 400);
    assert.deepEqual(snapshot(sqlite), before);
  }
});

test('append-note preserves each of the existing six statuses', async t => {
  const { sqlite, adapter } = setup(t);
  const statuses = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
  for (const [index, status] of statuses.entries()) {
    sqlite.prepare('UPDATE poc_cases SET status = ? WHERE case_id = ?').run(status, 'case-1');
    const result = await appendNote(adapter, 'demo-a',
      command({ requestId: 'status-' + index, expectedVersion: index + 1 }));
    assert.equal(result.status, 200);
    assert.equal(sqlite.prepare('SELECT status FROM poc_cases WHERE case_id = ?').get('case-1').status, status);
  }
  assert.throws(() => sqlite.exec("UPDATE poc_cases SET status = 'invented'"), /CHECK/);
});

test('negative control: INSERT SELECT zero rows commits an orphan request', t => {
  const { sqlite } = setup(t);
  sqlite.exec(`BEGIN;
    INSERT INTO poc_requests VALUES
      ('negative', 'demo-a', 'append_note', 'case-1', 99, 'hash', 'note', 'time', '{}');
    UPDATE poc_cases SET version = version + 1 WHERE case_id = 'case-1' AND version = 99;
    INSERT INTO poc_events
      SELECT 'event', 'negative', case_id, 'demo-a', 1, version, 'note', 'time'
      FROM poc_cases WHERE case_id = 'case-1' AND version = 100;
    COMMIT;`);
  assert.equal(snapshot(sqlite).poc_requests.length, 1);
  assert.equal(snapshot(sqlite).poc_events.length, 0);
});

test('guard requires BOTH new version and this request marker', async t => {
  const { sqlite, adapter } = setup(t);
  await appendNote(adapter, 'demo-a', command({ requestId: 'someone-else' }));
  const before = snapshot(sqlite);
  await assert.rejects(adapter.batch([
    adapter.prepare(SQL.insertRequest).bind('guard', 'demo-a', 'case-1', 1, 'hash', 'note', 'time', '{}'),
    adapter.prepare(SQL.updateCase).bind('guard', 'time', 'case-1', 1),
    adapter.prepare(SQL.insertEvent).bind('event', 'guard', 'case-1', 'demo-a',
      1, 'case-1', 1, 'guard', 'note', 'time'),
  ]), /NOT NULL constraint failed: poc_events.to_version/);
  assert.deepEqual(snapshot(sqlite), before);
});

test('schema rejects nonexistent request/case references and malformed receipts', t => {
  const { sqlite } = setup(t);
  const before = snapshot(sqlite);
  const insert = sqlite.prepare(SQL.insertRequest);
  assert.throws(() => insert.run('fk', 'demo-a', 'missing', 1, 'hash', 'note', 'time', '{}'),
    /FOREIGN KEY/);
  assert.throws(() => sqlite.exec(
    "UPDATE poc_cases SET last_request_id = 'missing' WHERE case_id = 'case-1'"), /FOREIGN KEY/);
  assert.throws(() => insert.run('json', 'demo-a', 'case-1', 1, 'hash', 'note', 'time', 'not json'),
    /CHECK/);
  assert.deepEqual(snapshot(sqlite), before);
});

function httpRequest(body, path = '/api/cases/case-1/actions/note') {
  return new Request('http://localhost' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('fixed HTTP action rejects spoofed fields and uses injected synthetic actor', async t => {
  const { sqlite, adapter } = setup(t);
  const body = { requestId: 'http-1', expectedVersion: 1, note: 'Synthetic HTTP note' };
  assert.equal((await handleNoteRequest(httpRequest(body), adapter, null)).status, 403);
  assert.equal((await handleNoteRequest(httpRequest({ ...body, actorId: 'demo-b' }),
    adapter, { actorId: 'demo-a' })).status, 400);
  assert.equal((await handleNoteRequest(httpRequest(body, '/api/cases/case-1/actions/resolve'),
    adapter, { actorId: 'demo-a' })).status, 404);
  const response = await handleNoteRequest(httpRequest(body), adapter, { actorId: 'demo-a' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).actorId, 'demo-a');
  assertSingleCommit(sqlite);
});

function runWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./helpers/support-contact-race-worker.mjs', import.meta.url),
      { workerData: data });
    let result;
    worker.on('message', message => { result = message; });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code === 0 && result) resolve(result);
      else reject(new Error('Race worker failed: ' + code));
    });
  });
}

for (const mode of ['different-ids', 'same-payload', 'different-payload']) {
  test('two SQLite connections race: ' + mode, { timeout: 20000 }, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'contact-atomicity-'));
    const path = join(folder, 'test.sqlite');
    const { sqlite } = openSqlite(path);
    try {
      const gate = new SharedArrayBuffer(4);
      const second = mode === 'different-ids' ? command({ requestId: 'request-2' })
        : mode === 'different-payload' ? command({ note: 'Other content' }) : command();
      const results = await Promise.all([
        runWorker({ path, gate, actor: 'demo-a', command: command() }),
        runWorker({ path, gate, actor: 'demo-a', command: second }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(),
        mode === 'same-payload' ? [200, 200] : [200, 409]);
      if (mode === 'same-payload') assert.deepEqual(results[0].body, results[1].body);
      assertSingleCommit(sqlite);
      const data = snapshot(sqlite);
      assert.equal(data.poc_cases[0].last_request_id, data.poc_requests[0].request_id);
      assert.equal(data.poc_events[0].note, results.find(result => result.status === 200).body.note);
    } finally {
      sqlite.close();
      // Only the exact per-test directory returned by mkdtempSync is removed.
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

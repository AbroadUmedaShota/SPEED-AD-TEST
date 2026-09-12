import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { executeCaseAction as sharedAction } from '../sharedCaseActions.mjs';
import { executeCaseAction as localAction } from '../caseActions.mjs';
import { createSharedWorker } from '../sharedWorker.mjs';
import mvpWorker from '../mvpWorker.mjs';

const actor = 'operator-a@example.invalid';
const target = 'operator-b@example.invalid';
const other = 'operator-c@example.invalid';
const caseId = 'case-mvp-1';
const timestamp = '2026-09-06T00:00:00.000Z';
const tables = ['contact_cases', 'contact_api_requests', 'contact_case_events',
  'contact_operators', 'contact_attachments'];
let runtime;
let db;

async function migration(name, fail = false) {
  const sql = await readFile(new URL(`../migrations-mvp/${name}`, import.meta.url), 'utf8');
  // These versioned migrations contain no semicolons inside literals or triggers.
  const statements = sql.split(';').map(value => value.trim()).filter(Boolean).map(sql => db.prepare(sql));
  if (fail) statements.splice(-1, 0, db.prepare(`INSERT INTO contact_api_requests
    SELECT request_id || '-invalid', actor_email, 'unknown', case_id, expected_version,
      payload_hash, response_json, created_at FROM contact_api_requests LIMIT 1`));
  return db.batch(statements);
}

async function reset() {
  await db.batch([
    db.prepare('UPDATE contact_cases SET last_request_id = NULL'),
    ...['contact_case_events', 'contact_api_requests', 'contact_attachments',
      'contact_cases', 'contact_operators'].map(table => db.prepare(`DELETE FROM ${table}`)),
    ...[actor, target, other].map((email, index) => db.prepare(`INSERT INTO contact_operators
      (email, display_name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .bind(email, `Synthetic operator ${index}`, timestamp, timestamp)),
    db.prepare(`INSERT INTO contact_cases (case_id, received_at, category, subject,
      customer_name, customer_email, message, status, version, created_at, updated_at)
      VALUES (?, ?, 'test', 'Synthetic case', 'Synthetic customer', 'customer@example.invalid',
        'Synthetic message', '未対応', 1, ?, ?)`).bind(caseId, timestamp, timestamp, timestamp),
  ]);
}

async function snapshot() {
  return Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,
  ])));
}

const payload = (overrides = {}) => ({
  requestId: crypto.randomUUID(), expectedVersion: 1, assigneeEmail: target,
  reason: 'Synthetic reassignment reason', ...overrides,
});
const currentCase = () => db.prepare('SELECT * FROM contact_cases WHERE case_id = ?').bind(caseId).first();
const setActive = (email, active) => db.prepare('UPDATE contact_operators SET active = ? WHERE email = ?')
  .bind(active, email).run();

test.before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("local D1"); } };',
    compatibilityDate: '2026-09-06', d1Databases: ['DB'],
  }));
  db = await runtime.getD1Database('DB');
  await migration('0001_contact_mvp.sql');
  await migration('0002_wait_management.sql');
});
test.after(async () => { await runtime?.dispose(); });

test('old migrations reject reassign atomically, upgrade preserves all values, FK, indexes and replay', async () => {
  await reset();
  const beforeGap = await snapshot();
  assert.equal((await sharedAction(db, { email: actor }, 'reassign', caseId, payload())).status, 503);
  assert.deepEqual(await snapshot(), beforeGap);
  const note = { requestId: 'legacy-note', expectedVersion: 1, note: 'Legacy receipt' };
  const receipt = await localAction(db, { email: actor }, 'note', caseId, note);
  assert.equal(receipt.status, 200);
  const assigned = await sharedAction(db, { email: actor }, 'assign-self', caseId, {
    requestId: 'legacy-assign', expectedVersion: 2,
  });
  assert.equal(assigned.status, 200);
  await setActive(other, 0);
  await db.prepare(`UPDATE contact_cases SET next_action = 'keep pending', followup_at = '2099-01-01',
    wait_target = 'customer', wait_reason = 'keep reason', archived_at = ?, archived_by = ?,
    resolution_code = 'keep resolution', resolved_at = ?, resolved_by = ? WHERE case_id = ?`)
    .bind(timestamp, actor, timestamp, actor, caseId).run();
  await db.prepare(`INSERT INTO contact_attachments
    (attachment_id, case_id, object_key, original_name, mime_type, size_bytes, sha256, created_at)
    VALUES ('attachment-1', ?, 'synthetic/key', 'synthetic.webp', 'image/webp', 4, 'abcd', ?)`)
    .bind(caseId, timestamp).run();
  const before = await snapshot();
  assert.equal((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).results.length, 0);
  const foreignKeys = await Promise.all(tables.map(table => db.prepare(`PRAGMA foreign_key_list(${table})`).all()));
  assert.ok(foreignKeys.flatMap(result => result.results).every(row => row.on_delete === 'NO ACTION'));
  const indexes = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all()).results;
  const schema = (await db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name').all()).results;
  await assert.rejects(migration('0003_case_reassignment.sql', true));
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual((await db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name').all()).results, schema);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  await migration('0003_case_reassignment.sql');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual(await Promise.all(tables.map(table => db.prepare(`PRAGMA foreign_key_list(${table})`).all()))
    .then(results => results.map(result => result.results)), foreignKeys.map(result => result.results));
  assert.deepEqual((await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all()).results, indexes);
  for (const execute of [sharedAction, localAction]) {
    assert.deepEqual(await execute(db, { email: actor }, 'note', caseId, note), receipt);
  }
  await assert.rejects(db.prepare("UPDATE contact_api_requests SET action = 'unknown'").run());
  await assert.rejects(db.prepare("UPDATE contact_case_events SET event_type = 'unknown'").run());
  await assert.rejects(db.prepare("UPDATE contact_cases SET last_request_id = 'missing'").run());
});

for (const [name, execute] of [['shared', sharedAction], ['mvp', localAction]]) {
  const command = (body = payload(), email = actor, database = db) =>
    execute(database, { email }, 'reassign', caseId, body);

  test(`${name}: inactive old assignee can be replaced by an active operator`, async () => {
    await reset();
    await db.prepare('UPDATE contact_cases SET assignee_email = ?').bind(other).run();
    await setActive(other, 0);
    const result = await command();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.changes, { previousAssigneeEmail: other, assigneeEmail: target });
  });

  for (const status of ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留']) {
    test(`${name}: another active actor can reassign ${status}, preserving pending state and auditing both assignees`, async () => {
      await reset();
      await db.prepare(`UPDATE contact_cases SET status = ?, assignee_email = ?, next_action = 'keep',
        followup_at = '2099-01-01', wait_target = 'customer', wait_reason = 'keep' WHERE case_id = ?`)
        .bind(status, actor, caseId).run();
      const before = await currentCase();
      const result = await command(payload(), other);
      assert.equal(result.status, 200);
      assert.equal(result.body.actorEmail, other);
      assert.deepEqual(result.body.changes, { previousAssigneeEmail: actor, assigneeEmail: target });
      assert.equal(result.body.note, 'Synthetic reassignment reason');
      assert.deepEqual(await currentCase(), {
        ...before, assignee_email: target, version: 2,
        last_request_id: result.body.requestId, updated_at: result.body.createdAt,
      });
      const event = await db.prepare('SELECT * FROM contact_case_events').first();
      assert.equal(event.actor_email, other);
      assert.equal(event.event_type, 'reassigned');
      assert.deepEqual(JSON.parse(event.changes_json), result.body.changes);
      assert.equal(event.created_at, result.body.createdAt);
      assert.equal(event.note, result.body.note);
      assert.equal(event.from_version, 1);
      assert.equal(event.to_version, 2);
    });
  }

  test(`${name}: unassigned, exact replay after target disable, actor-first auth and requestId reuse`, async () => {
    await reset();
    const body = payload({ reason: 'x'.repeat(4000) });
    const saved = await command(body);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.changes.previousAssigneeEmail, null);
    await setActive(target, 0);
    const before = await snapshot();
    assert.deepEqual(await command(body), saved);
    assert.equal((await command({ ...body, reason: 'changed' })).body.error, 'idempotency_conflict');
    assert.equal((await command({ ...body, assigneeEmail: actor })).body.error, 'idempotency_conflict');
    assert.equal((await command({ ...body, expectedVersion: 2 })).body.error, 'idempotency_conflict');
    assert.equal((await command(body, other)).body.error, 'idempotency_conflict');
    assert.deepEqual(await snapshot(), before);
    await setActive(actor, 0);
    assert.equal((await command(body)).status, 403);
    assert.equal((await command(payload(), 'unknown@example.invalid')).status, 403);
  });

  const invalid = [
    ['empty reason', { reason: '' }], ['blank reason', { reason: '   ' }],
    ['long reason', { reason: 'x'.repeat(4001) }], ['numeric reason', { reason: 7 }],
    ['null reason', { reason: null }], ['array reason', { reason: [] }],
    ['nul reason', { reason: 'x\0y' }], ['empty target', { assigneeEmail: '' }],
    ['long target', { assigneeEmail: 'x'.repeat(255) }], ['numeric target', { assigneeEmail: 7 }],
    ['null target', { assigneeEmail: null }], ['object target', { assigneeEmail: {} }],
    ['nul target', { assigneeEmail: 'x\0y' }], ['unknown target', { assigneeEmail: 'unknown@example.invalid' }],
    ['case mismatch', { assigneeEmail: target.toUpperCase() }],
    ['space mismatch', { assigneeEmail: ` ${target}` }],
    ['client actor', { actorEmail: other }], ['client status', { status: '対応中' }],
    ['numeric request', { requestId: 1 }], ['empty request', { requestId: '' }],
    ['long request', { requestId: 'x'.repeat(81) }], ['string version', { expectedVersion: '1' }],
    ['zero version', { expectedVersion: 0 }], ['fraction version', { expectedVersion: 1.5 }],
    ['unsafe version', { expectedVersion: Number.MAX_SAFE_INTEGER }],
  ];
  for (const [label, overrides] of invalid) {
    test(`${name}: rejects ${label} without writes`, async () => {
      await reset();
      const before = await snapshot();
      assert.equal((await command(payload(overrides))).status, 400);
      assert.deepEqual(await snapshot(), before);
    });
  }
  test(`${name}: missing keys and non-object bodies are rejected`, async () => {
    await reset();
    const before = await snapshot();
    for (const body of [null, [], 'text', 1, ...Object.keys(payload()).map(key => {
      const body = payload(); delete body[key]; return body;
    })]) assert.equal((await command(body)).status, 400);
    assert.deepEqual(await snapshot(), before);
  });

  for (const [label, setup, status, error] of [
    ['same assignee', () => db.prepare('UPDATE contact_cases SET assignee_email = ?').bind(target).run(), 409, 'state_conflict'],
    ['inactive target', () => setActive(target, 0), 400, 'invalid_assignee'],
    ['inactive actor', () => setActive(actor, 0), 403, 'not_allowed'],
    ['resolved', () => db.prepare("UPDATE contact_cases SET status = '対応済み'").run(), 409, 'state_conflict'],
    ['archived', () => db.prepare('UPDATE contact_cases SET archived_at = ?').bind(timestamp).run(), 409, 'case_archived'],
    ['stale version', () => db.prepare('UPDATE contact_cases SET version = 2').run(), 409, 'version_conflict'],
  ]) {
    test(`${name}: rejects ${label} without writes`, async () => {
      await reset();
      await setup();
      const before = await snapshot();
      const result = await command();
      assert.equal(result.status, status);
      assert.equal(result.body.error, error);
      assert.deepEqual(await snapshot(), before);
    });
  }

  test(`${name}: simultaneous different requests use CAS, same request races replay once`, async () => {
    for (const same of [false, true]) {
      await reset();
      let count = 0;
      let release;
      const barrier = new Promise(resolve => { release = resolve; });
      const racingDb = {
        prepare: sql => db.prepare(sql),
        async batch(statements) {
          if (++count === 2) release();
          await barrier;
          return db.batch(statements);
        },
      };
      const first = payload();
      const second = same ? first : payload({ assigneeEmail: other });
      const results = await Promise.all([command(first, actor, racingDb), command(second, actor, racingDb)]);
      assert.deepEqual(results.map(result => result.status).sort(), same ? [200, 200] : [200, 409]);
      if (same) assert.deepEqual(results[0], results[1]);
      const state = await snapshot();
      assert.equal(state.contact_cases[0].version, 2);
      assert.equal(state.contact_case_events.length, 1);
      assert.equal(state.contact_api_requests.length, 1);
    }
  });

  for (const [label, email, status, error] of [
    ['target', target, 409, 'assignee_unavailable'], ['actor', actor, 403, 'not_allowed'],
  ]) {
    test(`${name}: ${label} disabled after preflight cannot commit`, async () => {
      await reset();
      const before = await snapshot();
      const racingDb = {
        prepare: sql => db.prepare(sql),
        async batch(statements) {
          await setActive(email, 0);
          return db.batch(statements);
        },
      };
      const result = await command(payload(), actor, racingDb);
      assert.equal(result.status, status);
      assert.equal(result.body.error, error);
      const after = await snapshot();
      before.contact_operators.find(row => row.email === email).active = 0;
      assert.deepEqual(after, before);
    });
  }

  test(`${name}: failed history insert rolls back case and receipt`, async () => {
    await reset();
    const before = await snapshot();
    await db.prepare(`CREATE TRIGGER fail_reassignment BEFORE INSERT ON contact_case_events
      WHEN NEW.event_type = 'reassigned' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`).run();
    try {
      assert.equal((await command()).status, 503);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await db.prepare('DROP TRIGGER fail_reassignment').run();
    }
    assert.equal((await command()).status, 200);
  });

  test(`${name}: catch-side replay reauthorizes actor after a concurrent receipt commits`, async () => {
    await reset();
    const body = payload();
    const racingDb = {
      prepare: sql => db.prepare(sql),
      async batch(statements) {
        assert.equal((await command(body)).status, 200);
        await setActive(actor, 0);
        return db.batch(statements);
      },
    };
    const result = await command(body, actor, racingDb);
    assert.equal(result.status, 403);
    const after = await snapshot();
    assert.equal(after.contact_case_events.length, 1);
    assert.equal(after.contact_api_requests.length, 1);
    assert.equal(after.contact_cases[0].version, 2);
  });
}

for (const mode of ['shared', 'mvp']) {
  test(`${mode} Worker: authorized operators projection, target differs from principal, API rejection`, async () => {
    await reset();
    await setActive(other, 0);
    const env = { DB: db, TRIAL_HOSTNAME: '127.0.0.1', TRIAL_ENABLED: 'true',
      MVP_LOCAL_ONLY: 'true', MVP_TIME_ZONE: 'Asia/Tokyo' };
    const worker = mode === 'shared' ? createSharedWorker({
      principalResolver: { async resolve(request) {
        const row = request.headers.get('x-test-session') === 'valid'
          ? await db.prepare('SELECT active FROM contact_operators WHERE email = ?').bind(actor).first() : null;
        return row?.active === 1 ? { email: actor } : null;
      } },
    }) : mvpWorker;
    const headers = { 'x-test-session': 'valid', 'x-mvp-actor': actor };
    const request = (pathname, options = {}) => worker.fetch(new Request(`http://127.0.0.1${pathname}`, options), env);
    assert.equal((await request('/api/operators')).status, 403);
    const operators = await request('/api/operators', { headers });
    assert.equal(operators.status, 200);
    assert.equal(operators.headers.get('cache-control'), 'no-store');
    const body = await operators.json();
    assert.deepEqual(body.operators, [
      { email: actor, display_name: 'Synthetic operator 0' },
      { email: target, display_name: 'Synthetic operator 1' },
    ]);
    const actionPath = `/api/cases/${caseId}/actions/reassign`;
    const commandHeaders = { ...headers, 'content-type': 'application/json' };
    assert.equal((await request(actionPath, { headers })).status, 405);
    assert.equal((await request(actionPath, { method: 'POST', headers, body: '{}' })).status, 415);
    assert.equal((await request(actionPath, { method: 'POST', headers: commandHeaders, body: '{' })).status, 400);
    assert.equal((await request(actionPath, { method: 'POST', headers: commandHeaders, body: 'x'.repeat(24001) })).status, 413);
    const saved = await request(actionPath, {
      method: 'POST', headers: commandHeaders, body: JSON.stringify(payload()),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).actorEmail, actor);
    assert.equal((await currentCase()).assignee_email, target);
    await setActive(actor, 0);
    assert.equal((await request('/api/operators', { headers })).status, 403);
  });
}

test('fresh migration path and browser migration mirror accept reassign and preserve FK checks', async () => {
  for (const table of ['contact_case_events', 'contact_attachments']) await db.prepare(`DROP TABLE ${table}`).run();
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = ON'),
    db.prepare('DROP TABLE contact_cases'),
    db.prepare('DROP TABLE contact_api_requests'),
    db.prepare('DROP TABLE contact_operators'),
    db.prepare('PRAGMA defer_foreign_keys = OFF'),
  ]);
  await migration('0001_contact_mvp.sql');
  await migration('0002_wait_management.sql');
  await migration('0003_case_reassignment.sql');
  await reset();
  assert.equal((await sharedAction(db, { email: actor }, 'reassign', caseId, payload())).status, 200);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal(await readFile(new URL('../migrations-shared-browser/0004_case_reassignment.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../migrations-mvp/0003_case_reassignment.sql', import.meta.url), 'utf8'));
});

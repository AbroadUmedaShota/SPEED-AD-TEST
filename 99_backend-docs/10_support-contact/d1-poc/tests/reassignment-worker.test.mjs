import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const actor = 'operator-a@example.invalid';
const target = 'operator-b@example.invalid';
let runtime;
let db;

test.before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      contents: `
        import { createSharedWorker } from './sharedWorker.mjs';
        import mvp from './mvpWorker.mjs';
        const shared = createSharedWorker({
          principalResolver: { async resolve(request, env) {
            if (request.headers.get('x-fixture-session') !== 'valid') return null;
            const row = await env.DB.prepare('SELECT active FROM contact_operators WHERE email = ?')
              .bind('operator-a@example.invalid').first();
            return row?.active === 1 ? { email: 'operator-a@example.invalid' } : null;
          } },
        });
        export default {
          async fetch(request, env) {
            if (new URL(request.url).hostname !== '127.0.0.1') {
              return Response.json({ error: 'local_fixture_only' }, { status: 403 });
            }
            return request.headers.get('x-fixture-surface') === 'mvp'
              ? mvp.fetch(request, env) : shared.fetch(request, env);
          },
        };
      `,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser',
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-06', d1Databases: ['DB'],
    bindings: {
      MVP_LOCAL_ONLY: 'true', MVP_TIME_ZONE: 'Asia/Tokyo',
      TRIAL_HOSTNAME: '127.0.0.1', TRIAL_ENABLED: 'true', TIME_ZONE: 'Asia/Tokyo',
    },
  }));
  db = await runtime.getD1Database('DB');
  for (const name of ['0001_contact_mvp.sql', '0002_wait_management.sql', '0003_case_reassignment.sql']) {
    const sql = await readFile(new URL(`../migrations-mvp/${name}`, import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
});
test.after(async () => { await runtime?.dispose(); });

for (const surface of ['shared', 'mvp']) {
  test(`${surface}: real workerd Worker API routes authorize, commit, replay and expose audited reassignment`, async () => {
    const reset = await runtime.dispatchFetch('http://127.0.0.1/__test/reset', {
      method: 'POST', headers: { 'x-fixture-surface': 'mvp' },
    });
    assert.equal(reset.status, 200);
    const headers = { 'x-fixture-surface': surface, 'x-fixture-session': 'valid', 'x-mvp-actor': actor };
    const get = path => runtime.dispatchFetch(`http://127.0.0.1${path}`, { headers });
    const operators = await get('/api/operators');
    assert.equal(operators.status, 200);
    assert.deepEqual((await operators.json()).operators.map(item => Object.keys(item).sort()),
      [['display_name', 'email'], ['display_name', 'email']]);
    const body = { requestId: 'workerd-reassign', expectedVersion: 1, assigneeEmail: target, reason: 'Runtime test' };
    const post = payload => runtime.dispatchFetch('http://127.0.0.1/api/cases/case-mvp-1/actions/reassign', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const response = await post(body);
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.actorEmail, actor);
    assert.equal(receipt.changes.assigneeEmail, target);
    assert.equal(receipt.changes.previousAssigneeEmail, null);
    const history = await get('/api/cases/case-mvp-1/events');
    const events = (await history.json()).events;
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'reassigned');
    assert.deepEqual(events[0].changes, receipt.changes);
    await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(target).run();
    assert.deepEqual(await (await post(body)).json(), receipt);
    assert.equal((await post({ ...body, reason: 'Different content' })).status, 409);
    await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(actor).run();
    assert.equal((await post(body)).status, 403);
    assert.equal((await get('/api/operators')).status, 403);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  });
}

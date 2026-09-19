import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import bootstrapWorker from '../trialBootstrapWorker.mjs';
import { createSharedWorker } from '../sharedWorker.mjs';
import { clearSessionState, isSessionBlockingResponse } from '../shared-ui/app.js';
import { createRequestState } from '../shared-ui/requestState.js';

const root = path.resolve(import.meta.dirname, '..');
const request = (pathName, init) => new Request(`https://trial.example.invalid${pathName}`, init);

async function config(name) {
  return JSON.parse(await readFile(path.join(root, name), 'utf8'));
}

test('bootstrap worker returns the same no-store disabled response for every path and method', async () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await bootstrapWorker.fetch(request(`/any/${method.toLowerCase()}`, { method }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    if (method !== 'HEAD') assert.deepEqual(await response.json(), { error: 'trial_disabled' });
  }
});

test('bootstrap and trial profiles keep bindings and exposure separate', async () => {
  const [bootstrap, trial, shared] = await Promise.all([
    config('wrangler.shared-trial-bootstrap.example.jsonc'),
    config('wrangler.shared-trial.example.jsonc'),
    config('wrangler.shared.example.jsonc'),
  ]);
  assert.equal(bootstrap.workers_dev, true);
  assert.equal(bootstrap.preview_urls, false);
  assert.equal(bootstrap.main, './trialBootstrapWorker.mjs');
  assert.equal(bootstrap.name, trial.name);
  assert.notEqual(trial.name, shared.name);
  for (const property of ['routes', 'assets', 'd1_databases', 'r2_buckets']) {
    assert.equal(Object.hasOwn(bootstrap, property), false);
  }
  assert.equal(trial.workers_dev, true);
  assert.equal(trial.preview_urls, false);
  assert.equal(Object.hasOwn(trial, 'routes'), false);
  assert.equal(Object.hasOwn(trial, 'r2_buckets'), false);
  assert.equal(trial.assets.directory, './shared-ui');
  assert.equal(trial.assets.binding, 'ASSETS');
  assert.equal(trial.assets.run_worker_first, true);
  assert.equal(trial.d1_databases[0].migrations_dir, './migrations-mvp');
  assert.equal(trial.vars.TRIAL_ENABLED, 'false');
  assert.equal(trial.vars.TRIAL_ATTACHMENTS_ENABLED, 'false');
  assert.equal(shared.routes.length, 1);
  assert.equal(shared.r2_buckets.length, 1);
});

test('static content remains behind host, trial and principal guards', async () => {
  const calls = { auth: 0, assets: 0, db: 0 };
  let principal = null;
  const env = {
    TRIAL_HOSTNAME: 'trial.example.invalid',
    TRIAL_ENABLED: 'true',
    TRIAL_ATTACHMENTS_ENABLED: 'true',
    ASSETS: { async fetch() { calls.assets += 1; return new Response('private-ui'); } },
    DB: { prepare() { calls.db += 1; throw new Error('not reached'); } },
  };
  const worker = createSharedWorker({
    principalResolver: { async resolve() { calls.auth += 1; return principal; } },
  });
  let response = await worker.fetch(new Request('https://wrong.example.invalid/index.html'), env);
  assert.equal(response.status, 404);
  assert.deepEqual(calls, { auth: 0, assets: 0, db: 0 });
  env.TRIAL_ENABLED = 'false';
  response = await worker.fetch(request('/index.html'), env);
  assert.equal(response.status, 503);
  assert.deepEqual(calls, { auth: 0, assets: 0, db: 0 });
  env.TRIAL_ENABLED = 'true';
  response = await worker.fetch(request('/index.html'), env);
  assert.equal(response.status, 403);
  assert.deepEqual(calls, { auth: 1, assets: 0, db: 0 });
  principal = { email: 'operator@example.invalid' };
  response = await worker.fetch(request('/index.html'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, { auth: 2, assets: 1, db: 0 });
  response = await worker.fetch(request('/index.html', { method: 'POST' }), env);
  assert.equal(response.status, 405);
  assert.deepEqual(calls, { auth: 3, assets: 1, db: 0 });
});

test('disabled attachment content does not query metadata or R2', async () => {
  const calls = { auth: 0, db: 0, r2: 0 };
  const worker = createSharedWorker({
    principalResolver: { async resolve() { calls.auth += 1; return { email: 'operator@example.invalid' }; } },
    createAttachmentStore: () => ({ async get() { calls.r2 += 1; } }),
  });
  const response = await worker.fetch(request('/api/attachments/file-1/content'), {
    TRIAL_HOSTNAME: 'trial.example.invalid',
    TRIAL_ENABLED: 'true',
    TRIAL_ATTACHMENTS_ENABLED: 'false',
    DB: { prepare() { calls.db += 1; } },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, { auth: 0, db: 0, r2: 0 });
});

test('disabled attachments return an empty detail list without a metadata query', async () => {
  const queries = [];
  const worker = createSharedWorker({
    principalResolver: { async resolve() { return { email: 'operator@example.invalid' }; } },
  });
  const response = await worker.fetch(request('/api/cases/case-1'), {
    TRIAL_HOSTNAME: 'trial.example.invalid',
    TRIAL_ENABLED: 'true',
    TRIAL_ATTACHMENTS_ENABLED: 'false',
    DB: { prepare(sql) {
      queries.push(sql);
      return { bind() { return this; }, async first() { return { case_id: 'case-1' }; } };
    } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).attachments, []);
  assert.equal(queries.some(sql => sql.includes('contact_attachments')), false);
});

test('blocked UI state invalidates requests and clears sensitive values', () => {
  const requests = createRequestState();
  const pending = requests.beginDetail();
  const urls = ['blob:one', 'blob:two'];
  const state = {
    cases: [{ case_id: 'case-1' }],
    current: { case_id: 'case-1' },
    principal: { email: 'operator@example.invalid' },
    objectUrls: new Set(urls),
  };
  const revoked = [];
  clearSessionState(requests, state, url => revoked.push(url));
  assert.equal(requests.isCurrent(pending), false);
  assert.deepEqual(revoked, urls);
  assert.deepEqual(state.cases, []);
  assert.equal(state.current, null);
  assert.equal(state.principal, null);
  assert.equal(state.objectUrls.size, 0);
  assert.deepEqual(state.page, { limit: 50, hasMore: false, nextCursor: null });
  assert.deepEqual(state.cursorStack, [null]);
  assert.equal(state.pageIndex, 0);
});

test('response classification blocks trial shutdown but not ordinary attachment 503s', () => {
  assert.equal(isSessionBlockingResponse(503, { error: 'trial_disabled' }), true);
  assert.equal(isSessionBlockingResponse(503, { error: 'attachments_disabled' }), false);
  assert.equal(isSessionBlockingResponse(503, { error: 'attachment_unavailable' }), false);
});

test('UI source preserves blocked-session state and distinguishes attachment API failures', async () => {
  const app = await readFile(path.join(root, 'shared-ui', 'app.js'), 'utf8');
  for (const condition of ['response.status === 401 || response.status === 403', 'response.redirected',
    "!== 'application/json'", "!== 'image/webp'", 'if (isCurrent()) blockAccess();',
    'catch {\n    if (!isCurrent()) return null;\n    blockAccess();']) {
    assert.ok(app.includes(condition), `missing fail-closed UI condition: ${condition}`);
  }
  assert.ok(app.includes("{ sessionBlocked: true }"));
  assert.equal(app.includes('response.json().catch(() => ({}))'), false);
  assert.ok(app.includes('body = await response.json();'));
  assert.ok(app.includes('blob = await response.blob();'));
  assert.ok(app.includes('!error.sessionBlocked && error.status !== 401 && error.status !== 403'));
  assert.ok(app.includes("if (contentType !== 'application/json') {"));
  assert.ok(app.includes("else message('添付ファイルを取得できませんでした。');"));
  assert.ok(app.includes("if (isSessionBlockingResponse(response.status, body)) blockAccess();"));
  assert.ok(app.includes("if (typeof document !== 'undefined')"));
  assert.ok(app.includes('saveVisibleDraft();'));
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium, firefox, expect as baseExpect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, '../../../.local-test/integration-browser');
const expect = baseExpect.configure({ timeout: 15_000 });
const actor = 'operator-one@example.invalid';
const target = 'operator-two@example.invalid';
const caseA = 'case-mvp-1';
const caseB = 'case-z-list-001';
let runtime;
let db;
let server;
let baseUrl;
let jwt;
const pendingRoutes = new WeakMap();

const headers = () => ({ 'cf-access-jwt-assertion': jwt, 'content-type': 'application/json' });
const api = (url, init = {}) => fetch(`${baseUrl}${url}`, { ...init, headers: headers() });
const payload = () => ({ requestId: crypto.randomUUID(), expectedVersion: 1,
  assigneeEmail: target, reason: 'Synthetic integration handover' });
const reassign = (id, body) => api(`/api/cases/${id}/actions/reassign`, {
  method: 'POST', body: JSON.stringify(body),
});

async function bounded(operation, timeout, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

test.before(async () => {
  await mkdir(output, { recursive: true });
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'local-integration', alg: 'RS256' };
  jwt = await new SignJWT({ email: actor, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuedAt().setExpirationTime('2h')
    .setIssuer('https://example.cloudflareaccess.com').setAudience('shared-browser-local').sign(privateKey);
  const bundle = await build({ entryPoints: [path.join(root, 'tests/shared-browser-worker.mjs')],
    bundle: true, write: false, format: 'esm', platform: 'browser' });
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-06', d1Databases: ['DB'], r2Buckets: ['ATTACHMENTS'],
    bindings: { LOCAL_BROWSER_HARNESS: 'enabled', TEST_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
      TRIAL_HOSTNAME: '127.0.0.1', TRIAL_ENABLED: 'true', TRIAL_ATTACHMENTS_ENABLED: 'true',
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'shared-browser-local',
      TIME_ZONE: 'Asia/Tokyo' },
  }));
  db = await runtime.getD1Database('DB');
  const migrations = path.join(root, 'migrations-shared-browser');
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join(migrations, name), 'utf8');
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
  server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(baseUrl).host) { response.writeHead(403).end(); return; }
      const url = new URL(request.url, baseUrl);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const result = await runtime.dispatchFetch(url.href, { method: request.method,
          headers: request.headers, ...(body.length ? { body } : {}) });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'styles.css', 'requestState.js', 'listState.js'].includes(asset)) {
        response.writeHead(404).end(); return;
      }
      const mime = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(await readFile(path.join(root, 'shared-ui', asset)));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('/api/session')).status, 200);
}, { timeout: 60_000 });

test.after(async () => {
  try {
    console.log('integration cleanup: HTTP');
    if (server) {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await bounded(closed, 5_000, 'HTTP close');
    }
  } finally {
    console.log('integration cleanup: workerd');
    await bounded(runtime?.dispose(), 10_000, 'workerd dispose');
    console.log('integration cleanup: complete');
  }
}, { timeout: 30_000 });

test.beforeEach(async () => {
  // Keep the existing harness's 55 cases and R2 object, with a one-item final self page.
  await db.batch([
    db.prepare('UPDATE contact_cases SET last_request_id = NULL'),
    db.prepare('DELETE FROM contact_case_events'), db.prepare('DELETE FROM contact_api_requests'),
    db.prepare('UPDATE contact_operators SET active = 1'),
    db.prepare(`UPDATE contact_cases SET assignee_email = CASE WHEN case_id >= 'case-z-list-051'
      THEN ? ELSE ? END, status = '未対応', version = 1`).bind(target, actor),
  ]);
});

async function open(t, name = 'chrome', viewport = { width: 1440, height: 1000 }) {
  // Retain short, synthetic-only profiles locally; Windows automatic profile removal can stall close.
  const profile = await mkdtemp(path.resolve(root, '../../../.local-test/p-'));
  const engine = name === 'firefox' ? firefox : chromium;
  const context = await engine.launchPersistentContext(profile, {
    ...(name !== 'firefox' ? { channel: name === 'edge' ? 'msedge' : 'chrome' } : {}),
    headless: true, viewport, extraHTTPHeaders: headers(),
  });
  const browser = context.browser();
  let closed;
  const close = () => closed ||= (async () => {
    const pending = context.pages().flatMap(page => [...pendingRoutes.get(page) || []]);
    pending.forEach(item => item.release());
    try { await bounded(Promise.all(pending.map(item => item.finished)), 12_000, 'delayed routes'); }
    finally {
      try { await bounded(context.close(), 10_000, 'context/browser close'); }
      finally { if (browser.isConnected()) await bounded(browser.close(), 10_000, 'browser close'); }
    }
  })();
  t.after(close, { timeout: 30_000 });
  await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.completed = [];
    window.fetch = async (...args) => {
      try { return await original(...args); }
      finally { window.completed.push(String(args[0])); }
    };
  });
  await page.goto(baseUrl);
  await expect(page).toHaveTitle('問い合わせ対応 | SPEED AD');
  await expect(page.locator('#cases button')).toHaveCount(50);
  await expect(page.locator('#principal')).toContainText(actor);
  t.after(() => assert.deepEqual(errors, []));
  return { page, context, browser, close };
}

async function selectCase(page, id = caseA) {
  await page.locator(`#cases button[data-case-id="${id}"]`).click();
  await expect(page.locator('#subject')).toHaveText(id === caseA
    ? '共有版の合成問い合わせ' : `一覧検索 ${id.slice(-3)}`);
}

async function editReassign(page, reason = 'Synthetic integration handover') {
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await page.getByLabel('変更先の担当者').selectOption(target);
  await page.getByLabel('変更理由', { exact: true }).fill(reason);
}
const submit = page => page.locator('#action-form button[type="submit"]').click();

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function delay(page, pattern, { status, capture = false } = {}) {
  const started = deferred();
  const gate = deferred();
  const finished = deferred();
  const pending = { release: gate.resolve, finished: finished.promise };
  if (!pendingRoutes.has(page)) pendingRoutes.set(page, new Set());
  pendingRoutes.get(page).add(pending);
  await page.route(pattern, async route => {
    let response;
    try {
      response = capture ? await route.fetch({ timeout: 10_000 }) : null;
      started.resolve(route.request());
      await gate.promise;
      if (status && status !== 200) {
        await route.fulfill({ status, contentType: 'application/json', body: '{"error":"synthetic_failure"}' });
      } else {
        response ||= await route.fetch({ timeout: 10_000 });
        await route.fulfill({ response });
      }
    } finally {
      await response?.dispose();
      pendingRoutes.get(page).delete(pending);
      finished.resolve();
    }
  }, { times: 1 });
  return { started: started.promise, release: gate.resolve, finished: finished.promise };
}

async function finishResponse(page, pending, pathName) {
  const count = await page.evaluate(value => window.completed.filter(url => url.includes(value)).length, pathName);
  pending.release();
  await page.waitForFunction(({ pathName, count }) =>
    window.completed.filter(url => url.includes(pathName)).length > count, { pathName, count });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const name of ['chrome', 'edge', 'firefox']) {
  test(`JWT integration ${name}: paging/search -> keyboard reassign -> filtered first page and audited history`, { timeout: 120_000 }, async t => {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      // Each viewport exercises the same one-item final-page transition.
      await db.prepare(`UPDATE contact_cases SET assignee_email = ?, version = 1, last_request_id = NULL
        WHERE case_id = 'case-z-list-050'`).bind(actor).run();
      await db.batch([db.prepare('DELETE FROM contact_case_events'), db.prepare('DELETE FROM contact_api_requests')]);
      const { page, browser, close } = await open(t, name, viewport);
      const consoleErrors = [];
      page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
      console.log(JSON.stringify({ browser: name, version: browser.version(), viewport, url: baseUrl, auth: 'local RS256 JWT' }));
      await selectCase(page);
      await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
      await expect(page.locator('#attachments img')).toBeVisible();
      assert.equal(await page.locator('#attachments img').evaluate(img => img.complete && img.naturalWidth > 0), true);
      await page.locator('#next-page').click();
      await expect(page.locator('#cases button')).toHaveCount(5);
      await expect(page.locator('#page-number')).toHaveText('2ページ');
      await page.locator('#search').evaluate(input => {
        input.value = '一覧検索 050';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (!document.querySelector('#previous-page').disabled || !document.querySelector('#next-page').disabled) {
          throw new Error('stale pagination remained enabled during search debounce');
        }
        document.querySelector('#previous-page').click();
        document.querySelector('#next-page').click();
      });
      await expect(page.locator('#cases button')).toHaveCount(1);
      await expect(page.locator('#page-number')).toHaveText('1ページ');
      await page.locator('#search').fill('');
      await page.locator('#assignee-filter').selectOption('self');
      await expect(page.locator('#cases button')).toHaveCount(50);
      await page.locator('#next-page').click();
      await expect(page.locator('#cases button')).toHaveCount(1);
      await expect(page.locator('#page-number')).toHaveText('2ページ');
      await selectCase(page, 'case-z-list-050');
      await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
      await expect(page.getByLabel('変更先の担当者')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('変更理由', { exact: true })).toBeFocused();
      await page.keyboard.type('Synthetic page-two handover');
      await expect(page.getByLabel('変更先の担当者')).toHaveValue(target);
      await page.locator('#action-form').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${name}-${viewport.width}-form.png`) });
      await submit(page);
      await expect(page.locator('#events')).toContainText(`旧担当: ${actor} → 新担当: ${target}`);
      await expect(page.locator('#events')).toContainText(`操作: ${actor}`);
      await expect(page.locator('#assignee-filter')).toHaveValue('self');
      await expect(page.locator('#page-number')).toHaveText('1ページ');
      await expect(page.locator('#cases button')).toHaveCount(50);
      await expect(page.locator('#next-page')).toBeDisabled();
      await expect(page.locator('#cases button[data-case-id="case-z-list-050"]')).toHaveCount(0);
      await page.locator('#events').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${name}-${viewport.width}-history.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(consoleErrors, []);
      const events = (await (await api('/api/cases/case-z-list-050/events')).json()).events;
      assert.equal(events.length, 1);
      assert.equal(events[0].event_type, 'reassigned');
      assert.equal(events[0].from_version, 1);
      assert.equal(events[0].to_version, 2);
      await close();
    }
  });
}

for (const status of [200, 409]) {
  test(`JWT integration background ${status}: refresh current assignee list without replacing B note`, { timeout: 60_000 }, async t => {
    const { page } = await open(t);
    await page.locator('#assignee-filter').selectOption('self');
    await selectCase(page);
    await editReassign(page);
    const pending = await delay(page, `**/api/cases/${caseA}/actions/reassign`);
    await submit(page);
    await pending.started;
    await selectCase(page, caseB);
    await page.getByRole('button', { name: 'メモを残す', exact: true }).click();
    await page.getByLabel('メモ', { exact: true }).fill('B note survives background reassignment');
    if (status === 409) assert.equal((await reassign(caseA, payload())).status, 200);
    await finishResponse(page, pending, `/api/cases/${caseA}/actions/reassign`);
    await expect(page.locator(`#cases button[data-case-id="${caseA}"]`)).toHaveCount(0);
    await expect(page.locator('#cases button')).toHaveCount(50);
    await expect(page.locator('#next-page')).toBeDisabled();
    await expect(page.getByLabel('メモ', { exact: true })).toHaveValue('B note survives background reassignment');
    await expect(page.locator('#action-form')).toHaveAttribute('data-action', 'note');
    await expect(page.locator('#subject')).toHaveText('一覧検索 001');
    await page.screenshot({ path: path.join(output, `background-${status}-B-note.png`) });
    assert.equal((await db.prepare('SELECT version FROM contact_cases WHERE case_id = ?').bind(caseB).first()).version, 1);
  });
}

for (const status of [200, 400, 403]) {
  test(`JWT integration stale list ${status}: cannot overwrite post-reassignment list or session`, { timeout: 60_000 }, async t => {
    const { page } = await open(t);
    await page.locator('#assignee-filter').selectOption('self');
    await selectCase(page);
    await editReassign(page);
    const pending = await delay(page, url => url.pathname === '/api/cases', { status, capture: true });
    await page.locator('#refresh').click();
    await pending.started;
    await submit(page);
    await expect(page.locator('#events')).toContainText('担当を変更');
    await expect(page.locator('#cases button')).toHaveCount(50);
    await finishResponse(page, pending, '/api/cases?');
    await expect(page.locator(`#cases button[data-case-id="${caseA}"]`)).toHaveCount(0);
    await expect(page.locator('#next-page')).toBeDisabled();
    await expect(page.locator('#principal')).toContainText(actor);
    await expect(page.locator('#message')).toHaveText('保存しました。');
  });
}

test('JWT integration: delayed operators after cancel/search and actual authentication rejection stay invalid', { timeout: 60_000 }, async t => {
  const { page, context } = await open(t);
  await selectCase(page);
  await editReassign(page, 'Retained candidate draft');
  await page.locator('#cancel').click();
  const pending = await delay(page, '**/api/operators', { capture: true });
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await pending.started;
  await page.getByRole('button', { name: 'メモを残す', exact: true }).click();
  await page.getByLabel('メモ', { exact: true }).fill('Keep this note during search');
  await page.locator('#search').fill('一覧検索 001');
  await expect(page.locator('#cases button')).toHaveCount(1);
  await finishResponse(page, pending, '/api/operators');
  await expect(page.getByLabel('メモ', { exact: true })).toHaveValue('Keep this note during search');
  await expect(page.getByLabel('変更先の担当者')).toHaveCount(0);
  const expired = await delay(page, '**/api/operators', { capture: true });
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await expired.started;
  await context.setExtraHTTPHeaders({ 'cf-access-jwt-assertion': 'invalid-local-signature' });
  await page.locator('#refresh').click();
  await expect(page.locator('#principal')).toHaveText('アクセスできません');
  await finishResponse(page, expired, '/api/operators');
  await expect(page.locator('#cases button')).toHaveCount(0);
  await expect(page.locator('#action-form')).toHaveCount(0);
  await expect(page.locator('#detail')).toHaveText('セッションを確認できません。再ログイン後に再読み込みしてください。');
});

test('JWT integration ACK loss: filtered refresh and replay preserve one atomic receipt/event after target disable', { timeout: 60_000 }, async t => {
  const { page } = await open(t);
  await page.locator('#assignee-filter').selectOption('self');
  await selectCase(page);
  await editReassign(page);
  let sent;
  await page.route(`**/api/cases/${caseA}/actions/reassign`, async route => {
    sent = route.request().postDataJSON();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"acknowledgement_unavailable"}' });
  }, { times: 1 });
  await submit(page);
  await expect(page.locator('#message')).toContainText('保存結果を確認できませんでした');
  await page.locator('#refresh').click();
  await expect(page.locator(`#cases button[data-case-id="${caseA}"]`)).toHaveCount(0);
  await expect(page.getByLabel('変更理由', { exact: true })).toHaveValue(sent.reason);
  await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(target).run();
  const replay = page.waitForRequest(request => request.method() === 'POST');
  await submit(page);
  assert.deepEqual((await replay).postDataJSON(), sent);
  await expect(page.locator('#events')).toContainText('担当を変更');
  await expect(page.locator('#message')).toHaveText('保存しました。');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM contact_api_requests').first()).count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM contact_case_events').first()).count, 1);
  assert.equal((await reassign(caseA, { ...sent, reason: 'Different contents' })).status, 409);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('integration harness cleanup releases an outstanding delayed route on early return', { timeout: 60_000 }, async t => {
  const { page } = await open(t);
  await selectCase(page);
  const pending = await delay(page, '**/api/operators', { capture: true });
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await pending.started;
  let completed = false;
  pending.finished.then(() => { completed = true; });
  t.after(() => assert.equal(completed, true, 'context cleanup must release and finish the held route'));
  // Deliberately leave the gate held; the registered context cleanup must release it.
});

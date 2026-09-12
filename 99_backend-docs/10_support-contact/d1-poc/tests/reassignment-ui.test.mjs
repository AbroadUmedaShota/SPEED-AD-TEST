import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium, firefox, expect as baseExpect } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createSharedWorker } from '../sharedWorker.mjs';
import mvpWorker from '../mvpWorker.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, '../../../.local-test/reassignment-browser');
const expect = baseExpect.configure({ timeout: 15_000 });
const actor = 'operator-a@example.invalid';
const target = 'operator-b@example.invalid';
const caseId = 'case-mvp-1';
const otherCase = 'case-mvp-2';
let mode = 'shared';
let runtime;
let db;
let server;
let baseUrl;
const env = { TRIAL_ENABLED: 'true', TRIAL_HOSTNAME: '127.0.0.1',
  MVP_LOCAL_ONLY: 'true', MVP_TIME_ZONE: 'Asia/Tokyo' };
const shared = createSharedWorker({
  principalResolver: { async resolve() {
    const row = await db.prepare('SELECT active FROM contact_operators WHERE email = ?').bind(actor).first();
    return row?.active === 1 ? { email: actor, displayName: 'Synthetic operator A' } : null;
  } },
});
const selectors = () => mode === 'shared' ? {
  subject: '#subject', events: '#events', message: '#message', refresh: '#refresh', cancel: '#cancel',
} : {
  subject: '.case-summary h1', events: '#event-list', message: '#global-message',
  refresh: '#refresh-button', cancel: '#cancel-action',
};

async function reset() {
  const response = await mvpWorker.fetch(new Request('http://127.0.0.1/__test/reset', { method: 'POST' }), env);
  assert.equal(response.status, 200);
  await db.prepare(`INSERT INTO contact_cases
    (case_id, received_at, category, subject, customer_name, customer_email, message,
      status, version, created_at, updated_at)
    SELECT ?, received_at, category, 'Second synthetic case', customer_name, customer_email,
      message, status, version, created_at, updated_at FROM contact_cases WHERE case_id = ?`)
    .bind(otherCase, caseId).run();
}

test.before(async () => {
  await mkdir(output, { recursive: true });
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("local D1"); } };',
    compatibilityDate: '2026-09-06', d1Databases: ['DB'],
  }));
  db = await runtime.getD1Database('DB');
  env.DB = db;
  for (const name of ['0001_contact_mvp.sql', '0002_wait_management.sql', '0003_case_reassignment.sql']) {
    const sql = await readFile(path.join(root, 'migrations-mvp', name), 'utf8');
    await db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
  server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(baseUrl).host) {
        response.writeHead(403).end(); return;
      }
      const url = new URL(request.url, baseUrl);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const input = new Request(url, {
          method: request.method, headers: request.headers,
          ...(body.length ? { body } : {}),
        });
        const result = await (mode === 'shared' ? shared : mvpWorker).fetch(input, env);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (url.pathname === '/expired') {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Synthetic expired session</p>');
        return;
      }
      const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'styles.css', 'app.js', 'requestState.js', 'requestCoordinator.js'].includes(asset)) {
        response.writeHead(404).end(); return;
      }
      const mime = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(await readFile(path.join(root, mode === 'shared' ? 'shared-ui' : 'ui', asset)));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await runtime?.dispose();
});

async function openPage(browser, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === baseUrl ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__operatorsFinished = 0;
    window.fetch = async (...args) => {
      try { return await originalFetch(...args); }
      finally {
        if (String(args[0]).endsWith('/api/operators')) window.__operatorsFinished += 1;
      }
    };
  });
  await page.goto(baseUrl);
  await expect(page).toHaveTitle('問い合わせ対応 | SPEED AD');
  if (mode === 'mvp') await page.locator('[data-filter="all"]').click();
  await page.locator(`button[data-case-id="${caseId}"]`).click();
  await expect(page.locator(selectors().subject)).toHaveText('合成問い合わせ');
  return { context, page, errors };
}

async function openReassign(page) {
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await expect(page.getByLabel('変更先の担当者')).toBeVisible();
}

async function fillReassign(page, reason = 'Synthetic handover reason') {
  await openReassign(page);
  await page.getByLabel('変更先の担当者').selectOption(target);
  await page.getByLabel(/^変更理由/).fill(reason);
}

async function submit(page) {
  await page.locator('#action-form button[type="submit"]').click();
}

async function completePending(page, release, finished) {
  release();
  await page.waitForFunction(value => window.__operatorsFinished >= value, finished);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function delayedOperators(page, outcome) {
  const finished = await page.evaluate(() => window.__operatorsFinished + 1);
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  await page.route('**/api/operators', async route => {
    started();
    await gate;
    if (outcome === 'network') return route.abort('failed');
    if (outcome === 'redirect') return route.fulfill({ status: 302, headers: { location: '/expired' } });
    const status = Number(outcome) || 200;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? {
      operators: [{ email: target, display_name: 'Synthetic delayed target' }],
    } : { error: 'synthetic_failure' }) });
  }, { times: 1 });
  await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
  await ready;
  return { release, finished };
}

for (const surface of ['shared', 'mvp']) {
  for (const [browserName, launch] of [
    ['chrome', () => chromium.launch({ channel: 'chrome', headless: true })],
    ['edge', () => chromium.launch({ channel: 'msedge', headless: true })],
    ['firefox', () => firefox.launch({ headless: true })],
  ]) {
    test(`${surface}: ${browserName} desktop/mobile keyboard select -> reason -> save -> history`, async t => {
      mode = surface;
      const browser = await launch();
      t.after(() => browser.close());
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await reset();
        const { page, context, errors } = await openPage(browser, viewport);
        await page.screenshot({ path: path.join(output, `${surface}-${browserName}-${viewport.width}-detail.png`) });
        const consoleErrors = [];
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        await openReassign(page);
        await expect(page.getByLabel('変更先の担当者')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Tab');
        await expect(page.getByLabel(/^変更理由/)).toBeFocused();
        await page.keyboard.type('Synthetic keyboard reassignment');
        await expect(page.getByLabel('変更先の担当者')).toHaveValue(target);
        await page.locator('#action-form').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${surface}-${browserName}-${viewport.width}-form.png`) });
        await submit(page);
        await expect(page.locator(selectors().events)).toContainText('旧担当: 未割当');
        await expect(page.locator(selectors().events)).toContainText(`新担当: ${target}`);
        await expect(page.locator(selectors().events)).toContainText(`操作: ${actor}`);
        await expect(page.locator(selectors().events)).toContainText('Synthetic keyboard reassignment');
        const row = await db.prepare('SELECT status, assignee_email, version FROM contact_cases WHERE case_id = ?').bind(caseId).first();
        assert.deepEqual(row, { status: '未対応', assignee_email: target, version: 2 });
        await page.locator(selectors().events).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${surface}-${browserName}-${viewport.width}-history.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
        assert.deepEqual(errors, []);
        assert.deepEqual(consoleErrors, []);
        console.log(JSON.stringify({ surface, browser: browserName, version: browser.version(), viewport, url: baseUrl }));
        await context.close();
      }
    });
  }

  test(`${surface}: ACK loss, refresh and inactive target retain original requestId/version for replay`, async t => {
    mode = surface;
    await reset();
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const { page, errors } = await openPage(browser);
    const commands = [];
    await page.route('**/actions/reassign', async route => {
      commands.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (commands.length === 1) {
        assert.equal(response.status(), 200);
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_ack_loss"}' });
      } else await route.fulfill({ response });
    });
    await fillReassign(page);
    await submit(page);
    await expect(page.getByText(/保存結果を確認できませんでした/)).toBeVisible();
    await expect(page.getByLabel(/^変更理由/)).toHaveValue('Synthetic handover reason');
    await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(target).run();
    await page.getByRole('button', { name: '最新版を取得', exact: true }).click();
    await expect(page.getByRole('button', { name: '対応を始める', exact: true })).toBeVisible();
    await openReassign(page);
    await expect(page.getByLabel('変更先の担当者')).toHaveValue(target);
    assert.match(await page.getByLabel('変更先の担当者').locator('option:checked').textContent(), /現在の候補外/);
    await submit(page);
    await expect(page.locator(selectors().events)).toContainText('Synthetic handover reason');
    await expect(page.locator('#action-form')).toBeHidden();
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[1], commands[0]);
    assert.equal(commands[1].expectedVersion, 1);
    assert.equal((await db.prepare('SELECT count(*) AS count FROM contact_case_events').first()).count, 1);
    assert.deepEqual(errors, []);
  });

  for (const navigate of [false, true]) {
    test(`${surface}: in-flight save retains edited draft${navigate ? ' across case navigation' : ''}`, async t => {
      mode = surface;
      await reset();
      const browser = await chromium.launch({ headless: true });
      t.after(() => browser.close());
      const { page, errors } = await openPage(browser);
      let release;
      let started;
      const gate = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { started = resolve; });
      await page.route('**/actions/reassign', async route => {
        const response = await route.fetch();
        started();
        await gate;
        await route.fulfill({ response });
      }, { times: 1 });
      await fillReassign(page);
      await submit(page);
      await ready;
      await page.getByLabel(/^変更理由/).fill('Edited while saving');
      if (navigate) {
        await page.locator(`button[data-case-id="${otherCase}"]`).click();
        await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
      }
      const saved = page.waitForResponse(response => response.url().endsWith('/actions/reassign'));
      release();
      await saved;
      if (!navigate) {
        await expect(page.locator('#action-form')).toBeHidden();
        await expect(page.getByRole('button', { name: '対応を始める', exact: true })).toBeVisible();
      } else {
        await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
        await page.locator(`button[data-case-id="${caseId}"]`).click();
        await expect(page.locator(selectors().subject)).toHaveText('合成問い合わせ');
      }
      await openReassign(page);
      await expect(page.getByLabel(/^変更理由/)).toHaveValue('Edited while saving');
      await expect(page.locator(selectors().events)).toContainText('Synthetic handover reason');
      assert.deepEqual(errors, []);
    });
  }

  test(`${surface}: cancel after a newer form suppresses an older candidates response`, async t => {
    mode = surface;
    await reset();
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const { page, errors } = await openPage(browser);
    const pending = await delayedOperators(page, '200');
    await openReassign(page);
    await page.getByLabel(/^変更理由/).fill('Cancelled draft');
    await page.locator(selectors().cancel).click();
    await completePending(page, pending.release, pending.finished + 1);
    await expect(page.locator('#action-form')).toBeHidden();
    await openReassign(page);
    await expect(page.getByLabel(/^変更理由/)).toHaveValue('Cancelled draft');
    assert.deepEqual(errors, []);
  });

  for (const status of [200, 409]) {
    test(`${surface}: old case POST ${status} preserves the current other-case note form`, async t => {
      mode = surface;
      await reset();
      const browser = await chromium.launch({ headless: true });
      t.after(() => browser.close());
      const { page, errors } = await openPage(browser);
      let release;
      let started;
      const gate = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { started = resolve; });
      await page.route('**/actions/reassign', async route => {
        if (status === 409) await db.prepare('UPDATE contact_cases SET version = 2 WHERE case_id = ?').bind(caseId).run();
        const response = await route.fetch();
        assert.equal(response.status(), status);
        started();
        await gate;
        await route.fulfill({ response });
      }, { times: 1 });
      await fillReassign(page);
      await submit(page);
      await ready;
      await page.locator(`button[data-case-id="${otherCase}"]`).click();
      await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
      await page.getByRole('button', { name: 'メモを残す', exact: true }).click();
      await page.getByLabel(/^メモ/).fill('Current B note must stay open');
      const saved = page.waitForResponse(response => response.url().endsWith('/actions/reassign'));
      release();
      await saved;
      await page.waitForLoadState('networkidle');
      await expect(page.getByLabel(/^メモ/)).toHaveValue('Current B note must stay open');
      await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
      await expect(page.getByLabel('変更先の担当者')).toHaveCount(0);
      await page.screenshot({ path: path.join(output, `${surface}-late-post-${status}-B-note.png`) });
      if (status === 409) {
        await page.locator(`button[data-case-id="${caseId}"]`).click();
        await expect(page.locator(selectors().subject)).toHaveText('合成問い合わせ');
        await openReassign(page);
        await expect(page.getByLabel(/^変更理由/)).toHaveValue('Synthetic handover reason');
        const retried = page.waitForRequest(request => request.url().endsWith('/actions/reassign'));
        await submit(page);
        assert.equal((await retried).postDataJSON().expectedVersion, 2);
        await expect(page.locator(selectors().events)).toContainText('Synthetic handover reason');
      }
      assert.deepEqual(errors, []);
    });
  }

  test(`${surface}: required reason, unavailable target, conflict and draft/cancel behavior`, async t => {
    mode = surface;
    await reset();
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const { page, errors } = await openPage(browser);
    const commands = [];
    page.on('request', request => {
      if (request.url().endsWith('/actions/reassign')) commands.push(request.postDataJSON());
    });
    await openReassign(page);
    await page.getByLabel('変更先の担当者').selectOption(target);
    await submit(page);
    assert.equal(commands.length, 0);
    await page.getByLabel(/^変更理由/).fill('Keep this draft');
    await page.locator(selectors().cancel).click();
    await openReassign(page);
    await expect(page.getByLabel(/^変更理由/)).toHaveValue('Keep this draft');
    await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(target).run();
    const rejected = page.waitForResponse(response => response.url().endsWith('/actions/reassign'));
    await submit(page);
    assert.equal((await rejected).status(), 400);
    await expect(page.locator('#action-form button[type="submit"]')).toBeEnabled();
    await expect(page.getByLabel(/^変更理由/)).toHaveValue('Keep this draft');
    assert.equal((await db.prepare('SELECT count(*) AS count FROM contact_case_events').first()).count, 0);
    await db.prepare('UPDATE contact_operators SET active = 1 WHERE email = ?').bind(target).run();
    await db.prepare('UPDATE contact_cases SET version = 2 WHERE case_id = ?').bind(caseId).run();
    const oldForm = await page.locator('#action-form').elementHandle();
    await submit(page);
    await expect(page.getByText(/別の担当者/).first()).toBeVisible();
    if (mode === 'shared') {
      await expect.poll(() => oldForm.evaluate(element => element.isConnected)).toBe(false);
      await openReassign(page);
    } else {
      await expect(page.locator('#version-label')).toHaveText('版 2');
    }
    await expect(page.getByLabel(/^変更理由/)).toHaveValue('Keep this draft');
    await submit(page);
    await expect(page.locator(selectors().events)).toContainText('Keep this draft');
    assert.equal(commands.at(-1).expectedVersion, 2);
    assert.notEqual(commands.at(-1).requestId, commands[0].requestId);
    assert.deepEqual(errors, []);
  });

  for (const destination of ['case', 'action']) {
    for (const outcome of ['200', '400', '403', 'network', 'redirect']) {
      test(`${surface}: delayed operators ${outcome} after ${destination} switch has no UI side effects`, async t => {
        mode = surface;
        await reset();
        const browser = await chromium.launch({ headless: true });
        t.after(() => browser.close());
        const { page, errors } = await openPage(browser);
        const pending = await delayedOperators(page, outcome);
        if (destination === 'case') {
          await page.locator(`button[data-case-id="${otherCase}"]`).click();
          await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
        }
        await page.getByRole('button', { name: 'メモを残す', exact: true }).click();
        await page.getByLabel(/^メモ/).fill('Keep current action');
        await completePending(page, pending.release, pending.finished);
        await expect(page.getByLabel(/^メモ/)).toHaveValue('Keep current action');
        await expect(page.getByLabel('変更先の担当者')).toHaveCount(0);
        await expect(page.locator(selectors().subject)).toHaveText(destination === 'case' ? 'Second synthetic case' : '合成問い合わせ');
        assert.deepEqual(errors, []);
      });
    }
  }

  test(`${surface}: delayed candidates cannot restore UI after current session is blocked`, async t => {
    mode = surface;
    await reset();
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const { page, errors } = await openPage(browser);
    const pending = await delayedOperators(page, '200');
    await db.prepare('UPDATE contact_operators SET active = 0 WHERE email = ?').bind(actor).run();
    await page.getByRole('button', { name: '担当を変更する', exact: true }).click();
    if (mode === 'shared') await expect(page.locator('#principal')).toHaveText('アクセスできません');
    else await expect(page.locator('#auth-blocked')).toBeVisible();
    await completePending(page, pending.release, pending.finished);
    await expect(page.getByLabel('変更先の担当者')).not.toBeVisible();
    if (mode === 'shared') await expect(page.locator('#principal')).toHaveText('アクセスできません');
    else await expect(page.locator('#auth-blocked')).toBeVisible();
    assert.deepEqual(errors, []);
  });
}

test('mvp: conflict refresh of A cannot replace B note after its detail response arrives', async t => {
  mode = 'mvp';
  await reset();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const { page, errors } = await openPage(browser);
  await fillReassign(page);
  await db.prepare('UPDATE contact_cases SET version = 2 WHERE case_id = ?').bind(caseId).run();
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  await page.route(`**/api/cases/${caseId}`, async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  await submit(page);
  await ready;
  await page.locator(`button[data-case-id="${otherCase}"]`).click();
  await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
  await page.getByRole('button', { name: 'メモを残す', exact: true }).click();
  await page.getByLabel(/^メモ/).fill('B note during A conflict refresh');
  release();
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel(/^メモ/)).toHaveValue('B note during A conflict refresh');
  await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
  await expect(page.getByLabel('変更先の担当者')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'mvp-conflict-refresh-B-note.png') });
  assert.deepEqual(errors, []);
});

test('shared: case navigation alone invalidates the pending candidates loading message', async t => {
  mode = 'shared';
  await reset();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const { page, errors } = await openPage(browser);
  const pending = await delayedOperators(page, '200');
  await expect(page.locator('#message')).toHaveText('担当候補を読み込み中です。');
  await page.locator(`button[data-case-id="${otherCase}"]`).click();
  await expect(page.locator(selectors().subject)).toHaveText('Second synthetic case');
  await expect(page.locator('#message')).toHaveText('');
  await completePending(page, pending.release, pending.finished);
  await expect(page.locator('#message')).toHaveText('');
  await expect(page.locator('#action-form')).toBeHidden();
  assert.deepEqual(errors, []);
});

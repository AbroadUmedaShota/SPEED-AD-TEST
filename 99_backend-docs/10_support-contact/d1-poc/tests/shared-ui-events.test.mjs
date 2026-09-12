import assert from 'node:assert/strict';
import test from 'node:test';

class StubElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.textContent = '';
    this.value = '';
  }

  addEventListener(type, listener) {
    if (!this.listeners) this.listeners = new Map();
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners?.get(type) || []) {
      listener({ target: this, preventDefault() {} });
    }
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  closest() { return null; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function page(cases, hasMore = false, nextCursor = null) {
  return { cases, page: { limit: 50, hasMore, nextCursor } };
}

const caseItem = caseId => ({
  case_id: caseId, status: '未対応', subject: caseId, customer_name: 'Customer',
});
const flush = () => new Promise(resolve => setImmediate(resolve));

async function startProductApp(t, testName) {
  const elementIds = ['message', 'cases', 'detail', 'principal', 'search', 'status-filter',
    'assignee-filter', 'priority-filter', 'page-number', 'previous-page', 'next-page',
    'queue-state', 'refresh', 'detail-template'];
  const elements = new Map(elementIds.map(id => [id, new StubElement()]));
  const pendingCases = [];
  const timers = new Map();
  let nextTimerId = 1;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.document = {
    createElement: tagName => new StubElement(tagName),
    getElementById: id => elements.get(id),
    querySelector: () => null,
  };
  globalThis.fetch = async path => {
    if (path === '/api/session') {
      return json({ principal: { email: 'operator@example.invalid', displayName: 'Operator' } });
    }
    const request = deferred();
    pendingCases.push({ path, ...request });
    return request.promise;
  };
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });
  const runTimers = () => {
    const scheduled = [...timers.values()];
    timers.clear();
    scheduled.forEach(({ callback }) => callback());
  };

  await import(`../shared-ui/app.js?event-regression=${testName}-${Date.now()}`);
  await flush();
  return { elements, pendingCases, runTimers, timers };
}

test('3b75219 regression: search input invalidates old cursor before next and debounce', async t => {
  const { elements, pendingCases, runTimers, timers } = await startProductApp(t, 'cursor-race');
  assert.equal(pendingCases.length, 1);
  pendingCases[0].resolve(json(page([caseItem('old-page')], true, 'old-cursor')));
  await flush();
  assert.equal(elements.get('next-page').disabled, false);

  elements.get('search').value = 'new query';
  elements.get('search').dispatch('input');
  assert.equal(elements.get('previous-page').disabled, true);
  assert.equal(elements.get('next-page').disabled, true);
  assert.equal(elements.get('page-number').textContent, '0ページ');
  assert.equal(elements.get('queue-state').textContent, '0件');
  elements.get('next-page').dispatch('click');
  elements.get('previous-page').dispatch('click');
  assert.equal(pendingCases.length, 1, 'no request may reuse the old cursor before debounce');

  elements.get('refresh').dispatch('click');
  assert.equal(timers.size, 0, 'refresh clears the pending search timer');
  assert.equal(pendingCases.length, 2);
  assert.equal(pendingCases[1].path, '/api/cases?q=new+query');
  pendingCases[1].resolve(json(page([])));
  await flush();

  elements.get('search').value = 'mixed query';
  elements.get('search').dispatch('input');
  elements.get('status-filter').value = '対応中';
  elements.get('status-filter').dispatch('change');
  assert.equal(timers.size, 0, 'filter change clears the pending search timer');
  assert.equal(pendingCases.length, 3);
  assert.match(pendingCases[2].path, /^\/api\/cases\?q=mixed\+query&status=/);
  assert.equal(pendingCases[2].path.includes('cursor='), false);
  pendingCases[2].resolve(json(page([])));
  await flush();
  assert.equal(elements.get('page-number').textContent, '0ページ');
  assert.equal(elements.get('next-page').disabled, true);

  elements.get('message').textContent = 'stable message';
  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 4);
  elements.get('search').value = 'latest';
  elements.get('search').dispatch('input');
  runTimers();
  await flush();
  assert.equal(pendingCases.length, 5);
  assert.equal(pendingCases[4].path.includes('cursor='), false);
  pendingCases[4].resolve(json(page([caseItem('latest-case')])));
  await flush();
  pendingCases[3].resolve(json(page([caseItem('stale-success')], true, 'stale-cursor')));
  await flush();
  assert.equal(elements.get('cases').children[0].children[0].dataset.caseId, 'latest-case');
  assert.equal(elements.get('next-page').disabled, true);
  assert.equal(elements.get('message').textContent, 'stable message');

  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 6);
  elements.get('search').value = 'final';
  elements.get('search').dispatch('input');
  runTimers();
  await flush();
  assert.equal(pendingCases.length, 7);
  pendingCases[6].resolve(json(page([])));
  await flush();
  pendingCases[5].resolve(json({ error: 'invalid_cursor' }, 400));
  await flush();
  assert.equal(elements.get('principal').textContent, 'Operator (operator@example.invalid)');
  assert.equal(elements.get('message').textContent, 'stable message');
  assert.equal(elements.get('page-number').textContent, '0ページ');

  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 8);
  pendingCases[7].resolve(json({ error: 'invalid_limit' }, 400));
  await flush();
  assert.match(elements.get('message').textContent, /一覧を取得できませんでした/);
  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 9);
  pendingCases[8].resolve(json(page([caseItem('recovered-case')])));
  await flush();
  assert.equal(elements.get('message').textContent, '');
  assert.equal(elements.get('cases').children[0].children[0].dataset.caseId, 'recovered-case');

  elements.get('message').textContent = 'action message';
  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 10);
  pendingCases[9].resolve(json(page([caseItem('unchanged-message-case')])));
  await flush();
  assert.equal(elements.get('message').textContent, 'action message');

  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 11);
  pendingCases[10].resolve(json({ error: 'not_allowed' }, 403));
  await flush();
  assert.equal(elements.get('principal').textContent, 'アクセスできません');
  assert.equal(elements.get('previous-page').disabled, true);
  assert.equal(elements.get('next-page').disabled, true);
  assert.equal(elements.get('page-number').textContent, '0ページ');
  assert.match(elements.get('message').textContent, /問い合わせ情報を非表示/);
});

test('stale 403 cannot clear a newer list success, principal, page, or message', async t => {
  const { elements, pendingCases, runTimers } = await startProductApp(t, 'stale-auth');
  pendingCases[0].resolve(json(page([caseItem('initial-case')], true, 'initial-cursor')));
  await flush();

  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 2);
  elements.get('search').value = 'newest';
  elements.get('search').dispatch('input');
  runTimers();
  await flush();
  assert.equal(pendingCases.length, 3);
  pendingCases[2].resolve(json(page([caseItem('newest-case')])));
  await flush();
  elements.get('message').textContent = 'newer success message';

  pendingCases[1].resolve(json({ error: 'not_allowed' }, 403));
  await flush();
  assert.equal(elements.get('cases').children[0].children[0].dataset.caseId, 'newest-case');
  assert.equal(elements.get('principal').textContent, 'Operator (operator@example.invalid)');
  assert.equal(elements.get('page-number').textContent, '1ページ');
  assert.equal(elements.get('message').textContent, 'newer success message');

  elements.get('refresh').dispatch('click');
  assert.equal(pendingCases.length, 4);
  pendingCases[3].resolve(json({ error: 'not_allowed' }, 403));
  await flush();
  assert.equal(elements.get('principal').textContent, 'アクセスできません');
  assert.equal(elements.get('cases').children.length, 0);
  assert.equal(elements.get('previous-page').disabled, true);
  assert.equal(elements.get('next-page').disabled, true);
  assert.equal(elements.get('page-number').textContent, '0ページ');
  assert.match(elements.get('message').textContent, /問い合わせ情報を非表示/);
});

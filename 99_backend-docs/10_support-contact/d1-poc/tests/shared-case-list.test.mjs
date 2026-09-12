import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedWorker } from '../sharedWorker.mjs';

const host = 'contact-ops.example.invalid';
const request = path => new Request(`https://${host}${path}`);

function createListDb(rows) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...bindings) {
          statements.push({ sql, bindings });
          return {
            async all() {
              let index = 0;
              let filtered = [...rows];
              if (sql.includes('case_id LIKE ? ESCAPE')) {
                const pattern = bindings[index];
                assert.deepEqual(bindings.slice(index, index + 5), Array(5).fill(pattern));
                index += 5;
                const query = pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase();
                filtered = filtered.filter(row => [row.case_id, row.subject, row.customer_name,
                  row.customer_email, row.category].some(value => value.toLowerCase().includes(query)));
              }
              if (sql.includes('status = ?')) {
                const status = bindings[index++];
                filtered = filtered.filter(row => row.status === status);
              }
              if (sql.includes('priority = ?')) {
                const priority = bindings[index++];
                filtered = filtered.filter(row => row.priority === priority);
              }
              if (sql.includes('assignee_email = ?')) {
                const assignee = bindings[index++];
                filtered = filtered.filter(row => row.assignee_email === assignee);
              } else if (sql.includes('assignee_email IS NULL')) {
                filtered = filtered.filter(row => row.assignee_email === null);
              }
              if (sql.includes('received_at > ?')) {
                const [receivedAt, repeatedReceivedAt, caseId] = bindings.slice(index, index + 3);
                assert.equal(receivedAt, repeatedReceivedAt);
                index += 3;
                filtered = filtered.filter(row => row.received_at > receivedAt
                  || (row.received_at === receivedAt && row.case_id > caseId));
              }
              const limit = bindings[index];
              assert.equal(index + 1, bindings.length);
              return { results: filtered.sort((left, right) => left.received_at.localeCompare(right.received_at)
                || left.case_id.localeCompare(right.case_id)).slice(0, limit) };
            },
          };
        },
      };
    },
  };
}

function caseRow(index, overrides = {}) {
  return {
    case_id: `case-${String(index).padStart(3, '0')}`,
    received_at: '2026-09-12T00:00:00.000Z', category: 'general',
    subject: `Subject ${index}`, customer_name: `Customer ${index}`,
    customer_email: `customer-${index}@example.invalid`, status: '未対応', priority: '中',
    assignee_email: null, followup_at: null, version: 1, updated_at: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

function context(rows) {
  const db = createListDb(rows);
  const worker = createSharedWorker({
    principalResolver: { async resolve() { return { email: 'operator@example.invalid' }; } },
  });
  return { db, worker, env: { TRIAL_HOSTNAME: host, TRIAL_ENABLED: 'true', DB: db } };
}

test('case list keyset pagination has no duplicate or missing rows with equal timestamps', async () => {
  const rows = Array.from({ length: 53 }, (_, index) => caseRow(index + 1));
  const item = context(rows);
  let path = '/api/cases?limit=10';
  const received = [];
  do {
    const response = await item.worker.fetch(request(path), item.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    received.push(...body.cases.map(row => row.case_id));
    path = body.page.nextCursor ? `/api/cases?limit=10&cursor=${encodeURIComponent(body.page.nextCursor)}` : '';
    if (!path) assert.equal(body.page.hasMore, false);
  } while (path);
  assert.deepEqual(received, rows.map(row => row.case_id));
  assert.equal(new Set(received).size, rows.length);
  assert.ok(item.db.statements.every(({ sql }) => sql.includes('ORDER BY received_at ASC, case_id ASC LIMIT ?')));
});

test('case list applies literal LIKE search and supported filters through bindings', async () => {
  const rows = [
    caseRow(1, { subject: '50%_\\ ready', status: '対応中', priority: '高', assignee_email: 'owner@example.invalid' }),
    caseRow(2, { subject: '500 ready', status: '対応中', priority: '高', assignee_email: 'owner@example.invalid' }),
    caseRow(3, { subject: '50%_\\ ready', status: '未対応', priority: '高', assignee_email: 'owner@example.invalid' }),
  ];
  const item = context(rows);
  const response = await item.worker.fetch(request('/api/cases?q=50%25_%5C%20ready&status=%E5%AF%BE%E5%BF%9C%E4%B8%AD&priority=high&assignee=owner%40example.invalid'), item.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.cases.map(row => row.case_id), ['case-001']);
  const [{ sql, bindings }] = item.db.statements;
  assert.match(sql, /LIKE \? ESCAPE '\\'/);
  assert.equal(bindings[0], '%50\\%\\_\\\\ ready%');
  assert.equal(bindings.at(-1), 51);
});

test('case list returns an empty final page and accepts the maximum limit', async () => {
  const item = context(Array.from({ length: 101 }, (_, index) => caseRow(index + 1)));
  let response = await item.worker.fetch(request('/api/cases?status=%E4%BF%9D%E7%95%99'), item.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cases: [], page: { limit: 50, hasMore: false, nextCursor: null } });
  response = await item.worker.fetch(request('/api/cases?limit=100'), item.env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.cases.length, 100);
  assert.equal(body.page.hasMore, true);
  assert.ok(body.page.nextCursor);
});

test('case list rejects invalid inputs, broken cursors, and mismatched cursor filters', async () => {
  const item = context([caseRow(1), caseRow(2)]);
  for (const path of ['/api/cases?status=invalid', '/api/cases?priority=urgent',
    '/api/cases?assignee=not-an-email', '/api/cases?limit=0', '/api/cases?limit=101',
    '/api/cases?limit=1.5', '/api/cases?limit=abc', `/api/cases?q=${'a'.repeat(201)}`,
    `/api/cases?assignee=${'a'.repeat(255)}%40example.invalid`, '/api/cases?cursor=broken!',
    `/api/cases?cursor=${'a'.repeat(2049)}`]) {
    const response = await item.worker.fetch(request(path), item.env);
    assert.equal(response.status, 400, path);
  }
  const first = await (await item.worker.fetch(request('/api/cases?limit=1'), item.env)).json();
  const response = await item.worker.fetch(request(`/api/cases?limit=1&status=%E6%9C%AA%E5%AF%BE%E5%BF%9C&cursor=${encodeURIComponent(first.page.nextCursor)}`), item.env);
  assert.equal(response.status, 400);
});

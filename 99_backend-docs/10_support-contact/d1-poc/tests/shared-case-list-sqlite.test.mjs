import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createSharedWorker } from '../sharedWorker.mjs';

const host = 'contact-ops.example.invalid';
const request = path => new Request(`https://${host}${path}`);

function d1Adapter(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...bindings) {
          return {
            async all() { return { results: statement.all(...bindings) }; },
            async first() { return statement.get(...bindings) || null; },
          };
        },
      };
    },
  };
}

function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE contact_cases (
    case_id TEXT PRIMARY KEY, received_at TEXT NOT NULL, category TEXT NOT NULL,
    subject TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
    status TEXT NOT NULL, priority TEXT NOT NULL, assignee_email TEXT, followup_at TEXT,
    version INTEGER NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
  )`);
  const insert = sqlite.prepare(`INSERT INTO contact_cases
    (case_id, received_at, category, subject, customer_name, customer_email, status,
     priority, assignee_email, followup_at, version, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, NULL)`);
  const timestamp = '2026-09-12T00:00:00.000Z';
  for (let index = 1; index <= 53; index += 1) {
    insert.run(`case-${String(index).padStart(3, '0')}`, timestamp, 'general', `Subject ${index}`,
      `Customer ${index}`, `customer-${index}@example.invalid`, '未対応', '中', null, timestamp);
  }
  insert.run('case-literal', '2026-09-13T00:00:00.000Z', 'billing', '50%_\\ literal',
    'Literal Customer', 'literal@example.invalid', '対応中', '高', 'owner@example.invalid', timestamp);
  insert.run('case-injection', '2026-09-14T00:00:00.000Z', 'feature', "' OR 1=1 --",
    'Injection Customer', 'injection@example.invalid', '保留', '低', null, timestamp);
  const worker = createSharedWorker({
    principalResolver: { async resolve() { return { email: 'operator@example.invalid' }; } },
  });
  return { worker, env: { TRIAL_HOSTNAME: host, TRIAL_ENABLED: 'true', DB: d1Adapter(sqlite) } };
}

test('SQLite-backed Worker list returns all same-timestamp cases exactly once', async t => {
  const item = setup(t);
  let path = '/api/cases?limit=10';
  const received = [];
  while (path) {
    const response = await item.worker.fetch(request(path), item.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    received.push(...body.cases.map(row => row.case_id));
    path = body.page.nextCursor ? `/api/cases?limit=10&cursor=${encodeURIComponent(body.page.nextCursor)}` : '';
  }
  assert.deepEqual(received, Array.from({ length: 53 }, (_, index) => `case-${String(index + 1).padStart(3, '0')}`)
    .concat(['case-literal', 'case-injection']));
  assert.equal(new Set(received).size, 55);
});

test('SQLite-backed Worker treats LIKE metacharacters and SQL text as literals', async t => {
  const item = setup(t);
  for (const [query, expected] of [['50%_\\ literal', ['case-literal']], ["' OR 1=1 --", ['case-injection']]]) {
    const response = await item.worker.fetch(request(`/api/cases?q=${encodeURIComponent(query)}`), item.env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).cases.map(row => row.case_id), expected);
  }
});

test('SQLite-backed Worker applies filters, limit boundaries, and empty results', async t => {
  const item = setup(t);
  let response = await item.worker.fetch(request('/api/cases?status=%E5%AF%BE%E5%BF%9C%E4%B8%AD&priority=high&assignee=owner%40example.invalid'), item.env);
  assert.deepEqual((await response.json()).cases.map(row => row.case_id), ['case-literal']);
  response = await item.worker.fetch(request('/api/cases?assignee=unassigned&priority=low'), item.env);
  assert.deepEqual((await response.json()).cases.map(row => row.case_id), ['case-injection']);
  response = await item.worker.fetch(request('/api/cases?status=%E5%AF%BE%E5%BF%9C%E6%B8%88%E3%81%BF'), item.env);
  assert.deepEqual(await response.json(), { cases: [], page: { limit: 50, hasMore: false, nextCursor: null } });
  response = await item.worker.fetch(request('/api/cases?limit=1'), item.env);
  assert.equal((await response.json()).cases.length, 1);
  response = await item.worker.fetch(request('/api/cases?limit=100'), item.env);
  assert.equal((await response.json()).cases.length, 55);
  for (const limit of ['0', '101', '1.5', 'abc']) {
    response = await item.worker.fetch(request(`/api/cases?limit=${limit}`), item.env);
    assert.equal(response.status, 400, limit);
  }
});

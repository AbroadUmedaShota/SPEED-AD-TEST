import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedWorker } from '../sharedWorker.mjs';

function counters() { return { auth: 0, db: 0, r2: 0 }; }
function setup(options = {}) {
  const count = counters();
  const principal = Object.hasOwn(options, 'principal')
    ? options.principal : { email: 'operator@example.invalid', displayName: '担当者' };
  const dbRows = options.dbRows || [];
  const env = {
    TRIAL_HOSTNAME: 'contact-ops.example.invalid', TRIAL_ENABLED: 'true',
    TRIAL_ATTACHMENTS_ENABLED: 'true', TIME_ZONE: 'Asia/Tokyo',
    DB: { prepare(sql) {
      count.db += 1;
      return { bind() { return this; }, async first() { return dbRows.shift() || null; }, async all() { return { results: dbRows.shift() || [] }; } };
    } },
  };
  const worker = createSharedWorker({
    principalResolver: { async resolve() { count.auth += 1; return principal; } },
    createAttachmentStore: () => ({ async get() { count.r2 += 1; return options.object || null; } }),
  });
  return { count, env, worker };
}
const request = (path, init) => new Request(`https://contact-ops.example.invalid${path}`, init);

test('host mismatch and disabled trial stop before auth, D1 and R2', async () => {
  const first = setup();
  let response = await first.worker.fetch(new Request('https://wrong.example.invalid/api/session'), first.env);
  assert.equal(response.status, 404);
  assert.deepEqual(first.count, counters());
  const second = setup();
  second.env.TRIAL_ENABLED = 'false';
  response = await second.worker.fetch(request('/api/session'), second.env);
  assert.equal(response.status, 503);
  assert.deepEqual(second.count, counters());
});

test('disabled attachments stop before auth, D1 and R2', async () => {
  const context = setup();
  context.env.TRIAL_ATTACHMENTS_ENABLED = 'false';
  const response = await context.worker.fetch(request('/api/attachments/file-1/content'), context.env);
  assert.equal(response.status, 503);
  assert.deepEqual(context.count, counters());
});

test('session identity comes only from resolved principal', async () => {
  const context = setup();
  const response = await context.worker.fetch(request('/api/session'), context.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { principal: {
    email: 'operator@example.invalid', displayName: '担当者',
  } });
});

test('rejects before parsing action body when principal is absent', async () => {
  const context = setup({ principal: null });
  let bodyRead = false;
  const fakeRequest = {
    url: 'https://contact-ops.example.invalid/api/cases/case-1/actions/note',
    method: 'POST', headers: new Headers({ 'content-type': 'application/json' }),
    async text() { bodyRead = true; return '{}'; },
  };
  const response = await context.worker.fetch(fakeRequest, context.env);
  assert.equal(response.status, 403);
  assert.equal(bodyRead, false);
});

test('serves valid private attachment with no-store and rejects missing or corrupt content', async () => {
  const bytes = new TextEncoder().encode('webp-bytes');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const row = { attachment_id: 'file-1', case_id: 'case-1', object_key: 'private/file.webp', mime_type: 'image/webp', size_bytes: bytes.byteLength, sha256: sha };
  const object = { bytes, customMetadata: { attachmentId: 'file-1', caseId: 'case-1' } };
  const valid = setup({ dbRows: [row], object });
  let response = await valid.worker.fetch(request('/api/attachments/file-1/content'), valid.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'image/webp');
  const missingMetadata = setup();
  response = await missingMetadata.worker.fetch(request('/api/attachments/file-1/content'), missingMetadata.env);
  assert.equal(response.status, 404);
  assert.equal(missingMetadata.count.r2, 0);
  const missingObject = setup({ dbRows: [row] });
  response = await missingObject.worker.fetch(request('/api/attachments/file-1/content'), missingObject.env);
  assert.equal(response.status, 503);
  const corrupt = setup({ dbRows: [row], object: { ...object, bytes: new Uint8Array([1]) } });
  response = await corrupt.worker.fetch(request('/api/attachments/file-1/content'), corrupt.env);
  assert.equal(response.status, 503);
  const sameSizeBytes = new Uint8Array(bytes.byteLength).fill(1);
  const sameSizeCorrupt = setup({ dbRows: [row], object: { ...object, bytes: sameSizeBytes } });
  response = await sameSizeCorrupt.worker.fetch(request('/api/attachments/file-1/content'), sameSizeCorrupt.env);
  assert.equal(response.status, 503);
  const wrongCase = setup({ dbRows: [row], object: { ...object, customMetadata: { ...object.customMetadata, caseId: 'case-2' } } });
  response = await wrongCase.worker.fetch(request('/api/attachments/file-1/content'), wrongCase.env);
  assert.equal(response.status, 503);
});

test('R2 binding failures return a no-store error', async () => {
  const row = { attachment_id: 'file-1', case_id: 'case-1', object_key: 'private/file.webp', mime_type: 'image/webp', size_bytes: 1, sha256: '00' };
  const count = counters();
  const env = {
    TRIAL_HOSTNAME: 'contact-ops.example.invalid', TRIAL_ENABLED: 'true',
    TRIAL_ATTACHMENTS_ENABLED: 'true',
    DB: { prepare() { count.db += 1; return { bind() { return this; }, async first() { return row; } }; } },
  };
  const worker = createSharedWorker({
    principalResolver: { async resolve() { return { email: 'operator@example.invalid' }; } },
    createAttachmentStore: () => ({ async get() { count.r2 += 1; throw new Error('R2 unavailable'); } }),
  });
  const response = await worker.fetch(request('/api/attachments/file-1/content'), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(count.r2, 1);
});

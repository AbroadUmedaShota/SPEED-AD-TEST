import { AccessPrincipalResolver } from '../accessPrincipalResolver.mjs';
import { createSharedWorker } from '../sharedWorker.mjs';
import { sha256Hex, syntheticAttachment } from '../syntheticAttachmentStore.mjs';

const HARNESS_MARKER = 'support-contact-shared-browser-v1';
let resolver;

function principalResolver(env) {
  if (!resolver) {
    resolver = new AccessPrincipalResolver({
      fetchJwks: async () => Response.json(JSON.parse(env.TEST_JWKS_JSON)),
    });
  }
  return resolver;
}

async function bootstrapSyntheticData(env) {
  const timestamp = '2026-09-06T00:00:00.000Z';
  const digest = await sha256Hex(syntheticAttachment.bytes);
  const statuses = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
  const priorities = ['高', '中', '低'];
  const listCases = Array.from({ length: 54 }, (_, offset) => {
    const index = offset + 1;
    const suffix = String(index).padStart(3, '0');
    const assignee = index % 3 === 1 ? null
      : index % 3 === 2 ? 'operator-one@example.invalid' : 'operator-two@example.invalid';
    return env.DB.prepare(`INSERT INTO contact_cases
      (case_id, received_at, category, subject, customer_name, customer_email, message,
       source_url, user_agent, status, priority, assignee_email, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
      `case-z-list-${suffix}`, timestamp, index % 2 ? '一覧検証' : 'billing',
      `一覧検索 ${suffix}`, `合成利用者 ${suffix}`, `synthetic-${suffix}@example.invalid`,
      `一覧ブラウザ受入用の合成データ ${suffix} です。`, 'https://example.invalid/contact',
      'Shared-Browser-Acceptance', statuses[offset % statuses.length],
      priorities[offset % priorities.length], assignee, timestamp, timestamp,
    );
  });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM contact_case_events'),
    env.DB.prepare('DELETE FROM contact_api_requests'),
    env.DB.prepare('DELETE FROM contact_attachments'),
    env.DB.prepare('DELETE FROM contact_cases'),
    env.DB.prepare('DELETE FROM contact_operators'),
    env.DB.prepare(`INSERT INTO contact_operators
      (email, display_name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).bind(
      'operator-one@example.invalid', '担当者1', timestamp, timestamp,
    ),
    env.DB.prepare(`INSERT INTO contact_operators
      (email, display_name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).bind(
      'operator-two@example.invalid', '担当者2', timestamp, timestamp,
    ),
    env.DB.prepare(`INSERT INTO contact_cases
      (case_id, received_at, category, subject, customer_name, customer_email, message,
       source_url, user_agent, status, priority, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '未対応', '中', 1, ?, ?)`).bind(
      syntheticAttachment.caseId, timestamp, '操作案内', '共有版の合成問い合わせ',
      '合成利用者', 'customer@example.invalid', 'ブラウザ受入用の合成データです。',
      'https://example.invalid/contact', 'Shared-Browser-Acceptance', timestamp, timestamp,
    ),
    ...listCases,
    env.DB.prepare(`INSERT INTO contact_attachments
      (attachment_id, case_id, object_key, original_name, mime_type, size_bytes,
       sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      syntheticAttachment.attachmentId, syntheticAttachment.caseId,
      syntheticAttachment.objectKey, syntheticAttachment.originalName,
      syntheticAttachment.mimeType, syntheticAttachment.bytes.byteLength, digest, timestamp,
    ),
  ]);
  await env.ATTACHMENTS.put(syntheticAttachment.objectKey, syntheticAttachment.bytes, {
    customMetadata: {
      attachmentId: syntheticAttachment.attachmentId,
      caseId: syntheticAttachment.caseId,
    },
  });
}

const worker = createSharedWorker({
  principalResolver: {
    resolve(request, env) { return principalResolver(env).resolve(request, env); },
  },
});

export function createBrowserAcceptanceWorker(sharedWorker = worker) {
  let bootstrap;
  let dropFirstNoteAcknowledgement = true;
  return {
    async fetch(request, env) {
      const hostname = new URL(request.url).hostname;
      const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
      if (!loopback || env.LOCAL_BROWSER_HARNESS !== 'enabled') {
        return Response.json({ error: 'local_harness_only' }, { status: 403 });
      }
      const guard = await env.DB.prepare(
        'SELECT marker FROM contact_browser_harness_guard WHERE marker = ?',
      ).bind(HARNESS_MARKER).first();
      if (guard?.marker !== HARNESS_MARKER) {
        return Response.json({ error: 'wrong_harness_database' }, { status: 403 });
      }
      if (!bootstrap) bootstrap = bootstrapSyntheticData(env);
      await bootstrap;
      const response = await sharedWorker.fetch(request, env);
      if (dropFirstNoteAcknowledgement
        && request.method === 'POST'
        && new URL(request.url).pathname.endsWith('/actions/note')
        && response.status === 200) {
        dropFirstNoteAcknowledgement = false;
        return Response.json({ error: 'acknowledgement_unavailable' }, {
          status: 503, headers: { 'cache-control': 'no-store' },
        });
      }
      return response;
    },
  };
}

export default createBrowserAcceptanceWorker();

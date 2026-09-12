import { accessPrincipalResolver } from './accessPrincipalResolver.mjs';
import { executeCaseAction, supportedCaseActions } from './sharedCaseActions.mjs';
import { R2AttachmentStore } from './r2AttachmentStore.mjs';

const JSON_HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const ID_PATTERN = '[a-zA-Z0-9_-]{1,80}';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function trustedHost(request, env) {
  const expected = String(env.TRIAL_HOSTNAME || '').trim().toLowerCase();
  return expected && new URL(request.url).hostname.toLowerCase() === expected;
}

async function listCases(db) {
  const result = await db.prepare(`SELECT case_id, received_at, category, subject,
    customer_name, status, priority, assignee_email, followup_at, version, updated_at
    FROM contact_cases WHERE archived_at IS NULL
    ORDER BY received_at ASC, case_id ASC LIMIT 50`).all();
  return result.results;
}

async function getCase(db, caseId) {
  return db.prepare(`SELECT case_id, received_at, category, subject, customer_name,
    customer_email, message, source_url, user_agent, status, priority, assignee_email,
    next_action, followup_at, resolution_code, resolved_at, resolved_by, version,
    wait_target, wait_reason, created_at, updated_at FROM contact_cases
    WHERE case_id = ? AND archived_at IS NULL`).bind(caseId).first();
}

async function getEvents(db, caseId) {
  const result = await db.prepare(`SELECT event_id, request_id, case_id, event_type,
    actor_email, from_version, to_version, note, changes_json, created_at
    FROM contact_case_events WHERE case_id = ? ORDER BY to_version ASC`).bind(caseId).all();
  return result.results.map(row => ({ ...row, changes: JSON.parse(row.changes_json) }));
}

async function getAttachmentMetadata(db, caseId) {
  const result = await db.prepare(`SELECT attachment_id, case_id, original_name,
    mime_type, size_bytes, created_at FROM contact_attachments
    WHERE case_id = ? ORDER BY attachment_id`).bind(caseId).all();
  return result.results;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function attachmentResponse(env, store, attachmentId) {
  const row = await env.DB.prepare(`SELECT a.attachment_id, a.case_id, a.object_key,
    a.mime_type, a.size_bytes, a.sha256
    FROM contact_attachments a JOIN contact_cases c ON c.case_id = a.case_id
    WHERE a.attachment_id = ? AND c.archived_at IS NULL`).bind(attachmentId).first();
  if (!row) return json({ error: 'attachment_not_found' }, 404);
  let object;
  try {
    object = await store.get(row.object_key);
  } catch {
    return json({ error: 'attachment_unavailable' }, 503);
  }
  if (!object
    || object.customMetadata?.attachmentId !== row.attachment_id
    || object.customMetadata?.caseId !== row.case_id
    || object.bytes.byteLength !== row.size_bytes
    || await sha256Hex(object.bytes) !== row.sha256) {
    return json({ error: 'attachment_unavailable' }, 503);
  }
  return new Response(object.bytes, { headers: {
    'cache-control': 'no-store',
    'content-disposition': `inline; filename="${attachmentId}.webp"`,
    'content-length': String(object.bytes.byteLength),
    'content-security-policy': "default-src 'none'; sandbox",
    'content-type': row.mime_type === 'image/webp' ? row.mime_type : 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  } });
}

async function actionResponse(request, env, principal, caseId, action) {
  if (!supportedCaseActions.includes(action)) return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json({ error: 'json_required' }, 415);
  }
  let payload;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 24_000) {
      return json({ error: 'payload_too_large' }, 413);
    }
    payload = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const result = await executeCaseAction(env.DB, principal, action, caseId, payload, {
    timeZone: env.TIME_ZONE,
  });
  return json(result.body, result.status);
}

async function assetResponse(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return json({ error: 'not_found' }, 404);
  }
  return noStore(await env.ASSETS.fetch(request));
}

export function createSharedWorker(options = {}) {
  const principalResolver = options.principalResolver || accessPrincipalResolver;
  const createAttachmentStore = options.createAttachmentStore
    || (env => new R2AttachmentStore(env.ATTACHMENTS));
  return {
    async fetch(request, env) {
      if (!trustedHost(request, env)) return json({ error: 'not_found' }, 404);
      if (env.TRIAL_ENABLED !== 'true') return json({ error: 'trial_disabled' }, 503);
      const url = new URL(request.url);
      const attachmentMatch = new RegExp(`^/api/attachments/(${ID_PATTERN})/content$`).exec(url.pathname);
      if (attachmentMatch && env.TRIAL_ATTACHMENTS_ENABLED !== 'true') {
        return json({ error: 'attachments_disabled' }, 503);
      }
      const principal = await principalResolver.resolve(request, env);
      if (!principal) return json({ error: 'not_allowed' }, 403);
      if (request.method === 'GET' && url.pathname === '/api/session') {
        return json({ principal: { email: principal.email, displayName: principal.displayName } });
      }
      if (request.method === 'GET' && url.pathname === '/api/cases') {
        return json({ cases: await listCases(env.DB) });
      }
      if (request.method === 'GET' && url.pathname === '/api/operators') {
        const operators = await env.DB.prepare(
          'SELECT email, display_name FROM contact_operators WHERE active = 1 ORDER BY display_name, email',
        ).all();
        return json({ operators: operators.results });
      }
      const detailMatch = new RegExp(`^/api/cases/(${ID_PATTERN})$`).exec(url.pathname);
      if (request.method === 'GET' && detailMatch) {
        const caseData = await getCase(env.DB, detailMatch[1]);
        if (!caseData) return json({ error: 'case_not_found' }, 404);
        const attachments = env.TRIAL_ATTACHMENTS_ENABLED === 'true'
          ? await getAttachmentMetadata(env.DB, detailMatch[1]) : [];
        return json({ case: caseData, attachments });
      }
      const eventsMatch = new RegExp(`^/api/cases/(${ID_PATTERN})/events$`).exec(url.pathname);
      if (request.method === 'GET' && eventsMatch) {
        return json({ events: await getEvents(env.DB, eventsMatch[1]) });
      }
      if (request.method === 'GET' && attachmentMatch) {
        return attachmentResponse(env, createAttachmentStore(env), attachmentMatch[1]);
      }
      const actionMatch = new RegExp(`^/api/cases/(${ID_PATTERN})/actions/([a-z-]+)$`).exec(url.pathname);
      if (actionMatch) {
        return actionResponse(request, env, principal, actionMatch[1], actionMatch[2]);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'not_found' }, 404);
      }
      return assetResponse(request, env);
    },
  };
}

export default createSharedWorker();

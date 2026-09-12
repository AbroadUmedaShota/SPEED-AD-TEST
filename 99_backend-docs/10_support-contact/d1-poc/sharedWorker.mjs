import { accessPrincipalResolver } from './accessPrincipalResolver.mjs';
import { executeCaseAction, supportedCaseActions } from './sharedCaseActions.mjs';
import { R2AttachmentStore } from './r2AttachmentStore.mjs';

const JSON_HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const ID_PATTERN = '[a-zA-Z0-9_-]{1,80}';
const CASE_STATUSES = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
const PRIORITIES = { high: '高', mid: '中', low: '低' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_CASE_LIMIT = 50;
const MAX_CASE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 2_048;

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

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function encodeCursor(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(value) {
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw badRequest('invalid_cursor');
  }
  try {
    const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw badRequest('invalid_cursor');
  }
}

function caseFilters(url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length > 200) throw badRequest('invalid_q');
  const status = url.searchParams.get('status') || '';
  if (status && !CASE_STATUSES.includes(status)) throw badRequest('invalid_status');
  const priority = url.searchParams.get('priority') || '';
  if (priority && !Object.hasOwn(PRIORITIES, priority)) throw badRequest('invalid_priority');
  const assignee = url.searchParams.get('assignee') || '';
  if (assignee && assignee !== 'unassigned'
    && (assignee.length > 254 || !EMAIL_PATTERN.test(assignee))) {
    throw badRequest('invalid_assignee');
  }
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? DEFAULT_CASE_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CASE_LIMIT) {
    throw badRequest('invalid_limit');
  }
  return { q, status, priority, assignee, limit };
}

function caseCursor(url, filters) {
  const rawCursor = url.searchParams.get('cursor');
  if (!rawCursor) return null;
  const cursor = decodeCursor(rawCursor);
  if (!cursor || cursor.version !== 1 || typeof cursor.receivedAt !== 'string'
    || cursor.receivedAt.length === 0 || cursor.receivedAt.length > 64
    || typeof cursor.caseId !== 'string' || !new RegExp(`^${ID_PATTERN}$`).test(cursor.caseId)
    || JSON.stringify(cursor.filters) !== JSON.stringify(filters)) {
    throw badRequest('invalid_cursor');
  }
  return cursor;
}

async function listCases(db, filters, cursor) {
  const conditions = ['archived_at IS NULL'];
  const bindings = [];
  if (filters.q) {
    const query = `%${escapeLike(filters.q)}%`;
    conditions.push(`(case_id LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\'
      OR customer_name LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\'
      OR category LIKE ? ESCAPE '\\')`);
    bindings.push(query, query, query, query, query);
  }
  if (filters.status) {
    conditions.push('status = ?');
    bindings.push(filters.status);
  }
  if (filters.priority) {
    conditions.push('priority = ?');
    bindings.push(PRIORITIES[filters.priority]);
  }
  if (filters.assignee === 'unassigned') {
    conditions.push('assignee_email IS NULL');
  } else if (filters.assignee) {
    conditions.push('assignee_email = ?');
    bindings.push(filters.assignee);
  }
  if (cursor) {
    conditions.push('(received_at > ? OR (received_at = ? AND case_id > ?))');
    bindings.push(cursor.receivedAt, cursor.receivedAt, cursor.caseId);
  }
  bindings.push(filters.limit + 1);
  const result = await db.prepare(`SELECT case_id, received_at, category, subject,
    customer_name, status, priority, assignee_email, followup_at, version, updated_at
    FROM contact_cases WHERE ${conditions.join(' AND ')}
    ORDER BY received_at ASC, case_id ASC LIMIT ?`).bind(...bindings).all();
  const hasMore = result.results.length > filters.limit;
  const cases = hasMore ? result.results.slice(0, filters.limit) : result.results;
  const last = cases.at(-1);
  return {
    cases,
    page: {
      limit: filters.limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor({
        version: 1,
        filters,
        receivedAt: last.received_at,
        caseId: last.case_id,
      }) : null,
    },
  };
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
        try {
          const filters = caseFilters(url);
          return json(await listCases(env.DB, filters, caseCursor(url, filters)));
        } catch (error) {
          if (error.status === 400) return json({ error: error.message }, 400);
          throw error;
        }
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

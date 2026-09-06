import { executeCaseAction, supportedCaseActions } from './caseActions.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const SYNTHETIC_OPERATORS = [
  { email: 'operator-a@example.invalid', displayName: '担当者A' },
  { email: 'operator-b@example.invalid', displayName: '担当者B' },
];
const CASE_STATUSES = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
const raceBarriers = new Map();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isLoopback(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function waitAtRaceBarrier(name) {
  return new Promise((resolve, reject) => {
    const waiting = raceBarriers.get(name) || [];
    const entry = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const current = raceBarriers.get(name) || [];
      raceBarriers.set(name, current.filter(candidate => candidate !== entry));
      reject(new Error('race barrier timeout'));
    }, 5_000);
    waiting.push(entry);
    raceBarriers.set(name, waiting);
    if (waiting.length === 2) {
      raceBarriers.delete(name);
      waiting.forEach(candidate => {
        clearTimeout(candidate.timer);
        candidate.resolve();
      });
    }
  });
}

async function resetDatabase(db) {
  const timestamp = '2026-09-06T00:00:00.000Z';
  await db.batch([
    db.prepare('UPDATE contact_cases SET last_request_id = NULL'),
    db.prepare('DELETE FROM contact_case_events'),
    db.prepare('DELETE FROM contact_api_requests'),
    db.prepare('DELETE FROM contact_attachments'),
    db.prepare('DELETE FROM contact_cases'),
    db.prepare('DELETE FROM contact_operators'),
    ...SYNTHETIC_OPERATORS.map(operator => db.prepare(`
      INSERT INTO contact_operators (email, display_name, active, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).bind(operator.email, operator.displayName, timestamp, timestamp)),
    db.prepare(`INSERT INTO contact_cases
      (case_id, received_at, category, subject, customer_name, customer_email, message,
       source_url, user_agent, status, priority, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '未対応', '中', 1, ?, ?)`)
      .bind('case-mvp-1', timestamp, '操作案内', '合成問い合わせ', '合成利用者',
        'customer@example.invalid', 'これは合成データです。', 'https://example.invalid/contact',
        'Synthetic-Test-Agent', timestamp, timestamp),
  ]);
  return { ok: true };
}

async function listCases(db) {
  const query = await db.prepare(`SELECT case_id, received_at, category, subject,
    customer_name, status, priority, assignee_email, followup_at, version, updated_at
    FROM contact_cases WHERE archived_at IS NULL
    ORDER BY received_at ASC, case_id ASC LIMIT 50`).all();
  return query.results;
}

async function getCase(db, caseId) {
  return db.prepare(`SELECT case_id, received_at, category, subject, customer_name,
    customer_email, message, source_url, user_agent, status, priority, assignee_email,
    next_action, followup_at, resolution_code, resolved_at, resolved_by, version,
    wait_target, wait_reason, created_at, updated_at
    FROM contact_cases WHERE case_id = ? AND archived_at IS NULL`).bind(caseId).first();
}

async function getEvents(db, caseId) {
  const query = await db.prepare(`SELECT event_id, request_id, case_id, event_type,
    actor_email, from_version, to_version, note, changes_json, created_at
    FROM contact_case_events WHERE case_id = ? ORDER BY to_version ASC`).bind(caseId).all();
  return query.results.map(row => ({ ...row, changes: JSON.parse(row.changes_json) }));
}

async function snapshotDatabase(db) {
  const [tables, cases, requests, events, operators, attachments] = await db.batch([
    db.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'contact_%' ORDER BY name`),
    db.prepare('SELECT * FROM contact_cases ORDER BY case_id'),
    db.prepare('SELECT * FROM contact_api_requests ORDER BY created_at, request_id'),
    db.prepare('SELECT * FROM contact_case_events ORDER BY to_version, event_id'),
    db.prepare('SELECT * FROM contact_operators ORDER BY email'),
    db.prepare('SELECT * FROM contact_attachments ORDER BY attachment_id'),
  ]);
  return {
    tables: tables.results.map(row => row.name),
    cases: cases.results,
    requests: requests.results,
    events: events.results,
    operators: operators.results,
    attachments: attachments.results,
  };
}

async function configureOperator(request, db) {
  const body = await request.json();
  if (!SYNTHETIC_OPERATORS.some(operator => operator.email === body.email)
    || typeof body.active !== 'boolean') {
    return jsonResponse({ error: 'invalid_test_command' }, 400);
  }
  await db.prepare('UPDATE contact_operators SET active = ?, updated_at = ? WHERE email = ?')
    .bind(body.active ? 1 : 0, new Date().toISOString(), body.email).run();
  return jsonResponse({ ok: true });
}

async function configureCaseStatus(request, db) {
  const body = await request.json();
  if (!CASE_STATUSES.includes(body.status)) {
    return jsonResponse({ error: 'invalid_test_command' }, 400);
  }
  await db.prepare(`UPDATE contact_cases
    SET status = ?, assignee_email = NULL, version = 1, last_request_id = NULL, updated_at = ?
    WHERE case_id = 'case-mvp-1'`).bind(body.status, new Date().toISOString()).run();
  return jsonResponse({ ok: true });
}

async function clearResolutionField(request, db) {
  const body = await request.json();
  const allowedFields = ['resolution_code', 'resolved_at', 'resolved_by'];
  if (!allowedFields.includes(body.field)) {
    return jsonResponse({ error: 'invalid_test_command' }, 400);
  }
  await db.prepare(`UPDATE contact_cases SET ${body.field} = NULL
    WHERE case_id = 'case-mvp-1' AND status = '対応済み' AND assignee_email IS NOT NULL`).run();
  return jsonResponse({ ok: true });
}

async function seedLegacyNoteReceipt(db) {
  const actorEmail = SYNTHETIC_OPERATORS[0].email;
  const requestId = 'legacy-note-request';
  const note = '旧canonical形式の合成メモ';
  const createdAt = '2026-09-06T01:00:00.000Z';
  const canonical = JSON.stringify([actorEmail, 'note', 'case-mvp-1', 1, note]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const payloadHash = Array.from(new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const receipt = {
    requestId,
    eventId: 'legacy-note-event',
    caseId: 'case-mvp-1',
    action: 'note',
    eventType: 'note_added',
    actorEmail,
    fromVersion: 1,
    toVersion: 2,
    note,
    changes: {},
    createdAt,
  };
  await db.batch([
    db.prepare(`INSERT INTO contact_api_requests
      (request_id, actor_email, action, case_id, expected_version, payload_hash,
       response_json, created_at) VALUES (?, ?, 'note', 'case-mvp-1', 1, ?, ?, ?)`)
      .bind(requestId, actorEmail, payloadHash, JSON.stringify(receipt), createdAt),
    db.prepare(`UPDATE contact_cases SET version = 2, last_request_id = ?, updated_at = ?
      WHERE case_id = 'case-mvp-1' AND version = 1`).bind(requestId, createdAt),
    db.prepare(`INSERT INTO contact_case_events
      (event_id, request_id, case_id, event_type, actor_email, from_version,
       to_version, note, changes_json, created_at)
      VALUES ('legacy-note-event', ?, 'case-mvp-1', 'note_added', ?, 1, 2, ?, '{}', ?)`)
      .bind(requestId, actorEmail, note, createdAt),
  ]);
  return jsonResponse({ ok: true, payload: { requestId, expectedVersion: 1, note } });
}

async function resolvePrincipal(request, db) {
  const email = request.headers.get('x-mvp-actor');
  if (!SYNTHETIC_OPERATORS.some(operator => operator.email === email)) return null;
  const operator = await db.prepare(
    'SELECT active FROM contact_operators WHERE email = ?',
  ).bind(email).first();
  return operator?.active ? { email } : null;
}

async function handleAction(request, db, principal, caseId, action, timeZone) {
  if (!supportedCaseActions.includes(action)) return jsonResponse({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!principal) return jsonResponse({ error: 'not_allowed' }, 403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return jsonResponse({ error: 'json_required' }, 415);
  }
  let payload;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 24_000) {
      return jsonResponse({ error: 'payload_too_large' }, 413);
    }
    payload = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const barrierName = request.headers.get('x-mvp-race-barrier');
  const result = await executeCaseAction(db, principal, action, caseId, payload, {
    afterPreflight: barrierName ? () => waitAtRaceBarrier(barrierName) : null,
    failEventInsert: request.headers.get('x-mvp-fail-event') === '1',
    timeZone,
  });
  if (request.headers.get('x-mvp-drop-ack') === '1' && result.status === 200) {
    return jsonResponse({ error: 'simulated_acknowledgement_loss' }, 503);
  }
  return jsonResponse(result.body, result.status);
}

export default {
  async fetch(request, env) {
    if (env.MVP_LOCAL_ONLY !== 'true' || !isLoopback(request)) {
      return jsonResponse({ error: 'local MVP only' }, 403);
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/__test/reset') {
      return jsonResponse(await resetDatabase(env.DB));
    }
    if (request.method === 'GET' && url.pathname === '/__test/snapshot') {
      return jsonResponse(await snapshotDatabase(env.DB));
    }
    if (request.method === 'POST' && url.pathname === '/__test/operator-active') {
      return configureOperator(request, env.DB);
    }
    if (request.method === 'POST' && url.pathname === '/__test/case-status') {
      return configureCaseStatus(request, env.DB);
    }
    if (request.method === 'POST' && url.pathname === '/__test/clear-resolution-field') {
      return clearResolutionField(request, env.DB);
    }
    if (request.method === 'POST' && url.pathname === '/__test/seed-legacy-note') {
      return seedLegacyNoteReceipt(env.DB);
    }

    const principal = await resolvePrincipal(request, env.DB);
    if (!principal) return jsonResponse({ error: 'not_allowed' }, 403);

    if (request.method === 'GET' && url.pathname === '/api/cases') {
      return jsonResponse({ cases: await listCases(env.DB) });
    }
    const detailMatch = /^\/api\/cases\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
    if (request.method === 'GET' && detailMatch) {
      const caseData = await getCase(env.DB, detailMatch[1]);
      return caseData ? jsonResponse({ case: caseData }) : jsonResponse({ error: 'case_not_found' }, 404);
    }
    const eventsMatch = /^\/api\/cases\/([a-zA-Z0-9_-]{1,80})\/events$/.exec(url.pathname);
    if (request.method === 'GET' && eventsMatch) {
      return jsonResponse({ events: await getEvents(env.DB, eventsMatch[1]) });
    }
    const actionMatch = /^\/api\/cases\/([a-zA-Z0-9_-]{1,80})\/actions\/([a-z-]+)$/.exec(
      url.pathname,
    );
    if (actionMatch) {
      return handleAction(
        request, env.DB, principal, actionMatch[1], actionMatch[2], env.MVP_TIME_ZONE,
      );
    }
    return jsonResponse({ error: 'not_found' }, 404);
  },
};

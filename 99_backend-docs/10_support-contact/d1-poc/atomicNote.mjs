export const SQL = Object.freeze({
  request: 'SELECT * FROM poc_requests WHERE request_id = ?',
  current: 'SELECT version FROM poc_cases WHERE case_id = ?',
  insertRequest: `INSERT INTO poc_requests
    (request_id, actor_id, action, case_id, expected_version, payload_hash, note, created_at, response_json)
    VALUES (?, ?, 'append_note', ?, ?, ?, ?, ?, ?)`,
  updateCase: `UPDATE poc_cases
    SET version = version + 1, last_request_id = ?, updated_at = ?
    WHERE case_id = ? AND version = ?`,
  // VALUES always attempts one row. A missing scalar result is NULL, not a zero-row INSERT.
  insertEvent: `INSERT INTO poc_events
    (event_id, request_id, case_id, actor_id, from_version, to_version, note, created_at)
    VALUES (?, ?, ?, ?, ?,
      (SELECT version FROM poc_cases
       WHERE case_id = ? AND version = ? + 1 AND last_request_id = ?),
      ?, ?)`,
});

const reply = (status, body) => ({ status, body });
const errorReply = (status, error) => reply(status, { error });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function sameRequest(row, command, actorId, payloadHash) {
  return row.actor_id === actorId && row.action === 'append_note'
    && row.case_id === command.caseId
    && row.expected_version === command.expectedVersion
    && row.payload_hash === payloadHash;
}

function replay(row, command, actorId, payloadHash) {
  if (!sameRequest(row, command, actorId, payloadHash)) {
    return errorReply(409, 'idempotency_conflict');
  }
  return reply(200, JSON.parse(row.response_json));
}

// actorId must come from a trusted adapter. This module does not implement authentication.
export async function appendNote(db, actorId, command, hooks = {}) {
  const allowedKeys = ['requestId', 'caseId', 'expectedVersion', 'note'];
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || Object.keys(command).some(key => !allowedKeys.includes(key))
    || !validId(command.requestId) || !validId(command.caseId)
    || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1
    || command.expectedVersion >= Number.MAX_SAFE_INTEGER
    || typeof command.note !== 'string' || !command.note.trim()
    || command.note.includes('\0') || command.note.length > 4000) {
    return errorReply(400, 'invalid_command');
  }
  if (!validId(actorId)) return errorReply(403, 'not_allowed');

  try {
    const actor = await db.prepare('SELECT active FROM poc_operators WHERE actor_id = ?')
      .bind(actorId).first();
    if (!actor?.active) return errorReply(403, 'not_allowed');
    const canonical = JSON.stringify([
      actorId, 'append_note', command.caseId, command.expectedVersion, command.note,
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const payloadHash = Array.from(new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const stored = await db.prepare(SQL.request).bind(command.requestId).first();
    if (stored) return replay(stored, command, actorId, payloadHash);
    if (hooks.afterPreflight) await hooks.afterPreflight();

    const receipt = {
      requestId: command.requestId,
      eventId: crypto.randomUUID(),
      caseId: command.caseId,
      action: 'append_note',
      actorId,
      fromVersion: command.expectedVersion,
      toVersion: command.expectedVersion + 1,
      note: command.note,
      createdAt: new Date().toISOString(),
    };
    try {
      await db.batch([
        db.prepare(SQL.insertRequest).bind(command.requestId, actorId, command.caseId,
          command.expectedVersion, payloadHash, command.note, receipt.createdAt, JSON.stringify(receipt)),
        db.prepare(SQL.updateCase).bind(command.requestId, receipt.createdAt,
          command.caseId, command.expectedVersion),
        db.prepare(SQL.insertEvent).bind(receipt.eventId, command.requestId,
          command.caseId, actorId, command.expectedVersion, command.caseId,
          command.expectedVersion, command.requestId, command.note, receipt.createdAt),
      ]);
      return reply(200, receipt);
    } catch {
      // These reads require primary consistency in a real D1 adapter.
      const committed = await db.prepare(SQL.request).bind(command.requestId).first();
      if (committed) return replay(committed, command, actorId, payloadHash);
      const current = await db.prepare(SQL.current).bind(command.caseId).first();
      if (!current) return errorReply(404, 'case_not_found');
      if (current.version !== command.expectedVersion) {
        return reply(409, { error: 'version_conflict', currentVersion: current.version });
      }
      return errorReply(503, 'storage_unavailable');
    }
  } catch {
    return errorReply(503, 'storage_unavailable');
  }
}

// No listener or deployment entrypoint: tests inject an authenticated synthetic principal.
export async function handleNoteRequest(request, db, principal, hooks = {}) {
  const match = /^\/api\/cases\/([a-zA-Z0-9_-]{1,80})\/actions\/note$/.exec(
    new URL(request.url).pathname);
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 });
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (!principal?.actorId) return Response.json({ error: 'not_allowed' }, { status: 403 });
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return Response.json({ error: 'json_required' }, { status: 415 });
  }
  let payload;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 24000) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    payload = JSON.parse(text);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object'
      || Object.hasOwn(payload, 'caseId')) throw new Error('Invalid payload');
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const result = await appendNote(db, principal.actorId, { ...payload, caseId: match[1] }, hooks);
  return Response.json(result.body, {
    status: result.status, headers: { 'Cache-Control': 'no-store' },
  });
}

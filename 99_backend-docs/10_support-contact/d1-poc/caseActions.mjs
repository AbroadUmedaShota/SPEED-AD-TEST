const ACTIONS = Object.freeze({
  'assign-self': {
    eventType: 'assigned',
    payloadKeys: ['requestId', 'expectedVersion'],
    changes: (actorEmail) => ({ assigneeEmail: actorEmail }),
    validateCase: (row) => row.status === '未対応' && row.assignee_email === null,
    updateSql: `UPDATE contact_cases
      SET assignee_email = ?, version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '未対応'
        AND assignee_email IS NULL AND archived_at IS NULL`,
    updateBindings: (actorEmail, receipt) => [
      actorEmail, receipt.requestId, receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  start: {
    eventType: 'started',
    payloadKeys: ['requestId', 'expectedVersion'],
    changes: () => ({ status: '対応中' }),
    validateCase: (row) => row.status === '未対応',
    updateSql: `UPDATE contact_cases
      SET status = '対応中', version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '未対応' AND archived_at IS NULL`,
    updateBindings: (_actorEmail, receipt) => [
      receipt.requestId, receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  note: {
    eventType: 'note_added',
    payloadKeys: ['requestId', 'expectedVersion', 'note'],
    changes: () => ({}),
    updateSql: `UPDATE contact_cases
      SET version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND archived_at IS NULL`,
    updateBindings: (_actorEmail, receipt) => [
      receipt.requestId, receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
});

const REQUEST_SQL = 'SELECT * FROM contact_api_requests WHERE request_id = ?';
const CASE_SQL = `SELECT case_id, status, assignee_email, version, archived_at
  FROM contact_cases WHERE case_id = ?`;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

const result = (status, body) => ({ status, body });
const errorResult = (status, error, details = {}) => result(status, { error, ...details });

async function payloadHash(actorEmail, action, caseId, payload) {
  const canonical = JSON.stringify([
    actorEmail,
    action,
    caseId,
    payload.expectedVersion,
    action === 'note' ? payload.note : null,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validatePayload(action, payload) {
  const definition = ACTIONS[action];
  if (!definition || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  const allowed = [...definition.payloadKeys].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) return false;
  if (typeof payload.requestId !== 'string' || !ID_PATTERN.test(payload.requestId)) return false;
  if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1
    || payload.expectedVersion >= Number.MAX_SAFE_INTEGER) return false;
  if (action === 'note' && (typeof payload.note !== 'string' || !payload.note.trim()
    || payload.note.includes('\0') || payload.note.length > 4000)) return false;
  return true;
}

function sameRequest(row, actorEmail, action, caseId, expectedVersion, hash) {
  return row.actor_email === actorEmail
    && row.action === action
    && row.case_id === caseId
    && row.expected_version === expectedVersion
    && row.payload_hash === hash;
}

function replay(row, actorEmail, action, caseId, expectedVersion, hash) {
  if (!sameRequest(row, actorEmail, action, caseId, expectedVersion, hash)) {
    return errorResult(409, 'idempotency_conflict');
  }
  return result(200, JSON.parse(row.response_json));
}

export async function executeCaseAction(db, principal, action, caseId, payload, hooks = {}) {
  if (!principal?.email || typeof principal.email !== 'string') {
    return errorResult(403, 'not_allowed');
  }
  if (!ID_PATTERN.test(caseId) || !validatePayload(action, payload)) {
    return errorResult(400, 'invalid_command');
  }

  const definition = ACTIONS[action];
  try {
    const operator = await db.prepare(
      'SELECT active FROM contact_operators WHERE email = ?',
    ).bind(principal.email).first();
    if (!operator?.active) return errorResult(403, 'not_allowed');

    const hash = await payloadHash(principal.email, action, caseId, payload);
    const stored = await db.prepare(REQUEST_SQL).bind(payload.requestId).first();
    if (stored) {
      return replay(stored, principal.email, action, caseId, payload.expectedVersion, hash);
    }

    const current = await db.prepare(CASE_SQL).bind(caseId).first();
    if (!current) return errorResult(404, 'case_not_found');
    if (current.archived_at) return errorResult(409, 'case_archived');
    if (current.version !== payload.expectedVersion) {
      return errorResult(409, 'version_conflict', { currentVersion: current.version });
    }
    if (definition.validateCase && !definition.validateCase(current)) {
      return errorResult(409, 'state_conflict', { currentStatus: current.status });
    }
    if (hooks.afterPreflight) await hooks.afterPreflight();

    const receipt = {
      requestId: payload.requestId,
      eventId: crypto.randomUUID(),
      caseId,
      action,
      eventType: definition.eventType,
      actorEmail: principal.email,
      fromVersion: payload.expectedVersion,
      toVersion: payload.expectedVersion + 1,
      note: action === 'note' ? payload.note : null,
      changes: definition.changes(principal.email),
      createdAt: new Date().toISOString(),
    };
    const changesJson = hooks.failEventInsert ? null : JSON.stringify(receipt.changes);

    try {
      await db.batch([
        db.prepare(`INSERT INTO contact_api_requests
          (request_id, actor_email, action, case_id, expected_version, payload_hash,
           response_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(receipt.requestId, principal.email, action, caseId, payload.expectedVersion,
            hash, JSON.stringify(receipt), receipt.createdAt),
        db.prepare(definition.updateSql).bind(
          ...definition.updateBindings(principal.email, receipt),
        ),
        db.prepare(`INSERT INTO contact_case_events
          (event_id, request_id, case_id, event_type, actor_email, from_version,
           to_version, note, changes_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?,
            (SELECT version FROM contact_cases
             WHERE case_id = ? AND version = ? + 1 AND last_request_id = ?),
            ?, ?, ?)`)
          .bind(receipt.eventId, receipt.requestId, caseId, receipt.eventType,
            principal.email, receipt.fromVersion, caseId, receipt.fromVersion,
            receipt.requestId, receipt.note, changesJson, receipt.createdAt),
      ]);
      return result(200, receipt);
    } catch {
      const committed = await db.prepare(REQUEST_SQL).bind(payload.requestId).first();
      if (committed) {
        return replay(committed, principal.email, action, caseId, payload.expectedVersion, hash);
      }
      const latest = await db.prepare(CASE_SQL).bind(caseId).first();
      if (!latest) return errorResult(404, 'case_not_found');
      if (latest.version !== payload.expectedVersion) {
        return errorResult(409, 'version_conflict', { currentVersion: latest.version });
      }
      return errorResult(503, 'storage_unavailable');
    }
  } catch {
    return errorResult(503, 'storage_unavailable');
  }
}

export const supportedCaseActions = Object.freeze(Object.keys(ACTIONS));

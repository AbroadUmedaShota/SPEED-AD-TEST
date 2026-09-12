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
  reassign: {
    eventType: 'reassigned',
    payloadKeys: ['requestId', 'expectedVersion', 'assigneeEmail', 'reason'],
    changes: (_actorEmail, payload, current) => ({
      previousAssigneeEmail: current.assignee_email,
      assigneeEmail: payload.assigneeEmail,
    }),
    note: payload => payload.reason,
    validateCase: (row, payload) => row.status !== '対応済み'
      && row.assignee_email !== payload.assigneeEmail,
    updateSql: `UPDATE contact_cases
      SET assignee_email = ?, version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status <> '対応済み'
        AND archived_at IS NULL AND assignee_email IS NOT ?
        AND EXISTS (SELECT 1 FROM contact_operators WHERE email = ? AND active = 1)
        AND EXISTS (SELECT 1 FROM contact_operators WHERE email = ? AND active = 1)`,
    updateBindings: (actorEmail, receipt, payload) => [
      payload.assigneeEmail, receipt.requestId, receipt.createdAt, receipt.caseId,
      receipt.fromVersion, payload.assigneeEmail, payload.assigneeEmail, actorEmail,
    ],
  },
  start: {
    eventType: 'started',
    payloadKeys: ['requestId', 'expectedVersion'],
    changes: () => ({ status: '対応中' }),
    validateCase: (row) => row.status === '未対応' && row.assignee_email !== null,
    updateSql: `UPDATE contact_cases
      SET status = '対応中', version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '未対応'
        AND assignee_email IS NOT NULL AND archived_at IS NULL`,
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
  'wait-customer': {
    eventType: 'wait_customer',
    payloadKeys: ['requestId', 'expectedVersion', 'note', 'nextAction', 'followupAt'],
    changes: (_actorEmail, payload) => ({
      status: '顧客確認待ち',
      nextAction: payload.nextAction,
      followupAt: payload.followupAt,
      waitTarget: 'customer',
      waitReason: payload.note,
    }),
    note: payload => payload.note,
    validateCase: row => row.status === '対応中' && row.assignee_email !== null,
    updateSql: `UPDATE contact_cases
      SET status = '顧客確認待ち', next_action = ?, followup_at = ?,
        wait_target = 'customer', wait_reason = ?, version = version + 1,
        last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '対応中'
        AND assignee_email IS NOT NULL AND archived_at IS NULL`,
    updateBindings: (_actorEmail, receipt, payload) => [
      payload.nextAction, payload.followupAt, payload.note, receipt.requestId,
      receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  'wait-internal': {
    eventType: 'wait_internal',
    payloadKeys: [
      'requestId', 'expectedVersion', 'confirmationTarget', 'note', 'nextAction', 'followupAt',
    ],
    changes: (_actorEmail, payload) => ({
      status: '引継ぎ待ち',
      nextAction: payload.nextAction,
      followupAt: payload.followupAt,
      waitTarget: payload.confirmationTarget,
      waitReason: payload.note,
    }),
    note: payload => payload.note,
    validateCase: row => row.status === '対応中' && row.assignee_email !== null,
    updateSql: `UPDATE contact_cases
      SET status = '引継ぎ待ち', next_action = ?, followup_at = ?,
        wait_target = ?, wait_reason = ?, version = version + 1,
        last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '対応中'
        AND assignee_email IS NOT NULL AND archived_at IS NULL`,
    updateBindings: (_actorEmail, receipt, payload) => [
      payload.nextAction, payload.followupAt, payload.confirmationTarget, payload.note,
      receipt.requestId, receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  hold: {
    eventType: 'held',
    payloadKeys: ['requestId', 'expectedVersion', 'reason', 'resumeCondition', 'followupAt'],
    changes: (_actorEmail, payload) => ({
      status: '保留',
      nextAction: payload.resumeCondition,
      followupAt: payload.followupAt,
      waitTarget: null,
      waitReason: payload.reason,
    }),
    note: payload => payload.reason,
    validateCase: row => row.status === '対応中' && row.assignee_email !== null,
    updateSql: `UPDATE contact_cases
      SET status = '保留', next_action = ?, followup_at = ?, wait_target = NULL,
        wait_reason = ?, version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status = '対応中'
        AND assignee_email IS NOT NULL AND archived_at IS NULL`,
    updateBindings: (_actorEmail, receipt, payload) => [
      payload.resumeCondition, payload.followupAt, payload.reason, receipt.requestId,
      receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  resolve: {
    eventType: 'resolved',
    payloadKeys: ['requestId', 'expectedVersion', 'resolutionCode', 'finalNote'],
    optionalPayloadKeys: ['pendingClosureNote'],
    changes: (actorEmail, payload, current, createdAt) => ({
      status: '対応済み',
      resolutionCode: payload.resolutionCode,
      resolvedAt: createdAt,
      resolvedBy: actorEmail,
      clearedPending: hasPendingConditions(current) ? {
        nextAction: current.next_action,
        followupAt: current.followup_at,
        waitTarget: current.wait_target,
        waitReason: current.wait_reason,
        completionNote: payload.pendingClosureNote,
      } : null,
    }),
    note: payload => payload.finalNote,
    validateCase: (row, payload) => {
      const hasPending = hasPendingConditions(row);
      return row.status !== '対応済み'
        && row.assignee_email !== null
        && (hasPending
          ? validText(payload.pendingClosureNote, 4000)
          : !hasOwn(payload, 'pendingClosureNote'));
    },
    updateSql: `UPDATE contact_cases
      SET status = '対応済み', next_action = NULL, followup_at = NULL,
        wait_target = NULL, wait_reason = NULL, resolution_code = ?, resolved_at = ?,
        resolved_by = ?, version = version + 1, last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND status <> '対応済み'
        AND assignee_email IS NOT NULL AND archived_at IS NULL`,
    updateBindings: (actorEmail, receipt, payload) => [
      payload.resolutionCode, receipt.createdAt, actorEmail, receipt.requestId,
      receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
  reopen: {
    eventType: 'reopened',
    payloadKeys: ['requestId', 'expectedVersion', 'reason'],
    changes: (_actorEmail, payload, current) => ({
      status: '対応中',
      reopenReason: payload.reason,
      previousResolution: current.status === '対応済み' ? {
        resolutionCode: current.resolution_code,
        resolvedAt: current.resolved_at,
        resolvedBy: current.resolved_by,
      } : null,
      clearedPending: hasPendingConditions(current) ? {
        nextAction: current.next_action,
        followupAt: current.followup_at,
        waitTarget: current.wait_target,
        waitReason: current.wait_reason,
      } : null,
    }),
    note: payload => payload.reason,
    validateCase: row => row.assignee_email !== null && (
      ['顧客確認待ち', '引継ぎ待ち', '保留'].includes(row.status)
      || (row.status === '対応済み'
        && row.resolution_code !== null
        && row.resolved_at !== null
        && row.resolved_by !== null)
    ),
    updateSql: `UPDATE contact_cases
      SET status = '対応中', next_action = NULL, followup_at = NULL,
        wait_target = NULL, wait_reason = NULL, resolution_code = NULL,
        resolved_at = NULL, resolved_by = NULL, version = version + 1,
        last_request_id = ?, updated_at = ?
      WHERE case_id = ? AND version = ? AND assignee_email IS NOT NULL
        AND archived_at IS NULL AND (
          status IN ('顧客確認待ち', '引継ぎ待ち', '保留')
          OR (status = '対応済み' AND resolution_code IS NOT NULL
            AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
        )`,
    updateBindings: (_actorEmail, receipt) => [
      receipt.requestId, receipt.createdAt, receipt.caseId, receipt.fromVersion,
    ],
  },
});

const REQUEST_SQL = 'SELECT * FROM contact_api_requests WHERE request_id = ?';
const CASE_SQL = `SELECT case_id, status, assignee_email, next_action, followup_at,
    wait_target, wait_reason, resolution_code, resolved_at, resolved_by, version, archived_at
  FROM contact_cases WHERE case_id = ?`;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const INTERNAL_TARGETS = ['CS', '営業', '開発', '管理者', 'その他'];

const result = (status, body) => ({ status, body });
const errorResult = (status, error, details = {}) => result(status, { error, ...details });

function hasPendingConditions(row) {
  return Boolean(row.next_action || row.followup_at || row.wait_target || row.wait_reason);
}

function validText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
    && value.length <= maximum;
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function todayInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function payloadHash(actorEmail, action, caseId, payload) {
  if (['assign-self', 'start', 'note'].includes(action)) {
    return hashCanonical([
      actorEmail,
      action,
      caseId,
      payload.expectedVersion,
      action === 'note' ? payload.note : null,
    ]);
  }
  const businessPayload = ACTIONS[action].payloadKeys
    .concat(ACTIONS[action].optionalPayloadKeys || [])
    .filter(key => key !== 'requestId')
    .filter(key => hasOwn(payload, key))
    .sort()
    .map(key => [key, payload[key]]);
  return hashCanonical([
    actorEmail,
    action,
    caseId,
    businessPayload,
  ]);
}

async function hashCanonical(value) {
  const canonical = JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validatePayload(action, payload, timeZone) {
  const definition = ACTIONS[action];
  if (!definition || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  const allowed = [...definition.payloadKeys, ...(definition.optionalPayloadKeys || [])].sort();
  if (keys.some(key => !allowed.includes(key))
    || definition.payloadKeys.some(key => !hasOwn(payload, key))) return false;
  if (typeof payload.requestId !== 'string' || !ID_PATTERN.test(payload.requestId)) return false;
  if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1
    || payload.expectedVersion >= Number.MAX_SAFE_INTEGER) return false;
  if (hasOwn(payload, 'note') && !validText(payload.note, 4000)) return false;
  if (hasOwn(payload, 'nextAction') && !validText(payload.nextAction, 200)) return false;
  if (hasOwn(payload, 'confirmationTarget')
    && (!validText(payload.confirmationTarget, 100)
      || !INTERNAL_TARGETS.includes(payload.confirmationTarget))) return false;
  if (hasOwn(payload, 'reason') && !validText(payload.reason, 4000)) return false;
  if (hasOwn(payload, 'assigneeEmail') && !validText(payload.assigneeEmail, 254)) return false;
  if (hasOwn(payload, 'resumeCondition')
    && !validText(payload.resumeCondition, 200)) return false;
  if (hasOwn(payload, 'finalNote') && !validText(payload.finalNote, 4000)) return false;
  if (hasOwn(payload, 'pendingClosureNote')
    && !validText(payload.pendingClosureNote, 4000)) return false;
  if (hasOwn(payload, 'resolutionCode')
    && !['解決', '案内完了', '対応不要'].includes(payload.resolutionCode)) return false;
  if (hasOwn(payload, 'followupAt')
    && (!validCalendarDate(payload.followupAt)
      || payload.followupAt < todayInTimeZone(timeZone))) return false;
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

export async function executeCaseAction(db, principal, action, caseId, payload, options = {}) {
  if (!principal?.email || typeof principal.email !== 'string') {
    return errorResult(403, 'not_allowed');
  }
  const timeZone = options.timeZone || 'Asia/Tokyo';
  if (!ID_PATTERN.test(caseId) || !validatePayload(action, payload, timeZone)) {
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
    if (definition.validateCase && !definition.validateCase(current, payload)) {
      return errorResult(409, 'state_conflict', { currentStatus: current.status });
    }
    if (action === 'reassign') {
      const target = await db.prepare(
        'SELECT active FROM contact_operators WHERE email = ?',
      ).bind(payload.assigneeEmail).first();
      if (target?.active !== 1) return errorResult(400, 'invalid_assignee');
    }
    const createdAt = new Date().toISOString();
    const receipt = {
      requestId: payload.requestId,
      eventId: crypto.randomUUID(),
      caseId,
      action,
      eventType: definition.eventType,
      actorEmail: principal.email,
      fromVersion: payload.expectedVersion,
      toVersion: payload.expectedVersion + 1,
      note: definition.note ? definition.note(payload) : action === 'note' ? payload.note : null,
      changes: definition.changes(principal.email, payload, current, createdAt),
      createdAt,
    };
    const changesJson = JSON.stringify(receipt.changes);

    try {
      await db.batch([
        db.prepare(`INSERT INTO contact_api_requests
          (request_id, actor_email, action, case_id, expected_version, payload_hash,
           response_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(receipt.requestId, principal.email, action, caseId, payload.expectedVersion,
            hash, JSON.stringify(receipt), receipt.createdAt),
        db.prepare(definition.updateSql).bind(
          ...definition.updateBindings(principal.email, receipt, payload),
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
      if (action === 'reassign') {
        const actor = await db.prepare(
          'SELECT active FROM contact_operators WHERE email = ?',
        ).bind(principal.email).first();
        if (actor?.active !== 1) return errorResult(403, 'not_allowed');
      }
      const committed = await db.prepare(REQUEST_SQL).bind(payload.requestId).first();
      if (committed) {
        return replay(committed, principal.email, action, caseId, payload.expectedVersion, hash);
      }
      const latest = await db.prepare(CASE_SQL).bind(caseId).first();
      if (action === 'reassign') {
        const target = await db.prepare(
          'SELECT active FROM contact_operators WHERE email = ?',
        ).bind(payload.assigneeEmail).first();
        if (target?.active !== 1) return errorResult(409, 'assignee_unavailable');
      }
      if (!latest) return errorResult(404, 'case_not_found');
      if (latest.archived_at) return errorResult(409, 'case_archived');
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

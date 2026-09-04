/**
 * SPEED AD support contact viewer.
 *
 * Script Properties:
 *   SPREADSHEET_ID
 *   DRIVE_FOLDER_ID
 *   CONTACT_SHEET_NAME
 *   CONTACT_VIEWER_EMAILS
 *   CONTACT_VIEWER_ACCESS_TOKEN
 *   CONTACT_UNHANDLED_STALE_HOURS (optional)
 */

var DEFAULT_SHEET_NAME = 'contact_submissions';
var VIEWER_STATUSES = ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'];
var VIEWER_URGENCIES = ['高', '中', '低'];
var VIEWER_CASE_CATEGORIES = ['操作案内', '不具合', '契約・料金', '導入相談', '要望', 'その他'];
var VIEWER_HANDOFF_TARGETS = ['CS', '営業', '開発', '管理者', 'その他'];
var VIEWER_HANDOFF_STATUSES = ['なし', '依頼済み', '受領済み', '差戻し'];
var VIEWER_RESOLUTION_CODES = ['解決', '案内完了', '引継ぎ完了', '対応不要', '継続対応'];
var CONTACT_CASE_EVENT_SHEET_NAME = 'contact_case_events';
var CONTACT_CASE_SCHEMA_MIGRATION_CONFIRMATION = 'PREPARE_CONTACT_CASE_SCHEMA_V1';
var CONTACT_CASE_EVENT_HEADERS = [
  'event_id',
  'submission_id',
  'event_type',
  'from_value',
  'to_value',
  'note',
  'actor_identity',
  'actor_email',
  'actor_auth_mode',
  'request_id',
  'created_at'
];
var CONTACT_CASE_UPDATE_FIELDS = [
  'handled_status',
  'assignee_email',
  'urgency',
  'case_category',
  'gmail_thread_url',
  'progress_note',
  'handoff_to',
  'handoff_status',
  'resolution_code',
  'resolution_summary',
  'next_followup_at'
];
var CONTACT_DB_CLEANUP_CONFIRMATION = 'DELETE_TEST_CONTACT_ROWS_20260622';
var CONTACT_DB_CLEANUP_KNOWN_TEST_IDS = [
  '3d6bd3bc-a065-4908-9f73-b0b048ad0b06',
  '70a13837-4725-4b56-ab5f-22a5135ea3ca',
  '93f9c46a-b306-4238-b14b-5169811b58f4',
  '51cbb89e-b7e8-42ea-8890-0b4ce7645474'
];
var CONTACT_DB_CLEANUP_INTERNAL_EMAILS = [
  's-umeda@abroad-o.com',
  'customer@speed-ad.com',
  't-hayashi@abroad-o.com'
];
var CONTACT_DB_CLEANUP_MARKERS = [
  'テスト',
  'test',
  'Codex',
  'テストモード',
  'production-check',
  'contactTestMode'
];
var RESIDUAL_ATTACHMENT_CLEANUP_TARGETS = [
  {
    submission_id: '7fe3ea83-0308-4182-80a2-4d6067fe3bf0',
    fileId: '1pJpzNYUd6JN-Q9IkUWgDs1SKwMIgIbGs'
  },
  {
    submission_id: 'bc19d151-46a3-4a05-9efe-64706809bdfb',
    fileId: '1eMhiGKnbzYCqwSwl8vVo91aOSmT2dtbL'
  },
  {
    submission_id: '3d6bd3bc-a065-4908-9f73-b0b048ad0b06',
    fileId: '15eel6WUJZ_p1ESKBRPYskeZOSmVY58ev'
  },
  {
    submission_id: '70a13837-4725-4b56-ab5f-22a5135ea3ca',
    fileId: '1tAxw8xgyF5mvt762VMd3fHcpYTBnAUjh'
  }
];
var CONTACT_HEADERS = [
  'submission_id',
  'submitted_at',
  'contact_type',
  'name',
  'email',
  'subject',
  'message',
  'attachment_count',
  'attachment_refs',
  'source_url',
  'user_agent',
  'storage_status',
  'mail_status',
  'handled_status',
  'handled_by',
  'handled_at',
  'internal_note',
  'assignee_email',
  'urgency',
  'case_category',
  'gmail_thread_url',
  'progress_note',
  'handoff_to',
  'handoff_status',
  'resolution_code',
  'resolution_summary',
  'next_followup_at',
  'closed_at',
  'closed_by'
];

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  var accessToken = getRequestToken_(e);
  template.initialSubmissionId = String((e && e.parameter && e.parameter.id) || '');
  template.initialAccessToken = accessToken;
  template.viewerContext = getViewerContext_(accessToken);
  return template
    .evaluate()
    .setTitle('SPEED AD お問い合わせ確認')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getViewerContext() {
  return getViewerContext_('');
}

function validateViewerAccessToken(accessToken) {
  return getViewerContext_(accessToken);
}

function listContactSubmissions(accessToken, options) {
  var context = requireViewer_(accessToken);
  options = options || {};
  var statusFilter = String(options.status || '').trim();
  var query = String(options.query || '').toLowerCase().trim();
  var limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
  var sheet = getSheet_();
  var headers = readHeaders_(sheet);
  var timeZone = getCaseTimeZone_(sheet);
  var values = sheet.getDataRange().getValues();
  var records = [];
  var now = new Date();
  var staleHours = getCaseStaleHours_();
  var counts = {
    total: 0,
    active: 0,
    attention: 0
  };

  VIEWER_STATUSES.forEach(function (status) {
    counts[status] = 0;
  });

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var record = normalizeCaseRecord_(rowToRecord_(headers, values[rowIndex], rowIndex + 1, timeZone));
    record.attention_reasons = getCaseAttentionReasons_(record, now, staleHours, timeZone);
    counts.total += 1;
    if (isActiveStatus_(record.handled_status)) {
      counts.active += 1;
    }
    if (counts[record.handled_status] != null) {
      counts[record.handled_status] += 1;
    }
    if (record.attention_reasons.length) {
      counts.attention += 1;
    }
    if (query && !matchesQuery_(record, query)) continue;
    if (statusFilter === 'all') {
      records.push(toSummary_(record));
      continue;
    }
    if (statusFilter === 'active') {
      if (isActiveStatus_(record.handled_status)) {
        records.push(toSummary_(record));
      }
      continue;
    }
    if (statusFilter && record.handled_status !== statusFilter) continue;
    records.push(toSummary_(record));
  }

  records.sort(function (a, b) {
    return String(b.submitted_at).localeCompare(String(a.submitted_at));
  });

  return {
    ok: true,
    viewerEmail: context.email,
    statuses: VIEWER_STATUSES,
    options: getCaseOptions_(),
    staleHours: staleHours,
    counts: counts,
    submissions: records.slice(0, limit)
  };
}

function getContactSubmission(accessToken, submissionId) {
  var context = requireViewer_(accessToken);
  var match = findSubmission_(submissionId);
  if (!match) {
    throw new Error('問い合わせが見つかりません。');
  }
  match.record = normalizeCaseRecord_(match.record);
  match.record.attachments = parseAttachmentRefs_(match.record.attachment_refs).map(enrichAttachment_);
  match.record.attention_reasons = getCaseAttentionReasons_(match.record, new Date(), getCaseStaleHours_(), match.timeZone);
  return {
    ok: true,
    submission: match.record,
    events: listContactCaseEvents_(submissionId),
    options: getCaseOptions_(),
    audit: getCaseAuditContext_(context)
  };
}

function getAttachmentPreview(accessToken, fileId) {
  requireViewer_(accessToken);
  var file = DriveApp.getFileById(String(fileId || ''));
  assertAttachmentFile_(file);
  var blob = file.getBlob();
  var mimeType = blob.getContentType();
  if (String(mimeType || '').indexOf('image/') !== 0) {
    throw new Error('画像ファイルではありません。');
  }
  return {
    ok: true,
    fileId: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
    dataUrl: 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes()),
    url: file.getUrl()
  };
}

function updateContactSubmissionStatus(accessToken, submissionId, status, note) {
  requireViewer_(accessToken);
  var match = findSubmission_(submissionId);
  if (!match) {
    throw new Error('問い合わせが見つかりません。');
  }
  return updateContactCase(accessToken, submissionId, {
    handled_status: status,
    progress_note: note,
    history_note: '従来のステータス更新操作から保存',
    request_id: 'legacy-' + Utilities.getUuid(),
    expected_handled_at: String(match.record.handled_at || '')
  });
}

function updateContactCase(accessToken, submissionId, payload) {
  var context = requireViewer_(accessToken);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return updateContactCase_(accessToken, context, submissionId, payload || {});
  } finally {
    lock.releaseLock();
  }
}

function updateContactCase_(accessToken, context, submissionId, payload) {
  var sheet = getSheet_();
  assertContactCaseSchemaReady_(sheet);
  var headers = readHeaders_(sheet);
  var match = findSubmission_(submissionId, sheet, headers);
  if (!match) {
    throw new Error('問い合わせが見つかりません。');
  }

  var current = normalizeCaseRecord_(match.record);
  var requestId = normalizeCaseRequestId_(payload.request_id);
  if (findExistingCaseRequest_(sheet.getParent(), submissionId, requestId)) {
    return getContactSubmission(accessToken, submissionId);
  }
  var expectedHandledAt = String(payload.expected_handled_at || '');
  if (expectedHandledAt !== String(current.handled_at || '')) {
    throw new Error('この問い合わせは別の画面で更新されています。再読み込みしてから操作してください。');
  }
  var next = buildNextCaseRecord_(current, payload, getViewerEmails_());
  var actor = getCaseActor_(context);
  var nowIso = new Date().toISOString();
  var timeZone = getCaseTimeZone_(sheet);
  var historyNote = normalizeCaseText_(payload.history_note, 2000);
  var validationErrors = validateCaseFollowup_(next, nowIso, timeZone).concat(validateCaseClose_(current, next, historyNote, nowIso, timeZone));
  if (validationErrors.length) {
    throw new Error(validationErrors.join('\n'));
  }

  next.handled_by = actor.displayName;
  next.handled_at = nowIso;
  if (next.handled_status === '対応済み' && current.handled_status !== '対応済み') {
    next.closed_at = nowIso;
    next.closed_by = actor.displayName;
  } else if (next.handled_status !== '対応済み') {
    next.closed_at = '';
    next.closed_by = '';
  }

  var events = buildCaseEvents_(current, next, historyNote, actor, requestId, nowIso);
  if (!events.length) {
    return getContactSubmission(accessToken, submissionId);
  }

  var rowRange = sheet.getRange(match.rowNumber, 1, 1, headers.length);
  var previousRow = rowRange.getValues();
  var updatedRow = previousRow[0].slice();
  CONTACT_CASE_UPDATE_FIELDS.concat(['handled_by', 'handled_at', 'closed_at', 'closed_by']).forEach(function (key) {
    var colIndex = headers.indexOf(key);
    if (colIndex !== -1) {
      updatedRow[colIndex] = next[key] || '';
    }
  });

  rowRange.setValues([updatedRow]);
  try {
    appendContactCaseEvents_(sheet.getParent(), submissionId, events);
  } catch (err) {
    var historyRecorded;
    try {
      historyRecorded = findExistingCaseRequest_(sheet.getParent(), submissionId, requestId);
    } catch (verificationError) {
      throw new Error('対応履歴の保存結果を確認できませんでした。案件行は変更したままです。管理者によるSpreadsheet確認が必要です。' + String(verificationError));
    }
    if (historyRecorded) {
      return getContactSubmission(accessToken, submissionId);
    }
    if (!restoreContactCaseRow_(rowRange, previousRow)) {
      throw new Error('案件行と対応履歴の整合を復元できませんでした。管理者によるSpreadsheet確認が必要です。' + String(err));
    }
    throw new Error('対応履歴を保存できなかったため、案件更新を取り消しました。' + String(err));
  }
  return getContactSubmission(accessToken, submissionId);
}

/* CONTACT_CASE_TEST_HELPERS_START */
function normalizeCaseRecord_(record) {
  var normalized = Object.assign({}, record || {});
  normalized.handled_status = normalizeHandledStatus_(normalized.handled_status);
  normalized.urgency = normalizeEnumValue_(normalized.urgency, VIEWER_URGENCIES, '中');
  normalized.case_category = normalizeEnumValue_(normalized.case_category, VIEWER_CASE_CATEGORIES, '');
  normalized.handoff_status = normalizeEnumValue_(normalized.handoff_status, VIEWER_HANDOFF_STATUSES, 'なし');
  normalized.handoff_to = normalizeEnumValue_(normalized.handoff_to, VIEWER_HANDOFF_TARGETS, '');
  normalized.resolution_code = normalizeEnumValue_(normalized.resolution_code, VIEWER_RESOLUTION_CODES, '');
  normalized.assignee_email = String(normalized.assignee_email || '').trim().toLowerCase();
  normalized.progress_note = String(normalized.progress_note || normalized.internal_note || '').trim();
  normalized.gmail_thread_url = String(normalized.gmail_thread_url || '').trim();
  normalized.resolution_summary = String(normalized.resolution_summary || '').trim();
  normalized.next_followup_at = normalizeCaseDate_(normalized.next_followup_at);
  return normalized;
}

function buildNextCaseRecord_(current, payload, allowedAssignees) {
  var next = normalizeCaseRecord_(current);
  var allowedKeys = CONTACT_CASE_UPDATE_FIELDS.concat(['history_note', 'request_id', 'expected_handled_at']);
  Object.keys(payload || {}).forEach(function (key) {
    if (allowedKeys.indexOf(key) === -1) {
      throw new Error('更新対象に含まれない項目が指定されました。');
    }
  });

  next.handled_status = requireEnumValue_(getCaseUpdateValue_(payload, 'handled_status', next.handled_status), VIEWER_STATUSES, '対応ステータス');
  next.urgency = requireEnumValue_(getCaseUpdateValue_(payload, 'urgency', next.urgency), VIEWER_URGENCIES, '緊急度');
  next.case_category = optionalEnumValue_(getCaseUpdateValue_(payload, 'case_category', next.case_category), VIEWER_CASE_CATEGORIES, '分類');
  next.handoff_to = optionalEnumValue_(getCaseUpdateValue_(payload, 'handoff_to', next.handoff_to), VIEWER_HANDOFF_TARGETS, '引継ぎ先');
  next.handoff_status = requireEnumValue_(getCaseUpdateValue_(payload, 'handoff_status', next.handoff_status), VIEWER_HANDOFF_STATUSES, '引継ぎ状態');
  next.resolution_code = optionalEnumValue_(getCaseUpdateValue_(payload, 'resolution_code', next.resolution_code), VIEWER_RESOLUTION_CODES, '対応結果');
  next.assignee_email = normalizeAssignee_(getCaseUpdateValue_(payload, 'assignee_email', next.assignee_email), allowedAssignees);
  next.gmail_thread_url = normalizeGmailThreadUrl_(getCaseUpdateValue_(payload, 'gmail_thread_url', next.gmail_thread_url));
  next.progress_note = normalizeCaseText_(getCaseUpdateValue_(payload, 'progress_note', next.progress_note), 4000);
  next.resolution_summary = normalizeCaseText_(getCaseUpdateValue_(payload, 'resolution_summary', next.resolution_summary), 2000);
  next.next_followup_at = normalizeRequiredCaseDate_(getCaseUpdateValue_(payload, 'next_followup_at', next.next_followup_at));

  if (next.handoff_status !== 'なし' && !next.handoff_to) {
    throw new Error('引継ぎ状態を設定する場合は引継ぎ先を選択してください。');
  }
  if (next.handoff_status === 'なし') {
    next.handoff_to = '';
  }
  var requiresFollowup = ['顧客確認待ち', '保留'].indexOf(next.handled_status) !== -1 || next.resolution_code === '継続対応';
  if (requiresFollowup && !next.next_followup_at) {
    throw new Error('顧客確認待ち、保留、継続対応では次回確認日を設定してください。');
  }
  return next;
}

function getCaseUpdateValue_(payload, key, fallback) {
  return Object.prototype.hasOwnProperty.call(payload || {}, key) ? payload[key] : fallback;
}

function validateCaseClose_(current, next, historyNote, nowValue, timeZone) {
  if (next.handled_status !== '対応済み') return [];
  var closeFields = ['assignee_email', 'resolution_code', 'progress_note', 'handoff_to', 'handoff_status', 'next_followup_at'];
  var unchangedExistingClose = normalizeHandledStatus_(current.handled_status) === '対応済み' && closeFields.every(function (key) {
    return String(current[key] || '') === String(next[key] || '');
  });
  if (unchangedExistingClose) return [];
  var errors = [];
  if (!next.assignee_email) errors.push('対応済みにするには担当者が必要です。');
  if (!next.resolution_code) errors.push('対応済みにするには対応結果が必要です。');
  if (!next.progress_note && !historyNote) errors.push('対応済みにするには進捗メモまたは今回の対応履歴が必要です。');
  if (next.handoff_status !== 'なし' && next.handoff_status !== '受領済み' && next.resolution_code !== '引継ぎ完了') {
    errors.push('引継ぎがある案件は受領済み、または対応結果を引継ぎ完了にしてください。');
  }
  if (next.resolution_code === '継続対応') {
    if (!next.next_followup_at) {
      errors.push('継続対応でクローズする場合は次回確認日が必要です。');
    } else if (isCaseDateOverdue_(next.next_followup_at, nowValue, timeZone)) {
      errors.push('継続対応の次回確認日は本日以降に設定してください。');
    }
  }
  return errors;
}

function validateCaseFollowup_(next, nowValue, timeZone) {
  var requiresFollowup = ['顧客確認待ち', '保留'].indexOf(next.handled_status) !== -1 || next.resolution_code === '継続対応';
  if (!requiresFollowup || !next.next_followup_at) return [];
  return isCaseDateOverdue_(next.next_followup_at, nowValue, timeZone) ? ['次回確認日は本日以降に設定してください。'] : [];
}

function buildCaseEvents_(current, next, historyNote, actor, requestId, nowIso) {
  var events = [];
  CONTACT_CASE_UPDATE_FIELDS.forEach(function (key) {
    var fromValue = String(current[key] || '');
    var toValue = String(next[key] || '');
    if (fromValue === toValue) return;
    events.push({
      event_type: 'field_changed:' + key,
      from_value: fromValue,
      to_value: toValue,
      note: historyNote,
      actor_identity: actor.identity,
      actor_email: actor.email,
      actor_auth_mode: actor.authMode,
      request_id: requestId,
      created_at: nowIso
    });
  });
  if (!events.length && historyNote) {
    events.push({
      event_type: 'progress_added',
      from_value: '',
      to_value: '',
      note: historyNote,
      actor_identity: actor.identity,
      actor_email: actor.email,
      actor_auth_mode: actor.authMode,
      request_id: requestId,
      created_at: nowIso
    });
  }
  return events;
}

function getCaseAttentionReasons_(record, nowValue, staleHours, timeZone) {
  var current = normalizeCaseRecord_(record);
  var reasons = [];
  if (current.urgency === '高' && !current.assignee_email && current.handled_status !== '対応済み') {
    reasons.push({ code: 'high_urgency_unassigned', label: '高緊急度・未割当', severity: 'high' });
  }
  if (current.handled_status === '未対応' && Number(staleHours || 0) > 0 && isCaseStale_(current.submitted_at, nowValue, staleHours)) {
    reasons.push({ code: 'unhandled_stale', label: '未対応・滞留', severity: 'high' });
  }
  if (current.handled_status !== '対応済み' && current.next_followup_at && isCaseDateOverdue_(current.next_followup_at, nowValue, timeZone)) {
    reasons.push({ code: 'followup_overdue', label: '次回確認日超過', severity: 'high' });
  }
  if (current.handled_status !== '対応済み' && current.handoff_status === '依頼済み') {
    reasons.push({ code: 'handoff_pending', label: '引継ぎ未受領', severity: 'medium' });
  }
  return reasons;
}

function isCaseStale_(submittedAt, nowValue, staleHours) {
  var submitted = new Date(submittedAt);
  var now = new Date(nowValue);
  if (isNaN(submitted.getTime()) || isNaN(now.getTime())) return false;
  return now.getTime() - submitted.getTime() >= Number(staleHours) * 60 * 60 * 1000;
}

function isCaseDateOverdue_(dateValue, nowValue, timeZone) {
  var normalized = normalizeCaseDate_(dateValue);
  if (!normalized) return false;
  var now = new Date(nowValue);
  if (isNaN(now.getTime())) return false;
  var today = normalizeCaseDateCellValue_(now, timeZone);
  return normalized < today;
}

function normalizeGmailThreadUrl_(value) {
  var url = String(value || '').trim();
  if (!url) return '';
  if (!/^https:\/\/mail\.google\.com\/mail\//i.test(url)) {
    throw new Error('Gmail参照リンクは https://mail.google.com/mail/ で始まるURLを指定してください。');
  }
  return normalizeCaseText_(url, 2000);
}

function normalizeAssignee_(value, allowedAssignees) {
  var email = String(value || '').trim().toLowerCase();
  if (!email) return '';
  if ((allowedAssignees || []).indexOf(email) === -1) {
    throw new Error('担当者は確認アプリの許可ユーザーから選択してください。');
  }
  return email;
}

function requireEnumValue_(value, allowedValues, label) {
  var normalized = String(value || '').trim();
  if (allowedValues.indexOf(normalized) === -1) {
    throw new Error(label + 'が不正です。');
  }
  return normalized;
}

function optionalEnumValue_(value, allowedValues, label) {
  var normalized = String(value || '').trim();
  if (!normalized) return '';
  return requireEnumValue_(normalized, allowedValues, label);
}

function normalizeEnumValue_(value, allowedValues, fallback) {
  var normalized = String(value || '').trim();
  return allowedValues.indexOf(normalized) !== -1 ? normalized : fallback;
}

function normalizeCaseText_(value, maxLength) {
  var normalized = String(value || '').trim();
  if (normalized.length > maxLength) {
    throw new Error('入力内容が最大文字数を超えています。');
  }
  return /^[=+\-@]/.test(normalized) ? "'" + normalized : normalized;
}

function normalizeCaseRequestId_(value) {
  var requestId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) {
    throw new Error('更新リクエストIDが不正です。');
  }
  return requestId;
}

function normalizeRequiredCaseDate_(value) {
  var normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || normalizeCaseDate_(normalized) !== normalized) {
    throw new Error('次回確認日はYYYY-MM-DD形式で指定してください。');
  }
  return normalized;
}

function normalizeCaseDate_(value) {
  var raw = String(value || '').trim();
  var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  var monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return '';
  return match[1] + '-' + match[2] + '-' + match[3];
}
/* CONTACT_CASE_TEST_HELPERS_END */

function getCaseOptions_() {
  return {
    statuses: VIEWER_STATUSES.slice(),
    assignees: getViewerEmails_(),
    urgencies: VIEWER_URGENCIES.slice(),
    categories: VIEWER_CASE_CATEGORIES.slice(),
    handoffTargets: VIEWER_HANDOFF_TARGETS.slice(),
    handoffStatuses: VIEWER_HANDOFF_STATUSES.slice(),
    resolutionCodes: VIEWER_RESOLUTION_CODES.slice()
  };
}

function getCaseActor_(context) {
  var sessionEmail = String((context && context.email) || '').trim().toLowerCase();
  var email = sessionEmail.indexOf('@') !== -1 ? sessionEmail : '';
  return {
    identity: 'shared-token',
    email: email,
    authMode: 'shared_token',
    displayName: '共有トークン利用者'
  };
}

function getCaseAuditContext_(context) {
  var actor = getCaseActor_(context);
  return {
    authMode: actor.authMode,
    actorIdentity: actor.identity,
    accountAuditReliable: false,
    notice: '共有トークン認証のため、操作者をアカウント単位で保証できません。'
  };
}

function getCaseStaleHours_() {
  var raw = String(getProperty_('CONTACT_UNHANDLED_STALE_HOURS', '') || '').trim();
  if (!raw) return 0;
  var value = Number(raw);
  return isFinite(value) && value > 0 ? value : 0;
}

function appendContactCaseEvents_(spreadsheet, submissionId, events) {
  if (!events.length) return;
  var sheet = spreadsheet.getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  assertContactCaseEventSchemaReady_(sheet);
  var rows = events.map(function (event) {
    var record = Object.assign({}, event, {
      event_id: Utilities.getUuid(),
      submission_id: event.submission_id || submissionId
    });
    return CONTACT_CASE_EVENT_HEADERS.map(function (header) { return record[header] || ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CONTACT_CASE_EVENT_HEADERS.length).setValues(rows);
}

function findExistingCaseRequest_(spreadsheet, submissionId, requestId) {
  var sheet = spreadsheet.getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var headers = readHeaders_(sheet);
  var submissionIndex = headers.indexOf('submission_id');
  var requestIndex = headers.indexOf('request_id');
  if (submissionIndex === -1 || requestIndex === -1) return false;
  var values = sheet.getDataRange().getValues();
  return values.slice(1).some(function (row) {
    return String(row[submissionIndex] || '') === String(submissionId || '') && String(row[requestIndex] || '') === requestId;
  });
}

function restoreContactCaseRow_(rowRange, previousRow) {
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      rowRange.setValues(previousRow);
      var restored = rowRange.getValues();
      if (JSON.stringify(restored) === JSON.stringify(previousRow)) return true;
    } catch (_err) {
      // Retry once before escalating an inconsistent write.
    }
  }
  return false;
}

function assertContactCaseEventSchemaReady_(sheet) {
  if (!sheet) {
    throw new Error('対応履歴シートが未作成です。CS運用スキーマ移行を先に実行してください。');
  }
  assertContactCaseEventHeaders_(sheet, false);
}

function assertContactCaseEventHeaders_(sheet, allowIncomplete) {
  var headers = readHeaders_(sheet);
  if (!headers.some(function (header) { return !!header; }) && sheet.getLastRow() < 2) headers = [];
  // Event rows are written in this exact order; never reinterpret existing columns.
  var nonCanonical = headers.some(function (header, index) {
    return header !== CONTACT_CASE_EVENT_HEADERS[index];
  });
  if (nonCanonical || (!allowIncomplete && headers.length !== CONTACT_CASE_EVENT_HEADERS.length)) {
    throw new Error('対応履歴シートの列順・重複・不足が正規スキーマと一致しません。更新を中止して管理者に確認してください。');
  }
  return headers;
}

function assertContactCaseSchemaReady_(sheet) {
  var headers = readHeaders_(sheet);
  var missing = CONTACT_HEADERS.filter(function (header) { return headers.indexOf(header) === -1; });
  if (missing.length || !sheet.getParent().getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME)) {
    throw new Error('CS運用スキーマ移行が未完了です。管理者に確認してください。');
  }
  assertContactCaseEventSchemaReady_(sheet.getParent().getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME));
}

function listContactCaseEvents_(submissionId) {
  var sheet = getSheet_();
  var eventSheet = sheet.getParent().getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  if (!eventSheet || eventSheet.getLastRow() < 2) return [];
  var values = eventSheet.getDataRange().getValues();
  var headers = values[0].map(function (value) { return String(value || '').trim(); });
  var idIndex = headers.indexOf('submission_id');
  return values.slice(1).filter(function (row) {
    return String(row[idIndex] || '') === String(submissionId || '');
  }).map(function (row) {
    var event = {};
    headers.forEach(function (header, index) {
      if (header) event[header] = normalizeCellValue_(row[index]);
    });
    return event;
  }).sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function ensureContactCaseEventSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONTACT_CASE_EVENT_SHEET_NAME);
  }
  var headers = assertContactCaseEventHeaders_(sheet, true);
  if (headers.length < CONTACT_CASE_EVENT_HEADERS.length) {
    ensureSheetColumnCapacity_(sheet, CONTACT_CASE_EVENT_HEADERS.length);
    sheet.getRange(1, 1, 1, CONTACT_CASE_EVENT_HEADERS.length).setValues([CONTACT_CASE_EVENT_HEADERS]);
  }
  return sheet;
}

function previewContactDbCleanup() {
  var operatorEmail = assertContactDbCleanupOperator_();
  return buildContactDbCleanupPreview_(operatorEmail);
}

function executeContactDbCleanup(confirmation) {
  var operatorEmail = assertContactDbCleanupOperator_();
  assertContactDbCleanupConfirmation_(confirmation);
  return executeContactDbCleanup_(operatorEmail);
}

function previewResidualAttachmentCleanup() {
  var operatorEmail = assertContactDbCleanupOperator_();
  return inspectResidualAttachmentCleanup_(operatorEmail, false);
}

function executeResidualAttachmentCleanup(confirmation) {
  var operatorEmail = assertContactDbCleanupOperator_();
  assertContactDbCleanupConfirmation_(confirmation);
  return inspectResidualAttachmentCleanup_(operatorEmail, true);
}

function previewContactCaseSchemaMigration() {
  var operatorEmail = assertContactDbCleanupOperator_();
  var sheet = getConfiguredSheet_();
  var plan = buildContactCaseSchemaMigrationPlan_(sheet);
  plan.ok = true;
  plan.mode = 'preview';
  plan.operatorEmail = operatorEmail;
  return plan;
}

function executeContactCaseSchemaMigration(confirmation) {
  var operatorEmail = assertContactDbCleanupOperator_();
  if (String(confirmation || '') !== CONTACT_CASE_SCHEMA_MIGRATION_CONFIRMATION) {
    throw new Error('CS運用スキーマ移行の確認文字列が一致しません。');
  }
  var sheet = getConfiguredSheet_();
  var spreadsheet = sheet.getParent();
  var plan = buildContactCaseSchemaMigrationPlan_(sheet);
  var backupSheetName = createContactDbCleanupBackup_(spreadsheet, sheet);
  ensureHeaders_(sheet);
  ensureContactCaseEventSheet_(spreadsheet);
  var actor = {
    identity: operatorEmail,
    email: operatorEmail,
    authMode: 'apps_script_editor'
  };
  var createdAt = new Date().toISOString();
  var migrationEvents = plan.legacyCompletedSubmissionIds.map(function (submissionId) {
    return {
      submission_id: submissionId,
      event_type: 'legacy_migrated',
      from_value: '対応済み',
      to_value: '対応済み',
      note: '既存の対応済み状態を再判定せず維持',
      actor_identity: actor.identity,
      actor_email: actor.email,
      actor_auth_mode: actor.authMode,
      request_id: 'migration-' + submissionId,
      created_at: createdAt
    };
  });
  appendContactCaseEvents_(spreadsheet, '', migrationEvents);
  return {
    ok: true,
    mode: 'execute',
    operatorEmail: operatorEmail,
    backupSheetName: backupSheetName,
    addedHeaders: plan.missingHeaders,
    addedEventHeaders: plan.missingEventHeaders,
    migratedLegacyCompletedCount: plan.legacyCompletedSubmissionIds.length
  };
}

function buildContactCaseSchemaMigrationPlan_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
  var missingHeaders = CONTACT_HEADERS.filter(function (header) { return headers.indexOf(header) === -1; });
  var values = sheet.getDataRange().getValues();
  var idIndex = headers.indexOf('submission_id');
  var statusIndex = headers.indexOf('handled_status');
  var eventSheet = sheet.getParent().getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  var eventHeaders = eventSheet ? assertContactCaseEventHeaders_(eventSheet, true) : [];
  var migratedIds = getLegacyMigratedSubmissionIds_(sheet.getParent());
  var missingEventHeaders = CONTACT_CASE_EVENT_HEADERS.filter(function (header) { return eventHeaders.indexOf(header) === -1; });
  var legacyCompletedSubmissionIds = [];
  if (idIndex !== -1 && statusIndex !== -1) {
    values.slice(1).forEach(function (row) {
      var submissionId = String(row[idIndex] || '').trim();
      if (submissionId && String(row[statusIndex] || '').trim() === '対応済み' && !migratedIds[submissionId]) {
        legacyCompletedSubmissionIds.push(submissionId);
      }
    });
  }
  return {
    sheetName: sheet.getName(),
    missingHeaders: missingHeaders,
    eventSheetExists: !!eventSheet,
    missingEventHeaders: missingEventHeaders,
    legacyCompletedSubmissionIds: legacyCompletedSubmissionIds
  };
}

function getLegacyMigratedSubmissionIds_(spreadsheet) {
  var migrated = {};
  var eventSheet = spreadsheet.getSheetByName(CONTACT_CASE_EVENT_SHEET_NAME);
  if (!eventSheet || eventSheet.getLastRow() < 2) return migrated;
  var values = eventSheet.getDataRange().getValues();
  var headers = values[0].map(function (value) { return String(value || '').trim(); });
  var idIndex = headers.indexOf('submission_id');
  var typeIndex = headers.indexOf('event_type');
  if (idIndex === -1 || typeIndex === -1) return migrated;
  values.slice(1).forEach(function (row) {
    if (String(row[typeIndex] || '') === 'legacy_migrated') {
      migrated[String(row[idIndex] || '')] = true;
    }
  });
  return migrated;
}

function buildContactDbCleanupPreview_(operatorEmail) {
  var plan = buildContactDbCleanupPlan_();
  return {
    ok: true,
    mode: 'preview',
    generatedAt: new Date().toISOString(),
    operatorEmail: operatorEmail,
    sheetName: plan.sheetName,
    totalRows: plan.totalRows,
    candidateCount: plan.candidates.length,
    candidates: plan.candidates
  };
}

function executeContactDbCleanup_(operatorEmail) {
  var sheet = getSheet_();
  var spreadsheet = sheet.getParent();
  var plan = buildContactDbCleanupPlan_(sheet);
  var result = {
    ok: true,
    mode: 'execute',
    generatedAt: new Date().toISOString(),
    operatorEmail: operatorEmail,
    sheetName: plan.sheetName,
    totalRowsBefore: plan.totalRows,
    candidateCount: plan.candidates.length,
    candidates: plan.candidates,
    executed: false,
    backupSheetName: '',
    deletedRowNumbers: [],
    attachments: {
      trashedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      files: []
    }
  };

  if (!plan.candidates.length) {
    result.message = '削除対象はありません。';
    return result;
  }

  result.backupSheetName = createContactDbCleanupBackup_(spreadsheet, sheet);
  result.attachments = trashContactDbCleanupAttachments_(plan.candidates);
  result.deletedRowNumbers = deleteContactDbCleanupRows_(sheet, plan.candidates);
  result.totalRowsAfter = Math.max(sheet.getLastRow() - 1, 0);
  result.executed = true;
  return result;
}

function buildContactDbCleanupPlan_(sheet) {
  sheet = sheet || getSheet_();
  var headers = readHeaders_(sheet);
  var timeZone = getCaseTimeZone_(sheet);
  var values = sheet.getDataRange().getValues();
  var candidates = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var record = rowToRecord_(headers, values[rowIndex], rowIndex + 1, timeZone);
    var decision = getContactDbCleanupDecision_(record);
    if (!decision.deleteTarget) continue;

    candidates.push({
      rowNumber: record.rowNumber,
      submission_id: record.submission_id,
      email: record.email,
      subject: record.subject,
      attachmentFileIds: getCleanupAttachmentFileIds_(record.attachment_refs),
      reasons: decision.reasons
    });
  }

  return {
    sheetName: sheet.getName(),
    totalRows: Math.max(values.length - 1, 0),
    candidates: candidates
  };
}

function getContactDbCleanupDecision_(record) {
  var submissionId = String(record.submission_id || '').trim();
  var email = String(record.email || '').trim().toLowerCase();
  var reasons = [];

  if (CONTACT_DB_CLEANUP_KNOWN_TEST_IDS.indexOf(submissionId) !== -1) {
    reasons.push('known_test_submission_id');
    return {
      deleteTarget: true,
      reasons: reasons
    };
  }

  if (CONTACT_DB_CLEANUP_INTERNAL_EMAILS.indexOf(email) === -1) {
    return {
      deleteTarget: false,
      reasons: ['external_email_not_auto_deleted']
    };
  }

  var matchedMarkers = getContactDbCleanupMatchedMarkers_(record);
  if (!matchedMarkers.length) {
    return {
      deleteTarget: false,
      reasons: ['internal_email_without_test_marker']
    };
  }

  matchedMarkers.forEach(function (marker) {
    reasons.push('test_marker:' + marker);
  });
  return {
    deleteTarget: true,
    reasons: reasons
  };
}

function getContactDbCleanupMatchedMarkers_(record) {
  var target = [
    record.subject,
    record.message,
    record.name,
    record.user_agent,
    record.source_url
  ].join('\n').toLowerCase();
  return CONTACT_DB_CLEANUP_MARKERS.filter(function (marker) {
    return target.indexOf(String(marker).toLowerCase()) !== -1;
  });
}

function getCleanupAttachmentFileIds_(attachmentRefs) {
  var fileIds = [];
  parseAttachmentRefs_(attachmentRefs).forEach(function (attachment) {
    var fileId = String(attachment.fileId || '').trim();
    if (fileId && fileIds.indexOf(fileId) === -1) {
      fileIds.push(fileId);
    }
  });
  return fileIds;
}

function createContactDbCleanupBackup_(spreadsheet, sheet) {
  var timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Asia/Tokyo',
    'yyyyMMdd_HHmmss'
  );
  var baseName = sheet.getName() + '_backup_' + timestamp;
  var backupName = makeUniqueSheetName_(spreadsheet, baseName);
  var backupSheet = sheet.copyTo(spreadsheet);
  backupSheet.setName(backupName);
  spreadsheet.setActiveSheet(sheet);
  return backupName;
}

function makeUniqueSheetName_(spreadsheet, baseName) {
  var name = baseName;
  var suffix = 2;
  while (spreadsheet.getSheetByName(name)) {
    name = baseName + '_' + suffix;
    suffix += 1;
  }
  return name;
}

function trashContactDbCleanupAttachments_(candidates) {
  var result = {
    trashedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    files: []
  };

  candidates.forEach(function (candidate) {
    candidate.attachmentFileIds.forEach(function (fileId) {
      var fileResult = {
        submission_id: candidate.submission_id,
        fileId: fileId,
        name: '',
        status: ''
      };
      try {
        var file = DriveApp.getFileById(fileId);
        var fileName = file.getName();
        fileResult.name = fileName;
        if (String(fileName || '').indexOf(candidate.submission_id + '-') !== 0) {
          fileResult.status = 'skipped';
          fileResult.reason = 'filename_does_not_start_with_submission_id';
          result.skippedCount += 1;
        } else {
          file.setTrashed(true);
          fileResult.status = 'trashed';
          result.trashedCount += 1;
        }
      } catch (err) {
        fileResult.status = 'error';
        fileResult.error = String(err);
        result.errorCount += 1;
      }
      result.files.push(fileResult);
    });
  });

  return result;
}

function inspectResidualAttachmentCleanup_(operatorEmail, shouldTrash) {
  var result = {
    ok: true,
    mode: shouldTrash ? 'execute-residual-attachments' : 'preview-residual-attachments',
    generatedAt: new Date().toISOString(),
    operatorEmail: operatorEmail,
    targetCount: RESIDUAL_ATTACHMENT_CLEANUP_TARGETS.length,
    trashedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    files: []
  };

  RESIDUAL_ATTACHMENT_CLEANUP_TARGETS.forEach(function (target) {
    var fileResult = {
      submission_id: target.submission_id,
      fileId: target.fileId,
      name: '',
      trashed: false,
      status: ''
    };
    try {
      var file = DriveApp.getFileById(target.fileId);
      var fileName = file.getName();
      fileResult.name = fileName;
      fileResult.trashed = file.isTrashed();
      if (String(fileName || '').indexOf(target.submission_id + '-') !== 0) {
        fileResult.status = 'skipped';
        fileResult.reason = 'filename_does_not_start_with_submission_id';
        result.skippedCount += 1;
      } else if (fileResult.trashed) {
        fileResult.status = 'already_trashed';
        result.trashedCount += 1;
      } else if (shouldTrash) {
        file.setTrashed(true);
        fileResult.trashed = true;
        fileResult.status = 'trashed';
        result.trashedCount += 1;
      } else {
        fileResult.status = 'ready';
      }
    } catch (err) {
      fileResult.status = 'error';
      fileResult.error = String(err);
      result.errorCount += 1;
    }
    result.files.push(fileResult);
  });

  return result;
}

function deleteContactDbCleanupRows_(sheet, candidates) {
  var rowNumbers = candidates
    .map(function (candidate) { return Number(candidate.rowNumber); })
    .filter(function (rowNumber, index, rows) {
      return rowNumber > 1 && rows.indexOf(rowNumber) === index;
    })
    .sort(function (a, b) { return b - a; });

  rowNumbers.forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  return rowNumbers;
}

function assertContactDbCleanupOperator_() {
  var email = getActiveUserEmail_();
  var allowedEmails = getViewerEmails_();
  if (!email || allowedEmails.indexOf(email) === -1) {
    throw new Error('問い合わせDB整理は許可ユーザーの Apps Script 実行に限定されています。');
  }
  return email;
}

function assertContactDbCleanupConfirmation_(confirmation) {
  if (String(confirmation || '') !== CONTACT_DB_CLEANUP_CONFIRMATION) {
    throw new Error('問い合わせDB整理の確認フレーズが一致しません。');
  }
}

function getViewerContext_(accessToken) {
  var configuredToken = getViewerAccessToken_();
  var allowed = !!configuredToken && accessToken === configuredToken;
  var email = getActiveUserEmail_();
  return {
    email: email || '確認リンク',
    allowed: allowed,
    authMode: 'token',
    tokenConfigured: !!configuredToken
  };
}

function requireViewer_(accessToken) {
  var context = getViewerContext_(accessToken);
  if (!context.allowed) {
    throw new Error('このお問い合わせ確認アプリを利用する権限がありません。');
  }
  return context;
}

function getActiveUserEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (_err) {
    return '';
  }
}

function getViewerEmails_() {
  return normalizeEmailList_(getProperty_('CONTACT_VIEWER_EMAILS', ''));
}

function getViewerAccessToken_() {
  return String(getProperty_('CONTACT_VIEWER_ACCESS_TOKEN', '') || '').trim();
}

function getRequestToken_(e) {
  return String((e && e.parameter && (e.parameter.token || e.parameter.accessToken)) || '').trim();
}

function getSheet_() {
  return getConfiguredSheet_();
}

function getConfiguredSheet_() {
  var spreadsheetId = getProperty_('SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID が未設定です。');
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = getProperty_('CONTACT_SHEET_NAME', DEFAULT_SHEET_NAME);
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('問い合わせ保存シートが見つかりません。');
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  var current = readHeaders_(sheet);
  var hasAnyHeader = current.some(function (value) { return !!value; });
  if (!hasAnyHeader) {
    ensureSheetColumnCapacity_(sheet, CONTACT_HEADERS.length);
    sheet.getRange(1, 1, 1, CONTACT_HEADERS.length).setValues([CONTACT_HEADERS]);
    return CONTACT_HEADERS.slice();
  }

  var changed = false;
  CONTACT_HEADERS.forEach(function (header) {
    if (current.indexOf(header) === -1) {
      current.push(header);
      changed = true;
    }
  });
  if (changed) {
    ensureSheetColumnCapacity_(sheet, current.length);
    sheet.getRange(1, 1, 1, current.length).setValues([current]);
  }
  return current;
}

function readHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
}

function ensureSheetColumnCapacity_(sheet, requiredColumns) {
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  }
}

function findSubmission_(submissionId, sheet, headers) {
  var targetId = String(submissionId || '').trim();
  if (!targetId) return null;
  sheet = sheet || getSheet_();
  headers = headers || readHeaders_(sheet);
  var timeZone = getCaseTimeZone_(sheet);
  var values = sheet.getDataRange().getValues();
  var idIndex = headers.indexOf('submission_id');
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex]) === targetId) {
      return {
        rowNumber: rowIndex + 1,
        timeZone: timeZone,
        record: rowToRecord_(headers, values[rowIndex], rowIndex + 1, timeZone)
      };
    }
  }
  return null;
}

function rowToRecord_(headers, row, rowNumber, timeZone) {
  var record = { rowNumber: rowNumber };
  headers.forEach(function (header, index) {
    if (!header) return;
    record[header] = header === 'next_followup_at'
      ? normalizeCaseDateCellValue_(row[index], timeZone)
      : normalizeCellValue_(row[index]);
  });
  CONTACT_HEADERS.forEach(function (header) {
    if (record[header] == null) record[header] = '';
  });
  record.attachment_count = Number(record.attachment_count || 0);
  return record;
}

function getCaseTimeZone_(sheet) {
  var timeZone = String(sheet.getParent().getSpreadsheetTimeZone() || '').trim();
  if (!timeZone) throw new Error('Spreadsheetのタイムゾーンを取得できません。');
  return timeZone;
}

function normalizeCaseDateCellValue_(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    if (!timeZone) throw new Error('Spreadsheetのタイムゾーンを指定してください。');
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  return normalizeCaseDate_(value);
}

function toSummary_(record) {
  return {
    submission_id: record.submission_id,
    submitted_at: record.submitted_at,
    contact_type: record.contact_type,
    name: record.name,
    email: record.email,
    subject: record.subject,
    attachment_count: record.attachment_count,
    handled_status: record.handled_status || '未対応',
    assignee_email: record.assignee_email,
    urgency: record.urgency || '中',
    case_category: record.case_category,
    handoff_status: record.handoff_status || 'なし',
    next_followup_at: record.next_followup_at,
    attention_reasons: record.attention_reasons || [],
    handled_by: record.handled_by,
    handled_at: record.handled_at
  };
}

function matchesQuery_(record, query) {
  return [
    record.submission_id,
    record.contact_type,
    record.name,
    record.email,
    record.subject,
    record.message,
    record.assignee_email,
    record.case_category,
    record.urgency,
    record.progress_note,
    record.resolution_summary
  ].join(' ').toLowerCase().indexOf(query) !== -1;
}

function isActiveStatus_(status) {
  return normalizeHandledStatus_(status) !== '対応済み';
}

function normalizeHandledStatus_(status) {
  var normalized = String(status || '').trim();
  return normalized || '未対応';
}

function parseAttachmentRefs_(value) {
  return String(value || '')
    .split(',')
    .map(function (part) { return part.trim(); })
    .filter(Boolean)
    .map(function (part) {
      var separatorIndex = part.indexOf(':');
      return {
        fileId: separatorIndex === -1 ? part : part.slice(0, separatorIndex),
        url: separatorIndex === -1 ? '' : part.slice(separatorIndex + 1)
      };
    });
}

function enrichAttachment_(attachment) {
  try {
    var file = DriveApp.getFileById(attachment.fileId);
    assertAttachmentFile_(file);
    var description = parseJson_(file.getDescription());
    return {
      fileId: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      url: file.getUrl() || attachment.url,
      originalName: description.originalName || '',
      originalMimeType: description.originalMimeType || '',
      originalSize: description.originalSize || ''
    };
  } catch (err) {
    return {
      fileId: attachment.fileId,
      name: attachment.fileId,
      mimeType: '',
      size: '',
      url: attachment.url,
      error: String(err)
    };
  }
}

function assertAttachmentFile_(file) {
  var folderId = getProperty_('DRIVE_FOLDER_ID', '');
  if (!folderId) {
    throw new Error('DRIVE_FOLDER_ID が未設定です。');
  }
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) {
      return;
    }
  }
  throw new Error('添付保存フォルダ外のファイルは表示できません。');
}

function normalizeCellValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString();
  }
  return value == null ? '' : String(value);
}

function parseJson_(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch (_err) {
    return {};
  }
}

function getProperty_(key, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return value == null || value === '' ? fallback : value;
}

function normalizeEmailList_(value) {
  if (Array.isArray(value)) {
    value = value.join(',');
  }
  return String(value || '')
    .split(/[,;\n]+/)
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(function (email, index, emails) {
      return email && emails.indexOf(email) === index;
    });
}

/**
 * SPEED AD support contact viewer.
 *
 * Script Properties:
 *   SPREADSHEET_ID
 *   DRIVE_FOLDER_ID
 *   CONTACT_SHEET_NAME
 *   CONTACT_VIEWER_EMAILS
 *   CONTACT_VIEWER_ACCESS_TOKEN
 */

var DEFAULT_SHEET_NAME = 'contact_submissions';
var VIEWER_STATUSES = ['未対応', '対応中', '対応済み', '保留'];
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
  'internal_note'
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
  var headers = ensureHeaders_(sheet);
  var values = sheet.getDataRange().getValues();
  var records = [];
  var counts = {
    total: 0,
    active: 0
  };

  VIEWER_STATUSES.forEach(function (status) {
    counts[status] = 0;
  });

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var record = rowToRecord_(headers, values[rowIndex], rowIndex + 1);
    record.handled_status = normalizeHandledStatus_(record.handled_status);
    counts.total += 1;
    if (isActiveStatus_(record.handled_status)) {
      counts.active += 1;
    }
    if (counts[record.handled_status] != null) {
      counts[record.handled_status] += 1;
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
    counts: counts,
    submissions: records.slice(0, limit)
  };
}

function getContactSubmission(accessToken, submissionId) {
  requireViewer_(accessToken);
  var match = findSubmission_(submissionId);
  if (!match) {
    throw new Error('問い合わせが見つかりません。');
  }
  match.record.attachments = parseAttachmentRefs_(match.record.attachment_refs).map(enrichAttachment_);
  return {
    ok: true,
    submission: match.record
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
  var context = requireViewer_(accessToken);
  var normalizedStatus = String(status || '').trim();
  if (VIEWER_STATUSES.indexOf(normalizedStatus) === -1) {
    throw new Error('対応ステータスが不正です。');
  }

  var sheet = getSheet_();
  var headers = ensureHeaders_(sheet);
  var match = findSubmission_(submissionId, sheet, headers);
  if (!match) {
    throw new Error('問い合わせが見つかりません。');
  }

  var fields = {
    handled_status: normalizedStatus,
    handled_by: context.email,
    handled_at: new Date().toISOString(),
    internal_note: String(note || '').trim()
  };
  Object.keys(fields).forEach(function (key) {
    var colIndex = headers.indexOf(key);
    if (colIndex !== -1) {
      sheet.getRange(match.rowNumber, colIndex + 1).setValue(fields[key]);
    }
  });

  return getContactSubmission(accessToken, submissionId);
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
  var headers = ensureHeaders_(sheet);
  var values = sheet.getDataRange().getValues();
  var candidates = [];

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var record = rowToRecord_(headers, values[rowIndex], rowIndex + 1);
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
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), CONTACT_HEADERS.length);
  var current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
  var hasAnyHeader = current.some(function (value) { return !!value; });
  if (!hasAnyHeader) {
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
    sheet.getRange(1, 1, 1, current.length).setValues([current]);
  }
  return current;
}

function findSubmission_(submissionId, sheet, headers) {
  var targetId = String(submissionId || '').trim();
  if (!targetId) return null;
  sheet = sheet || getSheet_();
  headers = headers || ensureHeaders_(sheet);
  var values = sheet.getDataRange().getValues();
  var idIndex = headers.indexOf('submission_id');
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex]) === targetId) {
      return {
        rowNumber: rowIndex + 1,
        record: rowToRecord_(headers, values[rowIndex], rowIndex + 1)
      };
    }
  }
  return null;
}

function rowToRecord_(headers, row, rowNumber) {
  var record = { rowNumber: rowNumber };
  headers.forEach(function (header, index) {
    if (!header) return;
    record[header] = normalizeCellValue_(row[index]);
  });
  CONTACT_HEADERS.forEach(function (header) {
    if (record[header] == null) record[header] = '';
  });
  record.attachment_count = Number(record.attachment_count || 0);
  return record;
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
    record.message
  ].join(' ').toLowerCase().indexOf(query) !== -1;
}

function isActiveStatus_(status) {
  return ['未対応', '対応中'].indexOf(normalizeHandledStatus_(status)) !== -1;
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

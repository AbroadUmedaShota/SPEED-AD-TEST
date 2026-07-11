/**
 * SPEED AD support contact form receiver.
 *
 * Web App:
 *   POST { action: "submitContact", payload: {...} }
 *
 * Script Properties:
 *   SPREADSHEET_ID
 *   DRIVE_FOLDER_ID
 *   CONTACT_FROM_EMAIL
 *   CONTACT_REPLY_TO_EMAIL
 *   CONTACT_NOTIFY_EMAIL
 *   CONTACT_SHEET_NAME
 *   CONTACT_MAX_ATTACHMENT_MB
 *   CONTACT_VIEWER_BASE_URL
 *   CONTACT_VIEWER_ACCESS_TOKEN
 *   CONTACT_TEST_MODE_TOKEN
 */

var DEFAULT_SHEET_NAME = 'contact_submissions';
var DEFAULT_FROM_EMAIL = 'customer@speed-ad.com';
var DEFAULT_MAX_ATTACHMENT_MB = 10;
var DEFAULT_SPREADSHEET_TITLE = 'SPEED AD サポートお問い合わせ';
var DEFAULT_ATTACHMENT_FOLDER_NAME = 'SPEED AD サポートお問い合わせ添付';
var TEST_NOTIFY_EMAIL = 's-umeda@abroad-o.com';
var CONTACT_ALLOWED_SOURCE_URL_PREFIXES = [
  'https://support.speed-ad.com/contact/',
  'https://support.speed-ad.com/bug-report/',
  'http://localhost:8000/05_support/contact/',
  'http://localhost:8000/05_support/bug-report/',
  'http://127.0.0.1:8000/05_support/contact/',
  'http://127.0.0.1:8000/05_support/bug-report/'
];
var CONTACT_MIN_FORM_AGE_MS = 2500;
var CONTACT_MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
var CONTACT_MIN_INTERACTION_COUNT = 1;
var CONTACT_BOT_REJECTION_MESSAGE = '送信できませんでした。入力内容をご確認のうえ、数秒おいてから再度お試しください。';
var CONTACT_TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
var CONTACT_TURNSTILE_ACTION = 'contact_submit';
var CONTACT_TURNSTILE_HOSTNAME = 'support.speed-ad.com';
var CONTACT_TYPES = ['general', 'bug', 'billing', 'plan', 'feature', 'other'];
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

function initializeContactSheet() {
  var sheet = getSheet_();
  return logAndReturn_({
    ok: true,
    sheetName: sheet.getName(),
    headerCount: CONTACT_HEADERS.length
  });
}

function initializeContactStorage() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  var driveFolderId = properties.getProperty('DRIVE_FOLDER_ID');

  if (!spreadsheetId) {
    var spreadsheet = SpreadsheetApp.create(DEFAULT_SPREADSHEET_TITLE);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  if (!driveFolderId) {
    var folder = DriveApp.createFolder(DEFAULT_ATTACHMENT_FOLDER_NAME);
    driveFolderId = folder.getId();
    properties.setProperty('DRIVE_FOLDER_ID', driveFolderId);
  }

  setDefaultProperty_('CONTACT_FROM_EMAIL', DEFAULT_FROM_EMAIL);
  setDefaultProperty_('CONTACT_REPLY_TO_EMAIL', DEFAULT_FROM_EMAIL);
  setDefaultProperty_('CONTACT_NOTIFY_EMAIL', DEFAULT_FROM_EMAIL);
  setDefaultProperty_('CONTACT_SHEET_NAME', DEFAULT_SHEET_NAME);
  setDefaultProperty_('CONTACT_MAX_ATTACHMENT_MB', String(DEFAULT_MAX_ATTACHMENT_MB));

  var sheet = getSheet_();
  return logAndReturn_({
    ok: true,
    spreadsheetId: spreadsheetId,
    driveFolderId: driveFolderId,
    sheetName: sheet.getName()
  });
}

function checkContactConfiguration() {
  var result = {
    ok: true,
    spreadsheet: checkSpreadsheet_(),
    driveFolder: checkDriveFolder_(),
    from: getFromState_(),
    notifyEmail: checkNotifyEmails_(),
    replyToEmail: checkOptionalProperty_('CONTACT_REPLY_TO_EMAIL'),
    maxAttachmentMb: getMaxAttachmentMb_(),
    viewerBaseUrl: checkOptionalProperty_('CONTACT_VIEWER_BASE_URL'),
    viewerAccessToken: checkOptionalProperty_('CONTACT_VIEWER_ACCESS_TOKEN'),
    testModeToken: checkOptionalProperty_('CONTACT_TEST_MODE_TOKEN'),
    turnstileSecret: checkOptionalProperty_('CONTACT_TURNSTILE_SECRET')
  };

  result.ok = result.spreadsheet.ok &&
    result.driveFolder.ok &&
    result.notifyEmail.ok &&
    result.turnstileSecret.ok;

  return logAndReturn_(result);
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = String(body.action || '');
    if (action !== 'submitContact') {
      throw new Error('Unknown action: ' + action);
    }
    return submitContact_(body.payload || {});
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function submitContact_(payload) {
  var receivedAt = new Date().toISOString();
  var normalized = normalizePayload_(payload);
  var antiBotSignals = buildAntiBotSignals_(normalized, receivedAt);
  var antiBotDecision = evaluateAntiBotSignals_(antiBotSignals);
  if (antiBotDecision.blocked) {
    logContactSecurityEvent_('reject', normalized, antiBotSignals, antiBotDecision);
    return jsonOut_({
      ok: false,
      code: 'bot_rejected',
      error: CONTACT_BOT_REJECTION_MESSAGE
    });
  }

  var turnstileResult = verifyTurnstile_(normalized);
  if (!turnstileResult.ok) {
    logContactSecurityEvent_('reject', normalized, antiBotSignals, turnstileResult);
    return jsonOut_({
      ok: false,
      code: 'turnstile_rejected',
      error: CONTACT_BOT_REJECTION_MESSAGE
    });
  }

  validateAttachments_(normalized.attachments);
  var attachmentRefs = saveAttachments_(normalized.submissionId, normalized.attachments);
  var row = buildRow_(normalized, receivedAt, attachmentRefs, 'stored', 'pending');
  var sheetLink = appendRow_(row);

  var fromState = getFromState_();
  try {
    sendInternalNotification_(normalized, attachmentRefs, sheetLink, fromState);
    sendUserReceipt_(normalized, fromState);
    updateSubmission_(normalized.submissionId, {
      mail_status: 'sent'
    });
    return jsonOut_({
      ok: true,
      submissionId: normalized.submissionId,
      receivedAt: receivedAt,
      storageStatus: 'stored',
      mailStatus: 'sent'
    });
  } catch (err) {
    updateSubmission_(normalized.submissionId, {
      mail_status: 'failed_send'
    });
    return jsonOut_({
      ok: false,
      submissionId: normalized.submissionId,
      receivedAt: receivedAt,
      storageStatus: 'stored',
      mailStatus: 'failed_send',
      error: String(err)
    });
  }
}

function normalizePayload_(payload) {
  var contactType = String(payload.contactType || '').trim();
  var email = String(payload.email || '').trim();
  var message = String(payload.message || '').trim();
  var privacyConsent = payload.privacyConsent === true;
  var testMode = validateTestMode_(payload);

  if (CONTACT_TYPES.indexOf(contactType) === -1) {
    throw new Error('問い合わせ種別を選択してください。');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('メールアドレスをご確認ください。');
  }
  if (!message) {
    throw new Error('お問い合わせ内容をご入力ください。');
  }
  if (!privacyConsent) {
    throw new Error('個人情報の取り扱いへの同意が必要です。');
  }

  var attachments = payload.attachments || [];
  if (!Array.isArray(attachments)) attachments = [];

  return {
    submissionId: Utilities.getUuid(),
    contactType: contactType,
    contactTypeLabel: String(payload.contactTypeLabel || contactType).trim(),
    name: String(payload.name || '').trim(),
    email: email,
    subject: String(payload.subject || '').trim() || 'お問い合わせ',
    message: message,
    attachments: attachments,
    sourceUrl: sanitizeSourceUrl_(payload.sourceUrl),
    userAgent: String(payload.userAgent || '').trim(),
    testMode: testMode.enabled,
    honeypot: String(payload.honeypot || payload.website || '').trim(),
    formLoadedAt: normalizePositiveInteger_(payload.formLoadedAt, 0),
    formSubmittedAt: normalizePositiveInteger_(payload.formSubmittedAt, 0),
    formElapsedMs: normalizePositiveInteger_(payload.formElapsedMs, 0),
    formInteractionCount: normalizePositiveInteger_(payload.formInteractionCount, 0),
    turnstileToken: String(payload.turnstileToken || '').trim(),
    turnstileAction: String(payload.turnstileAction || '').trim(),
    turnstileHostname: String(payload.turnstileHostname || '').trim()
  };
}

function validateTestMode_(payload) {
  var enabled = payload.testMode === true || String(payload.testMode || '').toLowerCase() === 'true';
  if (!enabled) {
    return { enabled: false };
  }

  var expectedToken = String(getProperty_('CONTACT_TEST_MODE_TOKEN', '') || '').trim();
  var actualToken = String(payload.testModeToken || '').trim();
  if (!expectedToken) {
    throw new Error('CONTACT_TEST_MODE_TOKEN is not set.');
  }
  if (!actualToken || actualToken !== expectedToken) {
    throw new Error('テストモードトークンが不正です。');
  }
  return { enabled: true };
}

function sanitizeSourceUrl_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var hashParts = raw.split('#');
  var withoutHash = hashParts.shift();
  var hash = hashParts.join('#');
  var queryParts = withoutHash.split('?');
  var base = queryParts.shift();
  var query = queryParts.join('?');
  var sanitizedQuery = stripContactTestParams_(query);
  var sanitizedHash = stripContactTestParams_(hash);
  return base +
    (sanitizedQuery ? '?' + sanitizedQuery : '') +
    (sanitizedHash ? '#' + sanitizedHash : '');
}

function buildAntiBotSignals_(normalized, receivedAt) {
  var formLoadedAt = normalized.formLoadedAt;
  var formSubmittedAt = normalized.formSubmittedAt;
  var elapsedMs = normalized.formElapsedMs;
  if (!elapsedMs && formLoadedAt && formSubmittedAt) {
    elapsedMs = Math.max(0, formSubmittedAt - formLoadedAt);
  }

  return {
    honeypot: normalized.honeypot,
    sourceUrl: normalized.sourceUrl,
    userAgent: normalized.userAgent,
    elapsedMs: elapsedMs,
    formLoadedAt: formLoadedAt,
    formSubmittedAt: formSubmittedAt,
    interactionCount: normalized.formInteractionCount,
    receivedAt: receivedAt
  };
}

function evaluateAntiBotSignals_(signals) {
  if (signals.honeypot) {
    return {
      blocked: true,
      reasonCode: 'honeypot_filled'
    };
  }
  if (!isAllowedSourceUrl_(signals.sourceUrl)) {
    return {
      blocked: true,
      reasonCode: 'invalid_source_url'
    };
  }
  if (!signals.userAgent) {
    return {
      blocked: true,
      reasonCode: 'missing_user_agent'
    };
  }
  if (!signals.elapsedMs || signals.elapsedMs < CONTACT_MIN_FORM_AGE_MS) {
    return {
      blocked: true,
      reasonCode: 'submitted_too_fast'
    };
  }
  if (signals.elapsedMs > CONTACT_MAX_FORM_AGE_MS) {
    return {
      blocked: true,
      reasonCode: 'submission_too_old'
    };
  }
  if (signals.interactionCount < CONTACT_MIN_INTERACTION_COUNT) {
    return {
      blocked: true,
      reasonCode: 'no_interaction'
    };
  }
  return {
    blocked: false,
    reasonCode: ''
  };
}

function verifyTurnstile_(normalized) {
  var secret = String(getProperty_('CONTACT_TURNSTILE_SECRET', '') || '').trim();
  if (!secret) {
    return {
      ok: false,
      reasonCode: 'turnstile_secret_missing'
    };
  }
  var token = String(normalized.turnstileToken || '').trim();
  if (!token) {
    return {
      ok: false,
      reasonCode: 'turnstile_token_missing'
    };
  }
  if (String(normalized.turnstileAction || '').trim() !== CONTACT_TURNSTILE_ACTION) {
    return {
      ok: false,
      reasonCode: 'turnstile_action_invalid'
    };
  }

  var payload = {
    secret: secret,
    response: token
  };
  var response;
  try {
    response = UrlFetchApp.fetch(CONTACT_TURNSTILE_VERIFY_URL, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (_err) {
    return {
      ok: false,
      reasonCode: 'turnstile_verify_fetch_failed'
    };
  }

  var parsed = null;
  try {
    parsed = JSON.parse(response.getContentText() || '{}');
  } catch (_parseErr) {
    return {
      ok: false,
      reasonCode: 'turnstile_verify_parse_failed'
    };
  }

  if (!parsed || parsed.success !== true) {
    return {
      ok: false,
      reasonCode: 'turnstile_verify_failed',
      errorCodes: parsed && parsed['error-codes'] ? parsed['error-codes'] : []
    };
  }
  if (String(parsed.action || '').trim() !== CONTACT_TURNSTILE_ACTION) {
    return {
      ok: false,
      reasonCode: 'turnstile_action_mismatch'
    };
  }
  if (String(parsed.hostname || '').trim() !== CONTACT_TURNSTILE_HOSTNAME) {
    return {
      ok: false,
      reasonCode: 'turnstile_hostname_mismatch'
    };
  }

  return {
    ok: true,
    reasonCode: ''
  };
}

function isAllowedSourceUrl_(sourceUrl) {
  return CONTACT_ALLOWED_SOURCE_URL_PREFIXES.some(function (prefix) {
    return String(sourceUrl || '').indexOf(prefix) === 0;
  });
}

function normalizePositiveInteger_(value, fallback) {
  var parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  var fallbackParsed = Number(fallback || 0);
  return Number.isFinite(fallbackParsed) && fallbackParsed >= 0 ? Math.floor(fallbackParsed) : 0;
}

function logContactSecurityEvent_(action, normalized, signals, decision) {
  Logger.log(JSON.stringify({
    event: 'contact_security',
    action: action,
    submissionId: normalized.submissionId || '',
    contactType: normalized.contactType || '',
    reasonCode: decision && decision.reasonCode ? decision.reasonCode : '',
    elapsedMs: signals && typeof signals.elapsedMs === 'number' ? signals.elapsedMs : 0,
    interactionCount: signals && typeof signals.interactionCount === 'number' ? signals.interactionCount : 0,
    sourceHost: getUrlHost_(signals && signals.sourceUrl ? signals.sourceUrl : ''),
    sourcePath: getUrlPath_(signals && signals.sourceUrl ? signals.sourceUrl : ''),
    turnstileAction: normalized.turnstileAction || '',
    turnstileHostname: normalized.turnstileHostname || '',
    attachmentCount: normalized.attachments ? normalized.attachments.length : 0,
    testMode: !!normalized.testMode
  }));
}

function getUrlHost_(value) {
  try {
    var raw = String(value || '');
    var match = raw.match(/^[a-z]+:\/\/([^\/?#]+)/i);
    return match ? match[1] : '';
  } catch (_err) {
    return '';
  }
}

function getUrlPath_(value) {
  try {
    var raw = String(value || '');
    var withoutScheme = raw.replace(/^[a-z]+:\/\/[^\/?#]+/i, '');
    var path = withoutScheme.split(/[?#]/)[0];
    return path || '';
  } catch (_err) {
    return '';
  }
}

function stripContactTestParams_(value) {
  if (!value) return '';
  var blocked = {
    contactTestMode: true,
    contactTestToken: true,
    testMode: true,
    testModeToken: true
  };
  return String(value).split('&').filter(function (part) {
    var key = String(part || '').split('=')[0];
    try {
      key = decodeURIComponent(key);
    } catch (_err) {
      // Keep the raw key when decoding fails.
    }
    return !blocked[key];
  }).join('&');
}

function validateAttachments_(attachments) {
  var maxBytes = getMaxAttachmentMb_() * 1024 * 1024;
  attachments.forEach(function (attachment) {
    var name = String(attachment.name || '').trim();
    var mimeType = String(attachment.mimeType || '').trim();
    var size = Number(attachment.size || 0);
    var data = String(attachment.data || '');
    if (!name || !mimeType || !data) {
      throw new Error('添付ファイルの内容を確認できません。');
    }
    if (mimeType.indexOf('image/') !== 0) {
      throw new Error(name + ' は画像ファイルではありません。');
    }
    if (size > maxBytes) {
      throw new Error(name + ' は添付上限を超えています。');
    }
  });
}

function saveAttachments_(submissionId, attachments) {
  if (!attachments.length) return [];
  var folderId = getProperty_('DRIVE_FOLDER_ID', '');
  if (!folderId) {
    throw new Error('DRIVE_FOLDER_ID が未設定のため添付ファイルを保存できません。');
  }
  var folder = DriveApp.getFolderById(folderId);
  return attachments.map(function (attachment, index) {
    var bytes = Utilities.base64Decode(String(attachment.data || ''));
    var safeName = sanitizeFilename_(submissionId + '-' + (index + 1) + '-' + attachment.name);
    var blob = Utilities.newBlob(bytes, attachment.mimeType, safeName);
    var file = folder.createFile(blob);
    file.setDescription(JSON.stringify({
      originalName: String(attachment.originalName || attachment.name || ''),
      originalMimeType: String(attachment.originalMimeType || ''),
      originalSize: Number(attachment.originalSize || 0),
      savedMimeType: String(attachment.mimeType || ''),
      savedSize: Number(attachment.size || 0)
    }));
    return file.getId() + ':' + file.getUrl();
  });
}

function buildRow_(payload, receivedAt, attachmentRefs, storageStatus, mailStatus) {
  return {
    submission_id: payload.submissionId,
    submitted_at: receivedAt,
    contact_type: payload.contactType,
    name: payload.name,
    email: payload.email,
    subject: payload.subject,
    message: payload.message,
    attachment_count: attachmentRefs.length,
    attachment_refs: attachmentRefs.join(','),
    source_url: payload.sourceUrl,
    user_agent: payload.userAgent,
    storage_status: storageStatus,
    mail_status: mailStatus,
    handled_status: '未対応',
    handled_by: '',
    handled_at: '',
    internal_note: ''
  };
}

function sendUserReceipt_(payload, fromState) {
  var fromEmail = getProperty_('CONTACT_FROM_EMAIL', DEFAULT_FROM_EMAIL);
  var replyTo = payload.testMode ? TEST_NOTIFY_EMAIL : getProperty_('CONTACT_REPLY_TO_EMAIL', fromEmail);
  var subjectPrefix = payload.testMode ? '【TEST】' : '';
  var subject = subjectPrefix + '【SPEED AD】お問い合わせを受け付けました';
  var lines = [
    payload.name ? payload.name + ' 様' : 'SPEED AD ご利用者様',
    '',
    'SPEED AD サポートへのお問い合わせを受け付けました。',
    '内容を確認のうえ、2〜3営業日以内に担当者よりご返信いたします。',
    ''
  ];
  if (payload.testMode) {
    lines = lines.concat([
      '※テストモードのため、この受付メールは梅田さんのみに送信しています。',
      '入力メールアドレス: ' + payload.email,
      ''
    ]);
  }
  var body = lines.concat([
    '--- お問い合わせ内容 ---',
    '受付ID: ' + payload.submissionId,
    '問い合わせ種別: ' + payload.contactTypeLabel,
    '件名: ' + payload.subject,
    '',
    payload.message,
    '',
    '------------------------',
    'SPEED AD Support'
  ]).join('\n');

  sendEmail_(getUserReceiptEmail_(payload), subject, body, fromEmail, replyTo, fromState);
}

function sendInternalNotification_(payload, attachmentRefs, sheetLink, fromState) {
  var fromEmail = getProperty_('CONTACT_FROM_EMAIL', DEFAULT_FROM_EMAIL);
  var notifyEmails = getInternalNotifyEmails_(payload);
  var viewerDetailUrl = buildViewerDetailUrl_(payload.submissionId);
  var subjectPrefix = payload.testMode ? '【TEST】【SPEED AD】' : '【SPEED AD】';
  var subject = subjectPrefix + 'お問い合わせ: [' + payload.contactTypeLabel + '] ' + payload.subject;
  var body = [
    payload.testMode
      ? 'SPEED AD サポート問い合わせのテスト投稿を受け付けました。メール通知は梅田さんのみに送信しています。'
      : 'SPEED AD サポート問い合わせを受け付けました。',
    '',
    '確認アプリ: ' + (viewerDetailUrl || 'CONTACT_VIEWER_BASE_URL 未設定'),
    '',
    '受付ID: ' + payload.submissionId,
    '問い合わせ種別: ' + payload.contactTypeLabel + ' (' + payload.contactType + ')',
    'お名前: ' + (payload.name || '-'),
    'メールアドレス: ' + payload.email,
    '件名: ' + payload.subject,
    '投稿元URL: ' + (payload.sourceUrl || '-'),
    '',
    '--- 本文 ---',
    payload.message,
    '',
    '--- 予備情報 ---',
    'Spreadsheet: ' + sheetLink.spreadsheetUrl,
    '該当行: ' + sheetLink.rowUrl,
    'シート: ' + sheetLink.sheetName + ' / ' + sheetLink.rowNumber + '行目',
    '添付: ' + (attachmentRefs.length ? attachmentRefs.join('\n') : '-')
  ].join('\n');

  sendEmail_(notifyEmails, subject, body, fromEmail, payload.testMode ? TEST_NOTIFY_EMAIL : payload.email, fromState);
}

function getInternalNotifyEmails_(payload) {
  return payload && payload.testMode ? [TEST_NOTIFY_EMAIL] : getNotifyEmails_();
}

function getUserReceiptEmail_(payload) {
  return payload && payload.testMode ? TEST_NOTIFY_EMAIL : payload.email;
}

function buildViewerDetailUrl_(submissionId) {
  var baseUrl = String(getProperty_('CONTACT_VIEWER_BASE_URL', '') || '').trim();
  if (!baseUrl) return '';
  var separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
  var token = String(getProperty_('CONTACT_VIEWER_ACCESS_TOKEN', '') || '').trim();
  var url = baseUrl + separator + 'id=' + encodeURIComponent(submissionId);
  if (token) {
    url += '#token=' + encodeURIComponent(token);
  }
  return url;
}

function sendEmail_(to, subject, body, fromEmail, replyTo, fromState) {
  var options = {
    name: 'SPEED AD Support',
    replyTo: replyTo
  };
  // If the configured From is not available as the executing user or an alias,
  // Gmail sends from the executing account while preserving Reply-To.
  if (fromState.mode === 'alias') {
    options.from = fromEmail;
  }
  GmailApp.sendEmail(normalizeEmailList_(to).join(','), subject, body, options);
}

function getFromState_() {
  var fromEmail = getProperty_('CONTACT_FROM_EMAIL', DEFAULT_FROM_EMAIL).toLowerCase();
  var effectiveUser = '';
  try {
    effectiveUser = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  } catch (_err) {
    effectiveUser = '';
  }
  if (effectiveUser === fromEmail) {
    return { available: true, mode: 'primary' };
  }

  var aliases = GmailApp.getAliases().map(function (alias) {
    return String(alias || '').toLowerCase();
  });
  if (aliases.indexOf(fromEmail) !== -1) {
    return { available: true, mode: 'alias' };
  }
  return { available: false, mode: 'unavailable' };
}

function checkSpreadsheet_() {
  var spreadsheetId = getProperty_('SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    return { ok: false, error: 'SPREADSHEET_ID is not set' };
  }
  try {
    var sheet = getSheet_();
    return { ok: true, spreadsheetId: spreadsheetId, sheetName: sheet.getName() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function checkDriveFolder_() {
  var folderId = getProperty_('DRIVE_FOLDER_ID', '');
  if (!folderId) {
    return { ok: false, error: 'DRIVE_FOLDER_ID is not set' };
  }
  try {
    var folder = DriveApp.getFolderById(folderId);
    return { ok: true, driveFolderId: folderId, folderName: folder.getName() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function checkRequiredProperty_(key) {
  var value = getProperty_(key, '');
  return value ? { ok: true, set: true } : { ok: false, set: false, error: key + ' is not set' };
}

function checkNotifyEmails_() {
  var emails = normalizeEmailList_(getProperty_('CONTACT_NOTIFY_EMAIL', ''));
  if (!emails.length) {
    return { ok: false, set: false, count: 0, error: 'CONTACT_NOTIFY_EMAIL is not set' };
  }
  return { ok: true, set: true, count: emails.length };
}

function checkOptionalProperty_(key) {
  var value = getProperty_(key, '');
  return { ok: true, set: !!value };
}

function appendRow_(row) {
  var sheet = getSheet_();
  var values = CONTACT_HEADERS.map(function (header) {
    return row[header] == null ? '' : row[header];
  });
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, CONTACT_HEADERS.length).setValues([values]);
  var spreadsheet = sheet.getParent();
  return {
    spreadsheetUrl: spreadsheet.getUrl(),
    sheetName: sheet.getName(),
    rowNumber: rowNumber,
    rowUrl: spreadsheet.getUrl() + '#gid=' + sheet.getSheetId() + '&range=A' + rowNumber
  };
}

function updateSubmission_(submissionId, fields) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var idIndex = CONTACT_HEADERS.indexOf('submission_id');
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex]) === submissionId) {
      Object.keys(fields).forEach(function (key) {
        var colIndex = CONTACT_HEADERS.indexOf(key);
        if (colIndex !== -1) {
          sheet.getRange(rowIndex + 1, colIndex + 1).setValue(fields[key]);
        }
      });
      return;
    }
  }
}

function getSheet_() {
  var spreadsheetId = getProperty_('SPREADSHEET_ID', '');
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID が未設定です。');
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = getProperty_('CONTACT_SHEET_NAME', DEFAULT_SHEET_NAME);
  var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  var current = sheet.getRange(1, 1, 1, CONTACT_HEADERS.length).getValues()[0];
  var needsHeader = CONTACT_HEADERS.some(function (header, index) {
    return current[index] !== header;
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, CONTACT_HEADERS.length).setValues([CONTACT_HEADERS]);
  }
}

function getMaxAttachmentMb_() {
  var value = Number(getProperty_('CONTACT_MAX_ATTACHMENT_MB', DEFAULT_MAX_ATTACHMENT_MB));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_ATTACHMENT_MB;
}

function getProperty_(key, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return value == null || value === '' ? fallback : value;
}

function getNotifyEmails_() {
  return normalizeEmailList_(getProperty_('CONTACT_NOTIFY_EMAIL', DEFAULT_FROM_EMAIL));
}

function normalizeEmailList_(value) {
  if (Array.isArray(value)) {
    value = value.join(',');
  }
  return String(value || '')
    .split(/[,;\n]+/)
    .map(function (email) {
      return email.trim();
    })
    .filter(function (email, index, emails) {
      return email && emails.indexOf(email) === index;
    });
}

function setContactNotifyEmail(value) {
  var emails = normalizeEmailList_(value);
  if (!emails.length) {
    throw new Error('CONTACT_NOTIFY_EMAIL requires at least one email address.');
  }
  PropertiesService.getScriptProperties().setProperty('CONTACT_NOTIFY_EMAIL', emails.join(','));
  return logAndReturn_({
    ok: true,
    contactNotifyEmailCount: emails.length
  });
}

function setContactTestModeToken(value) {
  var token = String(value || '').trim();
  if (!token) {
    throw new Error('CONTACT_TEST_MODE_TOKEN requires a non-empty token.');
  }
  PropertiesService.getScriptProperties().setProperty('CONTACT_TEST_MODE_TOKEN', token);
  return logAndReturn_({
    ok: true,
    contactTestModeTokenSet: true
  });
}

function setDefaultProperty_(key, value) {
  var properties = PropertiesService.getScriptProperties();
  var current = properties.getProperty(key);
  if (current == null || current === '') {
    properties.setProperty(key, value);
  }
}

function sanitizeFilename_(name) {
  return String(name || 'attachment').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logAndReturn_(obj) {
  Logger.log(JSON.stringify(obj));
  return obj;
}

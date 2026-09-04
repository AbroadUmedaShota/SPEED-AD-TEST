import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const CONTACT_FORM_HELPERS = '05_support/assets/js/contact-attachment-utils.js';
const CONTACT_FORM_UTILS = '05_support/assets/js/contact-form-utils.js';
const CONTACT_FORM_SCRIPT = '05_support/assets/js/contact-form.js';
const CONTACT_FORM_HTML = '05_support/contact/index.html';
const CONTACT_PRIVACY_HTML = '05_support/privacy/index.html';
const PUBLIC_GAS_CODE = '99_backend-docs/10_support-contact/gas/Code.gs';
const VIEWER_GAS_CODE = '99_backend-docs/10_support-contact/viewer-gas/Code.gs';
const VIEWER_GAS_HTML = '99_backend-docs/10_support-contact/viewer-gas/Index.html';
const VIEWER_GAS_MANIFEST = '99_backend-docs/10_support-contact/viewer-gas/appsscript.json';
const VIEWER_CASE_FIXTURES = 'tests/fixtures/support-contact-cs-cases.json';

async function importLocalModule(path) {
  const source = await readFile(path, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadViewerTestHelpers() {
  const html = await readFile(VIEWER_GAS_HTML, 'utf8');
  const match = html.match(/\/\* CONTACT_VIEWER_TEST_HELPERS_START \*\/([\s\S]*?)\/\* CONTACT_VIEWER_TEST_HELPERS_END \*\//);
  assert.ok(match, 'viewer test helpers block not found');
  const sandbox = {
    window: {},
    URL,
    URLSearchParams,
    Array,
    Object,
    String,
    Number,
    Math,
    Date,
  };
  vm.runInNewContext(match[1], sandbox);
  return sandbox.window.__CONTACT_VIEWER_TEST__;
}

async function loadViewerCaseHelpers() {
  const code = await readFile(VIEWER_GAS_CODE, 'utf8');
  const sandbox = {
    Object,
    String,
    Number,
    Array,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
    Utilities: {
      formatDate: (date, timeZone, format) => {
        assert.equal(format, 'yyyy-MM-dd');
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(date);
        return ['year', 'month', 'day'].map((key) => parts.find((part) => part.type === key).value).join('-');
      },
    },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

async function loadGasGlobals(path) {
  const code = await readFile(path, 'utf8');
  const sandbox = {
    Object,
    String,
    Number,
    Array,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
  };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

test('support contact attachment helpers produce WEBP payload metadata', async () => {
  const helpers = await importLocalModule(CONTACT_FORM_HELPERS);
  const blob = new Blob(['webp-bytes'], { type: 'image/webp' });
  const file = { name: 'sample.capture.png', type: 'image/png', size: 14 };

  assert.equal(helpers.normalizeWebpQuality(undefined), 0.82);
  assert.equal(helpers.normalizeWebpQuality('0.72'), 0.72);
  assert.equal(helpers.normalizeWebpQuality('1.4'), 0.82);
  assert.equal(helpers.toWebpFilename('sample.capture.png'), 'sample.capture.webp');
  assert.equal(helpers.toWebpFilename(''), 'attachment.webp');

  assert.deepEqual(
    helpers.buildWebpAttachmentPayload({ file, webpBlob: blob, base64: 'abc123' }),
    {
      name: 'sample.capture.webp',
      mimeType: 'image/webp',
      size: blob.size,
      data: 'abc123',
      originalName: 'sample.capture.png',
      originalMimeType: 'image/png',
      originalSize: file.size,
    }
  );
});

test('support contact form test mode URL helpers protect test tokens', async () => {
  const helpers = await importLocalModule(CONTACT_FORM_UTILS);

  assert.deepEqual(
    helpers.getContactTestModeFromUrl('https://support.speed-ad.com/contact/?foo=bar#contactTestMode=1&contactTestToken=secret'),
    {
      enabled: true,
      token: 'secret',
      cleanedUrl: 'https://support.speed-ad.com/contact/?foo=bar',
    }
  );
  assert.deepEqual(
    helpers.getContactTestModeFromUrl('https://support.speed-ad.com/contact/?contactTestMode=true&contactTestToken=query-secret&foo=bar#section=1'),
    {
      enabled: true,
      token: 'query-secret',
      cleanedUrl: 'https://support.speed-ad.com/contact/?foo=bar#section=1',
    }
  );
  assert.deepEqual(
    helpers.getContactTestModeFromUrl('https://support.speed-ad.com/contact/#contactTestMode=0&contactTestToken=secret'),
    {
      enabled: false,
      token: '',
      cleanedUrl: 'https://support.speed-ad.com/contact/',
    }
  );
  assert.deepEqual(
    helpers.buildContactAntiBotSignals({
      honeypotValue: '  hidden  ',
      formLoadedAt: 1000,
      submittedAt: 5000,
      interactionCount: 2,
      sourceUrl: 'https://support.speed-ad.com/contact/',
    }),
    {
      honeypotValue: 'hidden',
      formLoadedAt: 1000,
      submittedAt: 5000,
      elapsedMs: 4000,
      interactionCount: 2,
      sourceUrl: 'https://support.speed-ad.com/contact/',
    }
  );
  assert.deepEqual(
    helpers.evaluateContactSubmissionSignals({
      honeypotValue: '',
      elapsedMs: 1200,
      interactionCount: 0,
      sourceUrl: 'https://support.speed-ad.com/contact/',
    }),
    {
      blocked: true,
      reasonCode: 'submitted_too_fast',
      reason: 'submission elapsed time is too short',
    }
  );
  assert.deepEqual(
    helpers.evaluateContactSubmissionSignals({
      honeypotValue: '',
      elapsedMs: 4200,
      interactionCount: 1,
      sourceUrl: 'https://support.speed-ad.com/contact/',
    }),
    {
      blocked: false,
      reasonCode: '',
      reason: '',
    }
  );
  assert.equal(helpers.TURNSTILE_ACTION, 'contact_submit');
  assert.equal(helpers.TURNSTILE_HOSTNAME, 'support.speed-ad.com');
  assert.equal(
    helpers.buildTurnstileSubmissionPayload('token-123', 'site-key-123').turnstileAction,
    'contact_submit'
  );
  assert.equal(
    helpers.buildTurnstileSubmissionPayload('token-123', 'site-key-123').turnstileHostname,
    'support.speed-ad.com'
  );
  assert.equal(
    helpers.buildTurnstileSubmissionPayload('token-123', 'site-key-123').turnstileSiteKey,
    'site-key-123'
  );
});

test('public support contact GAS advertises viewer detail links', async () => {
  const [code, formScript] = await Promise.all([
    readFile(PUBLIC_GAS_CODE, 'utf8'),
    readFile(CONTACT_FORM_SCRIPT, 'utf8'),
  ]);
  const [html, privacyHtml] = await Promise.all([
    readFile(CONTACT_FORM_HTML, 'utf8'),
    readFile(CONTACT_PRIVACY_HTML, 'utf8'),
  ]);

  assert.match(code, /CONTACT_VIEWER_BASE_URL/);
  assert.match(code, /CONTACT_VIEWER_ACCESS_TOKEN/);
  assert.match(code, /CONTACT_TEST_MODE_TOKEN/);
  assert.match(code, /TEST_NOTIFY_EMAIL = 's-umeda@abroad-o\.com'/);
  assert.match(code, /CONTACT_ALLOWED_SOURCE_URL_PREFIXES/);
  assert.match(code, /CONTACT_MIN_FORM_AGE_MS = 2500/);
  assert.match(code, /CONTACT_MIN_INTERACTION_COUNT = 1/);
  assert.match(code, /CONTACT_BOT_REJECTION_MESSAGE/);
  assert.match(code, /CONTACT_TURNSTILE_VERIFY_URL/);
  assert.match(code, /CONTACT_TURNSTILE_ACTION = 'contact_submit'/);
  assert.match(code, /CONTACT_TURNSTILE_HOSTNAME = 'support.speed-ad.com'/);
  assert.match(code, /function validateTestMode_/);
  assert.match(code, /function setContactTestModeToken/);
  assert.match(code, /throw new Error\('テストモードトークンが不正です。'\)/);
  assert.match(code, /function buildAntiBotSignals_/);
  assert.match(code, /function evaluateAntiBotSignals_/);
  assert.match(code, /function verifyTurnstile_/);
  assert.match(code, /function isAllowedSourceUrl_/);
  assert.match(code, /function normalizePositiveInteger_/);
  assert.match(code, /function logContactSecurityEvent_/);
  assert.match(code, /CONTACT_TURNSTILE_SECRET/);
  assert.match(code, /turnstileAction/);
  assert.match(code, /turnstileHostname/);
  assert.match(code, /function getInternalNotifyEmails_/);
  assert.match(code, /payload && payload\.testMode \? \[TEST_NOTIFY_EMAIL\] : getNotifyEmails_\(\)/);
  assert.match(code, /function getUserReceiptEmail_/);
  assert.match(code, /payload && payload\.testMode \? TEST_NOTIFY_EMAIL : payload\.email/);
  assert.match(code, /この受付メールは梅田さんのみに送信しています。/);
  assert.match(code, /function sanitizeSourceUrl_/);
  assert.match(code, /function buildViewerDetailUrl_/);
  assert.match(code, /#token=/);
  assert.doesNotMatch(code, /[&?]token=/);
  assert.match(code, /確認アプリ/);
  assert.match(code, /【TEST】/);
  assert.match(code, /handled_by/);
  assert.match(code, /internal_note/);
  assert.match(code, /honeypot/);
  assert.match(code, /formLoadedAt/);
  assert.match(code, /formSubmittedAt/);
  assert.match(code, /formInteractionCount/);
  assert.match(code, /turnstileToken/);
  assert.match(code, /turnstileAction/);
  assert.match(code, /bot_rejected/);
  assert.match(code, /turnstile_rejected/);
  assert.match(code, /送信できませんでした。入力内容をご確認のうえ、数秒おいてから再度お試しください。/);
  assert.match(formScript, /getContactTestModeFromUrl/);
  assert.match(formScript, /TEST_MODE_MISSING_TOKEN_MESSAGE/);
  assert.match(formScript, /TEST_MODE_REJECTED_MESSAGE/);
  assert.match(formScript, /buildContactAntiBotSignals/);
  assert.match(formScript, /buildTurnstileSubmissionPayload/);
  assert.match(formScript, /getTurnstileSiteKey/);
  assert.match(formScript, /TURNSTILE_SCRIPT_SRC/);
  assert.match(formScript, /TURNSTILE_FALLBACK_MESSAGE/);
  assert.match(formScript, /TURNSTILE_FALLBACK_CONTACT/);
  assert.match(formScript, /TURNSTILE_ACTION/);
  assert.match(formScript, /function validateTestModeBeforeSubmit/);
  assert.match(formScript, /submit\.disabled = isProcessingFiles \|\| isSubmitting \|\| isTestModeTokenMissing\(\)/);
  assert.match(formScript, /テストモードURLが不完全です。/);
  assert.match(formScript, /testModeToken = testModeState\.token|payload\.testModeToken = testModeState\.token/);
  assert.match(formScript, /sourceUrl: window\.location\.href/);
  assert.match(formScript, /formLoadedAtEl/);
  assert.match(formScript, /formInteractionCount/);
  assert.match(formScript, /honeypotEl/);
  assert.match(formScript, /contactAntiBot/);
  assert.match(formScript, /formElapsedMs/);
  assert.match(formScript, /turnstileSiteKeyEl/);
  assert.match(formScript, /turnstileContainer/);
  assert.match(formScript, /turnstileTokenEl/);
  assert.match(formScript, /turnstileUnavailable/);
  assert.match(formScript, /ensureTurnstileScript/);
  assert.match(formScript, /renderTurnstileWidget/);
  assert.match(formScript, /setTurnstileUnavailable/);
  assert.match(html, /name="website"/);
  assert.match(html, /name="formLoadedAt"/);
  assert.match(html, /name="formInteractionCount"/);
  assert.match(html, /name="turnstileToken"/);
  assert.match(html, /name="turnstileAction"/);
  assert.match(html, /name="turnstileSitekey"/);
  assert.match(html, /contactTurnstileWidget/);
  assert.match(html, /contactTurnstileNotice/);
  assert.match(html, /contactTurnstileFallback/);
  assert.match(html, /contactTurnstileError/);
  assert.match(html, /data-turnstile-sitekey/);
  assert.match(html, /challenges\.cloudflare\.com/);
  assert.doesNotMatch(html, /onload="this\.rel='stylesheet'"/);
  assert.match(privacyHtml, /お問い合わせフォームで利用する外部サービス/);
  assert.match(privacyHtml, /Cloudflare Turnstile/);
  assert.match(privacyHtml, /氏名、メールアドレス、件名、本文、添付ファイルはCloudflare Turnstileへ送信しません。/);
  assert.match(privacyHtml, /Google Workspace/);
});

test('support contact viewer GAS is token-gated and updates status', async () => {
  const [code, html, manifestText] = await Promise.all([
    readFile(VIEWER_GAS_CODE, 'utf8'),
    readFile(VIEWER_GAS_HTML, 'utf8'),
    readFile(VIEWER_GAS_MANIFEST, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.match(code, /CONTACT_VIEWER_EMAILS/);
  assert.match(code, /CONTACT_VIEWER_ACCESS_TOKEN/);
  assert.match(code, /function doGet/);
  assert.match(code, /function listContactSubmissions/);
  assert.match(code, /function getContactSubmission/);
  assert.match(code, /function getAttachmentPreview/);
  assert.match(code, /function updateContactSubmissionStatus/);
  assert.match(code, /function updateContactCase/);
  assert.match(code, /CONTACT_CASE_EVENT_SHEET_NAME = 'contact_case_events'/);
  assert.match(code, /function appendContactCaseEvents_/);
  assert.match(code, /function validateCaseClose_/);
  assert.match(code, /function getCaseAttentionReasons_/);
  assert.match(code, /function findExistingCaseRequest_/);
  assert.match(code, /function restoreContactCaseRow_/);
  assert.match(code, /expected_handled_at/);
  assert.match(code, /request_id/);
  assert.match(code, /CONTACT_UNHANDLED_STALE_HOURS/);
  assert.match(code, /function previewContactCaseSchemaMigration/);
  assert.match(code, /function executeContactCaseSchemaMigration/);
  assert.match(code, /CONTACT_CASE_SCHEMA_MIGRATION_CONFIRMATION = 'PREPARE_CONTACT_CASE_SCHEMA_V1'/);
  assert.match(code, /event_type: 'legacy_migrated'/);
  assert.match(code, /対応履歴を保存できなかったため、案件更新を取り消しました。/);
  assert.match(code, /authMode: 'shared_token'/);
  assert.match(code, /accountAuditReliable: false/);
  assert.match(code, /function previewContactDbCleanup/);
  assert.match(code, /function executeContactDbCleanup/);
  assert.match(code, /function previewResidualAttachmentCleanup/);
  assert.match(code, /function executeResidualAttachmentCleanup/);
  assert.match(code, /function buildContactDbCleanupPlan_/);
  assert.match(code, /RESIDUAL_ATTACHMENT_CLEANUP_TARGETS/);
  assert.match(code, /1pJpzNYUd6JN-Q9IkUWgDs1SKwMIgIbGs/);
  assert.match(code, /1eMhiGKnbzYCqwSwl8vVo91aOSmT2dtbL/);
  assert.match(code, /15eel6WUJZ_p1ESKBRPYskeZOSmVY58ev/);
  assert.match(code, /1tAxw8xgyF5mvt762VMd3fHcpYTBnAUjh/);
  assert.match(code, /CONTACT_DB_CLEANUP_CONFIRMATION = 'DELETE_TEST_CONTACT_ROWS_20260622'/);
  assert.match(code, /sheet\.getName\(\) \+ '_backup_'/);
  assert.match(code, /yyyyMMdd_HHmmss/);
  assert.match(code, /known_test_submission_id/);
  assert.match(code, /external_email_not_auto_deleted/);
  assert.match(code, /filename_does_not_start_with_submission_id/);
  assert.match(code, /file\.setTrashed\(true\)/);
  assert.match(code, /file\.isTrashed\(\)/);
  assert.match(code, /\.sort\(function \(a, b\) \{ return b - a; \}\)/);
  assert.match(code, /function validateViewerAccessToken/);
  assert.match(code, /function assertAttachmentFile_/);
  assert.match(code, /function requireViewer_/);
  assert.match(code, /normalizeHandledStatus_/);
  assert.match(code, /counts\.total \+= 1;[\s\S]*if \(query && !matchesQuery_\(record, query\)\) continue;/);
  assert.match(code, /isActiveStatus_/);
  assert.match(code, /getRequestToken_/);
  assert.match(code, /DRIVE_FOLDER_ID/);
  assert.match(html, /CONTACT_VIEWER_ACCESS_TOKEN/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /google\.script\.url\.getLocation/);
  assert.match(html, /google\.script\.history\.replace/);
  assert.match(html, /parseViewerAccessTokenFromAppsScriptLocation/);
  assert.match(html, /cleanAccessTokenFromUrl/);
  assert.match(html, /VIEWER_ACCESS_TOKEN_STORAGE_KEY/);
  assert.match(html, /applyViewerLocationState/);
  assert.match(html, /sessionStorage/);
  assert.match(html, /attachmentReturnFocus/);
  assert.match(html, /attachmentModalClose\.focus\(\)/);
  assert.match(html, /target\.focus\(\)/);
  assert.match(html, /showApp\(appsScriptLocation\)[\s\S]*cleanAccessTokenFromUrl\(appsScriptLocation\);/);
  assert.match(html, /validateViewerAccessToken/);
  assert.match(html, /bootstrapViewer/);
  assert.match(html, /callServer\('validateViewerAccessToken', state\.accessToken\)/);
  assert.doesNotMatch(html, /context\.allowed\s*=\s*true/);
  assert.match(html, /statusSummary/);
  assert.match(html, /対応が必要/);
  assert.match(html, /value="active" selected/);
  assert.match(html, /quick-status/);
  assert.match(html, /replyMailLink/);
  assert.match(html, /confirmDiscardChanges/);
  assert.match(html, /attachmentModal/);
  assert.match(html, /attachment-modal__nav/);
  assert.match(html, /未保存の変更があります。/);
  assert.match(html, /保存しました。/);
  assert.match(html, /未対応/);
  assert.match(html, /対応中/);
  assert.match(html, /顧客確認待ち/);
  assert.match(html, /引継ぎ待ち/);
  assert.match(html, /対応済み/);
  assert.match(html, /保留/);
  assert.match(html, /id="assignee_email"/);
  assert.match(html, /id="urgency"/);
  assert.match(html, /id="case_category"/);
  assert.match(html, /id="gmail_thread_url"/);
  assert.match(html, /id="progress_note"/);
  assert.match(html, /id="handoff_to"/);
  assert.match(html, /id="handoff_status"/);
  assert.match(html, /id="resolution_code"/);
  assert.match(html, /id="next_followup_at"/);
  assert.match(html, /共有リンク認証で利用中です。/);
  assert.match(html, /createCaseUpdateRequestId/);
  assert.match(html, /expected_handled_at/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('viewer helper functions cover token parsing, cleanup, queue counts, modal reset, and aria state', async () => {
  const helpers = await loadViewerTestHelpers();

  assert.equal(helpers.parseViewerAccessTokenFromUrl('https://example.com/view?id=9&token=query-token#token=hash-token'), 'query-token');
  assert.equal(helpers.parseViewerAccessTokenFromUrl('https://example.com/view?id=9&accessToken=query-token'), 'query-token');
  assert.equal(helpers.parseViewerAccessTokenFromUrl('https://example.com/view?id=9#token=hash-token'), 'hash-token');
  assert.equal(helpers.parseViewerAccessTokenFromUrl('https://example.com/view?id=9'), '');
  assert.equal(
    helpers.parseViewerAccessTokenFromAppsScriptLocation({ parameter: { id: '9' }, parameters: { id: ['9'] }, hash: 'token=apps-script-hash-token' }),
    'apps-script-hash-token'
  );
  assert.equal(
    helpers.parseViewerAccessTokenFromAppsScriptLocation({ parameter: { accessToken: 'apps-script-query-token' }, parameters: { accessToken: ['apps-script-query-token'] }, hash: '' }),
    'apps-script-query-token'
  );
  assert.equal(
    helpers.getSubmissionIdFromAppsScriptLocation({ parameter: { id: 'submission-9' }, parameters: { id: ['submission-9'] }, hash: 'token=secret' }),
    'submission-9'
  );
  const storage = new Map();
  const mockStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  helpers.writeViewerAccessTokenToSession(mockStorage, 'session-token');
  assert.equal(helpers.readViewerAccessTokenFromSession(mockStorage), 'session-token');
  helpers.clearViewerAccessTokenFromSession(mockStorage);
  assert.equal(helpers.readViewerAccessTokenFromSession(mockStorage), '');
  assert.equal(helpers.normalizeViewerHandledStatus(''), '未対応');
  assert.equal(helpers.normalizeViewerHandledStatus('  '), '未対応');
  assert.equal(helpers.normalizeViewerHandledStatus('対応中'), '対応中');

  const cleanedQuery = helpers.buildViewerUrlWithoutTokens('https://example.com/view?id=9&foo=bar&token=query-token');
  assert.equal(cleanedQuery.changed, true);
  assert.equal(cleanedQuery.href, 'https://example.com/view?id=9&foo=bar');
  const cleanedHash = helpers.buildViewerUrlWithoutTokens('https://example.com/view?id=9&foo=bar#section=2&accessToken=hash-token');
  assert.equal(cleanedHash.changed, true);
  assert.equal(cleanedHash.href, 'https://example.com/view?id=9&foo=bar#section=2');
  assert.deepEqual(
    JSON.parse(JSON.stringify(helpers.buildAppsScriptLocationWithoutTokens({
      parameter: { id: '9', token: 'query-token' },
      parameters: { id: ['9'], token: ['query-token'] },
      hash: 'token=hash-token&section=2',
    }))),
    {
      parameters: { id: ['9'] },
      hash: 'section=2',
      changed: true,
    }
  );

  assert.equal(helpers.clampAttachmentIndex(-3, ['a', 'b']), 0);
  assert.equal(helpers.clampAttachmentIndex(9, ['a', 'b']), 1);
  assert.equal(helpers.clampAttachmentIndex(1, []), -1);
  assert.equal(helpers.shouldResetAttachmentModal('abc', 'abc'), false);
  assert.equal(helpers.shouldResetAttachmentModal('abc', 'def'), true);
  assert.deepEqual({ ...helpers.buildAttachmentModalClosedState() }, {
    attachmentIndex: 0,
    hidden: true,
    ariaHidden: 'true',
  });
  assert.deepEqual({ ...helpers.getDetailLifecycleResetState('empty') }, {
    attachmentIndex: 0,
    hidden: true,
    ariaHidden: 'true',
    dirty: false,
  });
  ['empty', 'error', 'loading', 'detail'].forEach((transition) => {
    assert.deepEqual({ ...helpers.getDetailAttachmentModalState(transition) }, {
      attachmentIndex: 0,
      hidden: true,
      ariaHidden: 'true',
    });
  });
  assert.deepEqual(
    { ...helpers.buildAttachmentModalViewState([
      { fileId: 'a', name: 'A', dataUrl: 'data:a' },
      { fileId: 'b', name: 'B', previewLoading: true },
    ], 1) },
    {
      attachmentIndex: 1,
      hidden: false,
      ariaHidden: null,
      loading: true,
      error: '',
      imageSrc: '',
      caption: 'B / -',
      prevDisabled: false,
      nextDisabled: true,
    }
  );
  assert.deepEqual(
    { ...helpers.buildAttachmentModalViewState([
      { fileId: 'a', name: 'A', dataUrl: 'data:a' },
      { fileId: 'b', name: 'B', previewLoading: false, dataUrl: 'data:b', mimeType: 'image/webp' },
    ], 1) },
    {
      attachmentIndex: 1,
      hidden: false,
      ariaHidden: null,
      loading: false,
      error: '',
      imageSrc: 'data:b',
      caption: 'B / image/webp',
      prevDisabled: false,
      nextDisabled: true,
    }
  );
  assert.deepEqual(
    { ...helpers.buildAttachmentModalViewState([], 0) },
    {
      attachmentIndex: -1,
      hidden: true,
      ariaHidden: 'true',
      loading: false,
      error: '',
      imageSrc: '',
      caption: '',
      prevDisabled: true,
      nextDisabled: true,
    }
  );

  assert.deepEqual(
    { ...helpers.computeQueueCounts([
      { handled_status: '未対応' },
      { handled_status: '対応中' },
      { handled_status: '保留', attention_reasons: [{ code: 'followup_overdue' }] },
      { handled_status: '対応済み' },
      { handled_status: '' },
    ]) },
    {
      total: 5,
      active: 4,
      attention: 1,
      未対応: 2,
      対応中: 1,
      顧客確認待ち: 0,
      引継ぎ待ち: 0,
      保留: 1,
      対応済み: 1,
    }
  );

  assert.deepEqual({ ...helpers.getAttachmentModalVisibilityState(true) }, { hidden: false, ariaHidden: null });
  assert.deepEqual({ ...helpers.getAttachmentModalVisibilityState(false) }, { hidden: true, ariaHidden: 'true' });
  const formSnapshot = helpers.buildCaseFormSnapshot({ handled_status: '対応中', urgency: '高' });
  assert.equal(helpers.isCaseFormDirty(formSnapshot, { handled_status: '対応中', urgency: '高' }), false);
  assert.equal(helpers.isCaseFormDirty(formSnapshot, { handled_status: '保留', urgency: '高' }), true);
  assert.equal(helpers.getCaseEventLabel('field_changed:assignee_email'), '担当者を変更');
  assert.equal(helpers.getCaseEventLabel('progress_added'), '対応履歴を追記');
});

test('support contact CS case contract preserves legacy rows and enforces fixed updates', async () => {
  const helpers = await loadViewerCaseHelpers();
  const fixtures = JSON.parse(await readFile(VIEWER_CASE_FIXTURES, 'utf8'));
  const legacy = helpers.normalizeCaseRecord_(fixtures.legacy);

  assert.equal(legacy.handled_status, '未対応');
  assert.equal(legacy.urgency, '中');
  assert.equal(legacy.handoff_status, 'なし');
  assert.equal(legacy.progress_note, '既存内部メモ');

  const next = helpers.buildNextCaseRecord_(legacy, fixtures.validUpdate, fixtures.allowedAssignees);
  assert.equal(next.handled_status, '対応中');
  assert.equal(next.assignee_email, 's-umeda@abroad-o.com');
  assert.equal(next.gmail_thread_url, 'https://mail.google.com/mail/u/0/#inbox/thread-id');
  assert.equal(next.case_category, '不具合');

  assert.throws(
    () => helpers.buildNextCaseRecord_(legacy, { ...fixtures.validUpdate, assignee_email: 'outside@example.com' }, fixtures.allowedAssignees),
    /許可ユーザー/
  );
  assert.throws(
    () => helpers.buildNextCaseRecord_(legacy, { ...fixtures.validUpdate, gmail_thread_url: 'https://example.com/message/1' }, fixtures.allowedAssignees),
    /mail\.google\.com/
  );
  assert.throws(
    () => helpers.buildNextCaseRecord_(legacy, { ...fixtures.validUpdate, arbitrary_column: 'x' }, fixtures.allowedAssignees),
    /更新対象に含まれない/
  );
});

test('support contact CS close rules, alerts, and append-only event payloads are deterministic', async () => {
  const helpers = await loadViewerCaseHelpers();
  const fixtures = JSON.parse(await readFile(VIEWER_CASE_FIXTURES, 'utf8'));
  const current = helpers.normalizeCaseRecord_(fixtures.legacy);
  const invalidClose = helpers.buildNextCaseRecord_(current, fixtures.invalidClose, fixtures.allowedAssignees);
  const closeErrors = helpers.validateCaseClose_(current, invalidClose, '', '2026-09-04T12:00:00+09:00', 'Asia/Tokyo');
  assert.ok(closeErrors.length >= 3);

  const validClose = helpers.buildNextCaseRecord_(current, fixtures.validClose, fixtures.allowedAssignees);
  assert.deepEqual(
    Array.from(helpers.validateCaseClose_(current, validClose, '顧客へ案内済み', '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
    []
  );

  const actor = { identity: 'shared-token', email: '', authMode: 'shared_token' };
  const events = helpers.buildCaseEvents_(current, validClose, '顧客へ案内済み', actor, 'case-request-001', '2026-09-04T03:00:00.000Z');
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.actor_auth_mode === 'shared_token'));
  assert.ok(events.every((event) => event.request_id === 'case-request-001'));
  assert.ok(events.every((event) => !Object.hasOwn(event, 'message')));

  const reopenedInvalid = { ...validClose, handled_status: '対応済み', assignee_email: '', resolution_code: '' };
  assert.ok(helpers.validateCaseClose_(validClose, reopenedInvalid, '', '2026-09-04T12:00:00+09:00', 'Asia/Tokyo').length >= 2);

  const reasons = helpers.getCaseAttentionReasons_(fixtures.attention, '2026-09-04T12:00:00+09:00', 24, 'Asia/Tokyo');
  assert.deepEqual(
    Array.from(reasons, (reason) => reason.code),
    ['high_urgency_unassigned', 'unhandled_stale', 'followup_overdue', 'handoff_pending']
  );

  assert.deepEqual(
    { ...helpers.getCaseActor_({ email: 's-umeda@abroad-o.com' }) },
    {
      identity: 'shared-token',
      email: 's-umeda@abroad-o.com',
      authMode: 'shared_token',
      displayName: '共有トークン利用者',
    }
  );
  assert.deepEqual(
    Array.from(helpers.validateCaseFollowup_({ handled_status: '対応中', resolution_code: '継続対応', next_followup_at: '2026-09-03' }, '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
    ['次回確認日は本日以降に設定してください。']
  );
  assert.deepEqual(
    Array.from(helpers.validateCaseFollowup_({ handled_status: '保留', resolution_code: '', next_followup_at: '2026-09-04' }, '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
    []
  );
  assert.throws(
    () => helpers.buildNextCaseRecord_(current, { ...fixtures.validUpdate, handled_status: '顧客確認待ち', next_followup_at: '' }, fixtures.allowedAssignees),
    /次回確認日/
  );
  [
    { handled_status: '顧客確認待ち', resolution_code: '' },
    { handled_status: '保留', resolution_code: '' },
    { handled_status: '対応中', resolution_code: '継続対応' },
  ].forEach((condition) => {
    assert.throws(
      () => helpers.buildNextCaseRecord_(current, { ...fixtures.validUpdate, ...condition, next_followup_at: '' }, fixtures.allowedAssignees),
      /次回確認日/
    );
    assert.deepEqual(
      Array.from(helpers.validateCaseFollowup_({ ...condition, next_followup_at: '2026-09-03' }, '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
      ['次回確認日は本日以降に設定してください。']
    );
    assert.deepEqual(
      Array.from(helpers.validateCaseFollowup_({ ...condition, next_followup_at: '2026-09-04' }, '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
      []
    );
    assert.deepEqual(
      Array.from(helpers.validateCaseFollowup_({ ...condition, next_followup_at: '2026-09-05' }, '2026-09-04T12:00:00+09:00', 'Asia/Tokyo')),
      []
    );
  });
  assert.equal(
    helpers.normalizeGmailThreadUrl_('https://mail.google.com/mail/#inbox/thread-id'),
    'https://mail.google.com/mail/#inbox/thread-id'
  );
  assert.equal(
    helpers.normalizeGmailThreadUrl_('https://mail.google.com/mail/u/personal@gmail.com/#inbox/thread-id'),
    'https://mail.google.com/mail/u/personal@gmail.com/#inbox/thread-id'
  );
  assert.throws(
    () => helpers.normalizeGmailThreadUrl_('https://user@mail.google.com/mail/u/0/#inbox/thread-id'),
    /mail\.google\.com/
  );
});

test('support contact CS event sheet starts headers at the first column', async () => {
  const helpers = await loadViewerCaseHelpers();
  const writes = [];
  const sheet = {
    getLastColumn: () => 0,
    getLastRow: () => 0,
    getMaxColumns: () => 26,
    insertColumnsAfter: () => {},
    getRange: (row, column, rowCount, columnCount) => ({
      getValues: () => [Array(columnCount).fill('')],
      setValues: (values) => writes.push({ row, column, rowCount, columnCount, values }),
    }),
  };
  const spreadsheet = {
    getSheetByName: () => null,
    insertSheet: () => sheet,
  };

  assert.equal(helpers.ensureContactCaseEventSheet_(spreadsheet), sheet);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].column, 1);
  assert.deepEqual(
    Array.from(writes[0].values[0]),
    Array.from(helpers.CONTACT_CASE_EVENT_HEADERS)
  );
});

test('support contact CS headers append directly after existing columns', async () => {
  const helpers = await loadViewerCaseHelpers();
  const existingHeaders = Array.from(helpers.CONTACT_HEADERS).slice(0, 17);
  const writes = [];
  const insertions = [];
  const sheet = {
    getLastColumn: () => existingHeaders.length,
    getMaxColumns: () => existingHeaders.length,
    insertColumnsAfter: (after, count) => insertions.push({ after, count }),
    getRange: (row, column, rowCount, columnCount) => ({
      getValues: () => [existingHeaders.slice(0, columnCount)],
      setValues: (values) => writes.push({ row, column, rowCount, columnCount, values }),
    }),
  };

  const headers = helpers.ensureHeaders_(sheet);
  assert.deepEqual(Array.from(headers), Array.from(helpers.CONTACT_HEADERS));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].columnCount, helpers.CONTACT_HEADERS.length);
  assert.equal(writes[0].values[0][17], 'assignee_email');
  assert.deepEqual(insertions, [{ after: existingHeaders.length, count: helpers.CONTACT_HEADERS.length - existingHeaders.length }]);
});

test('support contact CS columns preserve the public receiver write contract', async () => {
  const [publicGas, viewerGas] = await Promise.all([
    loadGasGlobals(PUBLIC_GAS_CODE),
    loadGasGlobals(VIEWER_GAS_CODE),
  ]);
  assert.deepEqual(
    Array.from(viewerGas.CONTACT_HEADERS).slice(0, publicGas.CONTACT_HEADERS.length),
    Array.from(publicGas.CONTACT_HEADERS)
  );
  assert.equal(viewerGas.CONTACT_HEADERS[publicGas.CONTACT_HEADERS.length], 'assignee_email');
});

test('support contact viewer read path does not run schema migration', async () => {
  const helpers = await loadViewerCaseHelpers();
  const sheet = { id: 'configured-sheet' };
  helpers.getConfiguredSheet_ = () => sheet;
  helpers.ensureHeaders_ = () => {
    throw new Error('read path attempted a migration write');
  };
  assert.equal(helpers.getSheet_(), sheet);
});

function installCaseUpdateHarness(helpers, { appendError = null, appendCommitsBeforeError = false, restoreFails = false, responseError = null } = {}) {
  const current = helpers.normalizeCaseRecord_({
    submission_id: 'case-001',
    handled_status: '未対応',
    handled_at: '2026-09-04T01:00:00.000Z',
    urgency: '中',
    handoff_status: 'なし',
  });
  const headers = Array.from(helpers.CONTACT_HEADERS);
  const originalRow = headers.map((header) => current[header] || '');
  let storedRow = originalRow.slice();
  let setCount = 0;
  let requestRecorded = false;
  const rowRange = {
    getValues: () => [storedRow.slice()],
    setValues: (values) => {
      setCount += 1;
      if (restoreFails && setCount > 1) throw new Error('restore failed');
      storedRow = values[0].slice();
    },
  };
  const spreadsheet = { getSpreadsheetTimeZone: () => 'Asia/Tokyo' };
  const sheet = {
    getParent: () => spreadsheet,
    getRange: () => rowRange,
  };
  helpers.getSheet_ = () => sheet;
  helpers.assertContactCaseSchemaReady_ = () => {};
  helpers.readHeaders_ = () => headers;
  helpers.findSubmission_ = () => ({ rowNumber: 2, record: current });
  helpers.getViewerEmails_ = () => ['s-umeda@abroad-o.com'];
  helpers.findExistingCaseRequest_ = () => requestRecorded;
  helpers.appendContactCaseEvents_ = () => {
    if (appendError) {
      if (appendCommitsBeforeError) requestRecorded = true;
      throw appendError;
    }
    requestRecorded = true;
  };
  helpers.getContactSubmission = () => {
    if (responseError) throw responseError;
    return { ok: true, submission: { submission_id: 'case-001' } };
  };
  return {
    current,
    originalRow,
    getStoredRow: () => storedRow,
    getSetCount: () => setCount,
    payload: {
      handled_status: '対応中',
      assignee_email: 's-umeda@abroad-o.com',
      urgency: '中',
      case_category: '不具合',
      gmail_thread_url: '',
      progress_note: '確認中',
      handoff_to: '',
      handoff_status: 'なし',
      resolution_code: '',
      resolution_summary: '',
      next_followup_at: '',
      history_note: '一次確認を開始',
      request_id: 'case-request-001',
      expected_handled_at: current.handled_at,
    },
  };
}

test('support contact CS update rolls back the row when history append fails', async () => {
  const helpers = await loadViewerCaseHelpers();
  const harness = installCaseUpdateHarness(helpers, { appendError: new Error('event write failed') });
  assert.throws(
    () => helpers.updateContactCase_('token', { email: 's-umeda@abroad-o.com' }, 'case-001', harness.payload),
    /案件更新を取り消しました/
  );
  assert.deepEqual(harness.getStoredRow(), harness.originalRow);
  assert.equal(harness.getSetCount(), 2);
});

test('support contact CS update reports an explicit inconsistency when rollback fails', async () => {
  const helpers = await loadViewerCaseHelpers();
  const harness = installCaseUpdateHarness(helpers, { appendError: new Error('event write failed'), restoreFails: true });
  assert.throws(
    () => helpers.updateContactCase_('token', { email: '' }, 'case-001', harness.payload),
    /整合を復元できませんでした/
  );
  assert.equal(harness.getSetCount(), 3);
});

test('support contact CS request id prevents duplicate writes after response failure', async () => {
  const helpers = await loadViewerCaseHelpers();
  const harness = installCaseUpdateHarness(helpers, { responseError: new Error('response failed') });
  assert.throws(
    () => helpers.updateContactCase_('token', { email: '' }, 'case-001', harness.payload),
    /response failed/
  );
  const writesAfterCommit = harness.getSetCount();
  helpers.getContactSubmission = () => ({ ok: true, submission: { submission_id: 'case-001' } });
  const retry = helpers.updateContactCase_('token', { email: '' }, 'case-001', harness.payload);
  assert.equal(retry.ok, true);
  assert.equal(harness.getSetCount(), writesAfterCommit);
});

test('support contact CS keeps the row when history committed before an uncertain error', async () => {
  const helpers = await loadViewerCaseHelpers();
  const harness = installCaseUpdateHarness(helpers, {
    appendError: new Error('timeout after commit'),
    appendCommitsBeforeError: true,
  });
  const result = helpers.updateContactCase_('token', { email: '' }, 'case-001', harness.payload);
  assert.equal(result.ok, true);
  assert.equal(harness.getSetCount(), 1);
  const writesAfterCommit = harness.getSetCount();
  const retry = helpers.updateContactCase_('token', { email: '' }, 'case-001', harness.payload);
  assert.equal(retry.ok, true);
  assert.equal(harness.getSetCount(), writesAfterCommit);
});

test('support contact CS rejects a stale browser revision before writing', async () => {
  const helpers = await loadViewerCaseHelpers();
  const harness = installCaseUpdateHarness(helpers);
  assert.throws(
    () => helpers.updateContactCase_('token', { email: '' }, 'case-001', { ...harness.payload, expected_handled_at: 'older' }),
    /別の画面で更新/
  );
  assert.equal(harness.getSetCount(), 0);
});

test('CS date-only values preserve calendar dates and reject invalid dates', async () => {
  const helpers = await loadViewerCaseHelpers();
  for (const date of ['2026-09-05', '2024-02-29', '2000-02-29', '2026-12-31', '2027-01-01']) {
    assert.equal(helpers.normalizeRequiredCaseDate_(date), date);
    for (const timeZone of ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      assert.equal(helpers.normalizeCaseDateCellValue_(date, timeZone), date);
    }
  }
  for (const empty of ['', null, undefined]) {
    assert.equal(helpers.normalizeCaseDateCellValue_(empty, 'Asia/Tokyo'), '');
    assert.equal(helpers.normalizeRequiredCaseDate_(empty), '');
  }
  for (const invalid of ['2026-02-29', '1900-02-29', '0000-01-01', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-9-5', 'not-a-date', '2026-09-05T00:00:00Z']) {
    assert.equal(helpers.normalizeCaseDateCellValue_(invalid, 'Asia/Tokyo'), '');
    assert.throws(() => helpers.normalizeRequiredCaseDate_(invalid), /YYYY-MM-DD/);
  }
  assert.equal(helpers.normalizeCaseDateCellValue_(new Date(NaN), 'Asia/Tokyo'), '');
  assert.throws(() => helpers.normalizeCaseDateCellValue_(new Date('2026-09-04T15:00:00Z')), /タイムゾーン/);
});

test('CS Date cells and overdue checks share the spreadsheet timezone across date boundaries', async () => {
  const helpers = await loadViewerCaseHelpers();
  const manifest = JSON.parse(await readFile(VIEWER_GAS_MANIFEST, 'utf8'));
  assert.equal(manifest.timeZone, 'Asia/Tokyo');
  helpers.Session = { getScriptTimeZone: () => manifest.timeZone };
  const rows = [
    ['Asia/Tokyo', '2026-09-04T14:59:59.999Z', '2026-09-04'],
    ['Asia/Tokyo', '2026-09-04T15:00:00.000Z', '2026-09-05'],
    ['Asia/Tokyo', '2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['America/Los_Angeles', '2026-09-05T06:59:59.999Z', '2026-09-04'],
    ['America/Los_Angeles', '2026-09-05T07:00:00.000Z', '2026-09-05'],
    ['America/New_York', '2026-03-08T06:59:59.999Z', '2026-03-08'],
    ['America/New_York', '2026-03-08T07:00:00.000Z', '2026-03-08'],
    ['Pacific/Kiritimati', '2026-09-04T10:00:00.000Z', '2026-09-05'],
  ];
  for (const [zone, instant, expectedDate] of rows) {
    const sheet = { getParent: () => ({ getSpreadsheetTimeZone: () => zone }) };
    const timeZone = helpers.getCaseTimeZone_(sheet);
    const cell = new Date(instant);
    const record = helpers.rowToRecord_(['next_followup_at'], [cell], 2, timeZone);
    assert.equal(record.next_followup_at, expectedDate, `${zone}: ${instant}`);
    assert.equal(helpers.isCaseDateOverdue_(expectedDate, cell, timeZone), false);
    assert.equal(helpers.isCaseDateOverdue_('2026-01-01', cell, timeZone), true);
    assert.equal(helpers.isCaseDateOverdue_('2028-01-01', cell, timeZone), false);
  }
  for (const instant of ['2026-09-04T14:59:59.999Z', '2026-09-04T15:00:00.000Z']) {
    const expectedOverdue = instant.includes('15:00:00');
    const record = { handled_status: '保留', next_followup_at: '2026-09-04' };
    assert.equal(helpers.isCaseDateOverdue_(record.next_followup_at, instant, 'Asia/Tokyo'), expectedOverdue);
    assert.equal(helpers.validateCaseFollowup_(record, instant, 'Asia/Tokyo').length > 0, expectedOverdue);
    assert.equal(helpers.getCaseAttentionReasons_(record, instant, 0, 'Asia/Tokyo').some((reason) => reason.code === 'followup_overdue'), expectedOverdue);
  }
  assert.throws(() => helpers.getCaseTimeZone_({ getParent: () => ({ getSpreadsheetTimeZone: () => '' }) }), /タイムゾーン/);
  assert.equal(helpers.isCaseDateOverdue_('', new Date(), 'Asia/Tokyo'), false);
  assert.equal(helpers.isCaseDateOverdue_('2026-09-04', new Date(NaN), 'Asia/Tokyo'), false);
});

test('viewer list and detail normalize Date cells with the configured sheet timezone', async () => {
  const helpers = await loadViewerCaseHelpers();
  const headers = ['submission_id', 'handled_status', 'next_followup_at'];
  const values = [headers, ['fixture-date', '対応中', new Date('2026-09-04T15:00:00Z')]];
  const sheet = {
    getParent: () => ({ getSpreadsheetTimeZone: () => 'America/Los_Angeles' }),
    getDataRange: () => ({ getValues: () => values }),
  };
  helpers.requireViewer_ = () => ({ email: '' });
  helpers.Session = { getScriptTimeZone: () => 'Asia/Tokyo' };
  helpers.getSheet_ = () => sheet;
  helpers.readHeaders_ = () => headers;
  helpers.getCaseOptions_ = () => ({});
  helpers.getCaseStaleHours_ = () => 0;
  helpers.listContactCaseEvents_ = () => [];
  const list = helpers.listContactSubmissions('fixture-access', { status: 'all' });
  const detail = helpers.getContactSubmission('fixture-access', 'fixture-date');
  assert.equal(list.submissions[0].next_followup_at, '2026-09-04');
  assert.equal(detail.submission.next_followup_at, '2026-09-04');
});

test('legacy and CS update entry points authenticate before reading any case or acquiring a lock', async () => {
  const helpers = await loadViewerCaseHelpers();
  helpers.getViewerAccessToken_ = () => 'synthetic-valid-access';
  helpers.getActiveUserEmail_ = () => '';
  let dbReads = 0;
  let locks = 0;
  helpers.findSubmission_ = () => { dbReads += 1; throw new Error('unexpected case lookup'); };
  helpers.SpreadsheetApp = { openById: () => { dbReads += 1; throw new Error('unexpected DB access'); } };
  helpers.LockService = { getScriptLock: () => { locks += 1; throw new Error('unexpected lock'); } };
  for (const token of ['', 'synthetic-invalid-access']) {
    for (const id of ['existing-fixture', 'missing-fixture', '']) {
      assert.throws(() => helpers.updateContactSubmissionStatus(token, id, '対応中', 'fixture note'), /利用する権限がありません/);
      assert.throws(() => helpers.updateContactCase(token, id, {}), /利用する権限がありません/);
    }
  }
  assert.equal(dbReads, 0);
  assert.equal(locks, 0);
});

test('unhandled stale alerts stay disabled until a positive threshold is configured', async () => {
  const helpers = await loadViewerCaseHelpers();
  for (const value of ['', '0', '-1', 'not-a-number', 'Infinity']) {
    helpers.getProperty_ = () => value;
    const staleHours = helpers.getCaseStaleHours_();
    assert.equal(staleHours, 0);
    assert.equal(helpers.getCaseAttentionReasons_({ handled_status: '未対応', submitted_at: '2020-01-01T00:00:00Z' }, '2026-09-04T15:00:00Z', staleHours, 'Asia/Tokyo').some((reason) => reason.code === 'unhandled_stale'), false);
  }
});

test('normal save button does not pass its click event as the next status', async () => {
  const html = await readFile(VIEWER_GAS_HTML, 'utf8');
  const match = html.match(/document\.getElementById\('saveCaseButton'\)\.addEventListener\('click', (.+)\);/);
  assert.ok(match, 'save button listener not found');
  const calls = [];
  const handler = vm.runInNewContext(`(${match[1]})`, { saveCase: (...args) => calls.push(args) });
  handler({ type: 'click' });
  assert.deepEqual(calls, [[]]);
});

test('event schema rejects reordered, duplicate and unknown columns before writes or migration backup', async () => {
  const helpers = await loadViewerCaseHelpers();
  const canonical = Array.from(helpers.CONTACT_CASE_EVENT_HEADERS);
  const reordered = canonical.slice();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const variants = [reordered, ['custom', ...canonical], [...canonical, 'custom'], [...canonical, canonical[0]], [canonical[0], canonical[0], ...canonical.slice(2)], canonical.filter((_, index) => index !== 2), ['']];
  for (const headers of variants) {
    let writes = 0;
    const eventSheet = {
      getLastColumn: () => headers.length,
      getLastRow: () => 2,
      getRange: () => ({ getValues: () => [headers], setValues: () => { writes += 1; } }),
      getDataRange: () => ({ getValues: () => [headers, ['existing-data']] }),
      insertColumnsAfter: () => { writes += 1; },
    };
    const spreadsheet = { getSheetByName: () => eventSheet, insertSheet: () => { writes += 1; } };
    const contactHeaders = Array.from(helpers.CONTACT_HEADERS).slice(0, 17);
    const sheet = {
      getLastColumn: () => contactHeaders.length,
      getRange: () => ({ getValues: () => [contactHeaders], setValues: () => { writes += 1; } }),
      getDataRange: () => ({ getValues: () => [contactHeaders] }),
      getParent: () => spreadsheet,
      getName: () => 'contact_submissions',
    };
    helpers.assertContactDbCleanupOperator_ = () => 'fixture@example.invalid';
    helpers.getConfiguredSheet_ = () => sheet;
    helpers.createContactDbCleanupBackup_ = () => { writes += 1; return 'unexpected-backup'; };
    const readySheet = {
      ...sheet,
      getLastColumn: () => helpers.CONTACT_HEADERS.length,
      getRange: () => ({ getValues: () => [Array.from(helpers.CONTACT_HEADERS)] }),
    };
    assert.throws(() => helpers.assertContactCaseSchemaReady_(readySheet), /正規スキーマ/);
    assert.throws(() => helpers.appendContactCaseEvents_(spreadsheet, 'fixture-001', [{ event_type: 'status_changed' }]), /正規スキーマ/);
    assert.throws(() => helpers.ensureContactCaseEventSheet_(spreadsheet), /正規スキーマ/);
    assert.throws(() => helpers.previewContactCaseSchemaMigration(), /正規スキーマ/);
    assert.throws(() => helpers.executeContactCaseSchemaMigration('PREPARE_CONTACT_CASE_SCHEMA_V1'), /正規スキーマ/);
    assert.equal(writes, 0, JSON.stringify(headers));
  }
});

test('event schema migration only extends a canonical prefix and leaves canonical headers untouched', async () => {
  const helpers = await loadViewerCaseHelpers();
  const canonical = Array.from(helpers.CONTACT_CASE_EVENT_HEADERS);
  for (const initial of [[], canonical.slice(0, 4), canonical]) {
    let headers = initial.slice();
    const writes = [];
    const sheet = {
      getLastColumn: () => headers.length,
      getLastRow: () => headers.length ? 2 : 0,
      getMaxColumns: () => 26,
      getRange: (row, col, rows, cols) => ({
        getValues: () => [headers.length ? headers.slice() : ['']],
        setValues: (values) => { writes.push({ row, col, rows, cols }); headers = Array.from(values[0]); },
      }),
    };
    assert.deepEqual(Array.from(helpers.assertContactCaseEventHeaders_(sheet, true)), initial);
    if (initial.length < canonical.length) assert.throws(() => helpers.assertContactCaseEventSchemaReady_(sheet), /正規スキーマ/);
    helpers.ensureContactCaseEventSheet_({ getSheetByName: () => sheet });
    helpers.assertContactCaseEventSchemaReady_(sheet);
    assert.deepEqual(headers, canonical);
    assert.deepEqual(writes, initial.length === canonical.length ? [] : [{ row: 1, col: 1, rows: 1, cols: canonical.length }]);
  }
});

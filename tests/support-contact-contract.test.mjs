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
  assert.match(html, /対応済み/);
  assert.match(html, /保留/);
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
      { handled_status: '保留' },
      { handled_status: '対応済み' },
      { handled_status: '' },
    ]) },
    {
      total: 5,
      active: 3,
      未対応: 2,
      対応中: 1,
      保留: 1,
      対応済み: 1,
    }
  );

  assert.deepEqual({ ...helpers.getAttachmentModalVisibilityState(true) }, { hidden: false, ariaHidden: null });
  assert.deepEqual({ ...helpers.getAttachmentModalVisibilityState(false) }, { hidden: true, ariaHidden: 'true' });
});

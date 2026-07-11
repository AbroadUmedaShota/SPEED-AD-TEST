const TEST_MODE_KEYS = ['contactTestMode', 'contactTestToken', 'testMode', 'testModeToken'];
const ALLOWED_SOURCE_URL_PREFIXES = [
  'https://support.speed-ad.com/contact/',
  'https://support.speed-ad.com/bug-report/',
  'http://localhost:8000/05_support/contact/',
  'http://localhost:8000/05_support/bug-report/',
  'http://127.0.0.1:8000/05_support/contact/',
  'http://127.0.0.1:8000/05_support/bug-report/',
];
const DEFAULT_MIN_FORM_AGE_MS = 2500;
const DEFAULT_MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_INTERACTION_COUNT = 1;
export const TURNSTILE_ACTION = 'contact_submit';
export const TURNSTILE_HOSTNAME = 'support.speed-ad.com';
export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_FALLBACK_MESSAGE = 'Cloudflare Turnstile を読み込めないため、フォームからの送信を停止しています。';
export const TURNSTILE_FALLBACK_CONTACT = 'customer@speed-ad.com';

function isEnabledValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parseHashParams(hash) {
  const value = String(hash || '').replace(/^#/, '');
  return value ? new URLSearchParams(value) : new URLSearchParams();
}

export function getContactTestModeFromUrl(href, baseHref = 'https://support.speed-ad.com/contact/') {
  const url = new URL(href, baseHref);
  const hashHadTestKeys = TEST_MODE_KEYS.some((key) => url.hash.includes(`${key}=`));
  const hashParams = parseHashParams(url.hash);
  const modeValue = hashParams.get('contactTestMode') || url.searchParams.get('contactTestMode') || '';
  const token = hashParams.get('contactTestToken') || url.searchParams.get('contactTestToken') || '';
  const enabled = isEnabledValue(modeValue);

  TEST_MODE_KEYS.forEach((key) => {
    url.searchParams.delete(key);
    hashParams.delete(key);
  });

  if (hashHadTestKeys) {
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : '';
  }

  return {
    enabled,
    token: enabled ? token : '',
    cleanedUrl: url.href,
  };
}

export function normalizePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Math.max(0, Math.floor(Number(fallback) || 0));
}

export function buildContactAntiBotSignals({
  honeypotValue = '',
  formLoadedAt = 0,
  submittedAt = Date.now(),
  interactionCount = 0,
  sourceUrl = '',
} = {}) {
  const loadedAt = normalizePositiveInteger(formLoadedAt, 0);
  const endedAt = normalizePositiveInteger(submittedAt, 0);
  const elapsedMs = loadedAt && endedAt ? Math.max(0, endedAt - loadedAt) : 0;

  return {
    honeypotValue: String(honeypotValue || '').trim(),
    formLoadedAt: loadedAt,
    submittedAt: endedAt,
    elapsedMs,
    interactionCount: normalizePositiveInteger(interactionCount, 0),
    sourceUrl: String(sourceUrl || '').trim(),
  };
}

export function getTurnstileSiteKey(form) {
  const globalSiteKey = typeof window !== 'undefined' ? window.SUPPORT_CONTACT_TURNSTILE_SITE_KEY : '';
  return String(
    form?.dataset?.turnstileSitekey ||
    globalSiteKey ||
    getMetaContentSafe('support-contact-turnstile-sitekey') ||
    ''
  ).trim();
}

export function buildTurnstileSubmissionPayload(token, siteKey) {
  return {
    turnstileToken: String(token || '').trim(),
    turnstileAction: TURNSTILE_ACTION,
    turnstileHostname: TURNSTILE_HOSTNAME,
    turnstileSiteKey: String(siteKey || '').trim(),
  };
}

function getMetaContentSafe(name) {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta ? meta.content.trim() : '';
}

export function evaluateContactSubmissionSignals(signals, options = {}) {
  const normalized = signals || {};
  const minAgeMs = normalizePositiveInteger(options.minAgeMs, DEFAULT_MIN_FORM_AGE_MS);
  const maxAgeMs = normalizePositiveInteger(options.maxAgeMs, DEFAULT_MAX_FORM_AGE_MS);
  const minInteractions = normalizePositiveInteger(options.minInteractions, DEFAULT_MIN_INTERACTION_COUNT);
  const allowedPrefixes = Array.isArray(options.allowedSourcePrefixes) && options.allowedSourcePrefixes.length
    ? options.allowedSourcePrefixes
    : ALLOWED_SOURCE_URL_PREFIXES;

  if (normalized.honeypotValue) {
    return {
      blocked: true,
      reasonCode: 'honeypot_filled',
      reason: 'honeypot field was populated',
    };
  }
  if (!normalized.sourceUrl || !allowedPrefixes.some((prefix) => String(normalized.sourceUrl).startsWith(prefix))) {
    return {
      blocked: true,
      reasonCode: 'invalid_source_url',
      reason: 'source url is not allowed',
    };
  }
  if (!normalized.elapsedMs || normalized.elapsedMs < minAgeMs) {
    return {
      blocked: true,
      reasonCode: 'submitted_too_fast',
      reason: 'submission elapsed time is too short',
    };
  }
  if (normalized.elapsedMs > maxAgeMs) {
    return {
      blocked: true,
      reasonCode: 'submission_too_old',
      reason: 'submission elapsed time is too long',
    };
  }
  if (normalized.interactionCount < minInteractions) {
    return {
      blocked: true,
      reasonCode: 'no_interaction',
      reason: 'no user interaction was observed',
    };
  }

  return {
    blocked: false,
    reasonCode: '',
    reason: '',
  };
}

import {
  buildWebpAttachmentPayload,
  convertImageFileToWebp,
  normalizeWebpQuality,
} from './contact-attachment-utils.js';
import {
  buildContactAntiBotSignals,
  buildTurnstileSubmissionPayload,
  getTurnstileSiteKey,
  getContactTestModeFromUrl,
  TURNSTILE_ACTION,
  TURNSTILE_FALLBACK_CONTACT,
  TURNSTILE_FALLBACK_MESSAGE,
  TURNSTILE_SCRIPT_SRC,
} from './contact-form-utils.js?v=20260712-turnstile';

const CONTACT_TYPE_LABELS = {
  general: '一般的なお問い合わせ',
  bug: '不具合・障害',
  billing: '請求・支払い',
  plan: '料金プラン',
  feature: '機能要望',
  other: 'その他',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_MODE_MISSING_TOKEN_MESSAGE = 'テストモードURLが不完全です。テスト用URLを発行し直してください。';
const TEST_MODE_REJECTED_MESSAGE = 'テストモードの設定を確認できませんでした。テスト用URLとScript Propertyを確認してください。';
function cleanContactTestModeUrl(state) {
  if (!state || !state.cleanedUrl || typeof window === 'undefined' || !window.history) return;
  if (state.cleanedUrl !== window.location.href) {
    window.history.replaceState({}, document.title, state.cleanedUrl);
  }
}

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  return meta ? meta.content.trim() : '';
}

function getEndpoint(form) {
  return (
    form.dataset.endpoint ||
    window.SUPPORT_CONTACT_ENDPOINT ||
    getMetaContent('support-contact-endpoint') ||
    ''
  ).trim();
}

function getMaxAttachmentMb(form) {
  const configured = Number(
    form.dataset.maxAttachmentMb ||
    window.SUPPORT_CONTACT_MAX_ATTACHMENT_MB ||
    getMetaContent('support-contact-max-attachment-mb') ||
    10
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

function getWebpQuality(form) {
  return normalizeWebpQuality(
    form.dataset.webpQuality ||
    window.SUPPORT_CONTACT_WEBP_QUALITY ||
    getMetaContent('support-contact-webp-quality') ||
    ''
  );
}

function setInvalid(control, error, isInvalid, message) {
  control.classList.toggle('is-invalid', isInvalid);
  if (error) {
    if (message) error.textContent = message;
    error.hidden = !isInvalid;
  }
}

function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const input = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const thumbs = document.getElementById('thumbs');
  const count = document.getElementById('count');
  const done = document.getElementById('contactDone');
  const status = document.getElementById('contactStatus');
  const submit = form.querySelector('.contact-submit');
  const testModeNotice = document.getElementById('contactTestModeNotice');
  const turnstileNotice = document.getElementById('contactTurnstileNotice');
  const turnstileFallback = document.getElementById('contactTurnstileFallback');
  const turnstileContainer = document.getElementById('contactTurnstileWidget');
  const turnstileTokenEl = document.getElementById('f-turnstile-token');
  const turnstileActionEl = document.getElementById('f-turnstile-action');
  const turnstileSiteKeyEl = document.getElementById('f-turnstile-sitekey');
  const turnstileError = document.getElementById('contactTurnstileError');
  const honeypotEl = document.getElementById('f-website');
  const formLoadedAtEl = document.getElementById('f-form-loaded-at');
  const interactionCountEl = document.getElementById('f-form-interaction-count');
  const testModeState = getContactTestModeFromUrl(window.location.href);
  cleanContactTestModeUrl(testModeState);
  if (testModeNotice && testModeState.enabled) {
    testModeNotice.hidden = false;
  }

  const typeEl = document.getElementById('f-contact-type');
  const typeError = document.getElementById('f-contact-type-error');
  const emailEl = document.getElementById('f-email');
  const emailError = document.getElementById('f-email-error');
  const messageEl = document.getElementById('f-message');
  const messageError = document.getElementById('f-message-error');
  const privacyEl = document.getElementById('f-privacy');
  const privacyError = document.getElementById('f-privacy-error');
  const fileError = document.getElementById('file-error');

  const maxAttachmentMb = getMaxAttachmentMb(form);
  const maxAttachmentBytes = maxAttachmentMb * 1024 * 1024;
  const webpQuality = getWebpQuality(form);
  const turnstileSiteKey = getTurnstileSiteKey(form);
  const formLoadedAt = Date.now();
  let files = [];
  let seq = 0;
  let isProcessingFiles = false;
  let isSubmitting = false;
  let interactionCount = 0;
  let turnstileWidgetId = null;
  let turnstileReady = false;
  let turnstileToken = '';
  let turnstileUnavailable = false;

  if (formLoadedAtEl) {
    formLoadedAtEl.value = String(formLoadedAt);
  }
  if (turnstileSiteKeyEl) {
    turnstileSiteKeyEl.value = turnstileSiteKey;
  }
  if (turnstileActionEl) {
    turnstileActionEl.value = TURNSTILE_ACTION;
  }

  function bumpInteractionCount() {
    interactionCount += 1;
    if (interactionCountEl) {
      interactionCountEl.value = String(interactionCount);
    }
  }

  ['focusin', 'input', 'change', 'paste', 'click', 'keydown'].forEach((eventName) => {
    form.addEventListener(eventName, bumpInteractionCount, { capture: true });
  });

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function setTurnstileError(message) {
    if (turnstileError) {
      turnstileError.textContent = message;
      turnstileError.hidden = !message;
    }
  }

  function setTurnstileUnavailable(message) {
    turnstileUnavailable = true;
    turnstileReady = false;
    turnstileToken = '';
    if (turnstileTokenEl) {
      turnstileTokenEl.value = '';
    }
    setTurnstileError(message || TURNSTILE_FALLBACK_MESSAGE);
    if (turnstileNotice) {
      turnstileNotice.hidden = false;
      turnstileNotice.textContent = message || TURNSTILE_FALLBACK_MESSAGE;
    }
    if (turnstileFallback) {
      turnstileFallback.hidden = false;
      turnstileFallback.innerHTML = `お問い合わせは <a href="mailto:${TURNSTILE_FALLBACK_CONTACT}">${TURNSTILE_FALLBACK_CONTACT}</a> へご連絡ください。`;
    }
    updateSubmitState();
  }

  function setTurnstileToken(token) {
    turnstileToken = String(token || '').trim();
    if (turnstileTokenEl) {
      turnstileTokenEl.value = turnstileToken;
    }
    setTurnstileError('');
    updateSubmitState();
  }

  function getDisplayErrorMessage(message) {
    const value = String(message || '');
    if (value.includes('CONTACT_TEST_MODE_TOKEN') || value.includes('テストモードトークン')) {
      return TEST_MODE_REJECTED_MESSAGE;
    }
    return value || '送信できませんでした。時間をおいて再度お試しください。';
  }

  function isTestModeTokenMissing() {
    return testModeState.enabled && !testModeState.token;
  }

  function validateTestModeBeforeSubmit() {
    if (!isTestModeTokenMissing()) return true;
    showStatus(TEST_MODE_MISSING_TOKEN_MESSAGE);
    if (testModeNotice) testModeNotice.focus && testModeNotice.focus();
    return false;
  }

  if (isTestModeTokenMissing()) {
    showStatus(TEST_MODE_MISSING_TOKEN_MESSAGE);
  }

  function clearFileError() {
    fileError.textContent = '';
    fileError.hidden = true;
  }

  function updateSubmitState() {
    const turnstileBlocked = !turnstileUnavailable && (!turnstileReady || !turnstileToken);
    submit.disabled = isProcessingFiles || isSubmitting || isTestModeTokenMissing() || turnstileBlocked || turnstileUnavailable;
    if (turnstileUnavailable) {
      submit.textContent = '利用不可';
    } else {
      submit.textContent = isProcessingFiles ? '画像変換中...' : isSubmitting ? '送信中...' : '送信する';
    }
  }
  updateSubmitState();
  ensureTurnstileScript();

  function ensureTurnstileScript() {
    if (!turnstileSiteKey) {
      setTurnstileUnavailable(TURNSTILE_FALLBACK_MESSAGE);
      return;
    }
    if (!turnstileNotice) {
      return;
    }
    turnstileNotice.hidden = false;
    turnstileNotice.textContent = 'Turnstile を読み込み中です。';
    const existing = document.querySelector('script[data-support-contact-turnstile="true"]');
    if (existing) return;

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.supportContactTurnstile = 'true';
    script.addEventListener('load', renderTurnstileWidget);
    script.addEventListener('error', () => setTurnstileUnavailable(TURNSTILE_FALLBACK_MESSAGE));
    document.head.appendChild(script);
  }

  function renderTurnstileWidget() {
    if (!turnstileSiteKey || turnstileUnavailable) return;
    if (!window.turnstile || !turnstileContainer) {
      setTurnstileUnavailable(TURNSTILE_FALLBACK_MESSAGE);
      return;
    }
    if (turnstileWidgetId !== null) return;

    try {
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: turnstileSiteKey,
        action: TURNSTILE_ACTION,
        theme: 'light',
        callback: (token) => {
          turnstileReady = true;
          setTurnstileToken(token);
        },
        'expired-callback': () => {
          turnstileReady = true;
          setTurnstileToken('');
          window.turnstile.reset(turnstileWidgetId);
        },
        'error-callback': () => setTurnstileUnavailable(TURNSTILE_FALLBACK_MESSAGE),
        'before-interactive-callback': () => {
          turnstileReady = true;
          updateSubmitState();
        },
      });
      turnstileReady = true;
      if (turnstileNotice) {
        turnstileNotice.textContent = '送信前に確認を完了してください。';
      }
      updateSubmitState();
    } catch (_error) {
      setTurnstileUnavailable(TURNSTILE_FALLBACK_MESSAGE);
    }
  }

  function render() {
    thumbs.innerHTML = '';
    files.forEach((item) => {
      const cell = document.createElement('div');
      cell.className = 'contact-thumb';

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'contact-thumb__remove';
      remove.title = '削除';
      remove.setAttribute('aria-label', `${item.name} を削除`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(item.url);
        files = files.filter((current) => current.id !== item.id);
        render();
      });

      const name = document.createElement('div');
      name.className = 'contact-thumb__name';
      name.textContent = item.originalName ? `${item.originalName} → ${item.name}` : item.name;

      cell.append(img, remove, name);
      thumbs.appendChild(cell);
    });

    count.hidden = files.length === 0;
    count.textContent = files.length ? `${files.length} 件の画像を添付中` : '';
  }

  async function addFiles(list) {
    clearFileError();
    const rejected = [];
    const incoming = Array.from(list || []);
    if (!incoming.length) return;

    isProcessingFiles = true;
    updateSubmitState();
    showStatus('画像をWEBPへ変換しています...');

    for (const file of incoming) {
      if (!file.type || !file.type.startsWith('image/')) {
        rejected.push(`${file.name} は画像ファイルではありません。`);
        continue;
      }
      if (file.size > maxAttachmentBytes) {
        rejected.push(`${file.name} は ${maxAttachmentMb}MB を超えています。`);
        continue;
      }

      try {
        const converted = await convertImageFileToWebp(file, webpQuality);
        const payload = buildWebpAttachmentPayload(converted);
        if (payload.size > maxAttachmentBytes) {
          rejected.push(`${file.name} は圧縮後も ${maxAttachmentMb}MB を超えています。`);
          continue;
        }
        files.push({
          id: `f${seq++}`,
          name: payload.name,
          size: payload.size,
          mimeType: payload.mimeType,
          originalName: payload.originalName,
          originalMimeType: payload.originalMimeType,
          originalSize: payload.originalSize,
          base64: payload.data,
          url: URL.createObjectURL(converted.webpBlob),
        });
      } catch (_error) {
        rejected.push(`${file.name} はWEBPへ変換できませんでした。`);
      }
    }

    isProcessingFiles = false;
    showStatus('');
    updateSubmitState();

    if (rejected.length) {
      fileError.textContent = rejected.join(' ');
      fileError.hidden = false;
    }
    render();
  }

  function validate() {
    let ok = true;
    const contactType = typeEl.value.trim();
    const email = emailEl.value.trim();
    const message = messageEl.value.trim();

    setInvalid(typeEl, typeError, !contactType);
    if (!contactType) ok = false;

    if (!email) {
      setInvalid(emailEl, emailError, true, 'メールアドレスを入力してください。');
      ok = false;
    } else if (!EMAIL_PATTERN.test(email)) {
      setInvalid(emailEl, emailError, true, 'メールアドレスの形式をご確認ください。');
      ok = false;
    } else {
      setInvalid(emailEl, emailError, false);
    }

    setInvalid(messageEl, messageError, !message);
    if (!message) ok = false;

    setInvalid(privacyEl, privacyError, !privacyEl.checked);
    if (!privacyEl.checked) ok = false;

    if (isProcessingFiles) {
      showStatus('画像変換が完了してから送信してください。');
      ok = false;
    }

    if (honeypotEl && String(honeypotEl.value || '').trim()) {
      showStatus('送信できませんでした。時間をおいて再度お試しください。');
      ok = false;
    }

    return ok;
  }

  async function buildAttachments() {
    return files.map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
      size: item.size,
      data: item.base64,
      originalName: item.originalName,
      originalMimeType: item.originalMimeType,
      originalSize: item.originalSize,
    }));
  }

  function buildPayload(attachments) {
    const formData = new FormData(form);
    const contactType = String(formData.get('contactType') || '').trim();
    const antiBotSignals = buildContactAntiBotSignals({
      honeypotValue: String(formData.get('website') || ''),
      formLoadedAt: formLoadedAtEl ? formLoadedAtEl.value : formLoadedAt,
      submittedAt: Date.now(),
      interactionCount,
      sourceUrl: window.location.href,
    });
    const turnstilePayload = buildTurnstileSubmissionPayload(turnstileToken, turnstileSiteKey);
    const payload = {
      contactType,
      contactTypeLabel: CONTACT_TYPE_LABELS[contactType] || contactType,
      name: String(formData.get('name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      subject: String(formData.get('subject') || '').trim(),
      message: String(formData.get('message') || '').trim(),
      attachments,
      sourceUrl: window.location.href,
      userAgent: window.navigator.userAgent,
      privacyConsent: formData.get('privacyConsent') === 'on',
      contactAntiBot: antiBotSignals,
      honeypot: antiBotSignals.honeypotValue,
      formLoadedAt: antiBotSignals.formLoadedAt,
      formSubmittedAt: antiBotSignals.submittedAt,
      formElapsedMs: antiBotSignals.elapsedMs,
      formInteractionCount: antiBotSignals.interactionCount,
      ...turnstilePayload,
    };
    if (testModeState.enabled) {
      payload.testMode = true;
      payload.testModeToken = testModeState.token;
    }
    return payload;
  }

  async function submitContact(payload) {
    const endpoint = getEndpoint(form);
    if (!endpoint) {
      return {
        ok: false,
        error: '送信先の設定が未完了です。しばらく時間をおいてから再度お試しください。',
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'submitContact', payload }),
      redirect: 'follow',
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_error) {
      return { ok: false, error: text.slice(0, 300) || '送信結果を確認できませんでした。' };
    }
  }

  input.addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-drag');
  });

  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-drag');
  });

  dropzone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-drag');
    await addFiles(event.dataTransfer.files);
  });

  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showStatus('');

    if (!validate()) {
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    if (!validateTestModeBeforeSubmit()) {
      return;
    }
    if (turnstileUnavailable) {
      showStatus(TURNSTILE_FALLBACK_MESSAGE);
      return;
    }
    if (!turnstileReady || !turnstileToken) {
      showStatus('Turnstile の確認が完了するまで送信できません。');
      return;
    }

    isSubmitting = true;
    updateSubmitState();

    try {
      const attachments = await buildAttachments();
      const result = await submitContact(buildPayload(attachments));
      if (!result.ok) {
        showStatus(getDisplayErrorMessage(result.error));
        return;
      }

      form.hidden = true;
      done.hidden = false;
      done.focus && done.focus();
    } catch (error) {
      showStatus(`送信できませんでした。${String(error).slice(0, 120)}`);
    } finally {
      isSubmitting = false;
      updateSubmitState();
    }
  });
}

if (typeof document !== 'undefined') {
  initContactForm();
}

export { getWebpQuality };

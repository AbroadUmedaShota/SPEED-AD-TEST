import { createRequestState } from './requestState.js';

const requests = createRequestState();
const state = {
  cases: [], current: null, principal: null, objectUrls: new Set(),
};
const byId = id => document.getElementById(id);

export function isSessionBlockingResponse(status, body) {
  return status === 401 || status === 403 || body?.error === 'trial_disabled';
}

export function clearSessionState(requestState, sessionState, revokeObjectUrl) {
  requestState.invalidateSession();
  sessionState.objectUrls.forEach(revokeObjectUrl);
  sessionState.objectUrls.clear();
  sessionState.cases = [];
  sessionState.current = null;
  sessionState.principal = null;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-requested-with', 'XMLHttpRequest');
  if (options.body) headers.set('content-type', 'application/json');
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    blockAccess();
    throw Object.assign(new Error('request_failed'), { sessionBlocked: true });
  }
  if (response.redirected
    || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    blockAccess();
    throw Object.assign(new Error('invalid_response'), { sessionBlocked: true });
  }
  let body;
  try {
    body = await response.json();
  } catch {
    blockAccess();
    throw Object.assign(new Error('invalid_response'), { sessionBlocked: true });
  }
  if (isSessionBlockingResponse(response.status, body)) {
    blockAccess();
    throw Object.assign(new Error(body.error || 'request_failed'), {
      status: response.status, body, sessionBlocked: true,
    });
  }
  if (!response.ok) throw Object.assign(new Error(body.error || 'request_failed'), {
    status: response.status, body,
  });
  return body;
}

function message(value) { byId('message').textContent = value; }
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function field(label, name, type = 'text', value = '') {
  const wrapper = text('label', label);
  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.name = name;
  input.required = true;
  input.value = value;
  if (type !== 'textarea') input.type = type;
  wrapper.append(input);
  return wrapper;
}

function clearObjectUrls() {
  state.objectUrls.forEach(url => URL.revokeObjectURL(url));
  state.objectUrls.clear();
}

function saveVisibleDraft() {
  const form = document.querySelector('#action-form:not([hidden])');
  if (!form?.dataset.action || !state.current) return;
  requests.setDraft(
    state.current.case_id, form.dataset.action, Object.fromEntries(new FormData(form).entries()),
  );
}

function blockAccess() {
  saveVisibleDraft();
  clearSessionState(requests, state, url => URL.revokeObjectURL(url));
  byId('cases').replaceChildren();
  byId('detail').replaceChildren(text('div', 'セッションを確認できません。再ログイン後に再読み込みしてください。'));
  byId('principal').textContent = 'アクセスできません';
  message('問い合わせ情報を非表示にしました。未送信の入力は、このタブを閉じるまで保持されます。');
}

const actions = {
  'assign-self': ['自分を担当にする', []], start: ['対応を始める', []],
  note: ['メモを残す', [['メモ', 'note', 'textarea']]],
  'wait-customer': ['お客様の返信を待つ', [['待機理由', 'note', 'textarea'], ['次の対応', 'nextAction'], ['確認予定日', 'followupAt', 'date']]],
  'wait-internal': ['社内へ確認する', [['確認先', 'confirmationTarget'], ['依頼内容', 'note', 'textarea'], ['次の対応', 'nextAction'], ['確認予定日', 'followupAt', 'date']]],
  hold: ['保留する', [['保留理由', 'reason', 'textarea'], ['再開条件', 'resumeCondition'], ['確認予定日', 'followupAt', 'date']]],
  resolve: ['解決する', [['対応結果', 'resolutionCode'], ['最終対応メモ', 'finalNote', 'textarea']]],
  reopen: ['対応を再開する', [['再開理由', 'reason', 'textarea']]],
};

function renderCases() {
  const query = byId('search').value.trim().toLowerCase();
  byId('cases').replaceChildren(...state.cases.filter(item =>
    [item.subject, item.customer_name, item.category].some(value => String(value).toLowerCase().includes(query)))
    .map(item => {
      const li = document.createElement('li');
      const button = text('button', `${item.status}｜${item.subject}\n${item.customer_name}`);
      button.type = 'button';
      button.dataset.caseId = item.case_id;
      button.setAttribute('aria-current', String(state.current?.case_id === item.case_id));
      li.append(button);
      return li;
    }));
  byId('queue-state').textContent = `${state.cases.length}件`;
}

async function loadCases() {
  const token = requests.beginList();
  const result = await api('/api/cases');
  if (!requests.isCurrent(token)) return;
  state.cases = result.cases;
  renderCases();
}

async function loadDetail(caseId) {
  saveVisibleDraft();
  const token = requests.beginDetail();
  clearObjectUrls();
  const [detail, history] = await Promise.all([
    api(`/api/cases/${encodeURIComponent(caseId)}`),
    api(`/api/cases/${encodeURIComponent(caseId)}/events`),
  ]);
  if (!requests.isCurrent(token)) return;
  state.current = detail.case;
  const fragment = byId('detail-template').content.cloneNode(true);
  fragment.querySelector('#status').textContent = state.current.status;
  fragment.querySelector('#subject').textContent = state.current.subject;
  const customer = fragment.querySelector('#customer');
  [['投稿者', state.current.customer_name], ['メール', state.current.customer_email], ['種別', state.current.category]]
    .forEach(([key, value]) => customer.append(text('dt', key), text('dd', value)));
  fragment.querySelector('#body').textContent = state.current.message;
  fragment.querySelector('#events').replaceChildren(...history.events.map(event =>
    text('li', `${event.created_at}｜${event.event_type}｜${event.actor_email}${event.note ? `｜${event.note}` : ''}`)));
  const attachmentList = fragment.querySelector('#attachments ul');
  fragment.querySelector('#attachments').hidden = !detail.attachments.length;
  detail.attachments.forEach(attachment => {
    const li = text('li', `${attachment.original_name} (${attachment.size_bytes} bytes) `);
    const button = text('button', 'プレビュー');
    button.type = 'button';
    button.addEventListener('click', async () => {
      const attachmentToken = requests.currentDetail();
      const selectedCaseId = state.current?.case_id;
      let response;
      try {
        response = await fetch(`/api/attachments/${encodeURIComponent(attachment.attachment_id)}/content`, {
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });
      } catch {
        blockAccess();
        return;
      }
      if (response.status === 401 || response.status === 403 || response.redirected) {
        blockAccess();
        return;
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!response.ok) {
        if (contentType !== 'application/json') {
          blockAccess();
          return;
        }
        let body;
        try {
          body = await response.json();
        } catch {
          blockAccess();
          return;
        }
        if (isSessionBlockingResponse(response.status, body)) blockAccess();
        else message('添付ファイルを取得できませんでした。');
        return;
      }
      if (contentType !== 'image/webp') {
        blockAccess();
        return;
      }
      if (!requests.isCurrent(attachmentToken) || state.current?.case_id !== selectedCaseId) return;
      let blob;
      try {
        blob = await response.blob();
      } catch {
        blockAccess();
        return;
      }
      if (!requests.isCurrent(attachmentToken) || state.current?.case_id !== selectedCaseId) return;
      const image = document.createElement('img');
      image.alt = `${attachment.original_name}のプレビュー`;
      image.src = URL.createObjectURL(blob);
      state.objectUrls.add(image.src);
      li.append(image);
    });
    li.append(button);
    attachmentList.append(li);
  });
  const form = fragment.querySelector('#action-form');
  const fields = fragment.querySelector('#fields');
  fragment.querySelector('#actions').replaceChildren(...Object.entries(actions).map(([key, definition]) => {
    const button = text('button', definition[0]);
    button.type = 'button';
    button.addEventListener('click', () => {
      saveVisibleDraft();
      form.dataset.action = key;
      const draft = requests.getDraft(state.current.case_id, key);
      const definitions = [...definition[1]];
      if (key === 'resolve' && (state.current.next_action || state.current.followup_at
        || state.current.wait_target || state.current.wait_reason)) {
        definitions.push(['未完了条件を閉じる理由', 'pendingClosureNote', 'textarea']);
      }
      fields.replaceChildren(...definitions.map(item => field(
        item[0], item[1], item[2] || 'text', draft[item[1]] || '',
      )));
      form.hidden = false;
    });
    return button;
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const action = form.dataset.action;
    const caseId = state.current.case_id;
    requests.setDraft(caseId, action, values);
    const attempt = requests.attempt(caseId, action, values, state.current.version);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api(`/api/cases/${encodeURIComponent(state.current.case_id)}/actions/${form.dataset.action}`, {
        method: 'POST', body: JSON.stringify({
          requestId: attempt.requestId, expectedVersion: attempt.expectedVersion, ...values,
        }),
      });
      const visibleForm = document.querySelector('#action-form:not([hidden])');
      const visibleFormMatches = visibleForm
        && state.current?.case_id === caseId
        && visibleForm.dataset.action === action;
      const currentValues = visibleFormMatches
        ? Object.fromEntries(new FormData(visibleForm).entries())
        : requests.getDraft(caseId, action);
      const completion = requests.completeAttempt(
        caseId, action, attempt.requestId, values, currentValues,
      );
      if (completion.current && !completion.hasDraft && visibleFormMatches) {
        visibleForm.hidden = true;
      }
      if (!completion.current) return;
      if (state.principal) {
        const currentCaseId = state.current?.case_id;
        await Promise.all([loadCases(), currentCaseId ? loadDetail(currentCaseId) : Promise.resolve()]);
      }
      message('保存しました。');
    } catch (error) {
      if (error.status === 409) {
        if (!requests.clearAttempt(caseId, action, attempt.requestId)) return;
        message('別の担当者による更新を検出しました。入力内容を保持しています。最新版を確認してください。');
        if (state.principal) {
          const currentCaseId = state.current?.case_id;
          await Promise.all([loadCases(), currentCaseId ? loadDetail(currentCaseId) : Promise.resolve()]);
        }
      } else if (!error.sessionBlocked && error.status !== 401 && error.status !== 403) {
        message('保存結果を確認できませんでした。同じ内容で再送すると同じ操作IDを使用します。');
      }
    } finally {
      submit.disabled = false;
    }
  });
  form.addEventListener('input', saveVisibleDraft);
  fragment.querySelector('#cancel').addEventListener('click', () => { form.hidden = true; });
  fragment.querySelector('#reload-detail').addEventListener('click', () => loadDetail(caseId));
  byId('detail').replaceChildren(fragment);
  renderCases();
}

async function start() {
  try {
    const session = await api('/api/session');
    state.principal = session.principal;
    byId('principal').textContent = session.principal.displayName
      ? `${session.principal.displayName} (${session.principal.email})` : session.principal.email;
    await loadCases();
  } catch (error) {
    byId('principal').textContent = 'アクセスできません';
    if (!error.sessionBlocked) message('担当者情報を確認できませんでした。再ログインしてください。');
  }
}

if (typeof document !== 'undefined') {
  byId('refresh').addEventListener('click', loadCases);
  byId('search').addEventListener('input', renderCases);
  byId('cases').addEventListener('click', event => {
    const button = event.target.closest('button[data-case-id]');
    if (button) loadDetail(button.dataset.caseId);
  });
  start();
}

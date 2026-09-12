import { createRequestState } from './requestState.js';
import { applyCaseListResponse, defaultCasePage, resetCaseListState } from './listState.js';

const requests = createRequestState();
const state = {
  cases: [], current: null, principal: null, objectUrls: new Set(),
  page: defaultCasePage(), cursorStack: [null], pageIndex: 0,
};
const byId = id => document.getElementById(id);

export function isSessionBlockingResponse(status, body) {
  return status === 401 || status === 403 || body?.error === 'trial_disabled';
}

export function clearSessionState(requestState, sessionState, revokeObjectUrl) {
  requestState.invalidateSession();
  sessionState.objectUrls.forEach(revokeObjectUrl);
  sessionState.objectUrls.clear();
  resetCaseListState(sessionState);
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
function selectedFilters() {
  const assignee = byId('assignee-filter').value;
  return {
    q: byId('search').value.trim(),
    status: byId('status-filter').value,
    assignee: assignee === 'self' ? state.principal?.email || '' : assignee,
    priority: byId('priority-filter').value,
  };
}

export function casesPath(filters, cursor = null) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `/api/cases?${query}` : '/api/cases';
}

function renderPagination() {
  const pageNumber = state.cases.length || state.pageIndex > 0 ? state.pageIndex + 1 : 0;
  byId('page-number').textContent = pageNumber ? `${pageNumber}ページ` : '0ページ';
  byId('previous-page').disabled = state.pageIndex === 0;
  byId('next-page').disabled = !state.page.hasMore;
}
function field(label, name, type = 'text', value = '', options = []) {
  const wrapper = text('label', label);
  const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  input.name = name;
  input.required = true;
  if (type === 'select') {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '選択してください';
    input.append(placeholder, ...options.map(option => {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      return node;
    }));
  } else if (type !== 'textarea') {
    input.type = type;
  }
  input.value = value;
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
  renderPagination();
  message('問い合わせ情報を非表示にしました。未送信の入力は、このタブを閉じるまで保持されます。');
}

const actions = {
  'assign-self': ['自分を担当にする', []], start: ['対応を始める', []],
  note: ['メモを残す', [['メモ', 'note', 'textarea']]],
  'wait-customer': ['お客様の返信を待つ', [['待機理由', 'note', 'textarea'], ['次の対応', 'nextAction'], ['確認予定日', 'followupAt', 'date']]],
  'wait-internal': ['社内へ確認する', [['確認先', 'confirmationTarget', 'select', ['CS', '営業', '開発', '管理者', 'その他']], ['依頼内容', 'note', 'textarea'], ['次の対応', 'nextAction'], ['確認予定日', 'followupAt', 'date']]],
  hold: ['保留する', [['保留理由', 'reason', 'textarea'], ['再開条件', 'resumeCondition'], ['確認予定日', 'followupAt', 'date']]],
  resolve: ['解決する', [['対応結果', 'resolutionCode', 'select', ['解決', '案内完了', '対応不要']], ['最終対応メモ', 'finalNote', 'textarea']]],
  reopen: ['対応を再開する', [['再開理由', 'reason', 'textarea']]],
};

function availableActions(item) {
  const available = ['note'];
  if (item.status === '未対応' && !item.assignee_email) available.unshift('assign-self');
  if (item.status === '未対応' && item.assignee_email) available.unshift('start');
  if (item.status === '対応中') available.push('wait-customer', 'wait-internal', 'hold');
  if (item.assignee_email && item.status !== '対応済み') available.push('resolve');
  if (item.assignee_email && ['対応済み', '顧客確認待ち', '引継ぎ待ち', '保留'].includes(item.status)) {
    available.push('reopen');
  }
  return available;
}

function renderCases() {
  const items = state.cases.map(item => {
    const li = document.createElement('li');
    const button = text('button', `${item.status}｜${item.subject}\n${item.customer_name}`);
    button.type = 'button';
    button.dataset.caseId = item.case_id;
    button.setAttribute('aria-current', String(state.current?.case_id === item.case_id));
    li.append(button);
    return li;
  });
  if (!items.length) items.push(text('li', '該当する問い合わせはありません。'));
  byId('cases').replaceChildren(...items);
  byId('queue-state').textContent = `${state.cases.length}件`;
  renderPagination();
}

async function loadCases(pageIndex = state.pageIndex, cursor = state.cursorStack[pageIndex]) {
  const token = requests.beginList();
  const result = await api(casesPath(selectedFilters(), cursor));
  if (!applyCaseListResponse(state, requests, token, result, pageIndex)) return;
  renderCases();
}

function resetCases() {
  resetCaseListState(state);
  renderCases();
  loadCases(0, null).catch(error => {
    if (!error.sessionBlocked) message('一覧を取得できませんでした。入力内容を確認してください。');
  });
}

function nextPage() {
  if (!state.page.hasMore || !state.page.nextCursor) return;
  const nextIndex = state.pageIndex + 1;
  state.cursorStack[nextIndex] = state.page.nextCursor;
  loadCases(nextIndex, state.page.nextCursor).catch(error => {
    if (!error.sessionBlocked) message('次のページを取得できませんでした。');
  });
}

function previousPage() {
  if (state.pageIndex === 0) return;
  const previousIndex = state.pageIndex - 1;
  loadCases(previousIndex, state.cursorStack[previousIndex]).catch(error => {
    if (!error.sessionBlocked) message('前のページを取得できませんでした。');
  });
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
  fragment.querySelector('#actions').replaceChildren(...availableActions(state.current).map(key => {
    const definition = actions[key];
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
        item[0], item[1], item[2] || 'text', draft[item[1]] || '', item[3] || [],
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
  let searchTimer;
  byId('refresh').addEventListener('click', () => loadCases().catch(error => {
    if (!error.sessionBlocked) message('一覧を取得できませんでした。');
  }));
  byId('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(resetCases, 250);
  });
  ['status-filter', 'assignee-filter', 'priority-filter'].forEach(id => {
    byId(id).addEventListener('change', resetCases);
  });
  byId('previous-page').addEventListener('click', previousPage);
  byId('next-page').addEventListener('click', nextPage);
  byId('cases').addEventListener('click', event => {
    const button = event.target.closest('button[data-case-id]');
    if (button) loadDetail(button.dataset.caseId);
  });
  start();
}

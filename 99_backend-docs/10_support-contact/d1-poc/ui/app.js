import { createRequestCoordinator } from './requestCoordinator.js';

const requests = createRequestCoordinator();
let actionRevision = 0;

const state = {
  actor: 'operator-a@example.invalid',
  cases: [],
  currentCase: null,
  events: [],
  attachments: [],
  attachmentObjectUrls: new Set(),
  filter: 'mine',
  search: '',
  action: null,
  queueScrollTop: 0,
  drafts: new Map(),
  attempts: new Map(),
};

const elements = Object.fromEntries([
  'workspace', 'queue-pane', 'case-list', 'queue-state', 'case-search', 'actor-select',
  'refresh-button', 'queue-tabs', 'detail-empty', 'detail-content', 'auth-blocked',
  'retry-auth-button', 'back-button', 'detail-refresh-button', 'case-summary',
  'customer-details', 'case-message', 'version-label', 'action-buttons', 'action-form',
  'action-form-fields', 'form-message', 'cancel-action', 'submit-action', 'history-state',
  'event-list', 'global-message',
  'attachments-section', 'attachment-list',
].map(id => [id, document.getElementById(id)]));

const statusLabels = {
  '未対応': '新規',
  '対応中': '対応中',
  '顧客確認待ち': 'お客様の返信待ち',
  '引継ぎ待ち': '社内確認待ち',
  '保留': '保留',
  '対応済み': '解決済み',
};

const eventLabels = {
  reassigned: '担当者を変更',
  assigned: '担当者を設定',
  started: '対応を開始',
  note_added: 'メモを追加',
  wait_customer: 'お客様の返信待ちに変更',
  wait_internal: '社内確認待ちに変更',
  held: '保留に変更',
  resolved: '解決',
  reopened: '対応を再開',
};

const actionDefinitions = {
  reassign: {
    label: '担当を変更する', submit: '変更を保存',
    fields: [
      { name: 'assigneeEmail', label: '変更先の担当者', type: 'select', required: true, options: [] },
      { name: 'reason', label: '変更理由', type: 'textarea', maxLength: 4000, required: true },
    ],
  },
  'assign-self': { label: '自分を担当にする', submit: '担当する', fields: [] },
  start: { label: '対応を始める', submit: '対応を開始', fields: [] },
  note: {
    label: 'メモを残す', submit: 'メモを保存',
    fields: [{ name: 'note', label: 'メモ', type: 'textarea', maxLength: 4000, required: true }],
  },
  'wait-customer': {
    label: 'お客様の返信を待つ', submit: '返信待ちにする',
    fields: [
      { name: 'note', label: '待機理由・現在の状況', type: 'textarea', maxLength: 4000, required: true },
      { name: 'nextAction', label: '次の対応', type: 'text', maxLength: 200, required: true },
      { name: 'followupAt', label: '確認予定日', type: 'date', required: true },
    ],
  },
  'wait-internal': {
    label: '社内へ確認する', submit: '社内確認待ちにする',
    fields: [
      { name: 'confirmationTarget', label: '確認先', type: 'select', required: true, options: ['CS', '営業', '開発', '管理者', 'その他'] },
      { name: 'note', label: '依頼内容', type: 'textarea', maxLength: 4000, required: true },
      { name: 'nextAction', label: '次の対応', type: 'text', maxLength: 200, required: true },
      { name: 'followupAt', label: '確認予定日', type: 'date', required: true },
    ],
  },
  hold: {
    label: '保留する', submit: '保留にする',
    fields: [
      { name: 'reason', label: '保留理由', type: 'textarea', maxLength: 4000, required: true },
      { name: 'resumeCondition', label: '再開条件', type: 'text', maxLength: 200, required: true },
      { name: 'followupAt', label: '確認予定日', type: 'date', required: true },
    ],
  },
  resolve: {
    label: '解決する', submit: '解決として保存',
    fields: [
      { name: 'resolutionCode', label: '対応結果', type: 'select', required: true, options: ['解決', '案内完了', '対応不要'] },
      { name: 'finalNote', label: '最終対応メモ', type: 'textarea', maxLength: 4000, required: true },
    ],
  },
  reopen: {
    label: '対応を再開する', submit: '対応を再開',
    fields: [{ name: 'reason', label: '再開理由', type: 'textarea', maxLength: 4000, required: true }],
  },
};

function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => element.setAttribute(name, value));
  }
  return element;
}

function today() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

function draftKey(action = state.action) {
  return state.actor && state.currentCase && action
    ? `${state.actor}:${state.currentCase.case_id}:${action}`
    : null;
}

function setGlobalMessage(message, kind = '') {
  elements['global-message'].textContent = message;
  elements['global-message'].className = `global-message ${kind}`.trim();
  elements['global-message'].hidden = !message;
}

async function api(path, options = {}, isCurrent = () => true) {
  const { sessionRevision = requests.currentSession(), ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  if (state.actor) headers.set('x-mvp-actor', state.actor);
  if (fetchOptions.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...fetchOptions, headers });
  if (!isCurrent()) return null;
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: 'invalid_response' };
  }
  if (!isCurrent()) return null;
  if (response.status === 401 || response.status === 403) {
    if (sessionRevision === requests.currentSession()) showAuthBlocked();
    throw Object.assign(new Error('auth_required'), { status: response.status, body });
  }
  if (!response.ok) throw Object.assign(new Error(body.error || 'request_failed'), { status: response.status, body });
  return body;
}

async function attachmentApi(path, sessionRevision) {
  const headers = new Headers();
  if (state.actor) headers.set('x-mvp-actor', state.actor);
  const response = await fetch(path, { headers });
  if (response.status === 401 || response.status === 403) {
    if (sessionRevision === requests.currentSession()) showAuthBlocked();
    throw Object.assign(new Error('auth_required'), { status: response.status });
  }
  if (!response.ok) {
    throw Object.assign(new Error('attachment_unavailable'), { status: response.status });
  }
  return response.blob();
}

function clearAttachmentPreviews() {
  state.attachmentObjectUrls.forEach(url => URL.revokeObjectURL(url));
  state.attachmentObjectUrls.clear();
  elements['attachment-list'].replaceChildren();
  elements['attachments-section'].hidden = true;
}

function showAuthBlocked() {
  saveDraft();
  actionRevision += 1;
  requests.advanceSession();
  state.cases = [];
  state.currentCase = null;
  state.events = [];
  state.attachments = [];
  clearAttachmentPreviews();
  elements['case-list'].replaceChildren();
  elements['queue-state'].textContent = '担当者を確認できません';
  elements['refresh-button'].disabled = false;
  elements['detail-empty'].hidden = true;
  elements['detail-content'].hidden = true;
  elements['auth-blocked'].hidden = false;
  elements.workspace.classList.add('show-detail');
  setGlobalMessage('認証を確認できないため、問い合わせ情報を非表示にしました。', 'error');
}

function getFilteredCases() {
  const query = state.search.trim().toLocaleLowerCase('ja');
  return state.cases.filter(item => {
    if (state.filter === 'mine' && item.assignee_email !== state.actor) return false;
    if (state.filter === 'unassigned' && item.assignee_email !== null) return false;
    if (state.filter === 'today' && item.followup_at !== today()) return false;
    if (!query) return true;
    return [item.subject, item.customer_name, item.category]
      .some(value => String(value || '').toLocaleLowerCase('ja').includes(query));
  });
}

function counts() {
  return {
    mine: state.cases.filter(item => item.assignee_email === state.actor).length,
    unassigned: state.cases.filter(item => item.assignee_email === null).length,
    today: state.cases.filter(item => item.followup_at === today()).length,
    all: state.cases.length,
  };
}

function renderQueue() {
  const currentCounts = counts();
  Object.entries(currentCounts).forEach(([name, value]) => {
    const target = document.querySelector(`[data-count="${name}"]`);
    if (target) target.textContent = String(value);
  });
  const items = getFilteredCases();
  elements['case-list'].replaceChildren(...items.map(item => {
    const li = createElement('li', { className: 'case-item' });
    const button = createElement('button', {
      attributes: { type: 'button', 'aria-current': String(item.case_id === state.currentCase?.case_id) },
    });
    button.dataset.caseId = item.case_id;
    const top = createElement('div', { className: 'case-topline' });
    top.append(
      createElement('span', { className: 'status-badge', text: statusLabels[item.status] || item.status, attributes: { 'data-status': item.status } }),
      createElement('span', { text: item.category }),
    );
    const subject = createElement('h2', { className: 'case-subject', text: item.subject });
    const meta = createElement('div', { className: 'case-meta' });
    meta.append(
      createElement('span', { text: item.customer_name }),
      createElement('span', { text: item.assignee_email ? `担当: ${item.assignee_email === state.actor ? '自分' : '他担当'}` : '未割当' }),
    );
    if (item.followup_at) {
      const followup = createElement('span', { text: `確認 ${item.followup_at}` });
      if (item.followup_at <= today()) followup.className = 'followup-overdue';
      meta.append(followup);
    }
    button.append(top, subject, meta);
    li.append(button);
    return li;
  }));
  elements['queue-state'].textContent = items.length ? `${items.length}件を表示` : '該当する問い合わせはありません';
}

function renderSummary(item) {
  const summary = createElement('div', { className: 'case-summary' });
  const line = createElement('div', { className: 'summary-line' });
  line.append(
    createElement('span', { className: 'status-badge', text: statusLabels[item.status] || item.status, attributes: { 'data-status': item.status } }),
    createElement('span', { text: item.category }),
    createElement('span', { text: `受付 ${formatDateTime(item.received_at)}` }),
  );
  summary.append(
    line,
    createElement('h1', { text: item.subject, attributes: { tabindex: '-1' } }),
    createElement('p', { text: item.assignee_email ? `担当: ${item.assignee_email}` : '担当: 未割当' }),
  );
  elements['case-summary'].replaceChildren(summary);
}

function renderCustomerDetails(item) {
  const rows = [
    ['投稿者', item.customer_name],
    ['メール', item.customer_email],
    ['投稿元', item.source_url || '—'],
    ['User-Agent', item.user_agent || '—'],
  ];
  const nodes = [];
  rows.forEach(([label, value]) => {
    nodes.push(createElement('dt', { text: label }), createElement('dd', { text: value }));
  });
  elements['customer-details'].replaceChildren(...nodes);
  elements['case-message'].textContent = item.message;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'サイズ不明';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function renderAttachments() {
  elements['attachments-section'].hidden = !state.attachments.length;
  elements['attachment-list'].replaceChildren(...state.attachments.map(attachment => {
    const item = createElement('li', { className: 'attachment-item' });
    const row = createElement('div', { className: 'attachment-row' });
    const name = createElement('div', { className: 'attachment-name' });
    name.append(
      createElement('strong', { text: attachment.original_name }),
      createElement('small', { text: `${attachment.mime_type}・${formatBytes(attachment.size_bytes)}` }),
    );
    const button = createElement('button', {
      className: 'secondary-button', text: 'プレビューを表示',
      attributes: { type: 'button', 'data-attachment-id': attachment.attachment_id },
    });
    row.append(name, button);
    const preview = createElement('div', { className: 'attachment-preview', attributes: { 'aria-live': 'polite' } });
    item.append(row, preview);
    return item;
  }));
}

function availableActions(item) {
  const actions = ['note'];
  if (item.status !== '対応済み' && !item.archived_at) actions.push('reassign');
  if (item.status === '未対応' && !item.assignee_email) actions.unshift('assign-self');
  if (item.status === '未対応' && item.assignee_email) actions.unshift('start');
  if (item.status === '対応中') actions.push('wait-customer', 'wait-internal', 'hold');
  if (item.assignee_email && item.status !== '対応済み') actions.push('resolve');
  if (item.assignee_email && ['対応済み', '顧客確認待ち', '引継ぎ待ち', '保留'].includes(item.status)) {
    actions.push('reopen');
  }
  return actions;
}

function renderActionButtons() {
  if (!state.currentCase) return;
  elements['action-buttons'].replaceChildren(...availableActions(state.currentCase).map(action => {
    const button = createElement('button', {
      text: actionDefinitions[action].label,
      attributes: { type: 'button', 'data-action': action },
    });
    return button;
  }));
}

function fieldElement(definition, value = '') {
  const label = createElement('label', { className: 'field' });
  label.append(createElement('span', { text: definition.label }));
  let input;
  if (definition.type === 'textarea') input = createElement('textarea');
  else if (definition.type === 'select') {
    input = createElement('select');
    input.append(createElement('option', { text: '選択してください', attributes: { value: '' } }));
    definition.options.forEach(option => input.append(createElement('option', {
      text: typeof option === 'string' ? option : `${option.display_name} (${option.email})`,
      attributes: { value: typeof option === 'string' ? option : option.email },
    })));
  } else input = createElement('input', { attributes: { type: definition.type } });
  input.name = definition.name;
  input.value = value;
  if (definition.required) input.required = true;
  if (definition.maxLength) input.maxLength = definition.maxLength;
  if (definition.type === 'date') input.min = today();
  label.append(input);
  if (definition.maxLength) label.append(createElement('small', { text: `${definition.maxLength}文字以内` }));
  return label;
}

function currentFormValues() {
  if (elements['action-form'].hidden) return {};
  return Object.fromEntries(new FormData(elements['action-form']).entries());
}

function saveDraft() {
  const key = draftKey();
  if (key && !elements['action-form'].hidden) state.drafts.set(key, currentFormValues());
}

async function openAction(action) {
  if (!state.currentCase || !availableActions(state.currentCase).includes(action)) return;
  saveDraft();
  const revision = ++actionRevision;
  const token = requests.currentDetail();
  const caseId = state.currentCase.case_id;
  elements['action-form'].hidden = true;
  state.action = action;
  const definition = actionDefinitions[action];
  const draft = state.drafts.get(draftKey()) || {};
  const fields = [...definition.fields];
  if (action === 'reassign') {
    try {
      const result = await api('/api/operators', { sessionRevision: token.sessionRevision }, () =>
        requests.isCurrentDetail(token) && revision === actionRevision
          && state.currentCase?.case_id === caseId && state.action === action);
      if (!requests.isCurrentDetail(token) || revision !== actionRevision
        || state.currentCase?.case_id !== caseId || state.action !== action) return;
      const operators = [...result.operators];
      if (draft.assigneeEmail && !operators.some(item => item.email === draft.assigneeEmail)) {
        operators.push({ email: draft.assigneeEmail, display_name: '保存済み入力・現在の候補外' });
      }
      fields[0] = { ...fields[0], options: operators };
    } catch (error) {
      if (requests.isCurrentDetail(token) && revision === actionRevision
        && error.message !== 'auth_required') {
        setGlobalMessage('担当候補を取得できませんでした。担当を変更する操作から再度お試しください。', 'error');
      }
      return;
    }
  }
  const hasPending = state.currentCase && (
    state.currentCase.next_action || state.currentCase.followup_at
    || state.currentCase.wait_target || state.currentCase.wait_reason
  );
  if (action === 'resolve' && hasPending) {
    fields.push({
      name: 'pendingClosureNote', label: '未完了条件を閉じる理由', type: 'textarea',
      maxLength: 4000, required: true,
    });
  }
  const heading = createElement('h3', { text: definition.label });
  const nodes = fields.map(field => fieldElement(field, draft[field.name] || ''));
  elements['action-form-fields'].replaceChildren(heading, ...nodes);
  elements['submit-action'].textContent = definition.submit;
  elements['action-form'].hidden = false;
  elements['form-message'].hidden = true;
  const firstInput = elements['action-form'].querySelector('input, select, textarea');
  (firstInput || elements['submit-action']).focus();
}

function closeAction({ discard = false } = {}) {
  actionRevision += 1;
  if (discard) {
    const key = draftKey();
    if (key) {
      state.drafts.delete(key);
      state.attempts.delete(key);
    }
  } else saveDraft();
  state.action = null;
  elements['action-form'].hidden = true;
  elements['action-form-fields'].replaceChildren();
  elements['form-message'].hidden = true;
}

function renderEvents() {
  if (!state.events.length) {
    elements['history-state'].textContent = '対応履歴はまだありません';
    elements['event-list'].replaceChildren();
    return;
  }
  elements['history-state'].textContent = `${state.events.length}件`;
  elements['event-list'].replaceChildren(...[...state.events].reverse().map(event => {
    const item = createElement('li', { className: 'event-item' });
    const time = createElement('div', { className: 'event-time', text: formatDateTime(event.created_at) });
    const content = createElement('div', { className: 'event-content' });
    content.append(
      createElement('strong', { text: eventLabels[event.event_type] || event.event_type }),
      createElement('span', { text: `操作: ${event.actor_email}` }),
    );
    if (event.note) content.append(createElement('p', { text: event.note }));
    if (event.event_type === 'reassigned') {
      content.append(createElement('p', {
        text: `旧担当: ${event.changes.previousAssigneeEmail || '未割当'} → 新担当: ${event.changes.assigneeEmail}`,
      }));
    }
    item.append(time, content);
    return item;
  }));
}

function renderDetail() {
  const item = state.currentCase;
  if (!item) return;
  elements['auth-blocked'].hidden = true;
  elements['detail-empty'].hidden = true;
  elements['detail-content'].hidden = false;
  renderSummary(item);
  renderCustomerDetails(item);
  renderAttachments();
  elements['version-label'].textContent = `版 ${item.version}`;
  renderActionButtons();
  renderEvents();
}

async function loadCases({ preserveMessage = false } = {}) {
  const token = requests.beginList();
  elements['refresh-button'].disabled = true;
  elements['queue-state'].textContent = '読み込み中です';
  if (!preserveMessage) setGlobalMessage('');
  try {
    const response = await api('/api/cases', { sessionRevision: token.sessionRevision });
    if (!requests.isCurrentList(token)) return;
    state.cases = response.cases;
    renderQueue();
  } catch (error) {
    if (!requests.isCurrentList(token)) return;
    if (error.message !== 'auth_required') {
      elements['queue-state'].textContent = '一覧を取得できませんでした';
      setGlobalMessage('一覧の取得に失敗しました。時間をおいて再度お試しください。', 'error');
    }
  } finally {
    if (requests.isCurrentList(token)) {
      elements['refresh-button'].disabled = false;
    }
  }
}

async function loadDetail(caseId, { keepDraft = true } = {}) {
  const token = requests.beginDetail();
  clearAttachmentPreviews();
  if (keepDraft) saveDraft();
  closeAction();
  elements['action-buttons'].replaceChildren();
  state.queueScrollTop = elements['queue-pane'].scrollTop;
  elements['detail-empty'].hidden = true;
  elements['detail-content'].hidden = false;
  elements['case-summary'].replaceChildren(createElement('div', { className: 'queue-state', text: '詳細を読み込み中です' }));
  elements['history-state'].textContent = '履歴を読み込み中です';
  elements['event-list'].replaceChildren();
  elements.workspace.classList.add('show-detail');
  try {
    const [detail, history] = await Promise.all([
      api(`/api/cases/${encodeURIComponent(caseId)}`, { sessionRevision: token.sessionRevision }),
      api(`/api/cases/${encodeURIComponent(caseId)}/events`, { sessionRevision: token.sessionRevision }),
    ]);
    if (!requests.isCurrentDetail(token)) return;
    state.currentCase = detail.case;
    state.events = history.events;
    state.attachments = detail.attachments || [];
    renderQueue();
    renderDetail();
    elements['case-summary'].querySelector('h1')?.focus();
  } catch (error) {
    if (!requests.isCurrentDetail(token)) return;
    if (error.message !== 'auth_required') {
      setGlobalMessage('詳細を取得できませんでした。一覧から再度選択してください。', 'error');
      elements['detail-content'].hidden = true;
      elements['detail-empty'].hidden = false;
    }
  }
}

function getAttempt(payloadFields) {
  const key = draftKey();
  const fingerprint = JSON.stringify(payloadFields);
  const existing = state.attempts.get(key);
  if (existing && existing.fingerprint === fingerprint
    && (state.action === 'reassign' || existing.expectedVersion === state.currentCase.version)) return existing;
  const attempt = {
    requestId: crypto.randomUUID(), fingerprint, expectedVersion: state.currentCase.version,
  };
  state.attempts.set(key, attempt);
  return attempt;
}

function formPayload() {
  return Object.fromEntries([...new FormData(elements['action-form']).entries()]
    .map(([key, value]) => [key, state.action === 'reassign' ? String(value) : String(value).trim()]));
}

function showFormMessage(message, kind = '') {
  elements['form-message'].textContent = message;
  elements['form-message'].className = `form-message ${kind}`.trim();
  elements['form-message'].hidden = false;
}

async function submitAction(event) {
  event.preventDefault();
  if (!state.currentCase || !state.action) return;
  if (!elements['action-form'].reportValidity()) {
    showFormMessage('必須項目と入力内容を確認してください。');
    return;
  }
  const values = formPayload();
  state.drafts.set(draftKey(), values);
  const attempt = getAttempt(values);
  const submittedCaseId = state.currentCase.case_id;
  const submittedAction = state.action;
  const submittedKey = draftKey();
  const submittedRevision = actionRevision;
  const token = requests.currentDetail();
  const payload = {
    requestId: attempt.requestId,
    expectedVersion: attempt.expectedVersion,
    ...values,
  };
  elements['submit-action'].disabled = true;
  elements['cancel-action'].disabled = true;
  elements['actor-select'].disabled = true;
  showFormMessage('保存しています。画面を閉じずにお待ちください。', 'info');
  try {
    await api(`/api/cases/${encodeURIComponent(state.currentCase.case_id)}/actions/${state.action}`, {
      method: 'POST', body: JSON.stringify(payload), sessionRevision: requests.currentSession(),
    });
    if (submittedAction === 'reassign' && (!requests.isCurrentDetail(token)
      || actionRevision !== submittedRevision || state.currentCase?.case_id !== submittedCaseId)) {
      state.attempts.delete(submittedKey);
      if (JSON.stringify(state.drafts.get(submittedKey)) === JSON.stringify(values)) {
        state.drafts.delete(submittedKey);
      }
      return;
    }
    if (submittedAction === 'reassign' && JSON.stringify(formPayload()) !== JSON.stringify(values)) {
      state.attempts.delete(submittedKey);
      saveDraft();
      closeAction();
      const detailRefresh = loadDetail(submittedCaseId);
      const refreshToken = requests.currentDetail();
      await Promise.all([loadCases({ preserveMessage: true }), detailRefresh]);
      if (!requests.isCurrentDetail(refreshToken) || state.currentCase?.case_id !== submittedCaseId) return;
      setGlobalMessage('担当変更を保存しました。保存中に編集した入力は保持しています。', 'success');
      return;
    }
    const completedAction = state.action;
    closeAction({ discard: true });
    const detailRefresh = loadDetail(state.currentCase.case_id, { keepDraft: false });
    const refreshToken = requests.currentDetail();
    await Promise.all([loadCases({ preserveMessage: true }), detailRefresh]);
    if (submittedAction === 'reassign' && (!requests.isCurrentDetail(refreshToken)
      || state.currentCase?.case_id !== submittedCaseId)) return;
    setGlobalMessage(`${actionDefinitions[completedAction].label}を保存しました。`, 'success');
  } catch (error) {
    if (error.message === 'auth_required') return;
    if (submittedAction === 'reassign' && error.status === 409
      && state.attempts.get(submittedKey)?.requestId === attempt.requestId) {
      state.attempts.delete(submittedKey);
    }
    if (submittedAction === 'reassign' && (!requests.isCurrentDetail(token)
      || actionRevision !== submittedRevision || state.currentCase?.case_id !== submittedCaseId)) return;
    if (error.status === 409 && error.body?.error === 'version_conflict') {
      state.attempts.delete(submittedKey);
      const conflictedAction = state.action;
      showFormMessage('別の担当者が先に更新しました。入力は保持しています。最新版を確認し、内容を見直してから保存してください。', 'info');
      const detailRefresh = loadDetail(state.currentCase.case_id);
      const refreshToken = requests.currentDetail();
      const refreshRevision = actionRevision;
      await Promise.all([loadCases({ preserveMessage: true }), detailRefresh]);
      if (submittedAction === 'reassign' && (!requests.isCurrentDetail(refreshToken)
        || state.currentCase?.case_id !== submittedCaseId || actionRevision !== refreshRevision)) return;
      const actionOpen = openAction(conflictedAction);
      const openedRevision = actionRevision;
      await actionOpen;
      if (submittedAction === 'reassign' && (!requests.isCurrentDetail(refreshToken)
        || actionRevision !== openedRevision || state.action !== submittedAction)) return;
      showFormMessage('別の担当者が先に更新しました。入力は保持しています。最新版を確認し、内容を見直してから保存してください。', 'info');
      return;
    }
    if (error.status === 409 && error.body?.error === 'idempotency_conflict') {
      showFormMessage('同じ操作IDで異なる内容が検出されました。入力を確認して操作をやり直してください。');
      state.attempts.delete(draftKey());
      return;
    }
    if (error.status === 400 || error.status === 409) {
      showFormMessage('現在の状態では保存できません。最新版と入力内容を確認してください。');
      return;
    }
    showFormMessage('保存結果を確認できませんでした。同じ内容のまま再送すると、同じ操作IDを使用します。', 'info');
  } finally {
    elements['submit-action'].disabled = false;
    elements['cancel-action'].disabled = false;
    elements['actor-select'].disabled = false;
  }
}

elements['queue-tabs'].addEventListener('click', event => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  elements['queue-tabs'].querySelectorAll('button').forEach(item => {
    item.setAttribute('aria-pressed', String(item === button));
  });
  renderQueue();
});

elements['case-search'].addEventListener('input', event => {
  state.search = event.target.value;
  renderQueue();
});

elements['case-list'].addEventListener('click', event => {
  const button = event.target.closest('button[data-case-id]');
  if (button) loadDetail(button.dataset.caseId);
});

elements['action-buttons'].addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button) openAction(button.dataset.action);
});

elements['attachment-list'].addEventListener('click', async event => {
  const button = event.target.closest('button[data-attachment-id]');
  if (!button || !state.currentCase) return;
  const attachmentId = button.dataset.attachmentId;
  const attachment = state.attachments.find(item => item.attachment_id === attachmentId);
  if (!attachment) return;
  const attachmentToken = requests.beginAttachment();
  const sessionRevision = attachmentToken.sessionRevision;
  const caseId = state.currentCase.case_id;
  const preview = button.closest('.attachment-item').querySelector('.attachment-preview');
  button.disabled = true;
  preview.replaceChildren(createElement('p', { text: 'プレビューを読み込み中です' }));
  try {
    const blob = await attachmentApi(
      `/api/attachments/${encodeURIComponent(attachmentId)}/content`, sessionRevision,
    );
    if (!requests.isCurrentAttachment(attachmentToken)
      || state.currentCase?.case_id !== caseId) return;
    const objectUrl = URL.createObjectURL(blob);
    state.attachmentObjectUrls.add(objectUrl);
    const image = createElement('img', {
      attributes: { src: objectUrl, alt: `${attachment.original_name}のプレビュー` },
    });
    preview.replaceChildren(image);
    button.textContent = 'プレビューを再読み込み';
  } catch (error) {
    if (error.message !== 'auth_required'
      && sessionRevision === requests.currentSession()
      && requests.isCurrentAttachment(attachmentToken)
      && state.currentCase?.case_id === caseId) {
      preview.replaceChildren(createElement('p', { text: '添付ファイルを取得できませんでした' }));
    }
  } finally {
    if (requests.isCurrentAttachment(attachmentToken)
      && state.currentCase?.case_id === caseId) {
      button.disabled = false;
    }
  }
});

elements['action-form'].addEventListener('input', saveDraft);
elements['action-form'].addEventListener('submit', submitAction);
elements['cancel-action'].addEventListener('click', () => closeAction());
elements['refresh-button'].addEventListener('click', () => loadCases());
elements['detail-refresh-button'].addEventListener('click', () => {
  if (state.currentCase) loadDetail(state.currentCase.case_id);
});
elements['retry-auth-button'].addEventListener('click', () => loadCases());
elements['back-button'].addEventListener('click', () => {
  saveDraft();
  closeAction();
  elements.workspace.classList.remove('show-detail');
  requestAnimationFrame(() => { elements['queue-pane'].scrollTop = state.queueScrollTop; });
});
elements['actor-select'].addEventListener('change', async event => {
  saveDraft();
  state.actor = event.target.value;
  requests.advanceSession();
  state.currentCase = null;
  state.events = [];
  state.attachments = [];
  clearAttachmentPreviews();
  elements['detail-content'].hidden = true;
  elements['detail-empty'].hidden = false;
  elements['auth-blocked'].hidden = true;
  elements.workspace.classList.remove('show-detail');
  await loadCases();
});

loadCases();

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestState } from '../shared-ui/requestState.js';

test('authentication invalidation rejects earlier list, detail and attachment tokens', () => {
  const state = createRequestState();
  const list = state.beginList();
  const detail = state.beginDetail();
  const attachment = state.beginList();
  state.invalidateSession();
  assert.equal(state.isCurrent(list), false);
  assert.equal(state.isCurrent(detail), false);
  assert.equal(state.isCurrent(attachment), false);
});

test('a later list request invalidates the earlier list response', () => {
  const state = createRequestState();
  const first = state.beginList();
  const second = state.beginList();
  assert.equal(state.isCurrent(first), false);
  assert.equal(state.isCurrent(second), true);
});

test('a later detail selection invalidates the earlier detail response', () => {
  const state = createRequestState();
  const first = state.beginDetail();
  const second = state.beginDetail();
  assert.equal(state.isCurrent(first), false);
  assert.equal(state.isCurrent(second), true);
});

test('unacknowledged attempt keeps its request identity after a newer detail version', () => {
  const state = createRequestState();
  const first = state.attempt('case-1', 'note', { note: '同じ内容' }, 1);
  const retried = state.attempt('case-1', 'note', { note: '同じ内容' }, 2);
  assert.deepEqual(retried, first);
  state.clearAttempt('case-1', 'note', first.requestId);
  assert.notEqual(state.attempt('case-1', 'note', { note: '同じ内容' }, 2).requestId, first.requestId);
});

test('drafts remain in tab memory across session invalidation', () => {
  const state = createRequestState();
  state.setDraft('case-1', 'note', { note: '入力中' });
  state.invalidateSession();
  assert.deepEqual(state.getDraft('case-1', 'note'), { note: '入力中' });
});

test('confirmed payload is cleared while edits made during submission remain a draft', () => {
  const state = createRequestState();
  const submitted = { note: '送信内容' };
  state.setDraft('case-1', 'note', submitted);
  const first = state.attempt('case-1', 'note', submitted, 1);
  assert.deepEqual(state.completeAttempt(
    'case-1', 'note', first.requestId, submitted, submitted,
  ), { current: true, hasDraft: false });
  assert.deepEqual(state.getDraft('case-1', 'note'), {});
  const second = state.attempt('case-1', 'note', submitted, 2);
  assert.deepEqual(state.completeAttempt(
    'case-1', 'note', second.requestId, submitted, { note: '追加入力' },
  ), { current: true, hasDraft: true });
  assert.deepEqual(state.getDraft('case-1', 'note'), { note: '追加入力' });
});

test('an older response cannot clear a newer pending attempt', () => {
  const state = createRequestState();
  const first = state.attempt('case-1', 'note', { note: 'A' }, 1);
  const second = state.attempt('case-1', 'note', { note: 'B' }, 2);
  assert.deepEqual(state.completeAttempt(
    'case-1', 'note', first.requestId, { note: 'A' }, { note: 'B' },
  ), { current: false, hasDraft: true });
  assert.deepEqual(state.attempt('case-1', 'note', { note: 'B' }, 3), second);
  state.clearAttempt('case-1', 'note', first.requestId);
  assert.deepEqual(state.attempt('case-1', 'note', { note: 'B' }, 3), second);
});

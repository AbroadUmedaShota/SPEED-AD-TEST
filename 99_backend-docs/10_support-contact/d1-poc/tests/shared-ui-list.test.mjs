import assert from 'node:assert/strict';
import test from 'node:test';
import { casesPath } from '../shared-ui/app.js';
import { applyCaseListResponse, defaultCasePage, resetCaseListState } from '../shared-ui/listState.js';
import { createRequestState } from '../shared-ui/requestState.js';

test('shared UI sends server-side filter values and cursors to the case endpoint', () => {
  assert.equal(casesPath({
    q: 'invoice', status: '対応中', assignee: 'operator@example.invalid', priority: 'high',
  }, 'cursor-value'), '/api/cases?q=invoice&status=%E5%AF%BE%E5%BF%9C%E4%B8%AD&assignee=operator%40example.invalid&priority=high&cursor=cursor-value');
  assert.equal(casesPath({ q: '', status: '', assignee: '', priority: '' }), '/api/cases');
});

test('a reset disables stale paging before a later list response is applied', () => {
  const requestState = createRequestState();
  const state = {
    cases: [{ case_id: 'old-case' }], page: { limit: 50, hasMore: true, nextCursor: 'old-cursor' },
    cursorStack: [null, 'old-cursor'], pageIndex: 1,
  };
  const oldToken = requestState.beginList();
  resetCaseListState(state);
  assert.deepEqual(state, {
    cases: [], page: defaultCasePage(), cursorStack: [null], pageIndex: 0,
  });
  const newToken = requestState.beginList();
  assert.equal(applyCaseListResponse(state, requestState, oldToken, {
    cases: [{ case_id: 'old-filter-case' }], page: { limit: 50, hasMore: true, nextCursor: 'old' },
  }, 1), false);
  assert.deepEqual(state, {
    cases: [], page: defaultCasePage(), cursorStack: [null], pageIndex: 0,
  });
  assert.equal(applyCaseListResponse(state, requestState, newToken, {
    cases: [{ case_id: 'new-filter-case' }], page: { limit: 50, hasMore: false, nextCursor: null },
  }, 0), true);
  assert.equal(state.cases[0].case_id, 'new-filter-case');
});

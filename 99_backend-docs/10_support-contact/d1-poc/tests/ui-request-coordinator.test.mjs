import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestCoordinator } from '../ui/requestCoordinator.js';

function applyListResult(coordinator, token, result, view) {
  if (coordinator.isCurrentList(token)) view.cases = result;
}

test('post-wait list wins when the pre-operation list arrives last', () => {
  const coordinator = createRequestCoordinator();
  const view = { cases: [] };
  const beforeWait = coordinator.beginList();
  const afterWait = coordinator.beginList();

  applyListResult(coordinator, afterWait, [{ caseId: 'case-1', status: '顧客確認待ち' }], view);
  applyListResult(coordinator, beforeWait, [{ caseId: 'case-1', status: '対応中' }], view);

  assert.deepEqual(view.cases, [{ caseId: 'case-1', status: '顧客確認待ち' }]);
});

test('post-resolution empty queue is not replaced by a late pre-resolution response', () => {
  const coordinator = createRequestCoordinator();
  const view = { cases: [{ caseId: 'case-1', status: '顧客確認待ち' }] };
  const beforeResolution = coordinator.beginList();
  const afterResolution = coordinator.beginList();

  applyListResult(coordinator, afterResolution, [], view);
  applyListResult(coordinator, beforeResolution,
    [{ caseId: 'case-1', status: '顧客確認待ち' }], view);

  assert.deepEqual(view.cases, []);
});

test('session change invalidates every list and detail response from the previous actor', () => {
  const coordinator = createRequestCoordinator();
  const oldList = coordinator.beginList();
  const oldDetail = coordinator.beginDetail();
  coordinator.advanceSession();

  assert.equal(coordinator.isCurrentList(oldList), false);
  assert.equal(coordinator.isCurrentDetail(oldDetail), false);
});

test('case or actor changes invalidate an in-flight attachment response', () => {
  const coordinator = createRequestCoordinator();
  const beforeCaseChange = coordinator.beginAttachment();
  coordinator.beginDetail();
  assert.equal(coordinator.isCurrentAttachment(beforeCaseChange), false);

  const beforeActorChange = coordinator.beginAttachment();
  coordinator.advanceSession();
  assert.equal(coordinator.isCurrentAttachment(beforeActorChange), false);
});

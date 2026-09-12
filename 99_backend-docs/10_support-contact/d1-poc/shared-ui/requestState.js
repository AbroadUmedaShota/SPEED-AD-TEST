export function createRequestState() {
  let sessionRevision = 0;
  let listRevision = 0;
  let detailRevision = 0;
  const drafts = new Map();
  const attempts = new Map();
  const key = (caseId, action) => `${caseId}:${action}`;
  return {
    beginList: () => ({ sessionRevision, listRevision: ++listRevision }),
    invalidateList() { listRevision += 1; },
    beginDetail: () => ({ sessionRevision, detailRevision: ++detailRevision }),
    currentDetail: () => ({ sessionRevision, detailRevision }),
    invalidateSession() { sessionRevision += 1; listRevision += 1; detailRevision += 1; },
    isCurrent(token) {
      return token.sessionRevision === sessionRevision
        && (token.listRevision === undefined || token.listRevision === listRevision)
        && (token.detailRevision === undefined || token.detailRevision === detailRevision);
    },
    setDraft(caseId, action, values) { drafts.set(key(caseId, action), { ...values }); },
    getDraft(caseId, action) { return drafts.get(key(caseId, action)) || {}; },
    clearDraft(caseId, action) { drafts.delete(key(caseId, action)); },
    attempt(caseId, action, values, currentVersion) {
      const attemptKey = key(caseId, action);
      const fingerprint = JSON.stringify(values);
      const existing = attempts.get(attemptKey);
      if (existing?.fingerprint === fingerprint) return existing;
      const created = {
        requestId: crypto.randomUUID(), expectedVersion: currentVersion, fingerprint,
      };
      attempts.set(attemptKey, created);
      return created;
    },
    clearAttempt(caseId, action, requestId) {
      const attemptKey = key(caseId, action);
      if (attempts.get(attemptKey)?.requestId !== requestId) return false;
      attempts.delete(attemptKey);
      return true;
    },
    completeAttempt(caseId, action, requestId, submitted, current) {
      const attemptKey = key(caseId, action);
      if (attempts.get(attemptKey)?.requestId !== requestId) {
        return { current: false, hasDraft: true };
      }
      attempts.delete(attemptKey);
      if (JSON.stringify(submitted) === JSON.stringify(current)) {
        drafts.delete(attemptKey);
        return { current: true, hasDraft: false };
      }
      drafts.set(attemptKey, { ...current });
      return { current: true, hasDraft: true };
    },
  };
}

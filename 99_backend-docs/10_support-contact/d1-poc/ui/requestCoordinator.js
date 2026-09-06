export function createRequestCoordinator() {
  let sessionRevision = 0;
  let listRevision = 0;
  let detailRevision = 0;

  return Object.freeze({
    currentSession() {
      return sessionRevision;
    },
    advanceSession() {
      sessionRevision += 1;
      listRevision += 1;
      detailRevision += 1;
      return sessionRevision;
    },
    beginList() {
      return Object.freeze({ sessionRevision, requestRevision: ++listRevision });
    },
    isCurrentList(token) {
      return token.sessionRevision === sessionRevision
        && token.requestRevision === listRevision;
    },
    beginDetail() {
      return Object.freeze({ sessionRevision, requestRevision: ++detailRevision });
    },
    isCurrentDetail(token) {
      return token.sessionRevision === sessionRevision
        && token.requestRevision === detailRevision;
    },
  });
}

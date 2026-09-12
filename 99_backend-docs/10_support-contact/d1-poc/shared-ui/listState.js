export const defaultCasePage = () => ({ limit: 50, hasMore: false, nextCursor: null });

export function resetCaseListState(state) {
  state.cases = [];
  state.page = defaultCasePage();
  state.cursorStack = [null];
  state.pageIndex = 0;
}

export function applyCaseListResponse(state, requestState, token, result, pageIndex) {
  if (!requestState.isCurrent(token)) return false;
  state.cases = result.cases;
  state.page = result.page || defaultCasePage();
  state.pageIndex = pageIndex;
  state.cursorStack = state.cursorStack.slice(0, pageIndex + 1);
  return true;
}

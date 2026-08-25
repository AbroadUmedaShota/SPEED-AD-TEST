/**
 * 管理画面モック（03_admin）の到達画面と一覧の定義。
 *
 * ここを正として admin-mock 配下の spec が回る。画面を足したらこの表に追記する。
 * 到達画面 = index.html から辿れる画面。名刺入力画面の全グループ入力（?g=all）は
 * 画面としては同一だが、扱う項目が変わるため別行として検査する。
 * escalations.html と reconciliation/list.html は
 * 到達不能な旧画面のため対象外（docs/architecture/admin_architecture.json の F-10）。
 */

/** 到達画面。path は baseURL からの相対、name は失敗時に読む用 */
const SCREENS = [
  { name: 'ダッシュボード', path: '/03_admin/index.html' },
  { name: 'ユーザー管理', path: '/03_admin/user-management.html' },
  { name: 'ユーザー詳細', path: '/03_admin/user-detail.html?id=U-1002' },
  { name: 'アンケート管理', path: '/03_admin/survey-management.html' },
  { name: 'アンケート詳細', path: '/03_admin/survey-detail.html?id=SV-10259' },
  { name: '請求管理', path: '/03_admin/billing-management.html' },
  { name: '請求書管理', path: '/03_admin/invoice-management.html' },
  { name: 'クーポン管理', path: '/03_admin/coupon-management.html' },
  { name: '営業日カレンダー', path: '/03_admin/calendar-management.html' },
  { name: 'オペレーター管理', path: '/03_admin/operator-management.html' },
  // perfList(人の一覧)がオペレーター別タブ側にあるため、一覧の検査はタブを開いた状態で行う
  { name: 'オペレーター実績確認', path: '/03_admin/performance-management.html?tab=operators' },
  { name: 'グループ実績詳細', path: '/03_admin/performance-group-detail.html' },
  { name: 'オペレーター実績詳細', path: '/03_admin/performance-operator-detail.html' },
  { name: '監査ログ', path: '/03_admin/audit-log.html' },
  { name: 'データ入力対象一覧', path: '/03_admin/data-entry/index.html' },
  { name: '名刺入力画面', path: '/03_admin/data-entry/form.html' },
  { name: '名刺入力画面(全グループ)', path: '/03_admin/data-entry/form.html?g=all' },
  { name: '照合結果一覧', path: '/03_admin/reconciliation/index.html' },
  { name: '名刺情報照合', path: '/03_admin/reconciliation/detail.html' },
];

/**
 * 一覧を持つ9画面。
 * sortCol は並び替えの検証に使う列の index、numeric はその列を数として比べるか。
 */
const LISTS = [
  { name: 'ユーザー管理', path: '/03_admin/user-management.html', id: 'usersList', sortCol: 0, numeric: false },
  { name: 'アンケート管理', path: '/03_admin/survey-management.html', id: 'surveysList', sortCol: 5, numeric: true },
  { name: '請求管理', path: '/03_admin/billing-management.html', id: 'billingList', sortCol: 3, numeric: true },
  { name: '請求書管理', path: '/03_admin/invoice-management.html', id: 'invoiceList', sortCol: 5, numeric: true },
  { name: 'クーポン管理', path: '/03_admin/coupon-management.html', id: 'couponList', sortCol: 5, numeric: true },
  { name: '照合結果一覧', path: '/03_admin/reconciliation/index.html', id: 'reconList', sortCol: 0, numeric: false },
  { name: 'オペレーター管理', path: '/03_admin/operator-management.html', id: 'operatorsList', sortCol: 0, numeric: false },
  // 一覧はタブ2枚構成。perfList はオペレーター別タブ側にあるため ?tab= で開いた状態から検査する
  { name: 'オペレーター実績確認', path: '/03_admin/performance-management.html?tab=operators', id: 'perfList', sortCol: 3, numeric: true },
  { name: '監査ログ', path: '/03_admin/audit-log.html', id: 'auditList', sortCol: 0, numeric: false },
];

/**
 * 一覧・集計領域の取得状態(01_admin_common_ui.md §4.4)を持つ画面。
 * proto-ui.js の pRegionState/pPageState が URL クエリ `?state=` を読んで
 * [data-a-region] の各領域を loading/reloading/error/error-keep/partial に切り替える。
 * list/summary は該当領域の id（無ければ省略）。1画面に両方持つ場合もある。
 * partial: true は state=partial（集計のみ失敗）が意味を持つ画面（reconciliation/data-entry の2つ。
 * 実績管理はタブ構成のため対象外という設計判断）。
 */
const REGIONS = [
  { name: 'ユーザー管理', path: '/03_admin/user-management.html', list: 'usersList' },
  { name: 'アンケート管理', path: '/03_admin/survey-management.html', list: 'surveysList' },
  { name: '請求管理', path: '/03_admin/billing-management.html', list: 'billingList' },
  { name: '請求書管理', path: '/03_admin/invoice-management.html', list: 'invoiceList' },
  { name: 'クーポン管理', path: '/03_admin/coupon-management.html', list: 'couponList' },
  {
    name: '照合結果一覧', path: '/03_admin/reconciliation/index.html',
    list: 'reconList', summary: 'reconSummary', partial: true,
  },
  { name: 'オペレーター管理', path: '/03_admin/operator-management.html', list: 'operatorsList' },
  // perfList はオペレーター別タブ側にあるため、一覧の検査はタブを開いた状態で行う（LISTS と同じ理由）
  { name: 'オペレーター実績確認(オペレーター別タブ)', path: '/03_admin/performance-management.html?tab=operators', list: 'perfList' },
  { name: '監査ログ', path: '/03_admin/audit-log.html', list: 'auditList' },
  {
    name: 'データ入力対象一覧', path: '/03_admin/data-entry/index.html',
    list: 'groupList', summary: 'deSummary', partial: true,
    note: 'groupList はページャ・絞り込み・data-a-ctl を持たない（data-g 行の静的一覧）',
  },
  {
    name: 'ダッシュボード(案件パイプライン)', path: '/03_admin/index.html', summary: 'dashCardsPipeline',
    note: 'Lv2以上で表示。既定シナリオ(Lv4)では可視',
  },
  {
    name: 'ダッシュボード(あなたの作業)', path: '/03_admin/index.html', summary: 'dashCardsWork',
    visibleByDefault: false,
    note: 'Lv1限定領域。既定シナリオ(Lv4)ではラッパーごと display:none のため、'
      + '可視判定はできず data-a-state 属性の有無のみ確認する',
  },
  // perfGroups はグループ別集計タブ（既定表示）側にあるため、タブ切替クエリなしで検査する
  { name: 'オペレーター実績確認(グループ別タブ)', path: '/03_admin/performance-management.html', summary: 'perfGroups' },
  { name: 'グループ実績詳細', path: '/03_admin/performance-group-detail.html', summary: 'pgSummary' },
  { name: 'オペレーター実績詳細', path: '/03_admin/performance-operator-detail.html', summary: 'poSummary' },
];

/** 画面を開き、描画とシェル注入の完了まで待つ */
async function openScreen(page, path) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') { errors.push('console: ' + m.text()); }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  // networkidle は待ちが読めないので使わない。準備完了の合図は
  // 「admin.js が共通シェルを差し込み終えたか」で判断する
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const h = document.querySelector('#header-placeholder');
      if (!h || !h.children.length) { return false; }
      // サイドバーは全画面作業モードの2画面には無い。ある画面では注入まで待つ
      const s = document.querySelector('#sidebar-placeholder');
      if (s && !s.children.length) { return false; }
      return typeof window.pLevel === 'function';
    },
    null,
    { timeout: 15000 },
  );
  return errors;
}

module.exports = { SCREENS, LISTS, REGIONS, openScreen };

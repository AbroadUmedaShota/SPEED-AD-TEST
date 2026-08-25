const { test, expect } = require('@playwright/test');

/**
 * 権限の足りないシナリオで開いたときのページガード。
 *
 * proto-level.js は main[data-page-min-lv] の範囲外で main.innerHTML をガード表示へ
 * 差し替える。差し替えの後に画面側の描画が走ると、消えた要素へ書き込んで例外になる。
 * ガード文言は出るので画面を見ても気付けず、console にだけ残る。
 *
 * 15画面を並列に開くと静的サーバーが取りこぼすため、1つのテストで順に回す。
 * 判定は本題の pageerror（未捕捉の例外）に絞る。資材の読み込みは他のテストが見ている。
 */

const BASE = '/03_admin';

// data-page-min-lv を持つ画面と、その最小レベル
const GUARDED = [
  { path: `${BASE}/calendar-management.html`, min: 2 },
  { path: `${BASE}/operator-management.html`, min: 2 },
  { path: `${BASE}/performance-management.html`, min: 2 },
  { path: `${BASE}/performance-group-detail.html`, min: 2 },
  { path: `${BASE}/performance-operator-detail.html`, min: 2 },
  { path: `${BASE}/reconciliation/index.html`, min: 2 },
  { path: `${BASE}/reconciliation/detail.html`, min: 2 },
  { path: `${BASE}/audit-log.html`, min: 3 },
  { path: `${BASE}/billing-management.html`, min: 3 },
  { path: `${BASE}/coupon-management.html`, min: 3 },
  { path: `${BASE}/invoice-management.html`, min: 3 },
  { path: `${BASE}/survey-management.html`, min: 3 },
  { path: `${BASE}/survey-detail.html`, min: 3 },
  { path: `${BASE}/user-management.html`, min: 3 },
  { path: `${BASE}/user-detail.html`, min: 3 },
  // 到達不能2画面(index.htmlからリンクなし・URL直打ちのみ)。旧世代マークアップで
  // proto-level.js未読込のため権限ガードが効いていなかった(2026-08-25 修正)
  { path: `${BASE}/escalations.html`, min: 3 },
  { path: `${BASE}/reconciliation/list.html`, min: 2 },
];

test('権限の足りないシナリオではガード表示になり、例外を出さない', async ({ page }) => {
  test.slow();
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(`${page.url().split('/').pop()}: ${e.message}`));

  const noGuard = [];
  for (const { path, min } of GUARDED) {
    const lv = `lv${min - 1}`;
    await page.addInitScript((v) => localStorage.setItem('adminMockLevel', v), lv);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    const main = (await page.locator('#main-content').innerText()).trim();
    if (!main.includes('シナリオでは表示されません')) {
      noGuard.push(`${path} (${lv})`);
    }
  }

  expect(noGuard, `ガード表示にならない画面: ${noGuard.join(' / ')}`).toEqual([]);
  expect(thrown, `ガード表示の裏で例外が出ている: ${thrown.join(' / ')}`).toEqual([]);
});

/**
 * 到達不能2画面(escalations.html・reconciliation/list.html)は、権限を満たすシナリオでは
 * 通常どおり表示され、ヘッダーの「表示シナリオ」select(#levelSelect)が proto-level.js に
 * よって配線されることを確認する(2026-08-25 追加。以前は proto-level.js 自体が未読込だった)。
 */
test('到達不能2画面は権限を満たすシナリオで通常表示され、表示シナリオselectが配線される', async ({ page }) => {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(e.message));

  for (const { path, min } of [
    { path: `${BASE}/escalations.html`, min: 3 },
    { path: `${BASE}/reconciliation/list.html`, min: 2 },
  ]) {
    const lv = `lv${min}`;
    await page.addInitScript((v) => localStorage.setItem('adminMockLevel', v), lv);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    await page.waitForSelector('#levelSelect', { timeout: 20000 });

    const main = (await page.locator('#main-content').innerText()).trim();
    expect(main, `${path} (${lv}) はガード表示にならないはず`).not.toContain('シナリオでは表示されません');

    const wired = await page.locator('#levelSelect').evaluate((el) => el.dataset.wired === '1' && el.value);
    expect(wired, `${path} の #levelSelect が proto-level.js で配線されていない`).toBe(lv);
  }

  expect(thrown, `到達不能2画面で例外が出ている: ${thrown.join(' / ')}`).toEqual([]);
});

/**
 * Lv2(OperatorAdmin)は自グループのオペレーターのみ集計できる(00号§5)。
 * グループ別集計に他社(オフィスワークス株式会社・データパートナーズ株式会社)の
 * 報酬額が混ざって見えていた不具合の回帰。
 */
test('Lv2の実績管理はグループ別集計が自グループのみになる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('adminMockLevel', 'lv2'));
  await page.goto(`${BASE}/performance-management.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
  await page.waitForSelector('#perfGroupsBody > div', { timeout: 20000 });

  const names = await page.locator('#perfGroupsBody > div > span:first-child').allInnerTexts();
  expect(names).toEqual(['アブロード本体']);
});

/**
 * オペレーター別集計は「作業件数 ▼」の見出しどおり、実データの降順で並ぶ(初期表示・並び替え未操作時)。
 * OP-0077(2,742件)がOP-0034(2,412件)より上に来る必要がある。
 */
test('実績管理のオペレーター別集計は初期表示が作業件数の降順になる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('adminMockLevel', 'lv4'));
  // ?tab=operators でオペレーター別集計タブを開いた状態にする(既定はグループ別集計タブで
  // paneOps が hidden のため、行は DOM にはあっても visible にならない)
  await page.goto(`${BASE}/performance-management.html?tab=operators`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
  await page.waitForSelector('#perfList [data-pg]', { timeout: 20000 });

  const oids = await page.locator('#perfList [data-pg]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-f-oid')));
  expect(oids).toEqual(['OP-0058', 'OP-0012', 'OP-0077', 'OP-0034', 'OP-0081', 'OP-0061']);
});

/**
 * オペレーター管理の詳細から ?oid= 付きで遷移した場合、オペレーター別集計タブが開き、
 * 対象オペレーターのみに絞り込まれ、解除手段付きの絞り込み表示が出ることを確認する(23号§4.4)。
 * 実測の結果、proto-ui.js の data-filter-keys 汎用機構(pApplyUrlFilter)が既にこの絞り込みを
 * 処理していたため、この項目自体はコード変更不要だった。回帰を防ぐためテストとして固定する。
 */
test('?oid= 遷移でオペレーター別集計が対象オペレーターに絞り込まれる', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('adminMockLevel', 'lv4'));
  await page.goto(`${BASE}/performance-management.html?oid=OP-0058`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
  await page.waitForSelector('#perfList-chip', { timeout: 20000 });

  await expect(page.locator('#tabOps')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#perfList-total')).toHaveText('1');
  await expect(page.locator('#perfList-chip')).toContainText('オペレーターID = OP-0058');
  await expect(page.locator('#perfList-chip button')).toHaveText('解除');

  const visible = await page.locator('#perfList [data-pg]:not([data-out])').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-f-oid')));
  expect(visible).toEqual(['OP-0058']);
});

/**
 * Lv2(OperatorAdmin)は自グループのオペレーターのみ閲覧できる(00号§5)。
 * グループ別集計は一覧側(renderGroups)で自グループへ絞られていたが、詳細2画面
 * (グループ実績詳細・オペレーター実績詳細)は存在チェックのみで、他社の gid/oid を
 * URL に直打ちすると報酬金額まで見えていた不具合の回帰(ストップ時レビュー検出)。
 */
test.describe('Lv2は実績詳細2画面で他社の対象を直打ちしても見られない', () => {
  test('グループ実績詳細: 自グループは開けるが他社グループは見つからない扱いになる', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('adminMockLevel', 'lv2'));

    // 自グループ(アブロード本体・gid=abroad)は通常どおり開ける
    await page.goto(`${BASE}/performance-group-detail.html?group=abroad`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    await expect(page.locator('[data-slot="gname"]')).toHaveText('アブロード本体');

    // 他社グループ(オフィスワークス株式会社・gid=officeworks)は直打ちしても見つからない扱い
    await page.goto(`${BASE}/performance-group-detail.html?group=officeworks`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    const main = (await page.locator('#main-content').innerText()).trim();
    expect(main, '他社グループが見えてしまっている(存在しない体になっていない)').toContain('指定されたグループが見つかりません');
    expect(main, '他社の報酬金額が漏れている').not.toContain('円');
  });

  test('オペレーター実績詳細: 自グループのオペレーターは開けるが他社オペレーターは見つからない扱いになる', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('adminMockLevel', 'lv2'));

    // 自グループ(アブロード本体)所属のOP-0012は通常どおり開ける
    await page.goto(`${BASE}/performance-operator-detail.html?oid=OP-0012`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    await expect(page.locator('[data-slot="opid"]')).toHaveText('OP-0012');

    // 他社(オフィスワークス株式会社)所属のOP-0058は直打ちしても見つからない扱い
    await page.goto(`${BASE}/performance-operator-detail.html?oid=OP-0058`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    const main = (await page.locator('#main-content').innerText()).trim();
    expect(main, '他社オペレーターが見えてしまっている(存在しない体になっていない)').toContain('指定されたオペレーターが見つかりません');
    expect(main, '他社の報酬金額が漏れている').not.toContain('円');
  });
});

/**
 * proto-level.js のドメイン置換(@abroad-o.com → @abroad.example.com)後、
 * pAccountMail() を参照する画面のヘッダー表示が壊れていないことを確認する(Lv2〜Lv4)。
 */
test('ドメイン置換後もヘッダーのメール表示が新ドメインで壊れずに出る', async ({ page }) => {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(e.message));

  for (const lv of ['lv2', 'lv3', 'lv4']) {
    await page.addInitScript((v) => localStorage.setItem('adminMockLevel', v), lv);
    await page.goto(`${BASE}/performance-management.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.pLevel === 'function', null, { timeout: 20000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('profileMail');
      return el && /@/.test(el.textContent);
    }, null, { timeout: 20000 });

    const mail = await page.locator('#profileMail').innerText();
    expect(mail, `${lv} のヘッダーメール表示`).toContain('@abroad.example.com');
    expect(mail, `${lv} のヘッダーメール表示に旧ドメインが残っている`).not.toContain('abroad-o.com');
  }

  expect(thrown, `ドメイン置換後に例外が出ている: ${thrown.join(' / ')}`).toEqual([]);
});

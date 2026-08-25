const { test, expect } = require('@playwright/test');
const { SCREENS, openScreen } = require('./_screens');

/**
 * 画面の衛生状態。1画面ずつ目視しても出てこない型の欠陥をまとめて拾う。
 *
 * このセッションで実際に出た欠陥から作った検査:
 *   - 重複 id（オペレーター管理に空表示の div が 2 つ）
 *   - 名前の無い入力欄（全グループ入力の textarea）
 *   - 一覧の列数と表示セル数のずれ（照合結果一覧に列を足したとき）
 *   - 枠から切れる（ユーザー詳細の2カラム。overflow-x-hidden の内側で気づけない）
 *   - 存在しない ID で既定の対象へ黙ってフォールバック
 *   - モーダルが Esc で閉じない（未保存の判定が開く前から真だった）
 */

/** ページ内で走らせる構造・表示の検査 */
const CHECK = () => {
  const r = { dupId: [], noLabel: [], deadLink: [], clipped: [], gridMismatch: [] };

  const seen = {};
  document.querySelectorAll('[id]').forEach((e) => { seen[e.id] = (seen[e.id] || 0) + 1; });
  Object.keys(seen).forEach((k) => { if (seen[k] > 1) { r.dupId.push(`${k}×${seen[k]}`); } });

  document.querySelectorAll('#main-content input, #main-content select, #main-content textarea').forEach((e) => {
    if (['hidden', 'radio', 'checkbox'].includes(e.type)) { return; }
    const named = e.getAttribute('aria-label') || e.getAttribute('title')
      || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label');
    if (!named) { r.noLabel.push(`${e.tagName.toLowerCase()}[${e.placeholder || e.id || '?'}]`); }
  });

  document.querySelectorAll('#main-content a[href="#"], #main-content a[href=""]').forEach((e) => {
    if (!e.getAttribute('onclick') && !e.onclick) { r.deadLink.push((e.textContent || '').trim().slice(0, 14)); }
  });

  // 枠から切れている要素。ellipsis・line-clamp・明示的な横スクロール容器・入力欄の内部スクロールは除く
  document.querySelectorAll('#main-content *').forEach((e) => {
    const d = e.scrollWidth - e.clientWidth;
    if (d <= 1 || e.clientWidth < 80) { return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) { return; }
    const st = getComputedStyle(e);
    if (st.textOverflow === 'ellipsis') { return; }
    if (st.webkitLineClamp && st.webkitLineClamp !== 'none') { return; }
    if (st.overflowX === 'auto' || st.overflowX === 'scroll') { return; }
    r.clipped.push(`${e.id || e.tagName.toLowerCase()}+${d}px`);
  });

  // 一覧の見出し・行のセル数がグリッドの列数と合うか。ずれると列が横にずれる
  document.querySelectorAll('[id$="List"], #groupList').forEach((list) => {
    // 非表示のタブ内などレンダリングされていない一覧は対象外。
    // 非表示だと grid-template-columns が px へ解決されず minmax 表記のまま数えてしまう
    if (!list.offsetParent) { return; }
    const head = list.firstElementChild;
    if (!head || getComputedStyle(head).display !== 'grid') { return; }
    const cols = getComputedStyle(head).gridTemplateColumns.split(' ').length;
    const shown = (el) => Array.from(el.children).filter((c) => getComputedStyle(c).display !== 'none').length;
    if (shown(head) !== cols) { r.gridMismatch.push(`${list.id} 見出し${shown(head)}/列${cols}`); }
    const row = list.querySelector('[data-pg]');
    if (row && getComputedStyle(row).display === 'grid' && shown(row) !== cols) {
      r.gridMismatch.push(`${list.id} 行${shown(row)}/列${cols}`);
    }
  });
  return r;
};

for (const s of SCREENS) {
  test(`${s.name}: 構造と表示が壊れていない`, async ({ page }) => {
    const errors = await openScreen(page, s.path);
    const r = await page.evaluate(CHECK);
    expect(errors, `JS/読み込みエラー: ${errors.join(' / ')}`).toEqual([]);
    expect(r.dupId, `id が重複: ${r.dupId.join(', ')}`).toEqual([]);
    expect(r.noLabel, `名前の無い入力欄: ${r.noLabel.join(', ')}`).toEqual([]);
    expect(r.deadLink, `行き先の無いリンク: ${r.deadLink.join(', ')}`).toEqual([]);
    expect(r.clipped, `枠から切れている: ${r.clipped.join(', ')}`).toEqual([]);
    expect(r.gridMismatch, `列数がずれている: ${r.gridMismatch.join(', ')}`).toEqual([]);
  });
}

test.describe('存在しない対象を指定したとき', () => {
  const CASES = [
    ['ユーザー詳細', '/03_admin/user-detail.html', 'U-9999'],
    ['アンケート詳細', '/03_admin/survey-detail.html', 'SV-99999'],
    ['名刺情報照合', '/03_admin/reconciliation/detail.html', 'SV-99999'],
  ];
  for (const [name, base, bad] of CASES) {
    test(`${name}: 別の対象を黙って出さない`, async ({ page }) => {
      await openScreen(page, `${base}?id=${bad}`);
      const t = await page.locator('#main-content').textContent();
      expect(t, '存在しない ID なのに通常表示になっている').toContain('見つかりません');
      expect(t).toContain(bad);
    });
  }
});

test.describe('モーダルは開いて Esc で閉じる', () => {
  const PAGES = [
    ['ユーザー詳細', '/03_admin/user-detail.html?id=U-1051'],
    ['アンケート詳細', '/03_admin/survey-detail.html?id=SV-10262'],
    ['照合結果一覧', '/03_admin/reconciliation/index.html'],
    ['名刺情報照合', '/03_admin/reconciliation/detail.html'],
    ['名刺入力画面', '/03_admin/data-entry/form.html'],
  ];
  for (const [name, url] of PAGES) {
    test(`${name}`, async ({ page }) => {
      await openScreen(page, url);
      const ids = await page.$$eval('.proto-modal[id]', (e) => e.map((x) => x.id));
      expect(ids.length, 'モーダルが1つも無い').toBeGreaterThan(0);
      for (const id of ids) {
        await page.evaluate((i) => window.pOpen(i), id);
        expect(await page.evaluate((i) => !document.getElementById(i).hidden, id), `${id} が開かない`).toBe(true);
        expect(await page.evaluate(() => document.activeElement.tagName),
          `${id} を開いてもフォーカスが移らない`).not.toBe('BODY');
        await page.keyboard.press('Escape');
        expect(await page.evaluate((i) => document.getElementById(i).hidden, id),
          `${id} が Esc で閉じない`).toBe(true);
      }
    });
  }
});

test.describe('行の操作は押した行を対象にする', () => {
  // データDL のモーダルは対象名がハードコードされており、どの行から開いても
  // 同じアンケート（SV-10250）を指していた。ファイル名もそれで決まる
  const CASES = [
    ['アンケート管理', '/03_admin/survey-management.html', 'surveysList'],
    ['照合結果一覧', '/03_admin/reconciliation/index.html', 'reconList'],
  ];
  for (const [name, url, listId] of CASES) {
    test(`${name}: データDL が押した行のアンケートを指す`, async ({ page }) => {
      await openScreen(page, url);
      const sids = await page.$$eval(`#${listId} [data-pg]`,
        (els) => els.map((e) => e.getAttribute('data-f-sid')).filter(Boolean));
      expect(sids.length).toBeGreaterThan(2);

      let checked = 0;
      for (const sid of sids.slice(0, 4)) {
        const btn = page.locator(`#${listId} [data-f-sid="${sid}"] button:has-text("DL")`);
        if (!(await btn.count())) { continue; }
        await btn.click();
        const t = (await page.locator('#mDl').textContent()).replace(/\s+/g, ' ');
        const shown = t.match(/SV-\d+/g) || [];
        expect(shown, `${sid} から開いたのに ${shown.join(',')} を指している`).toContain(sid);
        expect([...new Set(shown)], `${sid} 以外のアンケートも出ている`).toEqual([sid]);
        await page.keyboard.press('Escape');
        checked += 1;
      }
      expect(checked, 'データDL のある行が見つからない').toBeGreaterThan(1);
    });
  }
});

test.describe('非活性のボタンには理由を添える', () => {
  // 押せない理由が画面から読み取れないと、操作できないのか壊れているのか区別がつかない
  const CASES = [
    ['照合結果一覧', '/03_admin/reconciliation/index.html'],
    ['データ入力対象一覧', '/03_admin/data-entry/index.html'],
    ['名刺情報照合', '/03_admin/reconciliation/detail.html'],
    ['アンケート詳細', '/03_admin/survey-detail.html?id=SV-10259'],
  ];
  for (const [name, url] of CASES) {
    test(`${name}`, async ({ page }) => {
      await openScreen(page, url);
      const bad = await page.$$eval('#main-content button[disabled]', (els) => els
        .filter((e) => !e.getAttribute('title') && !e.getAttribute('aria-describedby'))
        .map((e) => (e.textContent || '').trim().slice(0, 16)));
      expect(bad, `理由の無い非活性ボタン: ${bad.join(', ')}`).toEqual([]);
    });
  }
});

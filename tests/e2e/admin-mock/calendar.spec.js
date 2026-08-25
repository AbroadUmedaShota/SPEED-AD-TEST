const { test, expect } = require('@playwright/test');
const { openScreen } = require('./_screens');

/**
 * 営業日カレンダー（SCR-A-008）営業日タブの会期件数。
 *
 * 18_admin_calendar.md §4.4.1。営業日タブは帯を持たないため、その日に会期があるか
 * どうかを月セルの「会期 N 件」だけで示す。件数が壊れると、日付を総当たりしない限り
 * 会期のあるアンケートへ辿り着けなくなる。
 */

const PATH = '/03_admin/calendar-management.html';

/** 月セルの「会期 N 件」を日付ごとに読む。日番号はセルの aria-label から引く */
async function cellCounts(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#calGrid > div[style*="grid-template-rows"]').forEach((week) => {
      const cols = {};
      week.querySelectorAll('[role="button"][aria-label]').forEach((c) => {
        const m = /^(\d+)月(\d+)日$/.exec(c.getAttribute('aria-label') || '');
        if (m) { cols[getComputedStyle(c).gridColumnStart] = `${m[1]}/${m[2]}`; }
      });
      week.querySelectorAll('div').forEach((e) => {
        const m = /^会期 (\d+)件$/.exec((e.innerText || '').trim());
        if (!m) { return; }
        const key = cols[getComputedStyle(e).gridColumnStart];
        if (key) { out[key] = Number(m[1]); }
      });
    });
    return out;
  });
}

test.describe('営業日タブの会期件数（§4.4.1）', () => {
  test('件数が出た日は、その日を選んだときの日付詳細の件数と一致する', async ({ page }) => {
    test.slow();
    const errors = await openScreen(page, PATH);
    const counts = await cellCounts(page);
    const days = Object.keys(counts).filter((k) => k.startsWith('7/'));
    expect(days.length, '7月に会期のある日が1日も出ていない').toBeGreaterThan(0);

    for (const key of days) {
      const d = key.split('/')[1];
      await page.getByLabel(`7月${d}日`, { exact: false }).first().click();
      const panel = (await page.locator('#calPanel').innerText()).trim();
      const m = /この日に会期のあるアンケート\((\d+)件\)/.exec(panel);
      expect(m, `7/${d} の日付詳細に件数が出ていない`).not.toBeNull();
      expect(Number(m[1]), `7/${d} のセルと詳細で件数が違う`).toBe(counts[key]);
    }
    expect(errors, `console エラー: ${errors.join(' / ')}`).toEqual([]);
  });

  test('会期の無い日には件数を出さない', async ({ page }) => {
    await openScreen(page, PATH);
    const counts = await cellCounts(page);
    // 7/6 は作業期間が通るが会期は無い。作業を数えていればここに件数が出る
    expect(counts['7/6'], '会期が無い日に件数が出ている').toBeUndefined();

    await page.getByLabel('7月6日', { exact: false }).first().click();
    const panel = (await page.locator('#calPanel').innerText()).trim();
    expect(panel).toContain('この日に会期のあるアンケートはありません');
  });

  test('月セルに「他 N 件」を出さない（帯のあふれはアサインタブだけの表示）', async ({ page }) => {
    // collectBands は作業期間でレーンを確保する。営業日タブでも計上してしまうと、
    // 描いていない作業帯のあふれが会期の件数の横に並び、会期が増えたように読める
    await openScreen(page, PATH);
    const grid = await page.locator('#calGrid').innerText();
    const hit = grid.split('\n').map((s) => s.trim()).filter((s) => /他\d+件/.test(s));
    expect(hit, `営業日タブに帯のあふれが出ている: ${hit.join(' / ')}`).toEqual([]);
  });

  test('帯を持つのはアサインタブだけで、営業日タブは持たない', async ({ page }) => {
    const bands = '#calGrid div[role="button"][aria-label*="作業期間"]';
    await openScreen(page, `${PATH}?tab=assign`);
    await expect(page.locator(bands).first()).toBeVisible();

    await openScreen(page, PATH);
    // 件数が出ていることを先に確かめてから、帯が無いことを見る。
    // 描画前に数えると「帯が無い」が偽陽性になる
    await expect(page.locator('#calGrid')).toContainText('会期');
    expect(await page.locator(bands).count(), '営業日タブに作業期間の帯が出ている').toBe(0);
  });
});

/**
 * アサインモーダルの人数説明（18_admin_calendar.md §4.5）。
 *
 * 「人数は会期の全日ではなく、作業期間を通した1日あたりの人数とする」が正。計算ロジック
 * (otherLoad/supplyOf/dailyLoad)はもともと作業期間ベースで、説明文だけが逆のことを言っていた。
 */
test.describe('アサインモーダルの人数説明（§4.5）', () => {
  test('人数は会期の全日ではなく作業期間を通した1日あたりの人数と説明する', async ({ page }) => {
    await openScreen(page, `${PATH}?tab=assign`);
    await page.evaluate(() => window.calAssignOpen('SV-10262'));
    await expect(page.locator('#mAssign')).toBeVisible();
    const note = await page.locator('#mAssign').innerText();
    expect(note, 'モーダルの人数説明が仕様と逆のまま').toContain('作業期間を通した1日あたりの人数');
    expect(note, '「会期の全日」の誤説明が残っている').not.toContain('会期の全日を通しての人数');
  });
});

/**
 * 日付表記の統一（01_admin_common_ui.md §9）。
 *
 * カレンダーセル・案件カードはスペース制約があるため M/D の簡略表示を維持する一方、
 * 増員依頼モーダルのように余裕がある箇所は YYYY/MM/DD に揃える。
 */
test.describe('増員モーダルの日付表記（§9）', () => {
  test('会期・納期・作業のいずれもYYYY/MM/DDで表示する', async ({ page }) => {
    await openScreen(page, `${PATH}?tab=assign`);
    // SV-10259は総動員でも不足しており、増員モーダルを開ける
    await page.evaluate(() => window.calRecruitOpen('SV-10259'));
    await expect(page.locator('#mRecruit')).toBeVisible();
    const stats = await page.locator('#calRecStats').innerText();
    expect(stats, '会期・納期の表記が崩れている').toMatch(/会期 \d{4}\/\d{2}\/\d{2}/);
    expect(stats, '作業期間がM\\/D簡略のまま残っている').toMatch(/作業 \d{4}\/\d{2}\/\d{2}/);
  });
});

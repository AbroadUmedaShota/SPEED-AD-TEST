const { test, expect } = require('@playwright/test');
const { openScreen } = require('./_screens');

/**
 * 照合結果一覧（SCR-A-011 / SCR-A-012）と名刺情報照合（SCR-A-013）。
 *
 * 21_admin_matching_list.md §4.3・§4.4・§4.5・§6 と
 * 22_admin_matching_form.md §4.1・§4.2・§4.4・§4.5・§4.6 を見る。
 */

const LIST = '/03_admin/reconciliation/index.html';
const FORM = '/03_admin/reconciliation/detail.html';

/** 表示シナリオを切り替えてから開く（proto-level.js は localStorage を見る） */
async function openAs(page, path, level) {
  await page.addInitScript((lv) => { localStorage.setItem('adminMockLevel', lv); }, level);
  return openScreen(page, path);
}

test.describe('照合結果一覧', () => {
  test('会社名は Lv3 以上にだけ出し、Lv2 では列がずれない（§6）', async ({ page }) => {
    await openAs(page, LIST, 'lv4');
    expect(await page.locator('#reconList .rc-line').first().locator('.c-client').isVisible()).toBe(true);
    const lv4 = await page.evaluate(() => getComputedStyle(document.querySelector('#reconList .rc-line')).gridTemplateColumns.split(' ').length);

    await page.addInitScript(() => { localStorage.setItem('adminMockLevel', 'lv2'); });
    await openScreen(page, LIST);
    expect(await page.locator('#reconList .rc-line').first().locator('.c-client').isVisible()).toBe(false);
    expect(await page.locator('input[data-f-key="company"]').isVisible(), '会社名の検索欄が Lv2 に出ている').toBe(false);
    const lv2 = await page.evaluate(() => getComputedStyle(document.querySelector('#reconList .rc-line')).gridTemplateColumns.split(' ').length);
    // 会社名の 1 列だけが減る。減らないと非表示のセルの分だけ他の列がずれる
    expect(lv2).toBe(lv4 - 1);
  });

  test('納期区分と会社名で絞り込める（§4.3）', async ({ page }) => {
    await openAs(page, LIST, 'lv4');
    const total = page.locator('#reconList-total');
    const all = Number(await total.textContent());

    await page.selectOption('select[data-f-key="plan"]', 'オンデマンド');
    await page.click('button:has-text("検索")');
    expect(Number(await total.textContent())).toBeLessThan(all);

    await page.click('button:has-text("条件をクリア")');
    expect(Number(await total.textContent())).toBe(all);

    await page.fill('input[data-f-key="company"]', '地方創生');
    await page.click('button:has-text("検索")');
    expect(Number(await total.textContent())).toBe(1);
  });

  test('データDLから回答データCSVを選べる（§4.5）', async ({ page }) => {
    await openAs(page, LIST, 'lv4');
    await page.locator('button:has-text("データDL")').first().click();
    const labels = await page.$$eval('#mDl button strong', (els) => els.map((e) => e.textContent.trim()));
    expect(labels).toEqual(['完成データCSV', '全レコードCSV', '回答データCSV', '名刺画像(ZIP)']);
  });
});

test.describe('名刺情報照合', () => {
  test('表と裏の名刺画像を同時に表示する（§4.2）', async ({ page }) => {
    await openScreen(page, FORM);
    const faces = await page.$$eval('.card-zoom img', (els) => els.map((e) => e.alt));
    expect(faces.length).toBe(2);
    expect(await page.locator('.card-zoom img').first().isVisible()).toBe(true);
    expect(await page.locator('.card-zoom img').nth(1).isVisible()).toBe(true);
  });

  test('表示枠が上段の左右いっぱいに広がり、表と裏が互いにはみ出さない（§4.2）', async ({ page }) => {
    await openScreen(page, FORM);
    const m = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('.card-zoom')).map((e) => e.getBoundingClientRect());
      // 枠 → 面の列 → 表裏を並べる行
      const row = document.querySelectorAll('.card-zoom')[0].parentElement.parentElement.getBoundingClientRect();
      return {
        widths: boxes.map((b) => Math.round(b.width)),
        half: Math.round(row.width / 2),
        overlap: boxes[0].right > boxes[1].left,
        clipped: Array.from(document.querySelectorAll('.card-zoom')).map((e) => getComputedStyle(e).overflow),
      };
    });
    // 上限幅を持たせると枠が半分より狭くなる。余白（左右と面の間）の分だけ引いた幅までは使う
    m.widths.forEach((w) => {
      expect(w, '表示枠が持ち分の半分まで広がっていない').toBeGreaterThan(m.half - 40);
      expect(w, '表示枠が持ち分を超えている').toBeLessThanOrEqual(m.half);
    });
    expect(m.overlap, '表と裏の枠が重なっている').toBe(false);
    // 拡大は枠で切り取る。切り取らないと隣の面へはみ出す
    expect(m.clipped).toEqual(['hidden', 'hidden']);
  });

  test('1920x1080 で比較表に 8 行が収まる（§4.1）', async ({ page }) => {
    await openScreen(page, FORM);
    const rows = await page.evaluate(() => {
      const box = document.getElementById('rcScroll');
      const h = document.querySelector('.rc-row').getBoundingClientRect().height;
      return (box.clientHeight - 36) / h;   // 36px は見出し行
    });
    expect(Math.floor(rows)).toBe(8);
  });

  test('確定の操作は画面上部にあり、比較表の下に帯を作らない（§4.1・§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    const m = await page.evaluate(() => {
      const btn = document.getElementById('btnMatchConfirm');
      const table = document.getElementById('rcScroll');
      return {
        btnBottom: btn.getBoundingClientRect().bottom,
        tableTop: table.getBoundingClientRect().top,
        state: document.getElementById('matchState').textContent,
        title: btn.title,
      };
    });
    expect(m.btnBottom, '確定ボタンが比較表より下にある').toBeLessThan(m.tableTop);
    // 非活性の理由は、残件の表示かボタンの説明のどちらかで読めること
    expect(`${m.state} ${m.title}`).toContain('残り 5');
  });

  test('一致した項目は確定済みで始まり、チェックを外すと編集できる（§4.4・§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    expect(await page.locator('#ok_mail').isChecked()).toBe(true);
    expect(await page.evaluate(() => document.getElementById('fix_mail').readOnly)).toBe(true);

    await page.locator('#ok_mail').uncheck();
    expect(await page.evaluate(() => document.getElementById('fix_mail').readOnly)).toBe(false);
    expect(await page.locator('#done_mail').textContent()).toBe('未確定');

    await page.locator('#ok_mail').check();
    expect(await page.evaluate(() => document.getElementById('fix_mail').readOnly)).toBe(true);
  });

  test('記載が無い項目は空欄のまま確定して「(記載なし)」になる（§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    // 電話番号2 はサンプルの名刺に記載が無い
    expect(await page.inputValue('#fix_tel2')).toBe('');
    expect(await page.locator('#ok_tel2').isChecked()).toBe(true);
    expect(await page.locator('#done_tel2').textContent()).toBe('(記載なし)');
  });

  test('全項目に確定チェックが付くまで確定できない（§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    expect(await page.locator('#btnMatchConfirm').isDisabled()).toBe(true);
    await page.locator('#rcAllCheck').check();
    expect(await page.locator('#btnMatchConfirm').isDisabled()).toBe(false);
    await page.locator('#rcAllCheck').uncheck();
    expect(await page.locator('#btnMatchConfirm').isDisabled()).toBe(true);
  });

  test('確定すると比較表が先頭へ戻る（§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    await page.locator('#rcAllCheck').check();
    await page.evaluate(() => { document.getElementById('rcScroll').scrollTop = 300; });
    expect(await page.evaluate(() => document.getElementById('rcScroll').scrollTop)).toBeGreaterThan(0);

    await page.click('#btnMatchConfirm');
    await page.click('#mConfirmMatch button:has-text("確定する")');
    expect(await page.evaluate(() => document.getElementById('rcScroll').scrollTop)).toBe(0);
  });

  test('ロックが解除されると名刺画像を伏せる（§4.6）', async ({ page }) => {
    await openScreen(page, FORM);
    // 3 分を待たずに済むよう、確認用の即時解除を使う
    await page.evaluate(() => window.pWorkLock.expireNow());
    await expect(page.locator('.card-lock-mask').first()).toBeVisible({ timeout: 5000 });
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.card-zoom img')).every((i) => i.style.visibility === 'hidden'))).toBe(true);
    expect(await page.locator('#lockBadge').textContent()).toContain('対象を再取得');

    await page.click('#lockBadge [data-lock-relock]');
    expect(await page.locator('.card-lock-mask').count()).toBe(0);
  });

  test('Ctrl+Z による独自の取り消しは持たない（§4.5）', async ({ page }) => {
    await openScreen(page, FORM);
    await page.locator('#ok_company').uncheck();
    const before = await page.inputValue('#fix_company');
    // OCR 結果を複写してから Ctrl+Z を押しても、複写前の値には戻らない
    await page.locator('.rc-row[data-k="company"] span[role="button"]').first().click();
    const copied = await page.inputValue('#fix_company');
    expect(copied).not.toBe(before);
    await page.keyboard.press('Control+z');
    expect(await page.inputValue('#fix_company')).toBe(copied);
  });
});

test('Lv2 でも作業領域が削られない（範囲の注記はヘッダーへ逃がす）', async ({ page }) => {
  const width = async () => page.evaluate(
    () => Math.round(document.querySelector('.card-zoom img').getBoundingClientRect().width));

  await openScreen(page, FORM);
  const lv4 = await width();

  await page.addInitScript(() => { localStorage.setItem('adminMockLevel', 'lv2'); });
  await openScreen(page, FORM);
  const note = page.locator('#proto-range-note');
  await expect(note, 'Lv2 の範囲注記が出ていない').toBeVisible();
  expect(await note.evaluate((el) => !!el.closest('header')), '注記が本文側にあり作業領域を削っている').toBe(true);
  // 本文へ帯を挟むと名刺が縮む。ヘッダーへ逃がしていれば Lv4 と同じ大きさで見られる
  expect(await width(), `Lv2 の名刺が Lv4 より小さい（Lv4=${lv4}）`).toBe(lv4);
});

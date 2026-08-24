const { test, expect } = require('@playwright/test');
const { openScreen } = require('./_screens');

/**
 * データ入力対象一覧（SCR-A-009）と名刺入力画面（SCR-A-010）。
 *
 * 19_admin_data_input_list.md §4.3・§4.4・§6 と
 * 20_admin_data_input_form.md §4.2・§4.4・§4.5・§4.6・§4.8 を見る。
 */

const LIST = '/03_admin/data-entry/index.html';
const FORM = '/03_admin/data-entry/form.html';

async function openAs(page, path, level) {
  await page.addInitScript((lv) => { localStorage.setItem('adminMockLevel', lv); }, level);
  return openScreen(page, path);
}

test.describe('データ入力対象一覧', () => {
  test('進捗が低い 2 グループを滞留として示す（§4.3）', async ({ page }) => {
    await openScreen(page, LIST);
    const stuck = await page.$$eval('#groupList .is-stuck', (els) => els.map((e) => Number(e.getAttribute('data-progress'))));
    expect(stuck.length).toBe(2);

    const all = await page.$$eval('#groupList .dg-row[data-progress]', (els) => els.map((e) => Number(e.getAttribute('data-progress'))).sort((a, b) => a - b));
    expect(stuck.sort((a, b) => a - b)).toEqual(all.slice(0, 2));
    expect(await page.locator('#groupList .is-stuck', { hasText: '滞留' }).count()).toBe(2);
  });

  test('全グループ入力への導線は Lv4 にだけ出す（§4.4・§6）', async ({ page }) => {
    await openAs(page, LIST, 'lv4');
    expect(await page.locator('button:has-text("全グループ入力画面へ")').isVisible()).toBe(true);

    await page.addInitScript(() => { localStorage.setItem('adminMockLevel', 'lv2'); });
    await openScreen(page, LIST);
    expect(await page.locator('button:has-text("全グループ入力画面へ")').isVisible()).toBe(false);
  });
});

/** 作業グループごとの総件数（進捗の「入力済み / 総件数」の右側） */
function totals(page) {
  return page.$$eval('#groupList .dg-row[data-g]', (els) => {
    const out = {};
    els.forEach((e) => {
      const m = e.querySelector('.dg-progress small').textContent.match(/([\d,]+)\s*\/\s*([\d,]+)/);
      out[e.getAttribute('data-g')] = m ? Number(m[2].replace(/,/g, '')) : 0;
    });
    return out;
  });
}

const LANG_FREE = ['1', '5', '6'];       // 言語非依存（20 §4.4）
const LANG_BOUND = ['2', '3', '4', '7', '8'];
const CODES = ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko'];

test.describe('対象言語の選択（19 §4.2・§4.3）', () => {
  test('選択肢は言語マスタの全件で、対応可能言語では絞らない', async ({ page }) => {
    // Lv1 は対応可能言語が日本語・中国語簡体字だが、選択肢はマスタ全件が並ぶ
    await openAs(page, LIST, 'lv1');
    const opts = await page.$$eval('#langSelect option', (els) => els.map((e) => e.value));
    expect(opts).toEqual(['auto'].concat(CODES));
    expect(await page.locator('#langSelect').inputValue()).toBe('auto');

    // 「自動」が指す範囲は画面上で読める
    expect(await page.locator('#langNote').innerText()).toContain('日本語・中国語簡体字');
  });

  test('「自動」の作業可能件数は対応可能言語の合計になる', async ({ page }) => {
    await openAs(page, LIST, 'lv4');   // 全言語
    const all = await page.locator('#availCount').innerText();

    await page.addInitScript(() => { localStorage.setItem('adminMockLevel', 'lv1'); });
    await openScreen(page, LIST);
    const lv1 = await page.locator('#availCount').innerText();
    expect(Number(lv1.replace(/,/g, ''))).toBeLessThan(Number(all.replace(/,/g, '')));
  });

  test('言語非依存の作業グループだけに「全言語」バッジが付く', async ({ page }) => {
    await openScreen(page, LIST);
    for (const g of LANG_FREE) {
      expect(await page.locator(`#groupList .dg-row[data-g="${g}"] .dg-status-badge`, { hasText: '全言語' }).count(),
        `グループ${g} に全言語バッジが無い`).toBe(1);
    }
    for (const g of LANG_BOUND) {
      expect(await page.locator(`#groupList .dg-row[data-g="${g}"] .dg-status-badge`, { hasText: '全言語' }).count(),
        `グループ${g} に全言語バッジが付いている`).toBe(0);
    }
  });

  test('対象言語を切り替えると言語依存のグループだけ件数が変わる', async ({ page }) => {
    await openScreen(page, LIST);
    const before = await totals(page);

    await page.selectOption('#langSelect', 'zh-Hans');
    const after = await totals(page);

    for (const g of LANG_FREE) {
      expect(after[g], `グループ${g} は対象言語で絞ってはいけない`).toBe(before[g]);
    }
    // ⑦は全言語で 0 件のため、言語を絞っても 0 のまま変わらない
    for (const g of LANG_BOUND.filter((x) => before[x] > 0)) {
      expect(after[g], `グループ${g} が対象言語で絞られていない`).toBeLessThan(before[g]);
    }
  });

  test('各言語の総件数の合計が全言語の総件数と一致する', async ({ page }) => {
    await openScreen(page, LIST);
    const all = await totals(page);

    const sum = {};
    for (const code of CODES) {
      await page.selectOption('#langSelect', code);
      const t = await totals(page);
      Object.keys(t).forEach((g) => { sum[g] = (sum[g] || 0) + t[g]; });
    }
    for (const g of LANG_BOUND) {
      expect(sum[g], `グループ${g} の言語別合計が全言語値と合わない`).toBe(all[g]);
    }
  });

  test('対象言語が入力画面へ引き継がれ、戻っても保たれる', async ({ page }) => {
    await openScreen(page, LIST);
    await page.selectOption('#langSelect', 'en');
    await page.click('#groupList .dg-row[data-g="3"] .dg-action button');

    await expect(page).toHaveURL(/g=3&lang=en/);
    expect(await page.locator('#langBadge').innerText()).toBe('対象言語: 英語');

    await page.goBack();
    expect(await page.locator('#langSelect').inputValue()).toBe('en');
  });
});

test.describe('名刺入力画面', () => {
  test('スキップの理由からエスカレーションを外している（§4.5）', async ({ page }) => {
    await openScreen(page, `${FORM}?g=3`);
    await page.click('#btnSkip');
    const reasons = await page.$$eval('#mSkip label', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    expect(reasons.some((r) => r.includes('エスカレーション'))).toBe(false);
    expect(reasons.some((r) => r.startsWith('名刺ではない'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('対応言語外'))).toBe(true);
  });

  test('言語非依存の作業グループでは「対応言語外」を出さない（§4.5）', async ({ page }) => {
    // ①⑤⑥ は入力値が言語に左右されず、読めない言語でも入力できるため理由が成立しない
    for (const g of ['1', '5', '6']) {
      await openScreen(page, `${FORM}?g=${g}&lang=zh-Hans`);
      expect(await page.locator('#langBadge').innerText(), `g=${g} の対象言語表示`).toBe('対象言語: 全言語');
      await page.click('#btnSkip');
      expect(await page.locator('#skipLangOut').isVisible(), `g=${g} で対応言語外が出ている`).toBe(false);
      await page.keyboard.press('Escape');
    }
  });

  test('裏面の画像が無い名刺では「裏面なし」と出す（§4.2）', async ({ page }) => {
    await openScreen(page, `${FORM}?g=3`);
    expect(await page.locator('#backNone').isVisible()).toBe(false);
    // サンプル 2 枚目は裏面を持たない
    await page.click('#btnConfirm');
    expect(await page.locator('#backNone').isVisible()).toBe(true);
  });

  test('郵便番号から住所候補を出し、押したときだけ入力する（§4.4）', async ({ page }) => {
    await openScreen(page, `${FORM}?g=4`);
    await page.fill('#g4_f1', '150-0001');
    await expect(page.locator('#zip_g4_f1')).toBeVisible();
    expect(await page.inputValue('#g4_f2'), '押していないのに住所が入っている').toBe('');

    await page.click('#zip_g4_f1 span[role="button"]');
    expect(await page.inputValue('#g4_f2')).toBe('東京都渋谷区神宮前');

    // 辞書に無い番号では候補を出さない
    await page.fill('#g4_f1', '999-9999');
    expect(await page.locator('#zip_g4_f1').isVisible()).toBe(false);
  });

  test('ロックが解除されると名刺を伏せ、確定・スキップを止める（§4.6）', async ({ page }) => {
    await openScreen(page, `${FORM}?g=3`);
    expect(await page.locator('#lockBadge').textContent()).toContain('作業ロック中');

    await page.evaluate(() => window.pWorkLock.expireNow());
    await expect(page.locator('.card-lock-mask').first()).toBeVisible({ timeout: 5000 });

    const sv = await page.locator('#svBadge').textContent();
    await page.click('#btnConfirm');
    expect(await page.locator('#svBadge').textContent(), 'ロック解除中に次の名刺へ進んだ').toBe(sv);
    expect(await page.locator('#p-toast').textContent()).toContain('ロックが解除されています');
  });

  test('全グループ入力は①〜⑧の全項目を並べる（§4.8）', async ({ page }) => {
    await openAs(page, `${FORM}?g=all`, 'lv4');
    expect(await page.locator('#groupBadge').textContent()).toContain('全グループ');
    // 20_admin_data_input_form.md §4.4 の項目表は合計 16 項目
    expect(await page.locator('#fieldsArea input, #fieldsArea textarea').count()).toBe(16);
  });

  test('全グループ入力は Lv3 以下では開けない（§6）', async ({ page }) => {
    await openAs(page, `${FORM}?g=all`, 'lv3');
    expect(await page.locator('#fieldsArea').count()).toBe(0);
    expect(await page.locator('#main-content').textContent()).toContain('Lv4 MasterAdmin');
  });
});

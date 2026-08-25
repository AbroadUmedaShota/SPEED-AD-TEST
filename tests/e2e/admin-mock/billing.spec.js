const { test, expect } = require('@playwright/test');
const { openScreen } = require('./_screens');

/**
 * 請求管理（SCR-A-006）。
 *
 * 15_admin_billing.md は 1 行 = 1 アンケートと定めている（§11 #8）。
 * 一覧から対象アンケートと請求先（個人契約かグループ契約か）が分かることを見る。
 */

test.describe('請求管理は1行=1アンケート', () => {
  test('全行にアンケートのタイトルとIDが出る', async ({ page }) => {
    await openScreen(page, '/03_admin/billing-management.html');

    const rows = await page.evaluate(() => {
      const list = document.getElementById('billingList');
      return [...list.children].slice(1)
        .filter((r) => r.hasAttribute('data-pg'))
        .map((r) => {
          const cell = r.children[0];
          return {
            text: (cell.textContent || '').replace(/\s+/g, ' ').trim(),
            sid: (cell.textContent.match(/SV-\d+/) || [null])[0],
            link: !!cell.querySelector('a, [onclick]'),
          };
        });
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sid, `アンケートIDが無い行がある: ${r.text}`).not.toBeNull();
      // ID だけでなくタイトルも要る（ID を除いた残りが空でないこと）
      expect(r.text.replace(r.sid, '').trim().length, `タイトルが空の行がある: ${r.text}`)
        .toBeGreaterThan(0);
    }
  });

  test('グループ契約は請求先にバッジを出し、個人契約には出さない', async ({ page }) => {
    await openScreen(page, '/03_admin/billing-management.html');

    const rows = await page.evaluate(() => {
      const list = document.getElementById('billingList');
      return [...list.children].slice(1)
        .filter((r) => r.hasAttribute('data-pg'))
        .map((r) => ({
          payer: (r.children[1].textContent || '').replace(/\s+/g, ' ').trim(),
          group: (r.children[1].textContent || '').includes('グループ'),
        }));
    });

    const groups = rows.filter((r) => r.group);
    expect(groups.length, 'グループ契約の行が1件も無い').toBeGreaterThan(0);
    expect(rows.length - groups.length, '個人契約の行が1件も無い').toBeGreaterThan(0);
    // どの行も請求先が空でない
    for (const r of rows) {
      expect(r.payer.length, '請求先が空の行がある').toBeGreaterThan(0);
    }
  });

  test('詳細を開くとタイトルと請求先が入っている', async ({ page }) => {
    await openScreen(page, '/03_admin/billing-management.html');

    await page.click('#billingList [data-pg] button:has-text("詳細")');
    await expect(page.locator('#mBillDetail')).toBeVisible();

    for (const slot of ['bdTitle', 'bdSid', 'bdName']) {
      const t = (await page.locator(`[data-slot="${slot}"]`).textContent() || '').trim();
      expect(t.length, `詳細の ${slot} が空`).toBeGreaterThan(0);
      expect(t, `詳細の ${slot} が未設定のまま`).not.toBe('—');
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#mBillDetail')).toBeHidden();
  });
});

test('会社名で絞り込める（§4.3）', async ({ page }) => {
  await openScreen(page, '/03_admin/billing-management.html');
  const visible = () => page.evaluate(() => [...document.getElementById('billingList').children]
    .slice(1).filter((r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none').length);

  const before = await visible();
  await page.fill('[data-filter-for="billingList"] [data-f-key="company"]', 'テクノブレイン');
  await page.click('[data-filter-for="billingList"] button:has-text("検索")');
  const after = await visible();
  expect(after, '絞り込んでも件数が変わらない').toBeLessThan(before);
  expect(after).toBeGreaterThan(0);

  await page.click('[data-filter-for="billingList"] button:has-text("条件をクリア")');
  expect(await visible(), 'クリアで戻らない').toBe(before);
});

test('アンケートのIDとタイトルで絞り込める（§4.3）', async ({ page }) => {
  await openScreen(page, '/03_admin/billing-management.html');
  const visible = () => page.evaluate(() => [...document.getElementById('billingList').children]
    .slice(1).filter((r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none').length);
  const field = '[data-filter-for="billingList"] [data-f-key="survey"]';
  await expect(page.locator(field), '一覧の主キーで探す欄が無い').toBeVisible();

  const before = await visible();
  // ID で
  await page.fill(field, 'SV-10188');
  await page.click('[data-filter-for="billingList"] button:has-text("検索")');
  expect(await visible(), 'アンケートIDで1件に絞れない').toBe(1);

  // タイトルの一部で
  await page.fill(field, 'SaaS Expo');
  await page.click('[data-filter-for="billingList"] button:has-text("検索")');
  expect(await visible(), 'タイトルで絞れない').toBe(1);

  await page.click('[data-filter-for="billingList"] button:has-text("条件をクリア")');
  expect(await visible(), 'クリアで戻らない').toBe(before);
});

/**
 * 請求の金額不変条件（レビュー指摘: 件数基準を effective(データ化対象) へ統一した回帰確認）。
 *
 * 15_admin_billing.md の金額規約: 明細合計=小計、税=floor(小計×10%)、小計+税=合計。
 * お礼メール送信費用は名刺データ化費用の無料枠(100通)控除のため、通数は必ずデータ化件数以下になる。
 * 2026-08-25 に SV-10233 以外の15件を総回答数(total)からデータ化対象数(effective)ベースへ
 * 再計算した際の壊れやすい不変条件のため、全16件を機械検証する。
 */
test.describe('請求の金額不変条件（15件+SV-10233・全16件）', () => {
  test('明細合計=小計・税=floor(小計×10%)・小計+税=合計・お礼メール件数≤データ化件数', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/data/core/invoices.json`);
    expect(res.ok(), 'invoices.json が取得できない').toBeTruthy();
    const invoices = await res.json();
    expect(invoices.length, 'invoices.json の件数が16件でない').toBe(16);

    for (const inv of invoices) {
      const itemSum = inv.items.reduce((s, it) => s + it.amount, 0);
      expect(itemSum, `${inv.invoiceId}: 明細合計 ${itemSum} が小計 ${inv.subtotalTaxable} と不一致`)
        .toBe(inv.subtotalTaxable);

      const expectTax = Math.floor(inv.subtotalTaxable * 0.10);
      expect(inv.tax, `${inv.invoiceId}: 税 ${inv.tax} が floor(小計×10%)=${expectTax} と不一致`)
        .toBe(expectTax);

      expect(inv.subtotalTaxable + inv.tax, `${inv.invoiceId}: 小計+税 が合計 ${inv.totalAmount} と不一致`)
        .toBe(inv.totalAmount);

      const dataItem = inv.items.find((it) => it.itemName === '名刺データ化費用');
      const mailItem = inv.items.find((it) => it.itemName === 'お礼メール送信費用');
      if (dataItem && mailItem) {
        expect(mailItem.quantity, `${inv.invoiceId}: お礼メール件数 ${mailItem.quantity} がデータ化件数 ${dataItem.quantity} を超える`)
          .toBeLessThanOrEqual(dataItem.quantity);
      }
    }
  });

  test('銀行口座情報がダミー値に統一されている（実在口座が残っていない）', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/data/core/invoices.json`);
    const invoices = await res.json();
    for (const inv of invoices) {
      const b = inv.bankInfo;
      expect(b.bankName, `${inv.invoiceId}: bankName がダミー値でない`).toBe('サンプル銀行');
      expect(b.bankCode, `${inv.invoiceId}: bankCode がダミー値でない`).toBe('0000');
      expect(b.branchName, `${inv.invoiceId}: branchName がダミー値でない`).toBe('本店');
      expect(b.branchCode, `${inv.invoiceId}: branchCode がダミー値でない`).toBe('001');
      expect(b.accountNumber, `${inv.invoiceId}: accountNumber がダミー値でない`).toBe('1234567');
      // 請求書発行元の名義は実在の自社名として維持する
      expect(b.accountHolder).toBe('アブロードアウトソーシング株式会社');
    }
  });
});

/**
 * クーポン管理の作成日検索（レビュー指摘: date input に data-f-key/aria-label が無く
 * 検索条件が静かに無視されていた）。billing-management.html の支払期日フィルタと
 * 同じ実装パターン(data-f-key="from"/"to" + 行の data-f-date(ISO))で機能する前提の検査。
 */
test.describe('クーポン管理の作成日検索', () => {
  test('作成日の期間で絞り込める', async ({ page }) => {
    await openScreen(page, '/03_admin/coupon-management.html');
    const visible = () => page.evaluate(() => [...document.getElementById('couponList').children]
      .slice(1).filter((r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none').length);

    const fromField = '[data-filter-for="couponList"] [data-f-key="from"]';
    const toField = '[data-filter-for="couponList"] [data-f-key="to"]';
    await expect(page.locator(fromField), '作成日(開始)の欄が無い').toBeVisible();
    await expect(page.locator(toField), '作成日(終了)の欄が無い').toBeVisible();

    const before = await visible();
    expect(before, '絞り込み前の件数が0').toBeGreaterThan(1);

    // CP-0021(サマーキャンペーン10 / 2026-06-01)だけが入る期間で絞り込む
    await page.fill(fromField, '2026-05-15');
    await page.fill(toField, '2026-06-15');
    await page.click('[data-filter-for="couponList"] button:has-text("検索")');
    const after = await visible();
    expect(after, '作成日の期間で絞り込んでも件数が変わらない（検索条件が無視されている）').toBeLessThan(before);
    expect(after, '期間内のクーポンが1件も残らない').toBeGreaterThan(0);

    const sidsAfter = await page.evaluate(() => [...document.getElementById('couponList').children]
      .slice(1).filter((r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none')
      .map((r) => r.getAttribute('data-f-cid')));
    expect(sidsAfter, '期間内のはずの CP-0021 が絞り込み結果に無い').toContain('CP-0021');

    await page.click('[data-filter-for="couponList"] button:has-text("条件をクリア")');
    expect(await visible(), 'クリアで戻らない').toBe(before);
  });
});

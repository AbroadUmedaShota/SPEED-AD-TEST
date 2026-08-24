const { test, expect } = require('@playwright/test');
const { LISTS, openScreen } = require('./_screens');

/**
 * 一覧を持つ9画面の共通のふるまい。
 *
 * ページング・並び替え・絞り込みは proto-ui.js の1本を全画面で使い回している。
 * 画面ごとに data-pg / data-sortable / data-filter-keys を付け忘れると
 * ここで落ちる（請求書管理が16行すべて data-pg="1" のまま「1〜5件」と表示していた例）。
 */

/** 実際に見えている行（ヘッダーと空表示を除く） */
function visibleRows(page, id) {
  return page.evaluate((listId) => {
    const list = document.getElementById(listId);
    return [...list.children].slice(1).filter(
      (r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none',
    ).length;
  }, id);
}

test.describe('一覧のページング', () => {
  for (const list of LISTS) {
    test(`${list.name}: 見えている行数と件数表示とページ数が一致する`, async ({ page }) => {
      const errors = await openScreen(page, list.path);

      const info = await page.evaluate((listId) => {
        const total = document.getElementById(listId + '-total');
        const range = document.getElementById(listId + '-range');
        const pager = document.getElementById(listId + '-pager');
        return {
          total: total ? parseInt(total.textContent.replace(/[^\d]/g, ''), 10) : null,
          range: range ? range.textContent.trim() : null,
          pages: pager ? [...pager.querySelectorAll('[data-page]')].map((b) => b.getAttribute('data-range')) : [],
          tagged: [...document.getElementById(listId).children].filter((e) => e.hasAttribute('data-pg')).length,
        };
      }, list.id);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
      expect(info.total, '件数表示（-total）が無い').not.toBeNull();
      expect(info.range, '件数表示（-range）が無い').not.toBeNull();
      expect(info.pages.length, 'ページャにページ番号が無い').toBeGreaterThan(0);

      // 件数表示「1〜10」と実際に見えている行数が合っているか
      const [from, to] = info.range.match(/(\d+)\D+(\d+)/).slice(1).map(Number);
      expect(await visibleRows(page, list.id), `件数表示は ${info.range} なのに実際の行数が違う`)
        .toBe(to - from + 1);

      // 全行がどこかのページに割り当たっているか（合計＝総件数）
      const covered = info.pages.reduce((sum, r) => {
        const [a, b] = r.match(/(\d+)\D+(\d+)/).slice(1).map(Number);
        return sum + (b - a + 1);
      }, 0);
      expect(covered, `ページの範囲の合計が総件数と合わない（${info.pages.join(' / ')}）`).toBe(info.total);
      expect(info.tagged, 'data-pg が付いた行数と総件数が合わない').toBe(info.total);
    });
  }
});

test.describe('アンケート管理の表示仕様', () => {
  test('有効回答数・データ化件数・納期日と内訳ツールチップが表示される', async ({ page }) => {
    const errors = await openScreen(page, '/03_admin/survey-management.html');
    const info = await page.evaluate(() => {
      const list = document.getElementById('surveysList');
      const row = list.querySelector('[data-f-sid="SV-10259"]');
      const head = list.firstElementChild;
      const cells = row ? row.children : [];
      const open = row && row.querySelector('[data-survey-open]');
      return {
        pageSize: list.getAttribute('data-page-size'),
        selectedPageSize: document.querySelector('select[aria-label="表示件数"]').value,
        visibleRows: [...list.querySelectorAll('[data-pg]')].filter((r) => getComputedStyle(r).display !== 'none').length,
        heads: [...head.children].map((c) => c.textContent.replace(/[▲▼\s]+$/g, '').trim()),
        effective: cells[5] && cells[5].textContent.trim(),
        total: row && row.getAttribute('data-f-total-answers'),
        tooltip: cells[5] && cells[5].getAttribute('title'),
        dataized: cells[6] && cells[6].textContent.trim(),
        openHref: open && open.getAttribute('href'),
        openTarget: open && open.getAttribute('target'),
      };
    });

    expect(errors, `JSエラー: ${errors.join(' / ')}`).toEqual([]);
    expect(info.pageSize).toBe('50');
    expect(info.selectedPageSize).toBe('50');
    expect(info.visibleRows).toBe(22);
    expect(info.heads).toContain('有効回答数');
    expect(info.heads).toContain('データ化件数');
    expect(info.heads).toContain('納期日');
    expect(info.effective).toBe('3,651');
    expect(info.total).toBe('3842');
    expect(info.tooltip).toContain('実際のアンケート回答数: 3,842件');
    expect(info.tooltip).toContain('名刺画像付き有効回答数: 3,651件');
    expect(info.dataized).toBe('—');
    expect(info.openHref).toBe('../02_dashboard/survey-answer.html?surveyId=SV-10259');
    expect(info.openTarget).toBe('_blank');
  });
});

test.describe('一覧の並び替え', () => {
  for (const list of LISTS) {
    test(`${list.name}: 見出しを押すと昇順と降順が入れ替わる`, async ({ page }) => {
      const errors = await openScreen(page, list.path);
      const head = `#${list.id} > div:first-child > *:nth-child(${list.sortCol + 1})`;

      const readCol = () => page.evaluate(([listId, col]) => {
        const list = document.getElementById(listId);
        return [...list.children].slice(1)
          .filter((r) => r.hasAttribute('data-pg') && getComputedStyle(r).display !== 'none')
          .map((r) => (r.children[col] || {}).textContent.replace(/\s+/g, ' ').trim());
      }, [list.id, list.sortCol]);
      const arrow = () => page.evaluate(([listId, col]) => {
        const t = document.getElementById(listId).firstElementChild.children[col].textContent;
        return t.includes('▲') ? 'asc' : (t.includes('▼') ? 'desc' : '');
      }, [list.id, list.sortCol]);

      expect(await page.getAttribute(head, 'role'), '見出しが押せない（data-sortable の付け忘れ）')
        .toBe('button');

      // 押下 → 並び替えが反映されるまで待つ。矢印が付いたら反映済み
      const clickAndSettle = async (want) => {
        await page.click(head);
        await page.waitForFunction(
          ([listId, col, prev]) => {
            const t = document.getElementById(listId).firstElementChild.children[col].textContent;
            const now = t.includes('▲') ? 'asc' : (t.includes('▼') ? 'desc' : '');
            return now !== '' && now !== prev;
          },
          [list.id, list.sortCol, want],
          { timeout: 5000 },
        );
      };

      // 既定の並び順が既にこの列のときは1回目の押下で降順になる。両方向を必ず通す
      const before = await arrow();
      await clickAndSettle(before);
      const dir1 = await arrow();
      const vals1 = await readCol();
      const rows1 = await visibleRows(page, list.id);
      await clickAndSettle(dir1);
      const dir2 = await arrow();
      const vals2 = await readCol();
      const rows2 = await visibleRows(page, list.id);

      expect([dir1, dir2].sort(), '昇順の▲と降順の▼が揃わない').toEqual(['asc', 'desc']);
      expect(rows1, '並び替えで行が消えた').toBe(rows2);
      expect(rows1).toBeGreaterThan(0);

      const asc = dir1 === 'asc' ? vals1 : vals2;
      const desc = dir1 === 'desc' ? vals1 : vals2;
      // 数値列は「値の全体が数値のとき」だけ数として比べる（U-1002 の - を負号と読まない）
      const toNum = (t) => {
        const m = /^[-+]?[\d,]+(\.\d+)?\s*(%|円|件|名|通|回|人|分)?$/.exec(String(t).trim());
        return m ? parseFloat(m[0].replace(/[^\d.-]/g, '')) : null;
      };
      const isSorted = (arr, dir) => {
        const v = arr.filter((x) => x && x !== '—');
        for (let i = 1; i < v.length; i++) {
          const a = list.numeric ? toNum(v[i - 1]) : v[i - 1];
          const b = list.numeric ? toNum(v[i]) : v[i];
          if (a === null || b === null) { continue; }
          const cmp = list.numeric ? a - b : String(a).localeCompare(String(b), 'ja');
          if (dir === 'asc' ? cmp > 0 : cmp < 0) { return false; }
        }
        return true;
      };
      expect(isSorted(asc, 'asc'), `昇順になっていない: ${asc.slice(0, 4).join(' , ')}`).toBe(true);
      expect(isSorted(desc, 'desc'), `降順になっていない: ${desc.slice(0, 4).join(' , ')}`).toBe(true);
      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('一覧の絞り込み', () => {
  // 絞り込み欄を持つ画面だけ。条件を入れると件数が減り、クリアで戻る
  const FILTERABLE = LISTS.filter((l) => !['perfList'].includes(l.id));

  for (const list of FILTERABLE) {
    test(`${list.name}: 絞り込みと「条件をクリア」で件数が戻る`, async ({ page }) => {
      await openScreen(page, list.path);
      const bar = await page.$(`[data-filter-for="${list.id}"]`);
      test.skip(!bar, '絞り込み欄が無い画面');

      const before = await visibleRows(page, list.id);
      const text = await page.$(`[data-filter-for="${list.id}"] input[type="text"], [data-filter-for="${list.id}"] input:not([type])`);
      test.skip(!text, 'テキストの絞り込み欄が無い');

      await text.fill('該当しないはずの文字列ZZZ');
      await page.click(`[data-filter-for="${list.id}"] button:has-text("検索"), [data-filter-for="${list.id}"] button:has-text("表示")`)
        .catch(() => {});
      await page.waitForTimeout(300);

      const empty = await page.evaluate((listId) => {
        const e = document.getElementById(listId + '-empty');
        return e ? getComputedStyle(e).display !== 'none' : null;
      }, list.id);
      expect(await visibleRows(page, list.id), '一致しない条件でも行が残る').toBe(0);
      expect(empty, '0件のときに「該当なし」の案内が出ない').toBe(true);

      await page.click(`[data-filter-for="${list.id}"] button:has-text("条件をクリア")`);
      await page.waitForTimeout(300);
      expect(await visibleRows(page, list.id), 'クリアしても件数が戻らない').toBe(before);
    });
  }

  // 対応可能言語は「日本語・英語」のような複合値。完全一致で照合すると
  // 「英語」で絞り込んでも1件も当たらない事故があった（2026-08-24 修正）
  test('オペレーター管理: 言語の絞り込みが複合値の行にも当たる', async ({ page }) => {
    await openScreen(page, '/03_admin/operator-management.html');
    const count = () => visibleRows(page, 'operatorsList');
    const filterBy = async (label) => {
      await page.selectOption('select[data-f-key="lang"]', { label });
      await page.click('[data-filter-for="operatorsList"] button:has-text("検索")');
      await page.waitForTimeout(250);
    };
    await filterBy('日本語');
    expect(await count(), '全員が日本語対応のはず').toBe(13);
    await filterBy('英語');
    expect(await count(), '日本語・英語の4名が当たるはず').toBe(4);
    await filterBy('中国語簡体字');
    expect(await count(), '中国語対応の2名が当たるはず').toBe(2);
  });
});

test.describe('一覧の既定の並び順', () => {
  // 見出しの▲▼は初期状態の印で、表示時に並び替えは走らない。
  // 静的マークアップの行順が崩れていても気づけないため、単調性を直接見る
  // （監査ログ2行・請求管理1行の逆転を検出できなかった実績から追加。2026-08-24）
  test('監査ログ: 操作日時の降順で並んでいる', async ({ page }) => {
    await openScreen(page, '/03_admin/audit-log.html');
    const times = await page.$$eval('#auditList [data-pg] > span:first-child', (els) => els.map((e) => e.textContent.trim()));
    expect(times.length).toBeGreaterThan(5);
    const sorted = [...times].sort().reverse();
    expect(times, `降順が崩れている: ${times.join(' / ')}`).toEqual(sorted);
  });

  test('請求管理: 支払期日の昇順で並び、支払期日なしは末尾に寄る', async ({ page }) => {
    await openScreen(page, '/03_admin/billing-management.html');
    const dates = await page.$$eval('#billingList [data-pg]', (els) => els.map((e) => e.getAttribute('data-f-date') || ''));
    const dated = dates.filter(Boolean);
    const blankFrom = dates.findIndex((d) => !d);
    expect(dated, `昇順が崩れている: ${dated.join(' / ')}`).toEqual([...dated].sort());
    if (blankFrom >= 0) {
      expect(dates.slice(blankFrom).every((d) => !d), '支払期日なしの行の後に日付ありの行がある').toBe(true);
    }
  });
});

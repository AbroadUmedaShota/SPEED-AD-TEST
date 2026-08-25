const { test, expect } = require('@playwright/test');
const { REGIONS, openScreen } = require('./_screens');

/**
 * 一覧・集計領域の取得状態（01_admin_common_ui.md §4.4）の検査。
 *
 * proto-ui.js の pRegionState/pPageState が URL クエリ `?state=` を読んで
 * [data-a-region] の各領域を loading/reloading/error/error-keep/partial に切り替える。
 * 本体（host）の inline style は書き換えず、host の data-a-state 属性・CSS（host 自体の
 * display 制御）・状態パネル（#{id}-state、host の直前の兄弟）だけで表現する実装のため、
 * ここでは「本体の中身が壊れていないか」「パネルの位置・個数が正しいか」を中心に検査する。
 */

/** REGIONS を list/summary ごとにフラットな1領域=1エントリへ展開する */
function flattenRegions(regions) {
  const out = [];
  for (const r of regions) {
    if (r.list) {
      out.push({ screen: r.name, path: r.path, id: r.list, kind: 'list', visibleByDefault: r.visibleByDefault !== false });
    }
    if (r.summary) {
      out.push({ screen: r.name, path: r.path, id: r.summary, kind: 'summary', visibleByDefault: r.visibleByDefault !== false });
    }
  }
  return out;
}

const ALL_REGIONS = flattenRegions(REGIONS);

/** state=partial（集計のみ失敗）が意味を持つ画面 */
const PARTIAL_SCREENS = REGIONS.filter((r) => r.partial);

/** クエリ無しの到達画面。同じ path を持つ複数領域（ダッシュボードの2領域など）は1件にまとめる */
function uniqueScreens(regions) {
  const map = new Map();
  for (const r of regions) {
    if (!map.has(r.path)) { map.set(r.path, { name: r.name, path: r.path, ids: [] }); }
    const entry = map.get(r.path);
    if (r.list) { entry.ids.push(r.list); }
    if (r.summary) { entry.ids.push(r.summary); }
  }
  return [...map.values()];
}

const UNIQUE_SCREENS = uniqueScreens(REGIONS);

function withState(path, state) {
  return path + (path.includes('?') ? '&' : '?') + 'state=' + state;
}

/**
 * `?state=` クエリを付けて画面を開き、指定領域の data-a-state が期待値になるまで待つ。
 * proto-ui.js は DOMContentLoaded → setTimeout(0) 経由で状態を適用するため、
 * openScreen の待ち条件（pLevel の存在）だけでは適用前に読みにいく競合がある。
 * expectAttr を省略した場合は queryState と同じ値を待つ（partial のように list/summary で
 * 適用結果が分かれる場合だけ明示する）。
 */
async function openWithState(page, path, queryState, waitId, expectAttr) {
  const errors = await openScreen(page, withState(path, queryState));
  const want = expectAttr === undefined ? queryState : expectAttr;
  await page.waitForFunction(
    ([id, w]) => {
      const el = document.getElementById(id);
      return !!el && el.getAttribute('data-a-state') === w;
    },
    [waitId, want],
    { timeout: 5000 },
  );
  return errors;
}

/**
 * 状態パネル（#{id}-state）が「出ている」ことの判定。
 * dashCardsWork のように既定シナリオでは祖先ごと display:none になる領域では
 * toBeVisible() が常に失敗するため、hidden プロパティによる DOM 上の判定に切り替える。
 */
async function expectPanelShown(page, id, visibleByDefault) {
  if (visibleByDefault) {
    await expect(page.locator(`#${id}-state`), '状態パネルが出ていない').toBeVisible();
    return;
  }
  const shown = await page.evaluate((rid) => {
    const el = document.getElementById(rid + '-state');
    return !!el && el.hidden === false;
  }, id);
  expect(shown, '状態パネル（hidden属性）が出ていない').toBe(true);
}

/**
 * 領域の内容（行・カード）を表す簡易シグネチャ。pRegionState は host の中身を書き換えない
 * 実装のため、状態をまたいでも一致するはずというレグレッションガード。
 * data-pg 行を持つ一覧はその可視数、持たない領域（groupList・summary カード群）は
 * 表示中のテキストで代替する。
 */
async function regionSignature(page, id) {
  return page.evaluate((rid) => {
    const host = document.getElementById(rid);
    if (!host) { return null; }
    const rows = [...host.querySelectorAll('[data-pg]')].filter((r) => getComputedStyle(r).display !== 'none');
    if (rows.length) { return rows.length; }
    return host.textContent.replace(/\s+/g, ' ').trim();
  }, id);
}

test.describe('T-1: 既定表示（クエリ無し）が壊れていない', () => {
  for (const s of UNIQUE_SCREENS) {
    test(`${s.name}: [data-a-state] が無く、状態パネルも出ない`, async ({ page }) => {
      const errors = await openScreen(page, s.path);

      const count = await page.evaluate(() => document.querySelectorAll('[data-a-state]').length);
      expect(count, '既定表示なのに data-a-state が付いた領域がある').toBe(0);

      for (const id of s.ids) {
        await expect(page.locator(`#${id}-state`), `${id}-state パネルが出ている`).toBeHidden();
      }
      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-2/T-3: state=loading', () => {
  for (const r of ALL_REGIONS) {
    test(`${r.screen} / ${r.id}: 読込中はホストが隠れ、骨格パネルが出る（操作は inert）`, async ({ page }) => {
      const errors = await openWithState(page, r.path, 'loading', r.id);
      const panel = page.locator(`#${r.id}-state`);

      if (r.visibleByDefault) {
        await expect(page.locator(`#${r.id}`), 'ホストが隠れていない').toBeHidden();
      }
      await expectPanelShown(page, r.id, r.visibleByDefault);
      await expect(page.locator(`#${r.id}`)).toHaveAttribute('data-a-state', 'loading');
      await expect(page.locator(`#${r.id}`)).toHaveAttribute('aria-busy', 'true');
      expect(await panel.locator('.a-skel').count(), '骨格（.a-skel）が1つも出ていない').toBeGreaterThan(0);
      expect(await page.locator(`#${r.id}-retry`).count(), '読込中なのに再試行が出ている').toBe(0);

      // T-3: 読込中は data-a-ctl（絞り込み・ページャ）を持つ領域だけ操作を止める
      const ctl = page.locator(`[data-a-ctl="${r.id}"]`);
      if (await ctl.count()) {
        await expect(ctl, '読込中なのに data-a-ctl が inert でない').toHaveAttribute('inert', '');
      }

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-4: state=reloading', () => {
  for (const r of ALL_REGIONS) {
    test(`${r.screen} / ${r.id}: 再読込中はホストを維持し、内容も操作も変わらない`, async ({ page }) => {
      await openScreen(page, r.path);
      const before = await regionSignature(page, r.id);

      const errors = await openWithState(page, r.path, 'reloading', r.id);

      if (r.visibleByDefault) {
        await expect(page.locator(`#${r.id}`), '再読込中なのにホストが隠れた').toBeVisible();
      }
      await expect(page.locator(`#${r.id}`)).toHaveAttribute('aria-busy', 'true');

      const after = await regionSignature(page, r.id);
      expect(after, '再読込中に内容が変わった').toBe(before);

      const ctl = page.locator(`[data-a-ctl="${r.id}"]`);
      if (await ctl.count()) {
        expect(await ctl.getAttribute('inert'), '再読込中なのに data-a-ctl が inert のまま').toBeNull();
      }

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-5/T-6/T-11: state=error', () => {
  for (const r of ALL_REGIONS) {
    test(`${r.screen} / ${r.id}: 取得失敗でホストが隠れ、再試行が領域の内側に1個だけ出る`, async ({ page }) => {
      const errors = await openWithState(page, r.path, 'error', r.id);

      if (r.visibleByDefault) {
        await expect(page.locator(`#${r.id}`), 'ホストが隠れていない').toBeHidden();
      }
      await expectPanelShown(page, r.id, r.visibleByDefault);
      expect(await page.locator(`#${r.id}-retry`).count(), '再試行がちょうど1個でない').toBe(1);

      // T-6: 再試行は「失敗した領域の内側」＝状態パネルの中にあり、
      // 状態パネル自体はホストの直前の兄弟に差し込まれている
      const position = await page.evaluate((id) => {
        const host = document.getElementById(id);
        const panelEl = document.getElementById(id + '-state');
        const retry = document.getElementById(id + '-retry');
        return {
          retryInsidePanel: !!(panelEl && retry && panelEl.contains(retry)),
          panelPrecedesHost: !!(panelEl && panelEl.nextElementSibling === host),
        };
      }, r.id);
      expect(position.retryInsidePanel, '再試行が状態パネルの外にある').toBe(true);
      expect(position.panelPrecedesHost, '状態パネルがホストの直前の兄弟になっていない').toBe(true);

      // T-11: ?state= クエリだけでは絞り込みロジックは動かない（絞り込みバッジが作られない）
      expect(await page.locator(`#${r.id}-chip`).count(), 'state=error なのに絞り込みバッジが出た').toBe(0);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-8: state=error-keep', () => {
  for (const r of ALL_REGIONS) {
    test(`${r.screen} / ${r.id}: 表示は維持したまま帯で失敗を知らせる`, async ({ page }) => {
      await openScreen(page, r.path);
      const before = await regionSignature(page, r.id);

      const errors = await openWithState(page, r.path, 'error-keep', r.id);

      if (r.visibleByDefault) {
        await expect(page.locator(`#${r.id}`), 'error-keep なのにホストが隠れた').toBeVisible();
      }
      const after = await regionSignature(page, r.id);
      expect(after, 'error-keep 中に内容が変わった').toBe(before);

      await expectPanelShown(page, r.id, r.visibleByDefault);
      expect(await page.locator(`#${r.id}-retry`).count(), '再試行がちょうど1個でない').toBe(1);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-7: 0件表示と取得失敗は別物として区別できる', () => {
  const LIST_REGIONS = ALL_REGIONS.filter((r) => r.kind === 'list');

  for (const r of LIST_REGIONS) {
    test(`${r.screen} / ${r.id}: 該当なし検索の空表示と、取得失敗の表示は別物`, async ({ page }) => {
      await openScreen(page, r.path);
      const bar = await page.$(`[data-filter-for="${r.id}"]`);
      test.skip(!bar, '絞り込み欄が無い領域');
      const text = await page.$(`[data-filter-for="${r.id}"] input[type="text"], [data-filter-for="${r.id}"] input:not([type])`);
      test.skip(!text, 'テキストの絞り込み欄が無い領域');

      await text.fill('該当しないはずの文字列ZZZ');
      await page.click(`[data-filter-for="${r.id}"] button:has-text("検索"), [data-filter-for="${r.id}"] button:has-text("表示")`)
        .catch(() => {});
      await page.waitForTimeout(300);

      await expect(page.locator(`#${r.id}-empty`), '0件なのに「該当なし」の案内が出ない').toBeVisible();
      expect(await page.locator(`#${r.id}-retry`).count(), '0件表示（絞り込み結果）なのに再試行が出ている').toBe(0);

      const errors = await openWithState(page, r.path, 'error', r.id);
      await expect(page.locator(`#${r.id}-empty`), '取得失敗なのに「該当なし」の案内が出ている').toBeHidden();
      expect(await page.locator(`#${r.id}-retry`).count(), '取得失敗なのに再試行が出ない').toBe(1);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-9: 再試行を押すと reloading を経て復帰する', () => {
  for (const r of ALL_REGIONS) {
    test(`${r.screen} / ${r.id}: 再試行後、短時間で data-a-state が消え内容も戻る`, async ({ page }) => {
      test.skip(r.visibleByDefault === false, 'Lv既定シナリオでは非表示の領域のため再試行を押せない');

      await openScreen(page, r.path);
      const before = await regionSignature(page, r.id);

      const errors = await openWithState(page, r.path, 'error', r.id);
      await page.click(`#${r.id}-retry`);

      const start = Date.now();
      await page.waitForFunction(
        (id) => !document.getElementById(id).hasAttribute('data-a-state'),
        r.id,
        { timeout: 3000 },
      );
      const elapsed = Date.now() - start;
      // proto-ui.js の実装は reloading を経て 700ms 後に ready へ戻る固定値。
      // CI のばらつきを見込みつつ「1秒程度」の想定から大きく外れていないかを確認する
      expect(elapsed, `復帰に ${elapsed}ms かかった（想定は約700ms）`).toBeLessThan(1500);

      const after = await regionSignature(page, r.id);
      expect(after, '再試行後に内容が変わった').toBe(before);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-10: state=partial（集計のみ失敗）', () => {
  for (const s of PARTIAL_SCREENS) {
    test(`${s.name}: summary だけ失敗し、list は影響を受けない`, async ({ page }) => {
      await openScreen(page, s.path);
      const listBefore = await regionSignature(page, s.list);

      const errors = await openWithState(page, s.path, 'partial', s.summary, 'error');

      await expect(page.locator(`#${s.summary}`), 'summary のホストが隠れていない').toBeHidden();
      expect(await page.locator(`#${s.summary}-retry`).count(), 'summary に再試行が1個出ていない').toBe(1);

      const listAttr = await page.getAttribute(`#${s.list}`, 'data-a-state');
      expect(listAttr, 'list に data-a-state が付いてしまった').toBeNull();
      await expect(page.locator(`#${s.list}`), 'list のホストが隠れた').toBeVisible();
      const listAfter = await regionSignature(page, s.list);
      expect(listAfter, 'partial 中に list の内容が変わった').toBe(listBefore);

      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-12: テーマ両対応（トークン解決の確認）', () => {
  // is-error の背景色は --a-danger-bg という共有トークン1本から出ているため、
  // 全領域で重複確認せず list/summary 各1件の代表で検証する
  const REPRESENTATIVE = ALL_REGIONS.filter((r) => ['usersList', 'reconSummary'].includes(r.id));

  for (const r of REPRESENTATIVE) {
    test(`${r.screen} / ${r.id}: ダークとライトで is-error の背景色が異なる`, async ({ page }) => {
      await openWithState(page, r.path, 'error', r.id);
      const light = await page.evaluate(
        (id) => getComputedStyle(document.getElementById(id + '-state')).backgroundColor,
        r.id,
      );

      await page.addInitScript(() => {
        try { localStorage.setItem('adminTheme', 'dark'); } catch (e) { /* 保存できなくても既定で進む */ }
      });
      const errors = await openWithState(page, r.path, 'error', r.id);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const dark = await page.evaluate(
        (id) => getComputedStyle(document.getElementById(id + '-state')).backgroundColor,
        r.id,
      );

      expect(dark, `ライトと同じ色のまま（トークンが未解決）: ${dark}`).not.toBe(light);
      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

test.describe('T-14: 状態切替APIの存在', () => {
  const REPRESENTATIVE_SCREENS = UNIQUE_SCREENS.filter(
    (s) => s.path === '/03_admin/user-management.html' || s.path === '/03_admin/reconciliation/index.html',
  );

  for (const s of REPRESENTATIVE_SCREENS) {
    test(`${s.name}: pRegionState / pPageState が関数として存在する`, async ({ page }) => {
      const errors = await openScreen(page, s.path);
      const ok = await page.evaluate(
        () => typeof window.pRegionState === 'function' && typeof window.pPageState === 'function',
      );
      expect(ok, 'pRegionState または pPageState が関数として存在しない').toBe(true);
      expect(errors, `JSエラー: ${errors[0] || ''}`).toEqual([]);
    });
  }
});

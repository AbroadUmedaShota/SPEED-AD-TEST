/**
 * 表示テーマ（ライト / ダーク）の検査。
 *
 * 配色は画面側のインライン style に散っているため、トークン（var(--a-*)）を
 * 1つ通し忘れると、その要素だけライトの色のまま取り残される。
 * 目視では既定表示しか見ないので、モーダルを開いた状態まで含めて機械で当たる。
 */

const { test, expect } = require('@playwright/test');
const { SCREENS, openScreen } = require('./_screens');

/** 相対輝度。rgb()/rgba() いずれでも先頭3つを使う */
const LUM_SRC = `(c) => {
  const m = (c.match(/[\\d.]+/g) || ['255', '255', '255']).slice(0, 3).map((x) => {
    const s = Number(x) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
}`;

/**
 * 画面内で「ダークなのに明るいままの面」を集める。
 * 名刺ビューアとサイドバーは両モードで暗いまま固定する設計のため対象外。
 */
const LIGHT_SURFACES = `() => {
  const lum = ${LUM_SRC};
  const out = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || e.offsetParent === null) { return; }
    if (e.closest('.card-zoom, #sidebar-placeholder')) { return; }
    const bg = getComputedStyle(e).backgroundColor;
    if (!bg || /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { return; }
    if (lum(bg) <= 0.55) { return; }
    if (r.width * r.height <= 900) { return; }   // 小さなバッジや区切り線は誤検出になるので除く
    const key = bg + '|' + e.tagName + '|' + String(e.className).slice(0, 40);
    if (seen.has(key)) { return; }
    seen.add(key);
    out.push(bg + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
      + ' <' + e.tagName.toLowerCase() + ' class="' + String(e.className).slice(0, 40) + '">');
  });
  return out;
}`;

/** ダークで最初から開く */
async function openDark(page, path) {
  await page.addInitScript(() => {
    try { localStorage.setItem('adminTheme', 'dark'); } catch (e) { /* 保存できなくても既定で進む */ }
  });
  return openScreen(page, path);
}

test.describe('表示テーマ', () => {
  for (const s of SCREENS) {
    test(`${s.name}: ダークが最初の描画から当たる`, async ({ page }) => {
      await openDark(page, s.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      // 背景がライトのままなら、theme-init.js かトークン定義のどちらかが届いていない
      const bodyLum = await page.evaluate(`(${LUM_SRC})(getComputedStyle(document.body).backgroundColor)`);
      expect(bodyLum, '本文の背景が暗くない').toBeLessThan(0.2);
    });

    test(`${s.name}: ダークで明るい面が残らない（モーダルを開いた状態を含む）`, async ({ page }) => {
      await openDark(page, s.path);

      const found = [];
      const base = await page.evaluate(`(${LIGHT_SURFACES})()`);
      base.forEach((x) => found.push('既定表示: ' + x));

      const ids = await page.evaluate(() => [...document.querySelectorAll('.proto-modal[id]')].map((m) => m.id));
      for (const id of ids) {
        const shown = await page.evaluate((i) => {
          if (typeof window.pOpen !== 'function') { return false; }
          if (typeof window.pCloseAll === 'function') { window.pCloseAll(); }
          try { window.pOpen(i); } catch (e) { return false; }
          const m = document.getElementById(i);
          return !!(m && getComputedStyle(m).display !== 'none');
        }, id);
        if (!shown) { continue; }
        await page.waitForTimeout(120);
        const inModal = await page.evaluate(`(${LIGHT_SURFACES})()`);
        inModal.forEach((x) => found.push(id + ': ' + x));
      }

      expect(found, `ライトの色が残っている\n${found.join('\n')}`).toEqual([]);
    });
  }

  test('切り替えた選択がリロードと画面遷移をまたいで残る', async ({ page }) => {
    await openScreen(page, '/03_admin/index.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.click('#themeToggle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // ボタンは「押すとどうなるか」を出す
    await expect(page.locator('#themeToggleLabel')).toHaveText('ライト');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await openScreen(page, '/03_admin/user-management.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.click('#themeToggle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('色を直接書かずトークンを通している（稼働画面のソース）', async () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..', '..', '03_admin');

    const files = [];
    (function walk(dir) {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) {
          // BY-*・sample・old・legacy は凍結した旧資産。テーマの対象外
          if (/^(BY-|sample$|old$|legacy$)/.test(n)) { continue; }
          walk(p);
          continue;
        }
        if (/\.(html|js|css)$/.test(n)) { files.push(p); }
      }
    }(root));

    // 到達不能な旧画面と、意図して生の色を残している2箇所は除く
    const SKIP = ['escalations.html', path.join('reconciliation', 'list.html'),
      'performance-management.js'];
    const offenders = [];
    for (const f of files) {
      if (SKIP.some((s) => f.endsWith(s))) { continue; }
      // 説明文の中の色（コメント）は対象外。改行数は保って行番号をずらさない
      const src = fs.readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
      src.split('\n').forEach((line, i) => {
        if (/--a-[a-z0-9-]+\s*:/.test(line)) { return; }          // トークンの定義行
        // 配色プロパティの値に出る色だけを見る。「回答#8821」のような番号は拾わない
        if (!/(color|background|border|outline|shadow|fill|stroke)/i.test(line)) { return; }
        const m = line.match(/(?:^|[\s(:,])(#[0-9a-fA-F]{3,8})\b/g);
        if (!m) { return; }
        offenders.push(`${path.relative(root, f)}:${i + 1} ${m.map((x) => x.trim()).join(' ')}`);
      });
    }
    expect(offenders, `生の色が残っている\n${offenders.join('\n')}`).toEqual([]);
  });
});

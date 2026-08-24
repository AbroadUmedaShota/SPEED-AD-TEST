const { test, expect } = require('@playwright/test');
const { openScreen } = require('./_screens');

/**
 * 画面をまたいだ値の突合。
 *
 * 同じアンケート・同じユーザーを別の画面で見たときに値が食い違わないかを見る。
 * 1画面ずつ目視しても出てこない種類の欠陥（納期区分の取り違え、件数のズレ）を拾うための回帰ゲート。
 * 2026-08-09 の監査で SV-10259 の納期区分と、SV-10236 / SV-10233 の名刺件数の食い違いを検出した。
 */

/** 一覧の行から data-f-* をまとめて拾う */
async function listRows(page, path, listId) {
  await openScreen(page, path);
  return page.$$eval(`#${listId} [data-pg]`, (els) => els.map((el) => {
    const o = {};
    for (const a of el.attributes) {
      if (a.name.startsWith('data-f-')) { o[a.name.slice(7)] = a.value; }
    }
    return o;
  }));
}

/** アンケート詳細の値を読む */
async function surveyDetail(page, sid) {
  await openScreen(page, `/03_admin/survey-detail.html?id=${sid}`);
  return page.evaluate(() => {
    const slot = (n) => {
      const e = document.querySelector(`[data-slot="${n}"]`);
      return e ? e.textContent.trim() : null;
    };
    const val = (n) => {
      const e = document.querySelector(`[data-slot="${n}"]`);
      return e && 'value' in e ? e.value : null;
    };
    return {
      title: val('title') || slot('title'),
      plan: slot('plan'),
      creator: slot('creator'),
      bizTotal: slot('bizTotal'),
      period: [val('periodStart'), val('periodEnd')],
    };
  });
}

const num = (t) => Number(String(t == null ? '' : t).replace(/[^\d]/g, ''));

test.describe('アンケートの値が画面をまたいで一致する', () => {
  test('納期区分・会社名・ユーザーIDが アンケート管理 / 照合結果一覧 / 請求管理 で揃う', async ({ page }) => {
    const sm = await listRows(page, '/03_admin/survey-management.html', 'surveysList');
    const rc = await listRows(page, '/03_admin/reconciliation/index.html', 'reconList');
    const bl = await listRows(page, '/03_admin/billing-management.html', 'billingList');

    const base = new Map(sm.filter((r) => r.sid).map((r) => [r.sid, r]));
    expect(base.size, 'アンケート管理の行が読めない').toBeGreaterThan(5);

    for (const src of [{ name: '照合結果一覧', rows: rc }, { name: '請求管理', rows: bl }]) {
      for (const r of src.rows) {
        const b = base.get(r.sid);
        if (!b) { continue; }
        for (const key of ['plan', 'company', 'uid']) {
          if (!r[key] || !b[key]) { continue; }
          expect(r[key], `${r.sid} の ${key} が ${src.name}=「${r[key]}」／アンケート管理=「${b[key]}」`)
            .toBe(b[key]);
        }
      }
    }
  });

  test('納期区分が 一覧 と アンケート詳細 で揃う', async ({ page }) => {
    const sm = await listRows(page, '/03_admin/survey-management.html', 'surveysList');
    for (const r of sm.filter((x) => x.sid).slice(0, 6)) {
      const d = await surveyDetail(page, r.sid);
      expect(d.plan, `${r.sid} の納期区分が 一覧=「${r.plan}」／詳細=「${d.plan}」`).toBe(r.plan);
    }
  });

  test('照合画面のヘッダーが アンケート詳細 と揃う', async ({ page }) => {
    // 照合画面は一覧を経由せず ?id= で直接開けるため、独自にアンケートの識別情報を持つ。
    // ここがずれると、同じアンケートなのに照合中だけ別の納期区分が見える
    for (const sid of ['SV-10259', 'SV-10244', 'SV-10236', 'SV-10233']) {
      const d = await surveyDetail(page, sid);
      await openScreen(page, `/03_admin/reconciliation/detail.html?id=${sid}`);
      const plan = (await page.locator('#planM').textContent()).trim();
      const company = (await page.locator('#companyM').textContent()).trim();
      expect(plan, `${sid} の納期区分が 照合画面=「${plan}」／アンケート詳細=「${d.plan}」`).toBe(d.plan);
      expect(d.creator, `${sid} の会社名が 照合画面=「${company}」／アンケート詳細の作成者=「${d.creator}」`)
        .toContain(company);
    }
  });

  test('名刺の件数が 照合結果一覧 と アンケート詳細 で揃う', async ({ page }) => {
    const rc = await listRows(page, '/03_admin/reconciliation/index.html', 'reconList');
    // 総件数は c-opt 列。行の並び順で拾う
    const totals = await page.$$eval('#reconList [data-pg]', (els) => els.map((el) => {
      const cells = el.querySelectorAll('.c-opt');
      return cells.length ? cells[0].textContent.trim() : null;
    }));

    let checked = 0;
    for (let i = 0; i < rc.length; i++) {
      const sid = rc[i].sid;
      const total = num(totals[i]);
      if (!sid || !total) { continue; }        // 会期前は件数を持たない
      const d = await surveyDetail(page, sid);
      const detail = num(d.bizTotal);
      if (!detail) { continue; }
      expect(detail, `${sid} の名刺件数が 照合結果一覧=${total}／アンケート詳細=${detail}`).toBe(total);
      checked += 1;
    }
    expect(checked, '突合できた行が無い').toBeGreaterThan(2);
  });

  test('照合結果一覧の内訳が総件数と合う', async ({ page }) => {
    await openScreen(page, '/03_admin/reconciliation/index.html');
    const rows = await page.$$eval('#reconList [data-pg]', (els) => els.map((el) => {
      const opt = Array.from(el.querySelectorAll('.c-opt')).map((c) => c.textContent.trim());
      const spans = Array.from(el.children).map((c) => c.textContent.trim());
      return { sid: el.getAttribute('data-f-sid'), opt, spans };
    }));
    let checked = 0;
    for (const r of rows) {
      // c-opt = 総件数 / 一致 / 不一致。未入力は常時表示の列
      if (r.opt.length !== 3) { continue; }
      const total = num(r.opt[0]);
      const match = num(r.opt[1]);
      const mismatch = num(r.opt[2]);
      if (!total) { continue; }
      const unentered = num(r.spans[6]);
      expect(unentered + match + mismatch,
        `${r.sid} の内訳が総件数 ${total} と合わない（未入力${unentered}+一致${match}+不一致${mismatch}）`)
        .toBe(total);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2);
  });
});

test.describe('ユーザーの値が画面をまたいで一致する', () => {
  test('氏名・会社名・状態が ユーザー管理 と ユーザー詳細 で揃う', async ({ page }) => {
    const um = await listRows(page, '/03_admin/user-management.html', 'usersList');
    const targets = um.filter((r) => r.uid && r.name && r.name !== '—').slice(0, 5);
    expect(targets.length, 'ユーザー管理の行が読めない').toBeGreaterThan(2);

    for (const r of targets) {
      await openScreen(page, `/03_admin/user-detail.html?id=${r.uid}`);
      const inputs = await page.$$eval('[data-slot="acctFields"] input', (e) => e.map((x) => x.value));
      const [company, name] = inputs;
      expect(company, `${r.uid} の会社名が 一覧=「${r.company}」／詳細=「${company}」`).toBe(r.company);
      expect(name, `${r.uid} の氏名が 一覧=「${r.name}」／詳細=「${name}」`).toBe(r.name);
      const status = await page.locator('[data-slot="status"]').first().textContent();
      expect(status.trim(), `${r.uid} の状態が 一覧=「${r.status}」／詳細=「${status.trim()}」`).toBe(r.status);
    }
  });

  test('アンケート詳細の作成者が ユーザー詳細の氏名と揃う', async ({ page }) => {
    for (const sid of ['SV-10244', 'SV-10238', 'SV-10233']) {
      const d = await surveyDetail(page, sid);
      const uid = (d.creator.match(/U-\d+/) || [])[0];
      expect(uid, `${sid} の作成者からユーザーIDが読めない`).toBeTruthy();
      await openScreen(page, `/03_admin/user-detail.html?id=${uid}`);
      const name = await page.$eval('[data-slot="acctFields"] input:nth-of-type(1)', () => null).catch(() => null);
      const inputs = await page.$$eval('[data-slot="acctFields"] input', (e) => e.map((x) => x.value));
      expect(d.creator, `${sid} の作成者「${d.creator}」に ${uid} の氏名「${inputs[1]}」が入っていない`)
        .toContain(inputs[1]);
      expect(name).toBeNull();   // 参照だけの取得なので値は使わない
    }
  });
});

test('照合対象の総件数が アンケート管理の有効回答数を超えない', async ({ page }) => {
  // 名刺は名刺画像付きの有効回答から生じるため「照合対象 ≦ 有効回答数」(13号 §11 の #10)。
  // SV-10233(486 > 394)・SV-10250(2,150 > 2,040) の逆転を 2026-08-24 に修正した
  await openScreen(page, '/03_admin/reconciliation/index.html');
  const recon = await page.$$eval('#reconList [data-pg]', (els) => els.map((el) => {
    // 進捗セルは「2,134 / 2,180」とスラッシュの前後に空白を挟む。
    // 空白を必須にしないと会期の日付(2026/08/03)を誤って拾う
    const m = el.innerText.match(/([\d,]+) \/ ([\d,]+)/);
    return { sid: el.getAttribute('data-f-sid'), total: m ? Number(m[2].replace(/,/g, '')) : null };
  }));
  const surveys = await listRows(page, '/03_admin/survey-management.html', 'surveysList');
  const checked = [];
  for (const r of recon.filter((x) => x.sid && x.total)) {
    const s = surveys.find((x) => x.sid === r.sid);
    expect(s, `${r.sid} がアンケート管理に無い`).toBeTruthy();
    const effective = Number(s['effective-answers']);
    expect(effective, `${r.sid}: 照合対象 ${r.total} 件 > 有効回答 ${effective} 件`).toBeGreaterThanOrEqual(r.total);
    checked.push(r.sid);
  }
  expect(checked.length, '突合できた行が無い').toBeGreaterThan(2);
});

test('グループ名が 請求管理 と アンケート詳細 で揃う', async ({ page }) => {
  const bl = await listRows(page, '/03_admin/billing-management.html', 'billingList');
  const withGroup = bl.filter((r) => r.group && r.sid);
  expect(withGroup.length, '請求管理にグループを持つ行が無い').toBeGreaterThan(0);

  for (const r of withGroup) {
    await openScreen(page, `/03_admin/survey-detail.html?id=${r.sid}`);
    const t = (await page.locator('[data-slot="grp"]').textContent()).replace(/\s+/g, ' ');
    expect(t, `${r.sid} のグループが 請求管理=「${r.group}」／アンケート詳細=「${t}」`).toContain(r.group);
  }
});

test.describe('ダッシュボードの案件パイプラインが実データと同数', () => {
  // 2026-08-18 の全体レビューで、会期前カード(3件)とデータ化中カード(6件)が実データ
  // (1件・4件)と食い違っているのを目視で検出した。カード件数を突合するテストが無く
  // 見逃されていたため追加する。固定値ではなくステータス行数と比べ、データを増やしても
  // 検査が追従するようにする
  test('会期前・会期中・データ化中・照合待ちのカード件数が一覧のステータス行数と揃う', async ({ page }) => {
    const sm = await listRows(page, '/03_admin/survey-management.html', 'surveysList');
    const rc = await listRows(page, '/03_admin/reconciliation/index.html', 'reconList');
    const byStatus = (s) => sm.filter((r) => r.status === s).length;

    await openScreen(page, '/03_admin/index.html'); // 既定Lv4
    const cards = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('.dash-card').forEach((c) => {
        const label = (c.querySelector('.dash-card-label') || { textContent: '' }).textContent.replace(/\s+/g, '');
        const n = (c.querySelector('.dash-card-num') || { textContent: '' }).textContent;
        if (!(label in out)) { out[label] = parseInt(n.replace(/[^\d]/g, ''), 10); }
      });
      return out;
    });

    expect(cards['会期前(7日以内に開始)'], '会期前カードがアンケート管理の会期前行数と違う').toBe(byStatus('会期前'));
    expect(cards['会期中'], '会期中カードがアンケート管理の会期中行数と違う').toBe(byStatus('会期中'));
    expect(cards['名刺データ化中'], 'データ化中カードがアンケート管理のデータ化中行数と違う').toBe(byStatus('データ化中'));
    expect(cards['照合待ち'], '照合待ちカードが照合結果一覧のデータ化中(進行中)行数と違う')
      .toBe(rc.filter((r) => r.status === 'データ化中').length);
  });
});

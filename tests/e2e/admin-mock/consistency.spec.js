const { test, expect } = require('@playwright/test');
const { SCREENS, openScreen } = require('./_screens');

/**
 * 2026-08-06 の通しレビューで人が目で見つけた指摘を、毎回走る検査にしたもの。
 *
 * まだ直していない項目は test.fail() を付けてある。「落ちるのが正しい」状態で、
 * 直すと不意に通って赤くなるので、そのとき注釈を外す。
 * どの項目かは docs/architecture/admin_architecture.json の findings（R-xx）と対応する。
 */

/** 画面に実際に出ている文字（タグの外側のテキスト） */
async function visibleText(page, path) {
  await openScreen(page, path);
  // 画面ごとのインラインスクリプトが data-slot を埋め終わるまで待つ。
  // 埋まる前に読むと、検査が拾う文字列が変わって結果が揺れる
  await page.waitForFunction(() => document.readyState === 'complete');
  return page.locator('#main-content').innerText();
}

/** 全16画面の表示テキストを集める */
async function allText(page) {
  const out = {};
  for (const s of SCREENS) {
    out[s.name] = await visibleText(page, s.path);
  }
  return out;
}

test.describe('決着済みの用語（戻ったら落ちる）', () => {
  test('「例外対応」は使わない（2026-08-06 に「要注意操作」へ改称）', async ({ page }) => {
    test.slow();
    const texts = await allText(page);
    const hit = Object.entries(texts).filter(([, t]) => t.includes('例外対応')).map(([n]) => n);
    expect(hit, `旧称が残っている画面: ${hit.join(', ')}`).toEqual([]);
  });

  test('実在しそうな連絡先を画面に出さない', async ({ page }) => {
    test.slow();
    const texts = await allText(page);
    // モックで使ってよいのは架空のドメインと 03-1234 / 090-8765 系のダミーだけ。
    // 実在の名刺から拾った値が紛れ込むのを防ぐ
    const banned = [/@repinc\.co\.jp/, /s-umeda@/, /03-6895-\d{4}/, /03-5835-\d{4}/];
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      for (const re of banned) {
        if (re.test(t)) { hit.push(`${name}: ${t.match(re)[0]}`); }
      }
    }
    expect(hit, `実在の連絡先らしき文字列: ${hit.join(' / ')}`).toEqual([]);
  });
});

test.describe('決着済みの配置（戻ったら落ちる）', () => {
  test('アンケート詳細の日付が壊れていない', async ({ page }) => {
    // 会期から時刻を取っていた箇所があり、書式を変えたときに 2026/2026/07 30 になった
    for (const id of ['SV-10259', 'SV-10250', 'SV-10262']) {
      await openScreen(page, `/03_admin/survey-detail.html?id=${id}`);
      const t = await page.locator('#main-content').innerText();
      // 年が二重になっていないか、日付の後ろに時刻でない数が付いていないか
      const broken = t.match(/20\d\d\/20\d\d|\/\d\d \d\d(?!:)/g) || [];
      expect(broken, `${id} に壊れた日付: ${broken.join(', ')}`).toEqual([]);
    }
  });

  test('会期は日付のみで扱う（2026-08-06 決定）', async ({ page }) => {
    // 利用者側は type="date" で、データも日付しか持たない。
    // 管理側だけが時刻を持つと、代行編集で利用者が持てない値を入れられる
    test.slow();
    const texts = await allText(page);
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      const m = t.match(/20\d\d\/\d\d\/\d\d \d\d:\d\d\s*[〜~]/g);
      if (m) { hit.push(`${name}: ${m.join(' ')}`); }
      // 営業日カレンダーは「会期 7/30–8/1 10:00–17:00」の年なし形式で時刻を出していた
      // (2026-08-24 撤去)。年あり前提の上の正規表現では拾えないため別に見る
      const m2 = t.match(/会期[^\n]*\d\d?:\d\d/g);
      if (m2) { hit.push(`${name}: ${m2.join(' ')}`); }
    }
    expect(hit, `会期に時刻が出ている: ${hit.join(' / ')}`).toEqual([]);
  });

  test('招待中のオペレーター詳細に登録済みアカウントの履歴を出さない', async ({ page }) => {
    // 招待中はまだ登録もログインもしていない。全アカウント共通のサンプル履歴
    // (登録日時・最終ログイン・登録完了の監査ログ)がそのまま出ていた(2026-08-24 修正)。
    // パスワード操作も招待中は不可(23号 §4.8)
    await openScreen(page, '/03_admin/operator-management.html');
    await page.click('#operatorsList [data-f-oid="OP-0075"]');
    await expect(page.locator('#opModal')).toBeVisible();
    const t = (await page.locator('#opModal').innerText()).replace(/\s+/g, ' ');
    expect(t, '登録完了の履歴が出ている').not.toContain('登録完了');
    expect(t, '登録日時が本登録前になっていない').toContain('—(本登録前)');
    expect(await page.getByRole('button', { name: '初期化メールを送信' }).isVisible(),
      '招待中なのにパスワード操作が出ている').toBe(false);

    // 登録済みアカウントでは従来どおり履歴とパスワード操作が出る。
    // 復元は素のサンプルからで、識別子置換(walk)後の内容を保存し直していないこと。
    // 「Lv1 → Lv1」のように権限変更の行が壊れて戻る事故があった(2026-08-24 修正)
    await page.keyboard.press('Escape');
    await page.click('#operatorsList [data-f-oid="OP-0034"]');
    const t2 = (await page.locator('#opModal').innerText()).replace(/\s+/g, ' ');
    expect(t2).toContain('登録完了');
    expect(t2, '権限変更の履歴が識別子置換で壊れている').toContain('Lv1 → Lv2 に変更');
    expect(await page.getByRole('button', { name: '初期化メールを送信' }).isVisible()).toBe(true);

    // 招待の再送は実行と別の操作として履歴に残り、実行日は上書きされない(23号 §7.5)。
    // 監査ログは追記専用: 繰り返し再送しても1件に潰れず、成立ごとに1行増える。
    // 実行者は現在の表示シナリオのアカウント(既定 lv4 = master@abroad-o.com)
    await page.keyboard.press('Escape');
    await page.click('#operatorsList [data-f-oid="OP-0075"]');
    await page.click('#opModal button:has-text("再送")');
    await page.click('#opModal button:has-text("再送")');
    const t3 = (await page.locator('#opModal').innerText()).replace(/\s+/g, ' ');
    // 再送ボタン自体も「招待を再送」の文字を持つため、件数は監査ログ領域だけで数える
    const audit3 = (await page.locator('#opModal [data-slot="opAudit"]').innerText()).replace(/\s+/g, ' ');
    const resends = (audit3.match(/招待を再送/g) || []).length;
    expect(resends, '2回再送したのに履歴が2件残らない').toBe(2);
    expect(t3, '再送の実行者が現在シナリオでない').toContain('実行者: master@abroad-o.com');
    expect(t3, '再送の時刻が同一で重複に見える').toMatch(/09:45[\s\S]*09:46|09:46[\s\S]*09:45/);
    expect(t3, '再送で実行日が上書きされた').toContain('2026/07/21 10:30 招待を実行');
  });

  test('再送の実行者はシナリオ定義から取り、共通部品の読込に依存しない', async ({ page }) => {
    // 実行者をヘッダーの #profileMail(非同期注入)から読むと、読込前の操作が
    // Lv4 名義に化ける。Lv3 シナリオ + #profileMail 不在の経路で正しい帰属を確かめる
    await page.addInitScript(() => { localStorage.setItem('adminMockLevel', 'lv3'); });
    await openScreen(page, '/03_admin/operator-management.html');
    await page.evaluate(() => {
      const el = document.getElementById('profileMail');
      if (el) { el.remove(); }   // 共通部品が未到着の状態を再現する
    });
    await page.click('#operatorsList [data-f-oid="OP-0075"]');
    await page.click('#opModal button:has-text("再送")');
    const audit = (await page.locator('#opModal [data-slot="opAudit"]').innerText()).replace(/\s+/g, ' ');
    expect(audit, 'Lv3 の再送が Lv4 名義で記録された').toContain('招待を再送 実行者: admin@abroad-o.com');
    expect(audit.split('招待を再送')[1], '再送行の実行者が master になっている').not.toContain('master@abroad-o.com');
  });

  test('別タブでシナリオが変わっても、表示中のタブの実行者は表示と一致する', async ({ page }) => {
    // localStorage は全タブ共有だが、切替は切り替えたタブしか reload しない。
    // click 時に localStorage を再読みすると、表示(Lv4)と記録(Lv3)が食い違う。
    // シナリオは読み込み時に確定する(2026-08-24 修正)
    await openScreen(page, '/03_admin/operator-management.html');   // 既定 lv4 で表示
    await page.evaluate(() => { localStorage.setItem('adminMockLevel', 'lv3'); });  // 別タブでの切替を再現
    await page.click('#operatorsList [data-f-oid="OP-0075"]');
    await page.click('#opModal button:has-text("再送")');
    const audit = (await page.locator('#opModal [data-slot="opAudit"]').innerText()).replace(/\s+/g, ' ');
    expect(audit, '表示は Lv4 のままなのに記録が別シナリオになった')
      .toContain('招待を再送 実行者: master@abroad-o.com');
    await page.evaluate(() => { localStorage.setItem('adminMockLevel', 'lv4'); });
  });

  test('データ化中のアンケートに「納品済」を出さない', async ({ page }) => {
    // SV-10233 がデータ化中のまま「納品済 2026/07/27」を出していた(2026-08-24 修正)。
    // 納品済はデータ化完了の含意なので、作業ステータスと矛盾する
    await openScreen(page, '/03_admin/survey-management.html');
    const bad = await page.$$eval('#surveysList [data-f-status="データ化中"]', (els) => els
      .filter((el) => el.innerText.includes('納品済'))
      .map((el) => el.getAttribute('data-f-sid')));
    expect(bad, `データ化中なのに納品済: ${bad.join(', ')}`).toEqual([]);
  });

  test('会期の入力欄は日付だけを選ばせる', async ({ page }) => {
    for (const path of ['/03_admin/survey-detail.html?id=SV-10259', '/03_admin/survey-management.html']) {
      await openScreen(page, path);
      const types = await page.evaluate(() => [...document.querySelectorAll('#main-content input, .proto-modal input')]
        .filter((el) => /会期/.test(el.getAttribute('aria-label') || '')
          || /period/i.test(el.getAttribute('data-slot') || '')
          || ['svFrom', 'svTo'].includes(el.id))
        .map((el) => el.type));
      expect(types.length, `会期の入力欄が見つからない: ${path}`).toBeGreaterThan(0);
      expect([...new Set(types)], `${path} で時刻まで選べる`).toEqual(['date']);
    }
  });

  test('アンケート詳細の会期入力が対象アンケートに追従する', async ({ page }) => {
    // 表示に年を出すようにした時点で、追従の判定に使う正規表現が当たらなくなっていた
    for (const [id, start, end] of [['SV-10262', '2026-08-03', '2026-08-05'],
      ['SV-10259', '2026-07-30', '2026-08-01']]) {
      await openScreen(page, `/03_admin/survey-detail.html?id=${id}`);
      expect(await page.inputValue('[data-slot="periodStart"]'), `${id} の会期開始が追従しない`).toBe(start);
      expect(await page.inputValue('[data-slot="periodEnd"]'), `${id} の会期終了が追従しない`).toBe(end);
    }
  });

  test('メールが届いたかどうかは画面に出さない（2026-08-06 決定）', async ({ page }) => {
    // 本人へ到達したかは本番の実装では取れないという報告がある。
    // 送信した記録は出してよいが、到達を示す表示は置かない
    test.slow();
    const texts = await allText(page);
    const banned = ['送達', '本人到達', '到達確認', '開封'];
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      banned.filter((w) => t.includes(w)).forEach((w) => hit.push(`${name}: ${w}`));
    }
    expect(hit, `到達を示す表示が戻っている: ${hit.join(' / ')}`).toEqual([]);
  });

  test('プレミアムはユーザー管理の一覧に置かない（2026-08-06 決定）', async ({ page }) => {
    // 契約状態の値も請求への影響も 12_admin_user_detail.md §11 #8 で未確定。
    // 未確定の機能を一覧から即時トグルできる形で置くと、決まっているように見える
    const t = await visibleText(page, '/03_admin/user-management.html');
    expect(t, '一覧にプレミアムが戻っている').not.toContain('プレミアム');
  });

  test('プレミアムの確認と変更はユーザー詳細に残る', async ({ page }) => {
    const t = await visibleText(page, '/03_admin/user-detail.html?id=U-1002');
    expect(t, 'ユーザー詳細からプレミアムが消えている').toContain('プレミアム');
  });

  test('一覧の操作ボタンは幅が揃う', async ({ page }) => {
    const targets = [
      { path: '/03_admin/user-management.html', listId: 'usersList' },
      { path: '/03_admin/survey-management.html', listId: 'surveysList' },
    ];
    for (const t of targets) {
      await openScreen(page, t.path);
      // ラベルが長いとトラックが広がって、行ごとにボタン(リンクを含む)の右端がずれる
      const rows = await page.evaluate((listId) => [...document.querySelectorAll('#' + listId + ' [data-pg] .row-act')]
        .map((el) => [...el.querySelectorAll('button, a')]
          .filter((b) => b.getBoundingClientRect().width > 0)   // 状態で隠している側は除く
          .map((b) => Math.round(b.getBoundingClientRect().width))), t.listId);
      const widths = [...new Set(rows.flat())];
      expect(rows.length, `${t.path} に行が無い`).toBeGreaterThan(0);
      expect(widths, `${t.path} でボタンの幅が揃っていない: ${widths.join(', ')}px`).toHaveLength(1);
    }
  });
});

test.describe('R-30 見出し階層', () => {
  for (const s of SCREENS) {
    test(`${s.name}: h1 がちょうど1つある`, async ({ page }) => {
      await openScreen(page, s.path);
      expect(await page.locator('h1').count()).toBe(1);
    });
  }
});

test.describe('R-24 画面内の遷移に矢印を使わない', () => {
  test('請求書管理の一覧に → が出ない', async ({ page }) => {
    const t = await visibleText(page, '/03_admin/invoice-management.html');
    expect(t).not.toContain('→');
  });

  test('新規タブで開くものだけ ↗ を付けてよい', async ({ page }) => {
    await openScreen(page, '/03_admin/invoice-management.html');
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#main-content a, #main-content button').forEach((el) => {
        if ((el.textContent || '').includes('↗') && el.getAttribute('target') !== '_blank') {
          out.push((el.textContent || '').trim().slice(0, 24));
        }
      });
      return out;
    });
    expect(bad, `別タブで開かないのに ↗ が付いている: ${bad.join(', ')}`).toEqual([]);
  });
});

test.describe('R-14 日付の書式', () => {
  for (const s of SCREENS) {
    test(`${s.name}: 年ありと年なしの日付が混ざらない`, async ({ page }) => {
      const t = await visibleText(page, s.path);
      const withYear = t.match(/20\d\d\/\d\d?\/\d\d?/g) || [];
      const withoutYear = (t.match(/(?<![\d/])\d{2}\/\d{2}(?![\d/])/g) || []);
      expect(
        withoutYear,
        `年あり(${withYear.length}件)と年なし(${withoutYear.length}件)が同じ画面にある: `
        + `${withoutYear.slice(0, 5).join(', ')}`,
      ).toEqual([]);
    });
  }

  test('ISO 形式（2026-08-08）と和式（2026年04月）を表示に使わない', async ({ page }) => {
    // 2026-08-24 修正済み: ユーザー詳細の請求月(2026年04月→2026/04)・クーポン管理の脚注(ISO)・
    // 営業日カレンダーのタイトル(2026年 7月→2026/07)
    test.slow();
    const texts = await allText(page);
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      if (/20\d\d-\d\d-\d\d/.test(t)) { hit.push(`${name}: ISO`); }
      if (/20\d\d年\d+月/.test(t)) { hit.push(`${name}: 和式`); }
    }
    expect(hit, hit.join(' / ')).toEqual([]);
  });
});

test.describe('R-15 / R-16 記号', () => {
  test('日本語の文中では全角の括弧を使う', async ({ page }) => {
    // 未着手: 半角が大多数で全角は7箇所だけ。どちらへ寄せるかは表記の方針決定が要る
    test.fail();
    test.slow();
    const texts = await allText(page);
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      // 「(株)」は会社名の略記なので対象外。それ以外で 仮名/漢字 の直後に来る半角括弧を見る
      const m = t.replace(/\(株\)/g, '').match(/[ぁ-んァ-ヶ一-龥][()]/g);
      if (m) { hit.push(`${name}: ${m.length}件`); }
    }
    expect(hit, hit.join(' / ')).toEqual([]);
  });

  test('空欄の — と マイナスの − を取り違えない', async ({ page }) => {
    test.slow();
    const texts = await allText(page);
    // 金額・割合のマイナスは半角にする。全角マイナス(U+2212)は空欄の em dash と
    // 見分けが付かず、値が無いのか負の数なのか読めない。
    // 拡大縮小の「＋ / −」は全角のペアなので対象外（数字が続かない）
    const hit = [];
    for (const [name, t] of Object.entries(texts)) {
      const m = t.match(/−\s?[\d]/g);
      if (m) { hit.push(`${name}: ${m.join(' ')}`); }
    }
    expect(hit, `数値の前に全角マイナス: ${hit.join(' / ')}`).toEqual([]);
  });
});

test.describe('R-05 〜 R-13 用語の統一', () => {
  const CASES = [
    { id: 'R-05', label: '納期区分', words: ['納期区分', '申込プラン', 'データ化申込プラン', 'データ化の申込'] },
    { id: 'R-06', label: 'ログの呼称', words: ['操作ログ', '監査ログ'] },
    { id: 'R-10', label: 'ユーザーの呼称', words: ['ユーザー', '利用者'] },
  ];
  for (const c of CASES) {
    test(`${c.id} ${c.label}: 呼び方を1つに絞る`, async ({ page }) => {
      test.slow();
      const texts = await allText(page);
      const used = c.words.filter((w) => Object.values(texts).some((t) => t.includes(w)));
      expect(used, `${used.length}通りの呼び方が使われている: ${used.join(' / ')}`).toHaveLength(1);
    });
  }

  test('R-13 人を数える一覧は「名」で数える', async ({ page }) => {
    for (const path of ['/03_admin/user-management.html', '/03_admin/operator-management.html',
      '/03_admin/performance-management.html?tab=operators']) {
      const t = await visibleText(page, path);
      const m = /全\s*\d+\s*([件名])中\s*[\d〜]+\s*([件名])を表示/.exec(t);
      expect(m, `件数表示が読めない: ${path}`).not.toBeNull();
      expect([m[1], m[2]], `${path} が「件」で人を数えている`).toEqual(['名', '名']);
    }
  });

  test('R-07 サイドバーの項目名と、遷移先の画面名が一致する', async ({ page }) => {
    await openScreen(page, '/03_admin/index.html');
    const links = await page.evaluate(() => [...document.querySelectorAll('#sidebar-placeholder a')]
      .map((a) => ({ label: (a.textContent || '').trim(), href: a.getAttribute('href') }))
      .filter((x) => x.label && x.href && !x.href.startsWith('#')));

    // 見出しは HTML に直書きなので、12画面を描画せず取得だけで足りる
    // （全部開くと並列実行のときに時間切れになる）
    const mismatch = [];
    for (const l of links) {
      const url = new URL(l.href, page.url()).href;
      const body = await (await page.request.get(url)).text();
      const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
      const title = m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
      if (title && title !== l.label) { mismatch.push(`${l.label} → ${title}`); }
    }
    expect(mismatch.length, `サイドバーと画面名が違う: ${mismatch.join(' / ')}`).toBe(0);
  });
});

test.describe('R-27 / R-28 モーダルのキーボード操作', () => {
  const MODALS = [
    { screen: 'ユーザー管理', path: '/03_admin/user-management.html', open: 'button:has-text("ユーザーを招待")' },
    { screen: 'クーポン管理', path: '/03_admin/coupon-management.html', open: 'button:has-text("クーポンを作成")' },
    { screen: 'オペレーター管理', path: '/03_admin/operator-management.html', open: 'button:has-text("新規招待")' },
  ];

  for (const m of MODALS) {
    test(`${m.screen}: Tab がモーダルの外へ出ない`, async ({ page }) => {
      await openScreen(page, m.path);
      await page.click(m.open);
      await page.waitForTimeout(300);

      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const modal = [...document.querySelectorAll('.proto-modal')].find((x) => !x.hidden);
          return modal ? modal.contains(document.activeElement) : null;
        });
        expect(inside, `${i + 1} 回目の Tab でモーダルの外へ出た`).toBe(true);
      }
    });

    test(`${m.screen}: 開いた直後に実行系のボタンへフォーカスしない`, async ({ page }) => {
      await openScreen(page, m.path);
      await page.click(m.open);
      await page.waitForTimeout(300);
      const focused = await page.evaluate(() => {
        const a = document.activeElement;
        return { tag: a.tagName, text: (a.textContent || '').trim() };
      });
      const dangerous = /保存|送信|作成|実行|削除|停止/;
      expect(
        focused.tag === 'BUTTON' && dangerous.test(focused.text),
        `開いた直後のフォーカスが「${focused.text}」`,
      ).toBe(false);
    });
  }

  test('Esc で閉じ、開いたボタンへフォーカスが戻る', async ({ page }) => {
    await openScreen(page, MODALS[0].path);
    await page.click(MODALS[0].open);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => (document.activeElement.textContent || '').trim());
    expect(back).toContain('招待');
  });
});

test.describe('R-29 識別子のコントラスト', () => {
  // 識別子は「読めないと困る情報」。補助テキストの淡さのままだと WCAG AA に届かない
  for (const s of SCREENS) {
    test(`${s.name}: 画面に出る ID が 4.5:1 以上ある`, async ({ page }) => {
      await openScreen(page, s.path);
      const bad = await page.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ID = /^(U|SV|OP|CP)-\d+$|^INV-[\d-]+$/;
        const out = [];
        document.querySelectorAll('#main-content *').forEach((el) => {
          if (el.children.length) { return; }
          const t = (el.textContent || '').trim();
          if (!ID.test(t)) { return; }
          const cs = getComputedStyle(el);
          let bg = cs.backgroundColor;
          let n = el;
          while (bg === 'rgba(0, 0, 0, 0)' && n.parentElement) { n = n.parentElement; bg = getComputedStyle(n).backgroundColor; }
          if (bg === 'rgba(0, 0, 0, 0)') { bg = 'rgb(255,255,255)'; }
          const l1 = lum(cs.color);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5 && parseFloat(cs.opacity) === 1) {
            out.push(`${t} ${Math.round(ratio * 100) / 100}:1`);
          }
        });
        return [...new Set(out)].slice(0, 4);
      });
      expect(bad, `薄い識別子: ${bad.join(' / ')}`).toEqual([]);
    });
  }
});

test.describe('R-29 文字色のコントラスト（WCAG AA）', () => {
  for (const s of SCREENS.slice(0, 6)) {
    test(`${s.name}: 本文が 4.5:1 以上ある`, async ({ page }) => {
      await openScreen(page, s.path);
      const bad = await page.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const out = [];
        document.querySelectorAll('#main-content *').forEach((el) => {
          if (el.children.length || !(el.textContent || '').trim()) { return; }
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) { return; }
          // 非活性の操作要素は基準の対象外（WCAG 1.4.3）
          if (el.matches(':disabled') || el.closest('[disabled]')) { return; }
          const cs = getComputedStyle(el);
          let bg = cs.backgroundColor;
          let n = el;
          while (bg === 'rgba(0, 0, 0, 0)' && n.parentElement) { n = n.parentElement; bg = getComputedStyle(n).backgroundColor; }
          if (bg === 'rgba(0, 0, 0, 0)') { bg = 'rgb(255,255,255)'; }
          const l1 = lum(cs.color);
          const l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const px = parseFloat(cs.fontSize);
          const need = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)) ? 3 : 4.5;
          if (ratio < need) { out.push(`${Math.round(ratio * 100) / 100}:1 ${cs.color} 「${(el.textContent || '').trim().slice(0, 18)}」`); }
        });
        return [...new Set(out)];
      });
      expect(bad, bad.join(' / ')).toEqual([]);
    });
  }
});

test.describe('R-19 〜 R-23 表示の読み取りやすさ', () => {
  test('R-19 請求管理のクーポン操作が、押すと何が起きるか読める', async ({ page }) => {
    await openScreen(page, '/03_admin/billing-management.html');
    const labels = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#billingList [data-pg]').forEach((r) => {
        const coupon = (r.getAttribute('data-f-coupon') || '').trim();
        const btn = [...r.querySelectorAll('button')].find((b) => /クーポン/.test(b.textContent));
        if (btn) { out.push({ coupon, label: btn.textContent.trim(), title: (btn.getAttribute('title') || '').trim() }); }
      });
      return out;
    });
    expect(labels.length).toBeGreaterThan(0);
    for (const x of labels) {
      // 名詞1語（「クーポン」だけ）では何が起きるか分からない。
      // 「(例外)」の但し書きは 2026-08-17 にラベルから外した。自動化方針
      // (01_admin_common_ui.md §7.4)は変わっていないので、例外操作である説明は
      // 補足表示(title)で残す。ラベルと説明の両方を検査し、説明だけ落ちるのを防ぐ
      expect(x.label, 'ボタンが動詞になっていない').toMatch(/を(適用|変更)$/);
      const applied = x.coupon && x.coupon !== '—';
      expect(x.label, `クーポン=${x.coupon || 'なし'} の行のラベルが合っていない`)
        .toBe(applied ? 'クーポンを変更' : 'クーポンを適用');
      expect(x.title, `${x.label} に例外操作である説明がない`).toMatch(/例外的な操作/);
      expect(x.title, `${x.label} の説明が通常の流れに触れていない`).toMatch(/通常は申込時/);
    }
  });

  test('R-20 クーポン管理で使用回数とメモが離れている', async ({ page }) => {
    await openScreen(page, '/03_admin/coupon-management.html');
    // 淡色の期限切れ行だけ書き方が違って余白が当たらない、ということがあったので全行見る
    const rows = await page.evaluate(() => [...document.querySelectorAll('#couponList [data-pg]')].map((r) => {
      const cells = [...r.children];
      const used = cells[7].getBoundingClientRect();
      const memo = cells[8].getBoundingClientRect();
      return {
        id: cells[0].textContent.trim(),
        space: Math.round(memo.left - used.right) + parseFloat(getComputedStyle(cells[8]).paddingLeft),
        used: cells[7].textContent.trim(),
        memo: cells[8].textContent.trim(),
      };
    }));
    expect(rows.length).toBeGreaterThan(0);
    const tight = rows.filter((r) => r.space < 12);
    expect(tight.map((r) => `${r.id}「${r.used}${r.memo}」`), '使用回数とメモの間隔が狭い行').toEqual([]);
  });

  test('R-21 正答率の警告色にしきい値が書いてある', async ({ page }) => {
    const t = await visibleText(page, '/03_admin/performance-management.html');
    expect(t, 'しきい値の説明が画面に無い').toMatch(/95\s*%\s*未満/);
  });

  test('R-22 対応言語の制約の説明が1つだけ', async ({ page }) => {
    await openScreen(page, '/03_admin/survey-detail.html?id=SV-10259');
    const t = await page.locator('#main-content').innerText();
    const hits = (t.match(/3\s*言語まで/g) || []).length;
    expect(hits, `同じ制約が ${hits} 箇所に出ている`).toBe(1);
  });

  // 色見本は「押せる操作に見える」問題があり、比較表の表示行数も削っていたため常時表示をやめた。
  // 色に頼らずに読める手掛かり（不一致の併記・確定チェック）が本文に残っていることを確かめる。
  test('R-23 照合画面は色見本を常時表示せず、状態は色以外からも読める', async ({ page }) => {
    await openScreen(page, '/03_admin/reconciliation/detail.html');
    const t = await page.locator('#main-content').innerText();
    expect(t, '色見本が本文に残っている').not.toContain('凡例');
    expect(t, '不一致が色だけでしか分からない').toContain('!不一致');
    expect(await page.locator('#ok_mail').isChecked(), '確定済みがチェックで読めない').toBe(true);

    // 色と状態の対応は「画面の見かた」で読める
    await page.getByRole('button', { name: '画面の見かた(?キー)' }).click();
    const help = await page.locator('#mShortcuts').innerText();
    expect(help, '画面の見かたに3状態の説明が無い').toContain('不一致(修正対象');
  });
});

test.describe('入力欄の幅', () => {
  for (const s of SCREENS) {
    test(`${s.name}: プレースホルダが途中で切れない`, async ({ page }) => {
      await openScreen(page, s.path);
      // Web フォントが載る前に測ると幅が数 px ぶれるので、確定まで待つ
      await page.evaluate(() => document.fonts.ready);
      const cut = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('#main-content input[placeholder]').forEach((el) => {
          const probe = document.createElement('span');
          const cs = getComputedStyle(el);
          probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
          probe.textContent = el.getAttribute('placeholder');
          document.body.appendChild(probe);
          const need = probe.offsetWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          probe.remove();
          if (need > el.offsetWidth + 1) { out.push(`${el.getAttribute('placeholder')} (要 ${Math.ceil(need)}px / 実 ${el.offsetWidth}px)`); }
        });
        return out;
      });
      expect(cut, `枠に収まっていない: ${cut.join(' / ')}`).toEqual([]);
    });
  }
});

test.describe('R-25 検索欄のラベル', () => {
  for (const s of SCREENS) {
    test(`${s.name}: 入力欄に名前が付いている`, async ({ page }) => {
      await openScreen(page, s.path);
      const unnamed = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('#main-content input:not([type=hidden]), #main-content select, #main-content textarea')
          .forEach((el) => {
            if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) { return; }
            if (el.id && document.querySelector(`label[for="${el.id}"]`)) { return; }
            if (el.closest('label')) { return; }
            out.push(el.tagName.toLowerCase() + ' placeholder=' + (el.getAttribute('placeholder') || '(なし)'));
          });
        return out;
      });
      expect(unnamed, `名前の無い入力欄: ${unnamed.join(', ')}`).toEqual([]);
    });
  }
});

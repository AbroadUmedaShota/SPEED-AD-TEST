// proto-level.js — 表示シナリオ(Lv1〜Lv4)の切替
// スプシ「管理画面_たたき台」G列(閲覧可否+データ範囲)のモック表現。実際の認可制御ではない。
// マークアップ側の宣言:
//   data-min-lv="N" / data-max-lv="N" … 現在シナリオのLvが範囲外なら非表示
//   <main data-page-min-lv="N">        … 範囲外シナリオではページ本文をガード表示に差し替え
(function () {
    'use strict';

    // lang はアカウントの対応可能言語(23号 §4.2)。出題を制限するものではなく、
    // データ入力対象一覧の対象言語「自動」が何を指すかを決める既定値として使う
    var LEVELS = {
        lv1: { n: 1, label: 'Lv1 Operator',      mail: 'l.wang@officeworks.co.jp', group: 'オフィスワークス株式会社', lang: ['ja', 'zh-Hans'] },
        lv2: { n: 2, label: 'Lv2 OperatorAdmin', mail: 'a.yamamoto@abroad-o.com',  group: 'アブロード本体',           lang: ['ja', 'en'] },
        lv3: { n: 3, label: 'Lv3 Admin',         mail: 'admin@abroad-o.com',       group: '',                        lang: ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko'] },
        lv4: { n: 4, label: 'Lv4 MasterAdmin',   mail: 'master@abroad-o.com',      group: '',                        lang: ['ja', 'en', 'zh-Hans', 'zh-Hant', 'ko'] }
    };
    var KEY = 'adminMockLevel'; // 既定はLv4(MasterAdmin)

    function currentKey() {
        var v = localStorage.getItem(KEY);
        return LEVELS[v] ? v : 'lv4';
    }

    // 現在の表示シナリオを数値(1〜4)で返す。未設定・未定義値は 4(MasterAdmin)。
    // 各画面が localStorage を直読みすると、ここのフォールバック規則と食い違うため窓口を1本にする
    window.pLevel = function () {
        return LEVELS[currentKey()].n;
    };

    // 現在のシナリオの対応可能言語を返す。対象言語「自動」の参照先(19号 §4.2)
    window.pAccountLangs = function () {
        return LEVELS[currentKey()].lang.slice();
    };

    function applyVisibility(lv) {
        document.querySelectorAll('[data-min-lv], [data-max-lv]').forEach(function (el) {
            var min = parseInt(el.getAttribute('data-min-lv') || '1', 10);
            var max = parseInt(el.getAttribute('data-max-lv') || '4', 10);
            if (lv >= min && lv <= max) {
                el.style.display = el.getAttribute('data-lv-display') || '';
            } else {
                el.style.display = 'none';
            }
        });
    }

    function applyPage(key) {
        var conf = LEVELS[key];
        document.body.setAttribute('data-level', key);
        applyVisibility(conf.n);

        var main = document.getElementById('main-content');
        if (!main) { return; }

        var pageMin = parseInt(main.getAttribute('data-page-min-lv') || '1', 10);
        if (conf.n < pageMin) {
            main.innerHTML =
                '<div class="w-full max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">' +
                '<div style="background:var(--a-surface);border:1px solid var(--a-border);border-radius:8px;padding:40px 32px;text-align:center">' +
                '<div style="font-size:16px;font-weight:700;color:var(--a-fg-strong)">この画面は ' + conf.label + ' シナリオでは表示されません</div>' +
                '<div style="margin-top:10px;font-size:12.5px;color:var(--a-fg-muted)">閲覧可能: Lv' + pageMin + '以上(スプシ「管理画面_たたき台」G列)。ヘッダー右上の表示シナリオで切り替えられます。</div>' +
                '</div></div>';
            return;
        }

        // Lv1〜2は自グループ範囲であることを帯で明示(モックのためデータの絞り込みはしない)。
        // 作業画面(名刺入力・名刺情報照合)は縦スクロールなしで1画面に収める規約のため、
        // 本文へ帯を挟むとそのぶん名刺画像の表示領域が削られる。作業画面ではヘッダーへ逃がす
        if (conf.n <= 2 && !document.getElementById('proto-range-note')
            && !document.querySelector('.admin-workscreen')) {
            var band = document.createElement('div');
            band.id = 'proto-range-note';
            band.innerHTML =
                '<div style="max-width:72rem;margin:0 auto;padding:16px 24px 0">' +
                '<div style="font-size:11.5px;color:var(--a-warn);background:var(--a-warn-bg);border:1px solid var(--a-warn-border);border-radius:6px;padding:6px 12px;display:inline-block">' +
                rangeText(conf) +
                '</div></div>';
            main.insertBefore(band, main.firstChild);
        }
    }

    function rangeText(conf) {
        return '表示シナリオ ' + conf.label + ': 表示範囲は自グループ(' + conf.group
            + ')のみ(スプシG列)。モックの見せ分けのため一覧データは絞り込んでいません。';
    }

    // 作業画面用。ヘッダーの右側へ短い注記として置き、作業領域を削らない
    function paintHeaderRange(conf) {
        var head = document.querySelector('#header-placeholder header');
        if (!head || !document.querySelector('.admin-workscreen')) { return; }
        var note = document.getElementById('proto-range-note');
        if (conf.n > 2) {
            if (note) { note.remove(); }
            return;
        }
        if (note) { return; }
        note = document.createElement('span');
        note.id = 'proto-range-note';
        note.title = rangeText(conf);
        note.textContent = '自グループのみ(' + conf.group + ')';
        note.style.cssText = 'font-size:11px;color:var(--a-warn);background:var(--a-warn-bg);border:1px solid var(--a-warn-border);'
            + 'border-radius:4px;padding:2px 8px;white-space:nowrap';
        var clock = head.querySelector('.admin-clock');
        head.lastElementChild.insertBefore(note, clock || null);
    }

    // ヘッダー・サイドバーは admin.js が非同期注入するため、現れたタイミングで配線する
    function wireChrome(key) {
        var sel = document.getElementById('levelSelect');
        if (sel && !sel.dataset.wired) {
            sel.dataset.wired = '1';
            sel.value = key;
            sel.addEventListener('change', function () {
                localStorage.setItem(KEY, sel.value);
                location.reload();
            });
        }
        var mail = document.getElementById('profileMail');
        var badge = document.getElementById('profileLevel');
        if (mail) { mail.textContent = LEVELS[key].mail; }
        if (badge) { badge.textContent = LEVELS[key].label; }
        paintHeaderRange(LEVELS[key]);  // 作業画面の範囲注記はヘッダー側に置く
        applyVisibility(LEVELS[key].n); // サイドバーnavの data-min-lv を再適用
    }

    document.addEventListener('DOMContentLoaded', function () {
        var key = currentKey();
        applyPage(key);
        wireChrome(key);  // 既に揃っている場合(注入が先に終わっていた場合)の保険
    });

    // ヘッダー・サイドバーは admin.js が非同期に注入する。完了通知を受けてから配線する
    document.addEventListener('admin:chrome-ready', function () {
        wireChrome(currentKey());
    });
})();

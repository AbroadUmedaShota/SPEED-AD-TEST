// proto-ui.js — 管理画面モックの共通モーダル制御(design_handoff_admin_ui/prototype.dc.html 準拠)
// .proto-modal(オーバーレイ) > .proto-dialog(本体) の構造を前提に、
// 開閉・Escキー・オーバーレイクリックの3系統クローズを提供する。
(function () {
    'use strict';

    var lastFocused = null;

    // 一覧の表示件数の既定値。選択肢は各画面の「表示件数」セレクト(50/100/150)と揃える
    var PAGE_SIZE_DEFAULT = '50';

    // モーダル表示中は背面(ヘッダー・サイドバー・メイン)を inert 化し、Tab移動もクリックも遮断する
    function setBackgroundInert(on) {
        ['header-placeholder', 'sidebar-placeholder', 'main-content'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) { return; }
            if (on) { el.setAttribute('inert', ''); } else { el.removeAttribute('inert'); }
        });
    }

    var FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

    function openModal() {
        return document.querySelector('.proto-modal:not([hidden])');
    }

    /** モーダル内で実際にフォーカスできる要素を、表示順に返す */
    function focusable(m) {
        return Array.prototype.filter.call(m.querySelectorAll(FOCUSABLE), function (el) {
            if (el.disabled || el.getAttribute('tabindex') === '-1') { return false; }
            if (el.closest('[hidden], [inert]')) { return false; }
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        });
    }

    /**
     * モーダルに役割と名前を付ける。
     * 支援技術は role="dialog" が無いとただの div として読み上げ、名前が無いと
     * 「何のダイアログか」が伝わらない。45 個の markup に個別で書くと付け忘れるため、
     * 開くときにこの1箇所で当てる。見出しは .proto-dialog 内の最初の h1〜h3 とする。
     */
    function labelDialog(m) {
        var d = m.querySelector('.proto-dialog') || m;
        if (d.getAttribute('role') !== 'dialog') {
            d.setAttribute('role', 'dialog');
            d.setAttribute('aria-modal', 'true');
        }
        if (d.getAttribute('aria-labelledby') || d.getAttribute('aria-label')) { return; }
        var h = d.querySelector('h1, h2, h3, [data-dialog-title]');
        if (h) {
            if (!h.id) { h.id = m.id + '-title'; }
            d.setAttribute('aria-labelledby', h.id);
            return;
        }
        // 見出し要素を持たないモーダルは、先頭行(タイトル行)を名前にする。
        // 本文まで拾うと「変更を保存しますか? × U-1002 川村 聡の…」のように長くなり、
        // 読み上げで何のダイアログか分からなくなる
        var head = d.firstElementChild;
        if (head) {
            var clone = head.cloneNode(true);
            // 閉じるボタンの「×」は名前に含めない
            clone.querySelectorAll('button, a').forEach(function (b) { b.remove(); });
            var t = (clone.textContent || '').trim().replace(/[×✕✖]\s*$/, '').trim()
                .replace(/\s+/g, ' ').slice(0, 60);
            if (t) { d.setAttribute('aria-label', t); }
        }
    }

    window.pOpen = function (id) {
        // 正本(prototype)は常に単一モーダル表示のため、開く前に他をすべて閉じる
        var wasOpen = document.querySelector('.proto-modal:not([hidden])');
        document.querySelectorAll('.proto-modal').forEach(function (m) { m.hidden = true; });
        var m = document.getElementById(id);
        if (!m) {
            document.body.style.overflow = '';
            setBackgroundInert(false);
            return;
        }
        if (!wasOpen) { lastFocused = document.activeElement; }
        labelDialog(m);
        m.hidden = false;
        document.body.style.overflow = 'hidden';
        setBackgroundInert(true);
        // 初期フォーカス: data-initial-focus 指定を最優先(破壊的な既定アクションを避けたいモーダル用)。
        // 次に入力欄。入力させるモーダルで「保存する」「招待を送信」に当たっていると、
        // Enter を続けて押したときに意図せず実行されるため
        // (確認だけのモーダルは入力欄が無いので、従来どおり主ボタン=最後のbutton に当てる)
        var first = m.querySelector('[data-initial-focus]');
        if (!first) {
            first = focusable(m).filter(function (el) {
                return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
            })[0];
        }
        if (!first) {
            var btns = Array.prototype.filter.call(m.querySelectorAll('button'), function (b) { return !b.disabled; });
            first = btns.length ? btns[btns.length - 1] : m.querySelector('[href], input, textarea, select, [tabindex]');
        }
        if (first) { first.focus(); }
    };

    function restoreFocus() {
        if (lastFocused && document.body.contains(lastFocused) && lastFocused.focus) {
            lastFocused.focus();
        }
        lastFocused = null;
    }

    // 値の設定。複写・チップ由来の変更もブラウザ標準の取り消しに委ねる
    window.pApplyValue = function (el, value) {
        if (!el) { return; }
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // 候補値の複写用: 対象inputへ値を設定し全選択(そのまま打ち直せる)
    window.pSet = function (inputId, value) {
        var el = document.getElementById(inputId);
        if (!el) { return; }
        window.pApplyValue(el, value);
        el.focus();
        if (el.setSelectionRange) { el.setSelectionRange(0, el.value.length); }
    };

    // tabindex付きのクリック要素(一覧行・カード・候補・チップ・×ボタン)を Enter / Space でも発火させる。
    // 一覧行は div のため既定のキーボード操作を持たない
    document.addEventListener('keydown', function (e) {
        if (e.isComposing || e.keyCode === 229) { return; }
        if (e.ctrlKey || e.metaKey || e.altKey) { return; }  // 修飾キー付きはショートカット側に譲る
        if (e.key !== 'Enter' && e.key !== ' ') { return; }
        var t = e.target;
        if (!t || !t.closest) { return; }
        // 行内のボタン・リンク・入力欄は各要素の既定動作に委ねる(行の遷移を二重発火させない)
        if (t.closest('button, a, input, select, textarea')) { return; }
        var el = t.closest('[tabindex]');
        if (!el || !(el.hasAttribute('onclick') || el.onclick)) { return; }
        e.preventDefault();
        el.click();
    });

    // よく使う入力チップ用: 対象inputのカーソル位置へ挿入(選択範囲は置換)
    window.pAppend = function (inputId, value) {
        var el = document.getElementById(inputId);
        if (!el) { return; }
        var st = el.selectionStart;
        var en = el.selectionEnd;
        if (typeof st === 'number') {
            el.value = el.value.slice(0, st) + value + el.value.slice(en);
            el.focus();
            var pos = st + value.length;
            el.setSelectionRange(pos, pos);
        } else {
            el.value += value;
            el.focus();
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // 一覧のページネーション(モック): 行に data-pg="n"、リスト容器に id、
    // ページャ容器に id="{listId}-pager"、件数表示に id="{listId}-range" を付けて使う
    window.pPage = function (listId, n) {
        var list = document.getElementById(listId);
        if (!list) { return; }
        list.querySelectorAll('[data-pg]').forEach(function (r) {
            // 行はインラインstyleに display:grid を持つため、''でのクリアだと
            // 非表示指定ごとgridも消えてblockに落ちる。gridを明示して復元する
            // data-out は絞り込みで外れた行。ページに関わらず常に隠す
            var on = !r.hasAttribute('data-out') && r.getAttribute('data-pg') === String(n);
            r.style.display = on ? 'grid' : 'none';
        });
        var pager = document.getElementById(listId + '-pager');
        if (!pager) { return; }
        pager.setAttribute('data-current', String(n));
        pager.querySelectorAll('button[data-page]').forEach(function (b) {
            var on = (b.getAttribute('data-page') === String(n));
            b.style.background = on ? 'var(--a-accent-bg)' : 'var(--a-surface)';
            b.style.color = on ? 'var(--a-on-accent)' : 'var(--a-fg)';
            b.style.border = '1px solid ' + (on ? 'var(--a-accent)' : 'var(--a-border-strong)');
            b.style.fontWeight = on ? '700' : '400';
        });
        var act = pager.querySelector('button[data-page="' + n + '"]');
        var lbl = document.getElementById(listId + '-range');
        if (act && lbl && act.getAttribute('data-range')) { lbl.textContent = act.getAttribute('data-range'); }
        // 端に達したページ送り矢印は淡色化(動作は元々no-op)
        var nums = Array.prototype.map.call(pager.querySelectorAll('button[data-page]'), function (b) { return parseInt(b.getAttribute('data-page'), 10); });
        var steppers = Array.prototype.filter.call(pager.querySelectorAll('button'), function (b) { return !b.hasAttribute('data-page'); });
        if (steppers.length === 2 && nums.length) {
            // 端では色を薄くするだけでなく実際に非活性にする。
            // 見た目だけ薄いと押せると思わせるうえ、薄い文字色は読めない濃さになる
            [[steppers[0], n <= Math.min.apply(null, nums), 'これより前のページはありません'],
                [steppers[1], n >= Math.max.apply(null, nums), 'これより後のページはありません']]
                .forEach(function (p) {
                    var el = p[0], off = p[1];
                    el.disabled = off;
                    el.style.color = off ? 'var(--a-fg-disabled)' : 'var(--a-fg)';
                    el.style.cursor = off ? 'default' : 'pointer';
                    if (off) { el.setAttribute('title', p[2]); } else { el.removeAttribute('title'); }
                });
        }
    };

    // 一覧の並び替え(モック): 容器に data-sortable を付けると見出しの各セルが押せるようになる。
    // 値は行の同じ位置のセルのテキストから取り、数値・件数(1,234)・日付は数として比較する。
    // 並び替えたあとはページを振り直す(pPageSize が data-pg を付け直す)
    var SORT_ARROW = 'margin-left:4px;font-size:10px;color:var(--a-accent)';

    function sortRows(list) {
        // 見出しを除いた子のうち、ページングを持つならその行、無ければ子をそのまま扱う
        var kids = Array.prototype.slice.call(list.children).slice(1);
        var paged = kids.filter(function (r) { return r.hasAttribute('data-pg'); });
        if (paged.length) { return paged; }
        return kids.filter(function (r) { return r.id !== (list.id + '-empty'); });
    }
    function sortText(row, col) {
        var c = row.children[col];
        return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    function sortNum(t) {
        // 値の全体が数値のときだけ数として扱う。U-1002 や 2026/07/31 09:12 を
        // 数と誤認しないよう、部分一致では拾わない
        var v = String(t).replace(/[,\s]/g, '');
        var m = /^[-+]?\d+(\.\d+)?(%|円|件|名|通|回|人|分)?$/.exec(v);
        return m ? parseFloat(m[0]) : null;
    }
    function paintSortHead(list) {
        var head = list.firstElementChild;
        if (!head) { return; }
        var col = list.getAttribute('data-sort-col');
        var dir = list.getAttribute('data-sort-dir') || 'asc';
        Array.prototype.forEach.call(head.children, function (c) {
            if (!c.hasAttribute('data-sort-html')) { return; }
            var on = (c.getAttribute('data-sort-col') === col);
            c.innerHTML = c.getAttribute('data-sort-html')
                + (on ? '<span style="' + SORT_ARROW + '">' + (dir === 'asc' ? '▲' : '▼') + '</span>' : '');
            c.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
    }
    window.pSort = function (listId, col) {
        var list = document.getElementById(listId);
        if (!list) { return; }
        var same = (list.getAttribute('data-sort-col') === String(col));
        var dir = (same && list.getAttribute('data-sort-dir') === 'asc') ? 'desc' : 'asc';
        list.setAttribute('data-sort-col', String(col));
        list.setAttribute('data-sort-dir', dir);
        var rows = sortRows(list);
        var numeric = rows.every(function (r) {
            var t = sortText(r, col);
            return !t || t === '—' || sortNum(t) !== null;
        });
        rows.sort(function (a, b) {
            var x = sortText(a, col), y = sortText(b, col), d;
            if (numeric) {
                var nx = sortNum(x), ny = sortNum(y);
                // 値が無い行(— や空)は末尾へ寄せる
                if (nx === null && ny === null) { return 0; }
                if (nx === null) { return 1; }
                if (ny === null) { return -1; }
                d = nx - ny;
            } else {
                // 文字列比較でも値が無い行(— や空)は数値のときと同様に末尾へ寄せる
                // (納期日など「—」混在の列で、— が昇順の先頭に固まるのを防ぐ)
                var ex = (!x || x === '—'), ey = (!y || y === '—');
                if (ex && ey) { return 0; }
                if (ex) { return 1; }
                if (ey) { return -1; }
                d = x.localeCompare(y, 'ja');
            }
            return dir === 'asc' ? d : -d;
        });
        rows.forEach(function (r) { list.appendChild(r); });
        // 行以外(該当なしの表示など)は末尾へ戻す
        Array.prototype.filter.call(list.children, function (r) {
            return r !== list.firstElementChild && !r.hasAttribute('data-pg');
        }).forEach(function (r) { list.appendChild(r); });
        paintSortHead(list);
        if (list.querySelector('[data-pg]')) {
            window.pPageSize(listId, parseInt(list.getAttribute('data-page-size') || PAGE_SIZE_DEFAULT, 10));
        }
    };
    window.pSortable = function (listId) {
        var list = document.getElementById(listId);
        if (!list) { return; }
        var head = list.firstElementChild;
        if (!head) { return; }
        Array.prototype.forEach.call(head.children, function (c, i) {
            var base = c.innerHTML.replace(/\s*[▲▼]\s*/g, '');
            if (!c.textContent.replace(/[▲▼\s]/g, '') || c.hasAttribute('data-no-sort')) { return; }
            c.setAttribute('data-sort-html', base);
            c.setAttribute('data-sort-col', String(i));
            c.setAttribute('role', 'button');
            c.setAttribute('tabindex', '0');
            c.style.cursor = 'pointer';
            c.style.userSelect = 'none';
            c.title = c.textContent.replace(/[▲▼]/g, '').trim() + 'で並び替え';
            c.onclick = function () { window.pSort(listId, i); };
            // 既定の並び順が示されている列を初期状態にする
            if (/[▲▼]/.test(c.textContent) && !list.hasAttribute('data-sort-col')) {
                list.setAttribute('data-sort-col', String(i));
                list.setAttribute('data-sort-dir', /▲/.test(c.textContent) ? 'asc' : 'desc');
            }
        });
        paintSortHead(list);
    };

    // 表示件数の切替。行を再分割してページ番号ボタンを作り直す
    // 絞り込みで外れた行(data-out)は数えない
    window.pPageSize = function (listId, size) {
        var list = document.getElementById(listId);
        var pager = document.getElementById(listId + '-pager');
        if (!list || !size) { return; }
        list.setAttribute('data-page-size', String(size));
        var rows = Array.prototype.slice.call(list.querySelectorAll('[data-pg]:not([data-out])'));
        var empty = document.getElementById(listId + '-empty');
        if (empty) { empty.style.display = rows.length ? 'none' : 'block'; }
        if (!pager) {
            // ページャを持たない一覧は絞り込み結果をそのまま表示する
            list.querySelectorAll('[data-pg]').forEach(function (r) {
                r.style.display = r.hasAttribute('data-out') ? 'none' : 'grid';
            });
            return;
        }
        if (!rows.length) {
            Array.prototype.forEach.call(pager.querySelectorAll('button[data-page]'), function (b) {
                b.parentNode.removeChild(b);
            });
            list.querySelectorAll('[data-pg]').forEach(function (r) { r.style.display = 'none'; });
            var lbl0 = document.getElementById(listId + '-range');
            if (lbl0) { lbl0.textContent = '0〜0'; }
            return;
        }
        rows.forEach(function (r, i) { r.setAttribute('data-pg', String(Math.floor(i / size) + 1)); });
        var pages = Math.ceil(rows.length / size);
        var tmpl = pager.querySelector('button[data-page]');
        var style = tmpl ? tmpl.getAttribute('style') : '';
        var steppers = Array.prototype.filter.call(pager.querySelectorAll('button'), function (b) {
            return !b.hasAttribute('data-page');
        });
        Array.prototype.forEach.call(pager.querySelectorAll('button[data-page]'), function (b) {
            b.parentNode.removeChild(b);
        });
        for (var i = 1; i <= pages; i++) {
            var btn = document.createElement('button');
            btn.setAttribute('data-page', String(i));
            btn.setAttribute('data-range', ((i - 1) * size + 1) + '\u301c' + Math.min(i * size, rows.length));
            btn.setAttribute('style', style);
            btn.textContent = String(i);
            btn.onclick = (function (n) { return function () { window.pPage(listId, n); }; })(i);
            pager.insertBefore(btn, steppers[1] || null);
        }
        // 1ページに収まる場合もページャは残す(ページ送りは pPage 側で淡色化される)
        window.pPage(listId, 1);
    };

    // --- 一覧の絞り込み(モック) ---
    // 行に data-f-<key>、絞り込みUIに data-f-key、一覧容器に data-filter-keys、
    // 絞り込みバーに data-filter-for="{listId}" を付けて使う。
    // 他画面からは同名のクエリ(?uid=U-1052 等)で同じ条件を引き継ぐ
    // lang は完全一致にしない。行の値が「日本語・英語」のような複合文字列のため、
    // 完全一致だと「英語」で絞り込んでも1件も当たらない(行側は言語マスタの正式名で持つ)
    var P_EXACT = { status: 1, plan: 1, coupon: 1, group: 1, lv: 1, month: 1, type: 1, today: 1, isnew: 1, premium: 1, unpaid: 1 };
    var P_LABEL = {
        uid: 'ユーザーID', sid: 'アンケートID', oid: 'オペレーターID', cid: 'クーポンID',
        company: '会社名', name: '氏名', mail: 'メールアドレス', code: 'コード', cname: 'クーポン名',
        status: '状態', plan: '納期区分', group: '所属グループ', lv: '権限', lang: '言語',
        month: '発行月', type: '操作種別', target: '対象', actor: '操作者', any: '氏名・メール・ID', from: '開始日', to: '終了日',
        coupon: 'クーポン', today: '本日会期のみ', isnew: '新着のみ', premium: 'プレミアム',
        survey: 'アンケート', invoice: '請求書'
    };

    function pFilterBar(listId) {
        return document.querySelector('[data-filter-for="' + listId + '"]');
    }

    function pRenderChip(listId, conds) {
        var list = document.getElementById(listId);
        var chip = document.getElementById(listId + '-chip');
        var keys = Object.keys(conds);
        if (!chip) {
            if (!keys.length) { return; }
            chip = document.createElement('div');
            chip.id = listId + '-chip';
            chip.setAttribute('style', 'margin-top:12px;display:flex;align-items:center;gap:10px;'
                + 'background:var(--a-info-bg);border:1px solid var(--a-info-border);border-radius:6px;padding:7px 12px;'
                + 'font-size:12.5px;color:var(--a-info-fg)');
            list.parentNode.insertBefore(chip, list);
        }
        if (!keys.length) { chip.style.display = 'none'; return; }
        var text = keys.map(function (k) {
            var label = P_LABEL[k] || k;
            return (conds[k] === '1' && P_EXACT[k]) ? label : label + ' = ' + conds[k];
        }).join(' / ');
        chip.innerHTML = '';
        var span = document.createElement('span');
        span.textContent = '絞り込み中: ' + text;
        var btn = document.createElement('button');
        btn.textContent = '解除';
        btn.setAttribute('style', 'background:var(--a-surface);color:var(--a-accent);border:1px solid var(--a-info-border);border-radius:5px;'
            + 'padding:3px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit');
        btn.onclick = function () { window.pClearSearch(listId); };
        chip.appendChild(span);
        chip.appendChild(btn);
        chip.style.display = 'flex';
    }

    window.pFilter = function (listId, conds) {
        var list = document.getElementById(listId);
        if (!list) { return; }
        var use = {};
        Object.keys(conds || {}).forEach(function (k) {
            var v = String(conds[k] === undefined || conds[k] === null ? '' : conds[k]).trim();
            if (v) { use[k] = v; }
        });
        list.__pConds = use;
        var keys = Object.keys(use);
        Array.prototype.forEach.call(list.querySelectorAll('[data-pg]'), function (r) {
            var hit = keys.every(function (k) {
                // from/to は data-f-date に対する期間比較(ISO形式なので文字列比較で足りる)
                if (k === 'from' || k === 'to') {
                    var d = r.getAttribute('data-f-date');
                    if (!d) { return false; }
                    return (k === 'from') ? (d >= use[k]) : (d <= use[k]);
                }
                var have = r.getAttribute('data-f-' + k);
                if (have === null) { return false; }
                return P_EXACT[k] ? (have === use[k])
                    : (have.toLowerCase().indexOf(use[k].toLowerCase()) >= 0);
            });
            if (hit) { r.removeAttribute('data-out'); } else { r.setAttribute('data-out', '1'); }
        });
        var shown = list.querySelectorAll('[data-pg]:not([data-out])').length;
        var totalEl = document.getElementById(listId + '-total');
        if (totalEl) { totalEl.textContent = shown.toLocaleString('en-US'); }
        pRenderChip(listId, use);
        window.pPageSize(listId, parseInt(list.getAttribute('data-page-size') || PAGE_SIZE_DEFAULT, 10));
    };

    // 「検索」ボタン: 絞り込みバーの入力値を集めて適用する。
    // バーに入力欄が無いキー(他画面から引き継いだ ?oid= 等)は再検索でも落とさず維持する
    // (維持中の条件は絞り込みバッジに表示され続け、「解除」でのみ外れる)
    window.pSearch = function (listId) {
        var bar = pFilterBar(listId);
        if (!bar) { return; }
        var list = document.getElementById(listId);
        var prev = (list && list.__pConds) || {};
        var conds = {};
        Object.keys(prev).forEach(function (k) {
            if (!bar.querySelector('[data-f-key="' + k + '"]')) { conds[k] = prev[k]; }
        });
        Array.prototype.forEach.call(bar.querySelectorAll('[data-f-key]'), function (el) {
            var k = el.getAttribute('data-f-key');
            conds[k] = (el.type === 'checkbox') ? (el.checked ? '1' : '') : el.value;
        });
        window.pFilter(listId, conds);
    };

    // 「条件をクリア」/絞り込みバッジの「解除」: 入力とURLのクエリを落として全件へ戻す
    window.pClearSearch = function (listId) {
        var bar = pFilterBar(listId);
        if (bar) {
            Array.prototype.forEach.call(bar.querySelectorAll('[data-f-key]'), function (el) {
                if (el.type === 'checkbox') { el.checked = false; }
                else if (el.tagName === 'SELECT') { el.selectedIndex = 0; }
                else { el.value = ''; }
            });
        }
        if (window.history && history.replaceState) {
            history.replaceState(null, '', location.pathname);
        }
        window.pFilter(listId, {});
    };

    // 起動時: URLのクエリのうち data-filter-keys に載っているものを適用する
    function pApplyUrlFilter(list) {
        var listId = list.id;
        var allowed = (list.getAttribute('data-filter-keys') || '').split(',').map(function (s) { return s.trim(); });
        var q = new URLSearchParams(location.search);
        var conds = {};
        allowed.forEach(function (k) { if (k && q.get(k)) { conds[k] = q.get(k); } });
        if (!Object.keys(conds).length) { return; }
        var bar = pFilterBar(listId);
        if (bar) {
            Object.keys(conds).forEach(function (k) {
                var el = bar.querySelector('[data-f-key="' + k + '"]');
                if (!el) { return; }
                if (el.type === 'checkbox') { el.checked = (conds[k] === '1'); }
                else { el.value = conds[k]; }
            });
        }
        window.pFilter(listId, conds);
    }

    // 横断検索(ヘッダー)。IDの頭書きで行き先を判定して直行し、ID以外は会社名として
    // ユーザー管理の絞り込みへ渡す。行き先側の絞り込みは pApplyUrlFilter が受け取る。
    // 存在しないIDは各詳細画面の「見つかりません」表示がそのまま受け止める
    window.pGlobalSearch = function (ev) {
        if (ev && ev.key !== 'Enter') { return; }
        var box = document.getElementById('globalSearch');
        var q = box ? box.value.trim() : '';
        if (!q) { return; }
        var s = q.toUpperCase();
        var to;
        if (/^U-\d+$/.test(s)) { to = 'user-detail.html?id=' + s; }
        else if (/^SV-\d+$/.test(s)) { to = 'survey-detail.html?id=' + s; }
        else if (/^OP-\d+$/.test(s)) { to = 'operator-management.html?any=' + s; }
        else if (/^INV[-0-9]+$/.test(s)) { to = 'invoice-management.html?invoice=' + s; }
        else if (/^CP-\d+$/.test(s)) { to = 'coupon-management.html?cid=' + s; }
        else { to = 'user-management.html?company=' + encodeURIComponent(q); }
        // ヘッダーのロゴリンクは注入時に基準パスへ解決済みのため、そこから 03_admin/ の
        // 位置を得る(data-entry/ 等の下層ページからでも正しい相対位置になる)
        var home = document.querySelector('#header-placeholder a[href]');
        var base = home ? String(home.getAttribute('href')).replace(/index\.html(?:[?#].*)?$/, '') : '';
        location.href = base + to;
    };

    window.pPageStep = function (listId, delta) {
        var pager = document.getElementById(listId + '-pager');
        if (!pager) { return; }
        var next = (parseInt(pager.getAttribute('data-current') || '1', 10)) + delta;
        if (pager.querySelector('button[data-page="' + next + '"]')) { window.pPage(listId, next); }
    };


    // 名刺画像エンジン: ホバー追従拡大・クリック固定・90度回転(回転時は収まるよう自動縮小)
    // 名刺入力画面・名刺情報照合の共用。+/− と R はキーボードから、入力欄フォーカス中は Alt を併用する
    window.pInitCardZoom = function () {
        if (window.__cardZoomInit) { return; }
        window.__cardZoomInit = true;
        var zoom = 2;
        var current = null;
        function fitScale(img) {
            if (parseInt(img.dataset.rot || '0', 10) % 180 === 0) { return 1; }
            var w = img.offsetWidth;
            var h = img.offsetHeight;
            if (!w || !h) { return 1; }
            return Math.min(w / h, h / w);
        }
        function apply(img, scaled) {
            if (!scaled) { img.style.transformOrigin = 'center center'; }
            var sc = (scaled ? zoom : 1) * fitScale(img);
            img.style.transform = (sc !== 1 ? 'scale(' + sc + ') ' : '') + 'rotate(' + (img.dataset.rot || 0) + 'deg)';
        }
        function refreshLabel() {
            var el = document.getElementById('zoomLabel');
            if (el) { el.textContent = 'ホバー拡大・クリック固定 ×' + zoom.toFixed(1); }
        }
        window.pZoomDelta = function (d) {
            zoom = Math.min(4, Math.max(1, Math.round((zoom + d) * 10) / 10));
            refreshLabel();
            document.querySelectorAll('.card-zoom img').forEach(function (img) {
                if (img.dataset.pinned === '1') { apply(img, true); }
            });
        };
        window.pRotate = function () {
            var img = current;
            if (!img || !document.body.contains(img) || img.offsetParent === null) {
                img = document.querySelector('.card-zoom img');
            }
            if (!img) { return; }
            img.dataset.rot = String((parseInt(img.dataset.rot || '0', 10) + 90) % 360);
            apply(img, img.dataset.pinned === '1');
        };
        window.pResetCardZoom = function () {
            document.querySelectorAll('.card-zoom img').forEach(function (img) {
                img.dataset.rot = '0';
                img.dataset.pinned = '';
                img.style.transform = '';
                img.style.outline = '';
                img.style.cursor = 'zoom-in';
            });
            current = null;
            refreshLabel();
        };
        document.querySelectorAll('.card-zoom img').forEach(function (img) {
            img.addEventListener('mouseenter', function () { current = img; });
            img.addEventListener('mousemove', function (e) {
                if (img.dataset.pinned === '1') { return; }
                var rc = img.getBoundingClientRect();
                img.style.transformOrigin = ((e.clientX - rc.left) / rc.width * 100) + '% ' + ((e.clientY - rc.top) / rc.height * 100) + '%';
                apply(img, true);
            });
            img.addEventListener('mouseleave', function () {
                if (img.dataset.pinned === '1') { return; }
                apply(img, false);
            });
            img.addEventListener('click', function () {
                if (img.dataset.pinned === '1') {
                    img.dataset.pinned = '';
                    img.style.outline = '';
                    img.style.cursor = 'zoom-in';
                    apply(img, false);
                } else {
                    img.dataset.pinned = '1';
                    img.style.outline = '2px solid var(--a-accent)';
                    img.style.cursor = 'zoom-out';
                    apply(img, true);
                }
            });
        });
        document.addEventListener('keydown', function (e) {
            if (e.isComposing || e.keyCode === 229) { return; }
            if (e.ctrlKey || e.metaKey) { return; }  // Ctrl+R(リロード)等のブラウザ操作は奪わない
            if (document.querySelector('.proto-modal:not([hidden])')) { return; }
            var t = e.target;
            var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
            if (inField && !e.altKey) { return; }
            if (e.key === '+' || e.key === '=') { e.preventDefault(); window.pZoomDelta(0.5); }
            else if (e.key === '-') { e.preventDefault(); window.pZoomDelta(-0.5); }
            else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); window.pRotate(); }
        });
        refreshLabel();
    };


    // 作業画面ロック: 名刺入力画面・名刺情報照合の共用。
    // 無操作が続くと既定3分で解除し、名刺画像を伏せる(他者へ出題し直される状態を画面でも示す)。
    // 入力内容は保持したままで、「対象を再取得」でロックし直す。
    // 戻り値の expired() を確定処理の前段で見て、解除中の確定を止める。
    window.pInitWorkLock = function (opts) {
        var o = opts || {};
        var seconds = o.seconds || 180;
        var badge = document.getElementById(o.badgeId || 'lockBadge');
        var timer = null;
        var left = seconds;
        var expired = false;

        function mask(on) {
            document.querySelectorAll('.card-zoom').forEach(function (box) {
                var m = box.querySelector('.card-lock-mask');
                if (on) {
                    box.querySelectorAll('img').forEach(function (img) { img.style.visibility = 'hidden'; });
                    if (!m) {
                        m = document.createElement('div');
                        m.className = 'card-lock-mask';
                        m.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--a-work-bg-inner);color:var(--a-fg-faint);font-size:12px;line-height:1.8;text-align:center;padding:12px';
                        m.innerHTML = '<span style="font-size:20px">🔒</span>ロックが解除されたため名刺画像を伏せています<br>「対象を再取得」で再表示します';
                        if (getComputedStyle(box).position === 'static') { box.style.position = 'relative'; }
                        box.appendChild(m);
                    }
                } else {
                    box.querySelectorAll('img').forEach(function (img) { img.style.visibility = ''; });
                    if (m) { m.remove(); }
                }
            });
        }

        function paint() {
            if (!badge) { return; }
            var sec = badge.querySelector('[data-lock-sec]');
            if (sec) { sec.textContent = String(left); }
            if (left <= 30) {
                badge.style.color = 'var(--a-warn)'; badge.style.background = 'var(--a-warn-bg)'; badge.style.borderColor = 'var(--a-warn-border)';
            } else {
                badge.style.color = 'var(--a-accent-deep)'; badge.style.background = 'var(--a-info-bg)'; badge.style.borderColor = 'var(--a-info-border)';
            }
        }

        function expire() {
            if (expired) { return; }
            if (timer) { clearInterval(timer); timer = null; }
            expired = true;
            mask(true);
            if (badge) {
                badge.innerHTML = 'ロック解除済み — <span role="button" tabindex="0" data-lock-relock style="font-weight:700;text-decoration:underline;cursor:pointer">対象を再取得</span>(入力内容は保持されます)';
                badge.style.color = 'var(--a-danger)';
                badge.style.background = 'var(--a-danger-bg)';
                badge.style.borderColor = 'var(--a-danger-border)';
            }
            if (o.onExpire) { o.onExpire(); }
        }

        function reset() {
            expired = false;
            left = seconds;
            mask(false);
            if (timer) { clearInterval(timer); }
            if (!badge) { return; }
            badge.innerHTML = '作業ロック中(自動解除まで <span data-lock-sec>' + left + '</span>秒)';
            paint();
            timer = setInterval(function () {
                if (!document.body.contains(badge)) { clearInterval(timer); return; }
                left -= 1;
                if (left > 0) { paint(); return; }
                expire();
            }, 1000);
        }

        ['keydown', 'input', 'mousedown'].forEach(function (ev) {
            document.addEventListener(ev, function () {
                if (!expired && timer) { left = seconds; paint(); }
            });
        });
        if (badge) {
            badge.addEventListener('click', function (e) {
                if (e.target.hasAttribute && e.target.hasAttribute('data-lock-relock')) { reset(); }
            });
        }
        reset();
        // 解除後の挙動は 3 分待たないと再現できないため、確認用に即時解除の口を残す
        var api = { expired: function () { return expired; }, reset: reset, expireNow: expire };
        window.pWorkLock = api;
        return api;
    };


    // 操作の結果を短く知らせる。実データを持たないモックでも、押した操作が通ったことを示す
    window.pToast = function (msg, kind) {
        var box = document.getElementById('p-toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'p-toast';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);'
                + 'z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;'
                + 'pointer-events:none';
            document.body.appendChild(box);
        }
        var t = document.createElement('div');
        t.style.cssText = 'background:' + (kind === 'error' ? 'var(--a-danger-bg-solid)' : 'var(--a-work-bg)')
            + ';color:var(--a-on-accent);border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;'
            + 'box-shadow:0 8px 24px rgba(12,18,30,.28);opacity:0;transition:opacity .12s';
        t.textContent = msg;
        box.appendChild(t);
        requestAnimationFrame(function () { t.style.opacity = '1'; });
        setTimeout(function () {
            t.style.opacity = '0';
            setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 200);
        }, 2600);
    };

    // 画面のデータからCSVを組み立てて保存する。Excelで開けるようBOM付きUTF-8・CRLF
    window.pCsv = function (name, rows) {
        var body = rows.map(function (r) {
            return r.map(function (v) {
                v = (v === undefined || v === null) ? '' : String(v);
                return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
            }).join(',');
        }).join('\r\n');
        var blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
        window.pToast(name + ' を保存しました');
    };

    // 一覧の表示中の行からCSVを作る。列見出しは一覧のヘッダーをそのまま使う。
    // 操作ログ・オペレーター実績確認の共用
    window.pListCsv = function (listId, name) {
        var list = document.getElementById(listId);
        if (!list) { return; }
        var head = list.firstElementChild;
        var cols = [];
        Array.prototype.forEach.call(head.children, function (c) {
            cols.push(c.textContent.replace(/[▼▲]/g, '').trim());
        });
        var rows = [cols];
        Array.prototype.forEach.call(list.querySelectorAll('[data-pg]:not([data-out])'), function (r) {
            var line = [];
            Array.prototype.forEach.call(r.children, function (c) {
                line.push(c.textContent.replace(/\s+/g, ' ').trim());
            });
            rows.push(line);
        });
        // 操作列は出力しない
        var last = cols.length - 1;
        if (/^操作$/.test(cols[last])) {
            rows = rows.map(function (r) { return r.slice(0, last); });
        }
        window.pCsv(name, rows);
    };

    // 回答データDLモーダル(#mDl)の選択で実際にファイルを保存する。
    // 名刺画像は実ファイルを作れないため受付のみ知らせる。
    // アンケート管理・アンケート詳細・照合結果一覧の共用
    // ダウンロードのモーダルを、押した行の対象で開く。
    // 対象を渡さないと、モーダル内の文言もファイル名も既定の1件に固定されてしまう
    window.pDlOpen = function (sid, title) {
        var slot = document.querySelector('#mDl [data-slot="dlSid"]');
        if (slot) { slot.textContent = sid + (title ? ' ' + title : ''); }
        window.pOpen('mDl');
    };

    window.pDlPick = function (kind) {
        var sid = (document.querySelector('#mDl [data-slot="dlSid"]') || {}).textContent
            || (document.getElementById('mDl').innerText.match(/SV-\d+/) || ['export'])[0];
        if (kind === 'zip') {
            window.pToast(sid + ' の名刺画像(ZIP)の取得を受け付けました');
            window.pClose('mDl');
            return;
        }
        // 回答データは名刺のデータ化結果ではなく、アンケートの設問回答そのもの
        if (kind === 'answer') {
            var ahead = ['回答ID', '受信日時', '回答言語', '設問1', '設問2', '設問3', '名刺画像の有無'];
            var arows = [ahead];
            for (var j = 1; j <= 8; j++) {
                arows.push(['#' + (8800 + j), '—', '—', '—', '—', '—', '—']);
            }
            window.pCsv(sid + '_answers.csv', arows);
            window.pClose('mDl');
            return;
        }
        var head = ['回答ID', '氏名', '会社名', '部署名', '役職名', 'メールアドレス', '電話番号', '受信日時'];
        var rows = [head];
        var n = (kind === 'all') ? 8 : 5;
        for (var i = 1; i <= n; i++) {
            rows.push(['#' + (8800 + i), '—', '—', '—', '—', '—', '—', '—']);
        }
        window.pCsv(sid + (kind === 'all' ? '_all' : '_final') + '.csv', rows);
        window.pClose('mDl');
    };

    // 指定された対象が無いときは、黙って既定の対象を出さない。
    // 別のレコードを見ていることに気づけないまま、レビューや代行操作の判断材料になるため。
    // 詳細系画面(ユーザー詳細・アンケート詳細・照合詳細ほか)の共用
    window.pNotFound = function (kind, wanted, backHref, backLabel) {
        var main = document.getElementById('main-content');
        if (!main) { return; }
        main.innerHTML =
            '<div class="w-full max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">' +
            '<div style="background:var(--a-surface);border:1px solid var(--a-border);border-radius:8px;padding:40px 32px;text-align:center">' +
            '<div style="font-size:16px;font-weight:700;color:var(--a-fg-strong)">指定された' + kind + 'が見つかりません</div>' +
            '<div style="margin-top:10px;font-size:12.5px;color:var(--a-fg-muted)">ID: ' +
            String(wanted).replace(/[&<>"]/g, '') + '</div>' +
            '<div style="margin-top:16px"><a href="' + backHref + '" style="font-weight:700">' + backLabel + '</a></div>' +
            '</div></div>';
    };

    // 一覧の行を書き換える。cells は 0 起点の位置 → HTML
    window.pRowSet = function (row, cells, attrs) {
        if (!row) { return; }
        var kids = row.children;
        Object.keys(cells || {}).forEach(function (i) {
            if (kids[i]) { kids[i].innerHTML = cells[i]; }
        });
        Object.keys(attrs || {}).forEach(function (k) {
            row.setAttribute('data-f-' + k, attrs[k]);
        });
    };

    // 一覧の行を取り出す(data-f-<key> の完全一致)
    window.pRow = function (listId, key, val) {
        return document.querySelector('#' + listId + ' [data-f-' + key + '="' + val + '"]');
    };

    window.pClose = function (id) {
        var m = document.getElementById(id);
        if (m) { m.hidden = true; }
        document.body.style.overflow = '';
        setBackgroundInert(false);
        restoreFocus();
    };

    window.pCloseAll = function () {
        var had = document.querySelector('.proto-modal:not([hidden])');
        document.querySelectorAll('.proto-modal').forEach(function (m) { m.hidden = true; });
        document.body.style.overflow = '';
        setBackgroundInert(false);
        if (had) { restoreFocus(); }
    };

    document.addEventListener('keydown', function (e) {
        if (e.isComposing || e.keyCode === 229) { return; }
        if (e.key === 'Escape') { window.pCloseAll(); }
        if (e.key === 'Tab') { trapTab(e); }
    });

    // Tab をモーダルの中で循環させる。
    // 背面は inert なのでフォーカスが背面の要素へ移ることはないが、そのままだと
    // body へ抜けてしまい、キーボードだけではモーダルのボタンへ戻れなくなる
    function trapTab(e) {
        var m = openModal();
        if (!m) { return; }
        var items = focusable(m);
        if (!items.length) { return; }
        var at = items.indexOf(document.activeElement);
        var next;
        if (at < 0) {
            // すでに外へ出ている場合は端から入れ直す
            next = e.shiftKey ? items[items.length - 1] : items[0];
        } else if (e.shiftKey && at === 0) {
            next = items[items.length - 1];
        } else if (!e.shiftKey && at === items.length - 1) {
            next = items[0];
        } else {
            return;     // 中ほどの移動はブラウザに任せる
        }
        e.preventDefault();
        next.focus();
    }

    // オーバーレイ(背景)クリックで閉じる。ダイアログ内クリックは対象外
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('proto-modal')) { window.pCloseAll(); }
    });

    // 未保存離脱ガード: main要素に data-guard-unsaved があるページで、
    // input/textarea/select への入力・変更があった後にページを離れようとしたら確認する。
    // フラグは「フォーム変更で立ち、確認ダイアログで移動を許可すると消える」単純仕様
    // (保存操作でフラグを下ろす仕組みは持たない)。
    // モーダル(.proto-modal)内の入力・リンクは対象外(モーダルは別の確認導線を持つため)。
    // ページ内アンカー(href="#...")はJS駆動の操作(取り消しリンク等)であり
    // 画面遷移ではないため対象外にする
    (function () {
        var unsavedDirty = false;

        function guardedMain() {
            return document.querySelector('main[data-guard-unsaved]');
        }

        ['input', 'change'].forEach(function (evName) {
            document.addEventListener(evName, function (e) {
                var main = guardedMain();
                if (!main || !main.contains(e.target)) { return; }
                if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) { return; }
                if (e.target.closest('.proto-modal')) { return; }
                unsavedDirty = true;
            });
        });

        window.addEventListener('beforeunload', function (e) {
            if (!unsavedDirty || !guardedMain()) { return; }
            e.preventDefault();
            e.returnValue = '';
        });

        document.addEventListener('click', function (e) {
            if (!unsavedDirty || !guardedMain()) { return; }
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a || a.closest('.proto-modal')) { return; }
            if (a.getAttribute('href').charAt(0) === '#') { return; }
            if (!window.confirm('入力内容が保存されていません。移動しますか?')) {
                e.preventDefault();
                return;
            }
            unsavedDirty = false;
        });
    })();

    // ============================================================
    // 一覧・集計領域の取得状態(01_admin_common_ui.md §4.4)
    // 領域(host): data-a-region="list" | "summary"、id 必須。
    // 本体の inline style は書き換えず、host の data-a-state と CSS だけで
    // 切り替える。行の display は pPage/pPageSize/pSort/pFilter および
    // proto-level.js が所有しているため、ここが触ると ready へ戻したときに
    // 元の表示を復元できなくなる。
    // モックの表示状態であり、実データ取得は伴わない。
    // ============================================================
    var A_TEXT = {
        list: {
            loading: '一覧を読み込んでいます…',
            reloading: '最新の一覧を読み込んでいます…',
            error: '一覧を取得できませんでした。',
            keep: '最新の一覧を取得できませんでした。表示中の内容は取得済みの時点のものです。'
        },
        summary: {
            loading: '集計を読み込んでいます…',
            reloading: '最新の集計を読み込んでいます…',
            error: '集計を取得できませんでした。',
            keep: '最新の集計を取得できませんでした。表示中の数値は取得済みの時点のものです。'
        }
    };

    function aKind(host) {
        return host.getAttribute('data-a-region') === 'summary' ? 'summary' : 'list';
    }

    // パネルは host の直前の兄弟に置く。host の子にすると pSort が
    // firstElementChild をヘッダー、以降を行として扱う前提を壊す。
    // 兄弟-before は pRenderChip(絞り込みバッジ)と同じ差し込み方
    function aPanel(host) {
        var el = document.getElementById(host.id + '-state');
        if (el) { return el; }
        el = document.createElement('div');
        el.id = host.id + '-state';
        el.className = 'a-region-state';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.hidden = true;
        host.parentNode.insertBefore(el, host);
        return el;
    }

    function aSkeleton(kind) {
        if (kind === 'summary') {
            return '<div class="a-skel-cards"><div class="a-skel a-skel-card"></div>'
                + '<div class="a-skel a-skel-card"></div><div class="a-skel a-skel-card"></div></div>';
        }
        var s = '';
        for (var i = 0; i < 5; i++) { s += '<div class="a-skel a-skel-row"></div>'; }
        return s;
    }

    // 初回読込中は検索・絞り込み・並び替え・ページングを受け付けない(§4.4)。
    // 並び替えは host ごと隠れるため、残る絞り込みバーとページャ行を止める
    function aCtl(regionId, on) {
        [document.querySelector('[data-filter-for="' + regionId + '"]'),
            document.querySelector('[data-a-ctl="' + regionId + '"]')].forEach(function (el) {
            if (!el) { return; }
            if (on) { el.removeAttribute('inert'); el.style.opacity = ''; }
            else { el.setAttribute('inert', ''); el.style.opacity = '0.5'; }
        });
    }

    window.pRegionState = function (regionId, state) {
        var host = document.getElementById(regionId);
        if (!host) { return; }
        var kind = aKind(host);
        var t = A_TEXT[kind];
        var panel = aPanel(host);

        if (!state || state === 'ready') {
            host.removeAttribute('data-a-state');
            host.removeAttribute('aria-busy');
            panel.hidden = true;
            panel.style.minHeight = '';
            aCtl(regionId, true);
            return;
        }

        host.setAttribute('data-a-state', state);
        if (state === 'loading' || state === 'reloading') { host.setAttribute('aria-busy', 'true'); }
        else { host.removeAttribute('aria-busy'); }
        aCtl(regionId, state !== 'loading');

        var cls = 'a-region-state', html = '', retry = false;
        if (state === 'loading') {
            cls += ' is-block';
            html = '<div class="a-region-state-msg">' + t.loading + '</div>' + aSkeleton(kind);
        } else if (state === 'reloading') {
            cls += ' is-bar is-info';
            html = '<span class="a-region-state-msg">' + t.reloading + '</span>';
        } else if (state === 'error') {
            cls += ' is-block is-error';
            html = '<div class="a-region-state-msg">' + t.error + '</div>'
                + '<div class="a-region-state-sub">時間をおいて再試行してください。</div>';
            retry = true;
        } else if (state === 'error-keep') {
            cls += ' is-bar is-error';
            html = '<span class="a-region-state-msg">' + t.keep + '</span>';
            retry = true;
        }

        panel.className = cls;
        panel.innerHTML = html;
        // 本体を差し替える状態では元の高さを引き継ぎ、レイアウトの跳ねを抑える
        var keepH = (state === 'loading' || state === 'error') && host.dataset.aH;
        panel.style.minHeight = keepH ? (host.dataset.aH + 'px') : '';

        if (retry) {
            var b = document.createElement('button');
            b.type = 'button';
            b.id = regionId + '-retry';
            b.className = 'a-region-retry';
            b.textContent = '再試行';
            b.addEventListener('click', function () {
                window.pRegionState(regionId, 'reloading');
                setTimeout(function () { window.pRegionState(regionId, 'ready'); }, 700);
            });
            panel.appendChild(b);
        }
        panel.hidden = false;
    };

    // 「集計のみ失敗」は単一領域の状態ではなく領域種別ごとの組み合わせのため、
    // シナリオ→領域状態の対応表として持つ
    var A_SCENARIO = {
        ready:        { list: 'ready',      summary: 'ready' },
        loading:      { list: 'loading',    summary: 'loading' },
        reloading:    { list: 'reloading',  summary: 'reloading' },
        error:        { list: 'error',      summary: 'error' },
        'error-keep': { list: 'error-keep', summary: 'error-keep' },
        partial:      { list: 'ready',      summary: 'error' }
    };
    var A_SCENARIO_LABEL = {
        loading: '初回読込中', reloading: '再読込中', error: '取得失敗',
        'error-keep': '取得失敗(表示中の内容を維持)', partial: '集計のみ失敗'
    };

    window.pPageState = function (scenario) {
        var map = A_SCENARIO[scenario] || A_SCENARIO.ready;
        document.querySelectorAll('[data-a-region]').forEach(function (host) {
            if (host.id) { window.pRegionState(host.id, map[aKind(host)]); }
        });
        aScenarioChip(A_SCENARIO_LABEL[scenario] || '');
    };

    // 表示状態で開いていることを画面に残す。実装済みの挙動と取り違えられないようにする
    function aScenarioChip(label) {
        var el = document.getElementById('p-region-scenario');
        if (!label) { if (el) { el.parentNode.removeChild(el); } return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'p-region-scenario';
            document.body.appendChild(el);
        }
        el.innerHTML = '';
        var s = document.createElement('span');
        s.textContent = '表示状態: ' + label + '(モック確認用)';
        var a = document.createElement('a');
        a.href = location.pathname;
        a.textContent = '通常表示へ戻す';
        el.appendChild(s);
        el.appendChild(a);
    }

    document.addEventListener('DOMContentLoaded', function () {
        // proto-level.js の applyPage(ページガード時の main.innerHTML 差し替え)は
        // 同じ DOMContentLoaded で後から走る。差し替え後の DOM に対して働くよう遅らせる
        setTimeout(function () {
            document.querySelectorAll('[data-a-region]').forEach(function (h) {
                if (h.id && !h.dataset.aH) {
                    h.dataset.aH = String(Math.min(h.offsetHeight || 0, 520));
                }
            });
            var s = new URLSearchParams(location.search).get('state');
            if (s) { window.pPageState(s); }
        }, 0);
    });

    // 初期化: ページャの初期状態適用と、理由必須ボタン(data-requires)の非活性制御
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[id$="-pager"]').forEach(function (pager) {
            var listId = pager.id.slice(0, -6);
            var list = document.getElementById(listId);
            if (!list) { return; }
            // 静的マークアップのページ分割に関わらず、既定の表示件数で振り直す
            // (件数が増えて存在しなくなったページ番号は開かず、1ページ目のままにする)
            var current = parseInt(pager.getAttribute('data-current') || '1', 10);
            window.pPageSize(listId, parseInt(list.getAttribute('data-page-size') || PAGE_SIZE_DEFAULT, 10));
            if (current > 1 && pager.querySelector('button[data-page="' + current + '"]')) {
                window.pPage(listId, current);
            }
        });
        // 他画面から引き継いだ絞り込み条件を適用する(ページャの有無は問わない)
        document.querySelectorAll('[data-filter-keys]').forEach(function (list) {
            if (list.id) { pApplyUrlFilter(list); }
        });
        document.querySelectorAll('button[data-requires]').forEach(function (btn) {
            var inp = document.getElementById(btn.getAttribute('data-requires'));
            if (!inp) { return; }
            function sync() {
                var ok = !!inp.value.trim();
                btn.disabled = !ok;
                btn.style.opacity = ok ? '' : '0.55';
                btn.style.cursor = ok ? 'pointer' : 'default';
            }
            inp.addEventListener('input', sync);
            sync();
        });
    });

    // data-sortable が付いた一覧に並び替えを配線する
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-sortable]').forEach(function (l) {
            if (l.id) { window.pSortable(l.id); }
        });
    });
})();

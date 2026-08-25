/**
 * 絞り込みカード(.a-filter-card)の表示制御。
 *
 * 受け持つのは「どの項目を見せるか」だけで、絞り込みそのものには関与しない。
 * 検索は proto-ui.js の pSearch がカード配下の [data-f-key] を可視・不可視を
 * 問わず全部読むため、開いていないタブの条件も同時に効く。タブは条件の
 * 区切りではなく表示の整理であり、切り替えても条件は落ちない。
 *
 * 必要な印:
 *   カード外殻    class="a-filter-card" data-filter-for="{listId}"
 *   タブ          data-filter-tab="{key}"    role="tab"
 *   項目パネル    data-filter-panel="{key}"  role="tabpanel"
 */
(function () {
    'use strict';

    function tabsOf(card) {
        return Array.prototype.slice.call(card.querySelectorAll('[data-filter-tab]'));
    }

    function panelsOf(card) {
        return Array.prototype.slice.call(card.querySelectorAll('[data-filter-panel]'));
    }

    function panelFor(card, key) {
        return card.querySelector('[data-filter-panel="' + key + '"]');
    }

    /** そのパネルに条件が1つでも入っているか */
    function hasValue(panel) {
        if (!panel) { return false; }
        return Array.prototype.some.call(panel.querySelectorAll('[data-f-key]'), function (el) {
            if (el.type === 'checkbox') { return el.checked; }
            return !!String(el.value || '').trim();
        });
    }

    function select(card, key, focusTab) {
        tabsOf(card).forEach(function (tab) {
            var on = tab.getAttribute('data-filter-tab') === key;
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            tab.setAttribute('tabindex', on ? '0' : '-1');
            if (on && focusTab) { tab.focus(); }
        });
        panelsOf(card).forEach(function (panel) {
            panel.hidden = panel.getAttribute('data-filter-panel') !== key;
        });
    }

    /** 開いていないタブに条件が残っていることを印で残す */
    function syncMarks(card) {
        tabsOf(card).forEach(function (tab) {
            var key = tab.getAttribute('data-filter-tab');
            if (hasValue(panelFor(card, key))) { tab.setAttribute('data-filled', '1'); }
            else { tab.removeAttribute('data-filled'); }
        });
    }

    function onClick(ev) {
        var card = ev.target.closest ? ev.target.closest('.a-filter-card') : null;
        if (!card) { return; }

        var tab = ev.target.closest('[data-filter-tab]');
        if (tab) {
            select(card, tab.getAttribute('data-filter-tab'), false);
            return;
        }
        // 「検索」「条件をクリア」は同じ要素の onclick が値を書き換えるため、その後に読む
        setTimeout(function () { syncMarks(card); }, 0);
    }

    /** タブ間は左右キーで移動する(WAI-ARIA の tablist と同じ操作) */
    function onKeydown(ev) {
        var tab = ev.target.closest ? ev.target.closest('[data-filter-tab]') : null;
        if (!tab) { return; }
        var card = tab.closest('.a-filter-card');
        var tabs = tabsOf(card);
        var i = tabs.indexOf(tab);
        var to = -1;
        if (ev.key === 'ArrowRight') { to = (i + 1) % tabs.length; }
        else if (ev.key === 'ArrowLeft') { to = (i - 1 + tabs.length) % tabs.length; }
        else if (ev.key === 'Home') { to = 0; }
        else if (ev.key === 'End') { to = tabs.length - 1; }
        if (to < 0) { return; }
        ev.preventDefault();
        select(card, tabs[to].getAttribute('data-filter-tab'), true);
    }

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('input', function (ev) {
        var card = ev.target.closest ? ev.target.closest('.a-filter-card') : null;
        if (card) { syncMarks(card); }
    });
    document.addEventListener('change', function (ev) {
        var card = ev.target.closest ? ev.target.closest('.a-filter-card') : null;
        if (card) { syncMarks(card); }
    });

    // 初期化は proto-ui.js の URL引き継ぎ(pApplyUrlFilter)より後に走らせる。
    // 引き継いだ条件が開いていないタブの項目だった場合、そのタブを開いて所在を示す
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.a-filter-card').forEach(function (card) {
            syncMarks(card);
            var tabs = tabsOf(card);
            if (!tabs.length) { return; }
            var current = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
            if (hasValue(panelFor(card, current.getAttribute('data-filter-tab')))) { return; }
            var filled = tabs.filter(function (t) { return t.hasAttribute('data-filled'); })[0];
            if (filled) { select(card, filled.getAttribute('data-filter-tab'), false); }
        });
    });
}());

# legacy/ — 旧世代の動的レンダラ（凍結・未参照）

このディレクトリのファイルは、現行の管理画面モック（静的モック版）からは **どこからも読み込まれていない** 旧世代の実装です。同名の画面 HTML がリファクタリング版（静的モック）へ置き換えられた際に残った資産を、誤編集を防ぐためここへ隔離しています（2026-08-25 の画面レビューで決定）。

## 収録物

- `src/` — 旧動的レンダラ 9 本
  - calendar-management.js / coupon-management.js / couponBulkCreate.js / data-entry-management.js / data_entry.js / data_entry_form.js / groupManagement.js / operator-management.js / performance-management.js
  - ※ data_entry_form.js のみ `03_admin/sample/data_entry_admin_form.html`（凍結サンプル）から参照されている
- `modals/` — 旧レンダラだけが fetch していたモーダル断片 7 本
  - `src/` からの相対パス `../modals/...` 参照を保つため、src と同じ階層関係で収録

## 注意

- 現行画面を修正するときにここを開く必要はない。現行のランタイムは `03_admin/src/` の admin.js / proto-ui.js / proto-level.js / theme-init.js / perf-data.js / support-memos.js の 6 本のみ
- ここのコードには現行の確定方針と矛盾する挙動（アカウント削除・総処理数など）が含まれる。**現行画面へ逆輸入しない**
- テーマトークン検査（tests/e2e/admin-mock/theme.spec.js）の走査対象外

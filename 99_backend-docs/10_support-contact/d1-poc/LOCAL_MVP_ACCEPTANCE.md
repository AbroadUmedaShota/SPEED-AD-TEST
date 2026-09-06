---
owner: support-contact
status: accepted-local
last_reviewed: 2026-09-06
accepted_commit: 3b3f38ec50ade63a7b4d56ac5d91d4b490db72ac
---

# CSオペレーターアプリ ローカルMVP受入表

## 1. 判定

コミット`3b3f38ec50ade63a7b4d56ac5d91d4b490db72ac`を、[MVP実装パッケージ](MVP_IMPLEMENTATION_PACKAGE.md)の`6.1 ローカル動作完了`に対して受け入れる。

この判定は合成データ、ローカルD1、local workerd、合成principal、合成WebPだけを対象とする。実認証、remote D1、R2、Drive、実顧客データ、共有試用、本番移行を受け入れたものではない。既存の公開フォーム、GAS、Spreadsheet、Drive、通知にも変更を加えていない。

## 2. 要件別照合

| ID | ローカル必須条件 | 判定 | 実装・自動検証 | 手動証跡と境界 |
| --- | --- | --- | --- | --- |
| L-01 | 4場面を一画面で一巡できる | PASS | `assign-self`、`start`、`note`、3種の待ち、`resolve`、`reopen`を固定APIとUIで実装。`tests/mvp-vertical-slice.test.mjs`で一連の更新と履歴を検証 | ChromeのPC幅と390px幅で一覧、詳細、操作フォーム、履歴を確認 |
| L-02 | 既存6状態と操作別必須入力を保持する | PASS | 6状態でのメモ、待ち・保留の日付/理由/次の対応、解決結果/最終メモ、再開理由の正常・境界・不正入力を検証 | 汎用状態PATCHはなく、UIは現在状態に応じた固定操作だけを表示 |
| L-03 | 案件、履歴、冪等受付を原子的に保存する | PASS | D1 `batch()`、版CAS、履歴INSERT制約、request receiptを使用。履歴失敗時に案件・request・eventが全て戻ることを検証 | ローカルD1契約の判定であり、remote D1の分散障害検証ではない |
| L-04 | 同時更新、再送、ID競合、保存失敗から安全に復帰する | PASS | 決定的barrierによる競合、同一再送、異内容ID再利用、acknowledgement loss、履歴失敗を検証 | UIは古い一覧・詳細・添付応答を破棄し、自動再送しない |
| L-05 | 全許可担当者が全案件を更新できる | PASS（合成） | 担当者Bが担当者Aの案件を更新・添付取得できること、無効principalが本文解釈前に拒否されることを検証 | `x-mvp-actor`はローカル検証用で、実際の本人認証ではない |
| L-06 | 一覧、詳細、履歴、添付を安全に確認できる | PASS | 一覧は軽量列、詳細と履歴は遅延取得。添付は認証後に案件関係、状態、存在、size、SHA-256を検証し、欠損・破損・不正pathをfail closed | 添付は操作時だけ`blob:` URL化し、案件・担当者切替でURLとDOMを破棄。静的assetには置かない |
| L-07 | 狭い画面とキーボード操作を阻害しない | PASS | native button/formとfocus制御を維持し、request競合をunit testで検証 | Chrome PC/390px、クリック/Enter、横overflowなし、console error/warningなしを確認。別ブラウザは共有試用ゲート |
| L-08 | 空DBからmigrationとseedを再現できる | PASS | `0001`、`0002`を順番に適用し、正式な`contact_*` 5表だけが作成されることを検証 | 手編集によるschema変更は使用しない |
| L-09 | 元を壊さず別DBへ復元できる | PASS | 合成sourceから5表だけをexportし、migration済みの別targetへimport。全表、FK、版、履歴、旧hash、receipt replayと再送後無変更を照合 | source DBは上書き・削除しない。`d1_migrations`はdata export対象外 |
| L-10 | DBと添付を一組として復元する | PASS | manifestとblobのID、case ID、object key、size、SHA-256を照合。DB-only Workerは503、bundle注入後だけ200とbytes一致 | 実R2のbackup/restoreは共有試用ゲート |

## 3. 検証結果

- `npm run test:mvp`: 53件成功、失敗0、commit `3b3f38e`。
- Node構文確認と`git diff --check`: 成功。
- Chrome: PC幅と390px幅で主要操作、添付正常表示、欠損表示、担当者切替後の情報消去、横overflowなし、console error/warningなし。
- 独立レビュー: 復元blob未接続による偽陽性と遅延添付応答のObject URL残留を指摘後に修正し、再レビューPASS。

初回復元試験では、Wranglerの`--no-schema`だけでは`d1_migrations`のdataも含まれ、移行済みtargetとのprimary key競合を検出した。最終実装は`contact_operators`、`contact_cases`、`contact_api_requests`、`contact_case_events`、`contact_attachments`を`--table`で明示し、migration履歴をtarget側の適用結果として維持する。

## 4. ローカル合否に追加しない項目

次は既存のローカル必須条件ではないため、今回のPASSを妨げない。

- 実Googleアカウント、Access、JWT、失効、remote D1、R2の確認
- 複数添付、大容量blob、Firefox、Edge、Safari、スクリーンリーダー
- 実顧客データ移行、公開フォーム/GAS/Spreadsheet/Drive/通知の切替
- 共有URL、費用、担当者登録、本番運用

必要なものは[共有試用実行パッケージ](SHARED_TRIAL_EXECUTION_PACKAGE.md)の共有ゲートで確認する。

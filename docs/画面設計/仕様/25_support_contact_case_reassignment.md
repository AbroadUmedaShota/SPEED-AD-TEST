---
owner: shared-docs
status: implemented-local
last_reviewed: 2026-09-12
---

# 問い合わせ案件の担当者再割当

## 操作と権限

- ASSIGN-01の固定操作「担当を変更する」を追加する。既存の「自分を担当にする」は変更しない。
- PERM-01に従い、active operatorは自分以外が担当する案件も更新できる。担当者は権限境界ではない。
- 未対応・対応中・顧客確認待ち・引継ぎ待ち・保留で、有効なoperatorへ変更できる。未割当、旧担当が停止済みの案件も対象。
- 対応済み・アーカイブ済み・同じ担当への変更は拒否する。対応済みは先に既存操作で再開する。
- 状態、待機条件、次の対応、確認予定日、解決情報は変更しない。

## API契約

認可済みの `GET /api/operators` は `{ operators: [{ email, display_name }] }` を返す。
activeな行の2項目だけを返し、保存主体は既存の認証済みprincipalから決定する。
候補を選んでもログイン主体・権限は変わらない。レスポンスは `Cache-Control: no-store`。

`POST /api/cases/:id/actions/reassign` のJSONは次の4項目のみ。

| 項目 | サーバー検証 |
| --- | --- |
| requestId | 既存規則: 英数字・ハイフン・アンダースコア、1〜80文字 |
| expectedVersion | 1以上、Number.MAX_SAFE_INTEGER未満の安全な整数 |
| assigneeEmail | 文字列、1〜254文字、NUL不可。DBのactive operator.emailとの完全一致。小文字化・trimによる補正なし |
| reason | 文字列、空白だけは不可、1〜4000文字、NUL不可。入力値を履歴に保存 |

型不正、必須項目不足、余剰項目、未知・停止した候補は400。
古いversion、無変更・禁止状態、別内容でのrequestId流用は409。
保存前読取後にtargetが停止した場合は409、actorが停止した場合は403。
DB障害・履歴保存失敗は503。既存のhost、認証、JSON、本文サイズ上限を維持する。

案件CAS更新、receipt、履歴イベントは1回のD1 batchで確定する。
更新SQLでもtarget/actor双方のactive条件を確認し、CAS不成立や履歴制約違反では全rollbackする。
`reassigned` イベントには操作者・時刻・理由・from/to versionと、
`changes.previousAssigneeEmail`（未割当はnull）・`changes.assigneeEmail` を記録する。

actor認可後にreceiptを照合し、同一リクエストは元の結果を返す。targetが後日停止、
担当や状態が後日変更されても過去結果を再実行しない。同時送信のcatch側replayでもactorを再確認する。
旧アクションのhash形式・receipt JSONとshared/local実装の分離を維持する。

## 画面と失敗時

- 両UIとも「担当を変更する」→担当候補select→変更理由→保存→履歴の旧担当・新担当を表示する。
- 候補は操作時に取得する。別案件、別操作、キャンセル、認証失効後の遅延応答は反映しない。
  古い403、通信失敗、リダイレクトも現在画面を非表示にする副作用を起こさない。
- 理由と選択値は既存のタブ内draftに保存する。失敗、キャンセル、最新版確認でも保持する。
- 候補から外れた保存済み入力は「保存済み入力・現在の候補外」と明示して保持する。
  新規保存はサーバーで拒否するが、ACK不明の同一操作は過去receiptを確認できる。
- ACK不明時は同じ内容のrequestId/expectedVersionを保持して再送する。
  version競合を確認した場合はdraftを保ち、最新版確認後の保存は新しい操作IDとversionを使う。
- 保存中の追加入力は送信済み内容と区別して保持する。別案件・別操作へ移った後の保存結果では、
  元案件のreceipt/attemptだけを確定し、現在のフォームを閉じたり開き直したりしない。
  競合後の詳細再取得・候補取得の各継続点でも案件・操作の世代を再確認する。
- 履歴の「操作」と「旧担当・新担当」を区別する。候補・理由・履歴はHTMLとして解釈しない。

## Migrationとローカル検証

既存0001/0002は変更しない。`migrations-mvp/0003_case_reassignment.sql` で
receipt/actionとevent_typeのCHECKに再割当を追加する。ブラウザ専用schemaは
`migrations-shared-browser/0004_case_reassignment.sql` に同じ変更を追加する。

現schemaの参照はNO ACTIONでtriggerはない。FKを無効化せず、transaction内だけ遅延し、
receipt/eventの2表を全列コピーして再構築、indexを再作成する。案件・operator・添付は再構築しない。
適用前に既存データを退避し、未知のCASCADE/triggerやschema差分がある環境には無確認で適用しない。
本変更は本番適用、権限変更、外部送信を承認するものではない。

repository rootから、lockに従った依存導入後に実行するローカル受入:

```powershell
node --test 99_backend-docs/10_support-contact/d1-poc/tests/reassignment-d1.test.mjs
node --test 99_backend-docs/10_support-contact/d1-poc/tests/reassignment-worker.test.mjs
node --test --test-concurrency=1 99_backend-docs/10_support-contact/d1-poc/tests/reassignment-ui.test.mjs
```

D1試験は実local workerd bindingで正常・拒否・競合・再送・rollbackと旧DB保全を確認する。
UI試験はloopbackサーバー、製品UIの実イベント、合成principal/fixture、同じ実local D1だけを使用する。
Chrome・Edge・Firefoxのdesktop/mobile、keyboard、draft・ACK再送・競合・候補応答競合を確認する。
ブラウザ画像は `.local-test/reassignment-browser/` に出力する。LIST-02の一覧変更は含めない。
Windowsで復元試験を併走させる場合は、TEMP/TMPをworktree内の短いパスへ設定する。

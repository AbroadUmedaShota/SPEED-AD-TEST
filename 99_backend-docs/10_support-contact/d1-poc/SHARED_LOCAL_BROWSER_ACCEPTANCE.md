---
owner: support-contact
status: accepted-local
last_reviewed: 2026-09-06
scope: shared adapter local browser and G1 metadata
---

# 共有adapter ローカルブラウザ受入

## 判定

共有版adapterは、合成JWT、注入JWKS、local D1、local R2だけを使用するローカルブラウザ受入を通過した。実Access、remote D1/R2、実Googleアカウント、実hostname、費用、deploy、共有試用、本番移行は未検証・未承認である。

## 実ブラウザ確認

Chromium系ブラウザでPC幅`1440 x 900`とモバイル幅`390 x 844`を確認した。

- 実行日時: `2026-09-06 20:40 JST`
- 検証基点: `d13db99e2a8168414295e77ab008976a7da3baf4`
- 追加対象: 本書、`wrangler.shared-browser.jsonc`、`migrations-shared-browser/`、`tests/shared-browser-*`、`tests/run-shared-browser-acceptance.ps1`
- 必要環境: PowerShell 7、Node.js、このディレクトリのnpm依存関係、PATH上の`agent-browser`

再現コマンド（`d1-poc`ディレクトリで実行）:

```powershell
pwsh -File tests/run-shared-browser-acceptance.ps1
```

このスクリプトは毎回、専用の一時保存先へローカルmigrationを適用し、実行時にだけ合成RS256鍵・JWT・公開JWKSを生成する。終了時はWrangler、ブラウザsession、一時D1/R2、ログを削除し、実トークンや実アカウントを保存しない。Wrangler自身が作成・回収する一時bundle以外の`.wrangler/tmp`は削除せず、同じworktreeの別処理を保全する。

- 署名済み合成Access JWTから検証された担当者だけが表示された。
- 担当者selectorは0件で、利用者がprincipalを変更できなかった。
- 一覧、詳細、顧客情報、本文、履歴を表示できた。
- private R2代替から、要求時だけWebP添付をプレビューできた。
- 担当設定と対応開始がD1へ保存され、actor付き履歴が連続して表示された。
- 詳細再読込後も未送信のメモ下書きがタブ内memoryに残った。
- メモ保存後の最初のACKをテストadapterで503へ置換し、同じ入力を再送すると200になり、`note_added`は1件だけ残った。
- Assertionを不正値へ変更して一覧を更新すると、担当者、一覧、詳細、画像が消去され、遅延応答による再表示は状態世代テストと独立レビューで否定された。
- 390px幅で文字・操作ボタン・一覧・詳細に重なりはなかった。

ブラウザ受入後、ローカルWrangler、ブラウザsession、一時D1/R2、画像artifactは終了・削除した。

## 自動検証

- 共有adapter（ローカルharnessガード3件を含む）: `27/27`
- 既存MVP: `53/53`
- local D1 binding: `7/7`
- SQLite原子性: `20/20`
- Wrangler dry-run生成bundleの禁止語検査: 成功
- production共有adapter（commit `d13db99e2a8168414295e77ab008976a7da3baf4`）の独立レビュー: 重大・中程度findingなし、PASS
- ローカルブラウザharnessと再現手順: 安全境界、production bundle分離、受入主張を独立再レビューし、Low以上のfindingなしでPASS

## G1 読み取り結果

確認済み:

- 既存Cloudflareアカウントへ、暗号化保存されたWrangler OAuth profileで認証できる。
- profileにはaccount/zoneのreadとWorkers/D1の操作scopeがある。
- remote D1 databaseは現時点で0件。
- R2は対象accountで未有効化。R2一覧取得は有効化要求で停止した。
- ローカル受入は外部resourceを作成・変更していない。

未確認:

- SPEED AD対象zoneと、試用専用hostnameをproxyできる権限・DNS境界。
- Zero Trust teamの有無、Free/Paid plan、seat総数・使用数、Access/Admin log保持、billing状態。
- 汎用Google IdPの既存設定、OAuth projectとconsent screenの所有者、External app可否。
- 3〜4名の正確な試用者、各Googleログイン可否、完全一致メールの本人確認。
- 試用期間、停止責任者、復元確認者、削除判断日。

## G2 最小案

G1未確認事項をdashboardで読み取った後、次の条件を満たす場合だけG2を判断する。

- Workers/D1/Access/R2のfree tier内で合成試用を開始し、有料契約や支払方法追加が必要なら作成前に停止する。
- Worker、D1、R2は試用専用名にし、既存本番resourceを流用しない。
- hostnameは既存本番導線から分離し、`workers.dev`とPreview URLを無効にする。
- 作成直後は`TRIAL_ENABLED=false`、添付もfalseとし、Access deny-by-defaultを確認してから段階的に有効化する。
- 使用量、Class A/B、storage、終了日を記録し、上限到達前に停止する。

撤収は、試用flag停止、Access deny、session revoke、D1/R2 export、read-only保全の順に行う。resource削除は保全確認後の別承認とする。

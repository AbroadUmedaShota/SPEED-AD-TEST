---
owner: support-contact
status: reviewed-proposed
last_reviewed: 2026-09-07
scope: synthetic-shared-trial-only
decision_gate: Q-CONTACT-014
---

# workers.dev共有試用 安全開始計画

## 1. 目的と変更境界

CSオペレーター向けD1アプリを、合成データだけで3〜4名が確認する最初の共有試用に限り、専用の`workers.dev` URLで提供する。公開フォーム、GAS、Spreadsheet、Drive、通知、本番データには接続しない。

本書は設計と実行順序を固定する資料であり、Cloudflare資源の作成、Zero Trust契約、支払い情報登録、Google OAuth同意、deploy、実利用者登録を承認しない。Zero Trust Freeでも初期設定時に支払い情報が必要なため、`Q-CONTACT-014`の判断完了前にonboardingを開始しない。

2026-09-07時点でCloudflareへの書込みは0件である。既存Workerは対象外とし、account全体のAccess設定を変更しない。

## 2. 確定した試用プロファイル

| 項目 | 初期値 | 強制条件 |
| --- | --- | --- |
| URL | 専用Workerのproduction `workers.dev` URL 1本 | Preview URLは無効。custom domain、既存本番hostnameを使用しない |
| Access範囲 | 対象Worker 1個のAll traffic、session上限8時間 | account-wide保護、既存Worker変更、Bypassを禁止。重複するhostname/path policyも点検 |
| IdP | Cloudflare Accessの汎用Google IdP | 対象applicationでGoogleだけを許可。承認済み担当者の完全一致メールのみAllowし、ドメイン許可を禁止 |
| Worker認証 | `Cf-Access-Jwt-Assertion`を再検証 | RS256、JWKS、`iss`、`aud`、`exp`、`nbf`、`type=app`、emailをfail closedで検証 |
| Worker認可 | D1 `contact_operators`の完全一致emailかつ`active=1` | client入力、表示中担当者、Access通過だけでは認可しない |
| DB | 専用D1、合成案件のみ | 公開フォームや既存Spreadsheetから同期しない |
| 添付 | 無効 | `TRIAL_ATTACHMENTS_ENABLED=false`に加え、初期configからR2 bindingを省く |
| 有効化 | `TRIAL_ENABLED=false`で作成 | Access、認証、D1、監査の受入完了後だけtrueへ変更 |
| 静的UI | Workerを常に先に通す | `assets.run_worker_first=true`。認証前や無効時にassetを返さない |
| キャッシュ | API、HTML、添付なし応答を`no-store` | 認証済み画面を共有キャッシュへ残さない |

`workers.dev`は初期共有試用に限定する。業務上重要な本番経路への採用判断は、本試用の受入結果、運用責任、独自domain/DNS、SLAを別途確認して行う。

## 3. 現行候補との差分と危険箇所

現行`wrangler.shared.example.jsonc`はcustom domain前提、`workers_dev=false`、R2 bindingありであり、この試用へ流用しない。共有試用専用configを別ファイルとして追加する。

現行のstatic assets設定は`run_worker_first`が`/api/*`だけである。Cloudflare Workers Static Assetsは該当assetをWorkerより先に返し得るため、`TRIAL_ENABLED=false`でもUI shellが公開される。共有試用configではbooleanの`true`を使い、全asset要求をWorkerへ通す。

現行`sharedWorker.mjs`は非API要求を`ASSETS.fetch()`へ渡さない。将来の共有試用実装では、hostname、trial flag、Access JWT、D1 operatorの順に確認した後だけassetを返す。失敗時はHTMLを含めて`no-store`で拒否する。

Worker-level Accessを設定するには対象Workerが先に存在する必要がある。この間の露出を防ぐため、最初のdeployはasset、D1、R2を持たず、全method・全pathへ503を返す封印済みBootstrap Workerとする。Access確認前に完成bundleをdeployしない。

## 4. 次のローカル実装単位

次の承認後に、以下だけを1単位として実装する。実アカウント値、実メール、team domain、audience、account ID、database ID、OAuth情報はrepoへ保存しない。

| ファイル | 操作 | 内容 |
| --- | --- | --- |
| `trialBootstrapWorker.mjs` | 追加 | 全pathを`503 trial_disabled`、`Cache-Control: no-store`で返す。bindingとasset参照なし |
| `wrangler.shared-trial-bootstrap.example.jsonc` | 追加 | 専用名、`workers_dev=true`、`preview_urls=false`、asset/D1/R2なし |
| `wrangler.shared-trial.example.jsonc` | 追加 | `workers_dev=true`、`preview_urls=false`、`run_worker_first=true`、D1あり、R2なし、両flag false、`migrations_dir`を共有用schemaへ固定 |
| `sharedWorker.mjs` | 変更 | 認証・認可後だけ`ASSETS.fetch()`。全応答no-store。添付無効時はmetadataもR2も参照しない |
| `shared-ui/app.js` | 変更 | 401/403、AccessへのredirectやHTML応答、network失敗時に表示済み案件を消し、自動再送しない |
| `tests/shared-trial-boundary.test.mjs` | 追加 | Bootstrap、全path guard、asset非公開、binding除外、JWT/D1境界、無効flagを検証 |
| `SHARED_TRIAL_EXECUTION_PACKAGE.md` | 変更 | 本書のworkers.dev・添付無効・支払い判断・二段階deployへ整合 |
| `README.md` | 変更 | config使い分けと「本番用ではない」を明記 |

既存のcustom-domain/R2候補は削除しない。共有試用configとの取り違えを契約テストで失敗させる。

## 5. 外部操作の安全な順序

各段階の証跡を保存してから次へ進む。秘密値や認証URLは証跡へ残さない。

1. `Q-CONTACT-014`でZero Trust Freeの支払い情報登録、規約同意、責任者を承認する。
2. ローカル実装、対象テスト、秘密情報scan、独立レビューをPASSにする。
3. Cloudflare accountのWorker/D1/Zero Trust使用量とFree plan表示を再確認する。
4. 専用D1を空で作成する。まだmigrationやfixtureを入れない。
5. 専用Workerへ封印済みBootstrapだけをdeployする。asset、D1、R2をbindingしない。
6. `workers.dev` production URLの全path・全methodが503かつno-storeで、UIやデータを返さないことを確認する。
7. Zero Trust organizationをFreeで初期化する。team name、支払い画面、契約表示を記録し、Paid選択や追加製品契約をしない。
8. Google OAuth project、consent screen、Web clientを準備し、team domainのoriginとcallbackだけを登録する。client secretはGoogleとCloudflareの管理面だけで扱う。
9. Cloudflare AccessへGoogle IdPを追加し、接続テストを行う。対象applicationで他のIdPやOne-time PINを選べないことを確認する。
10. 対象Worker 1個だけをAll trafficでAccess保護する。application/policyのsession durationは最大8時間、Previewは無効、Bypassなし、完全一致emailだけAllowとする。同じhostname/pathへ適用される別application、Service Auth、より広いAllowがないことも確認する。
11. 匿名、未許可Googleアカウント、許可GoogleアカウントでAccess境界を確認する。この時点でもWorkerは常に503であることを確認する。
12. Access applicationのaudience、team domain、実`workers.dev` hostnameをsecret管理されたdeploy入力へ設定する。repoへ固定しない。
13. configで`migrations_dir`を共有用schemaへ固定し、D1 migrationと合成fixtureだけを管理CLIから適用する。公開bootstrap endpointは作らず、承認済み担当者をactive operatorとして登録する。ローカルbrowser harnessはdeploy対象から除外する。
14. 完成bundleを`TRIAL_ENABLED=false`、添付false、`run_worker_first=true`、R2 bindingなしでdeployする。
15. Accessを意図的に迂回した相当条件でも、無効flag、host不一致、JWT不正、D1無効operatorがfail closedになることを確認する。
16. 「有効化前」項目をPASSにする。試用責任者1名だけをAllowし、最大30分だけ`TRIAL_ENABLED=true`とする。最初にoperatorを一時的に`active=0`としてA-06bを確認し、`active=1`へ戻してA-07、A-09a、A-09b、A-13、A-16を確認後、直ちにfalseへ戻す。
17. 2人目だけを追加し、再度最大30分だけtrueとしてA-08を確認後、falseへ戻す。失敗時は共有開始せずBootstrap版へrollbackする。
18. 限定有効化の証跡をレビューし、開始日・終了日・停止責任者が確定した場合だけ、承認済み3〜4名を登録して共有試用を開始する。
19. 共有試用期間中は合成データだけを使用し、日次で利用量と認証・D1 eventを確認する。
20. 個人を停止する場合は、最初に対象D1 operatorを`active=0`にし、既存sessionでも次要求が403になることを確認する。次にAccess Allowから削除し、sessionをrevokeする。
21. 終了時はflag false、全operatorのactive無効化、Access Allow無効化、session revokeの順に停止し、A-15確認とD1 export後に資源削除を別承認する。

## 6. 受入マトリクス

| ID | 条件 | 期待結果 | 証跡 | 判定時期 |
| --- | --- | --- | --- | --- |
| A-01 | Bootstrapの任意path/method | 503、no-store、body固定。asset/D1/R2操作0 | HTTP結果、binding一覧 | Access前 |
| A-02 | 匿名でWorker URLへアクセス | Accessで拒否またはlogin。Worker/UIへ到達しない | Access log、画面 | Access設定後 |
| A-03 | 未許可Googleアカウント | Access policyで拒否 | Access log | Access設定後 |
| A-03b | 他IdP、OTP、Service Auth、重複policy | Google以外で担当者sessionを作れず、広いAllow/Bypassが0件 | application・policy一覧 | Access設定後 |
| A-04 | 許可Googleアカウント、trial=false | Access通過後もWorkerが503。asset/D1操作0 | HTTP、Worker log | 完成deploy後 |
| A-05 | JWT欠落・改変・期限外・issuer/audience不一致 | request body解釈、D1、assetより前に403 | local test、Worker log | 有効化前 |
| A-06a | D1 operatorなし/無効のlocal境界 | JWT検証後にAPIとassetを403、D1 event更新0 | local test | 有効化前 |
| A-06b | Access許可済み責任者を一時的に`active=0` | 既存sessionの次要求でAPIとassetを403、D1 event更新0。確認後active=1へ戻す | D1照合、HTTP | 限定有効化1回目 |
| A-07 | 責任者1名を30分限定で有効化 | 一覧・詳細・更新・監査eventが動作し、確認後falseへ戻る | UI、D1 query、flag履歴 | 限定有効化1回目 |
| A-08 | 2人目を30分限定で追加 | 全案件を更新でき、eventのactorが検証済み本人。確認後falseへ戻る | UI、D1 event、flag履歴 | 限定有効化2回目 |
| A-09a | attachment content API | 503 `attachments_disabled`。R2 binding/operation 0 | binding一覧、HTTP | 限定有効化中・共有試用中 |
| A-09b | 案件詳細のattachment metadata | `attachments: []`。添付metadata用D1 query 0 | query計測、HTTP | 限定有効化中・共有試用中 |
| A-10 | `/`、JS、CSS、未知path | 全要求がWorkerを先に通り、認証前・無効時にassetを返さない | config、HTTP | 有効化前 |
| A-11 | Preview URL | URL無効または到達不能 | Dashboard、HTTP | deployごと |
| A-12 | 既存の無関係Worker | domain、route、Access policy、versionに差分0 | before/after | 外部操作後 |
| A-13 | 同時更新、同じIdempotency-Key再送 | version競合を409、同一要求をreplayし重複eventなし | D1、HTTP | 限定有効化1回目 |
| A-14 | JWT/JWKS取得障害 | cache失効後は403、D1/asset操作0 | local test、Worker log | 有効化前 |
| A-15 | 停止手順後 | 既存session/JWTでも全pathからUI/APIへ到達不能 | HTTP、Access log | 試用終了 |
| A-16 | 最大8時間設定、JWT `exp`、session revoke、Access redirect、HTML応答、network失敗 | 設定とJWT期限が上限内。失効時は表示済み案件を消去し、再認証を案内。更新を自動再送しない | Dashboard、claim型/期限、browser確認 | 限定有効化1回目 |
| A-17 | migration実行 | `contact_*`共有schemaだけが作成され、`poc_*`やbrowser harness初期化がない | config、D1 schema | 有効化前 |

受入ではtoken、OAuth secret、認証cookie、JWT本文をログやレポートへ保存しない。メールは件数と役割だけを証跡に記載する。
Bootstrapまたは`TRIAL_ENABLED=false`の期間は先行ガードによる503とD1/R2操作0をA-01/A-04で確認し、添付endpoint固有のA-09a/A-09bとは分ける。

## 7. 無料枠・停止条件

Cloudflare Dashboardで確認したFree表示は、Workers 100,000 requests/日・10 ms CPU/request、D1 5,000,000 rows read/日・100,000 rows written/日・account合計5 GB・最大10 DBである。これは試用の利用許可上限ではない。

| 指標 | 試用内の警戒値 | 停止条件 | 停止方法 |
| --- | --- | --- | --- |
| Worker requests | 1,000/日または5,000/試用 | 予期しない増加、上限の50%到達、limit error | trial=false、Access Allow無効化 |
| Worker CPU | p95 8 ms | 正常操作でp95 8 ms超、1102等 | trial=false。最適化を別判断しPaid化しない |
| D1 reads | 100,000 rows/日 | 予期しないscan、500,000 rows/日 | trial=false、query確認 |
| D1 writes | 5,000 rows/日 | 10,000 rows/日、重複event増加 | trial=false、更新停止 |
| D1 storage | 100 MB | 200 MBまたは合成案件100件 | 新規投入停止、export |
| Access users | 承認済み3〜4名 | 未承認ユーザー追加、policy drift | 対象D1 operatorをactive=0、Allow削除、session revoke |
| 期間 | 7日を暫定値 | 終了日未設定、責任者不在 | 開始しない |

Cloudflare Freeのhard limitやCPU計測仕様は変更され得るため、deploy直前にDashboardと公式文書を再確認する。警戒値は自動課金防止を保証しない。通知や自動停止機能がない指標は、試用責任者の日次確認とtrial flagを停止手段にする。

## 8. 回復・撤収

- 誤公開疑い: 最初に`TRIAL_ENABLED=false`、次にAccess Allowを無効化し、全sessionをrevokeする。保護設定自体は外さない。
- 認証不具合: Bootstrap版へrollbackし、全path 503を確認する。Google IdPを迂回するOTP/Bypassは追加しない。
- D1不具合: 更新停止後にexportを取得する。合成データのため既存Spreadsheetへ戻さない。
- 費用懸念: 利用を停止し、Paid planやR2を追加しない。資源削除はexportと責任者承認後に行う。
- 試用終了: Worker、D1、Access application、Google OAuth clientの削除対象と保管証跡を一覧化し、個別承認後に撤収する。

## 9. 未解決事項

| ID | 未解決事項 | 決定者・確認元 | 未解決時の扱い |
| --- | --- | --- | --- |
| Q-CONTACT-014 | Zero Trust Freeの支払い情報登録、規約同意、名義、責任者 | 司令塔・Cloudflare契約責任者 | onboarding開始禁止 |
| Q-CONTACT-015 | team nameとGoogle OAuth projectの所有者 | Google/Cloudflare管理者 | IdP作成禁止 |
| Q-CONTACT-016 | 正確な試用担当者、開始日、7日終了日、停止責任者 | CS運用責任者 | operator登録・有効化禁止 |
| Q-CONTACT-017 | workers.dev実hostname、Access audience、team domain | 作成後のDashboard | secret管理入力へ設定するまで完成deploy禁止 |
| Q-CONTACT-018 | Free環境でJWT検証を含む正常操作の実CPU | Workers Analytics | p95 8 ms超なら試用停止 |
| Q-CONTACT-019 | Worker-level Accessの実設定でproductionのみを保護しPreviewが無効か | Dashboardと匿名HTTP確認 | trial=true禁止 |

## 10. 公式根拠

- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [workers.dev routing and Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Static Assets Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Static Assets binding configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Zero Trust setup](https://developers.cloudflare.com/cloudflare-one/setup/)
- [Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)

## 11. 今回変更しないもの

- production code、Wrangler config、test、GAS、公開サイト、AWS、DNS
- Cloudflare Worker、D1、R2、Access、Zero Trust organization
- Google OAuth project、consent screen、client、secret
- Git remote、PR、CI
- 実顧客データ、既存bot投稿、Drive残添付

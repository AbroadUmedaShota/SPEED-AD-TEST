---
owner: support-contact
status: approved-architecture-only
last_reviewed: 2026-09-06
decision: D-CONTACT-SHARED-ARCHITECTURE
depends_on: G1-G6 execution approval
---

# CSオペレーターアプリ 共有試用実行パッケージ

`Q-CONTACT-002`は、初期workers.dev共有試用についてCloudflare Workers、D1、Accessの汎用Google IdPとexact email allowlist、WorkerでのJWT再検証、D1のactive operator照合を採用するアーキテクチャ判断として解決済みである。この初期試用は添付を無効にし、R2 bindingもR2 subscriptionも持たない。非公開R2は添付を有効化する延期したfull candidateの選択肢であり、初期試用の構成には含めない。これは実アカウント登録、資源作成、費用、deploy、共有試用、移行または本番利用の承認を意味しない。セッション8時間は設計既定値であり、実環境には未設定である。

## 1. 推奨構成

初期3〜4名の共有試用には、次の組合せを推奨する。

1. Cloudflare Accessのself-hosted applicationで、試用専用hostname全体を保護する。
2. IdPはCloudflareの汎用Google連携を使い、Access policyはドメイン許可ではなく試用者の完全一致メールだけをAllowする。
3. Workerは`Cf-Access-Jwt-Assertion`を再検証し、検証済み`email`をprincipalとする。
4. D1の`contact_operators`でも同じメールが`active=1`であることを要求する。
5. 初期workers.dev試用では添付を無効にし、R2 binding/subscriptionを作成しない。public accessを無効にしたR2 Standard bucketを認証済みWorkerのbinding経由だけで取得する構成は、添付有効化時の延期したfull candidateに限る。
6. 試用は合成データから開始し、公開フォーム、GAS、Spreadsheet、Drive、通知は変更しない。
7. custom-domain/R2候補は`workers_dev=false`と`preview_urls=false`を維持する。一方、workers.dev共有試用は依存なしのbootstrap Workerを`workers_dev=true`、`preview_urls=false`で先行し、全path/methodを`503 {error:'trial_disabled'}`かつ`Cache-Control: no-store`で固定する。試用profileはASSETS/D1だけを持ち、`TRIAL_ENABLED=false`、R2 bindingなしから開始する。Access policyにBypassを作らず、Free request上限到達時のroute挙動もfail closedにする。

汎用Google連携はGoogle Workspace groupを取得しない一方、GoogleアカウントであればAccess policyが許可した利用者を認証できる。初期利用者のWorkspace tenantやドメイン所有関係を仮定せず、3〜4名を個別allowlistで管理できるため、今回はこちらをWorkspace専用連携より優先する。各メールアドレスが実際にGoogleログイン可能かは、共有試用作成前の本人確認事項である。

## 2. 代替案比較

この比較のprivate R2を含む案は、初期workers.dev試用ではなく、G7で別承認する延期したfull candidateの添付方式である。

| 案 | 認証 | 添付 | 採否 | 主な理由 |
| --- | --- | --- | --- | --- |
| A | Access + 汎用Google + 完全一致メール | private R2 | 推奨 | 複数ドメインを推測せず個人単位で許可でき、Worker/D1/R2を同じ境界で監査・撤収できる |
| B | Access + email OTP + 完全一致メール | private R2 | 代替 | Google OAuth client準備は不要だが、毎回のメール到達性に依存し、日常UXと本人アカウント管理が本番候補と異なる |
| C | 既存Google側認証 | 既存Drive | 不採用 | 初期変更は少ないが、Worker/D1とGoogle/GAS/Driveの二つの認証・権限・復元境界を継続し、今回解消したい個人監査と添付導線が複雑になる |

## 3. 認証・認可契約

Accessを通過したことだけに依存せず、Workerで次をfail closedに検証する。

- Header: `Cf-Access-Jwt-Assertion`が存在する。
- JWT: RS256署名、`kid`に対応するteam domainのremote JWKS、`iss`、application固有`aud`、`exp`、`nbf`、`type=app`。
- Principal: IdP検証済み`email`を小文字に正規化し、空値やservice tokenを操作者として受け付けない。
- Authorization: D1 `contact_operators`の完全一致行が存在し、`active=1`である。
- Client input: `x-mvp-actor`、選択中の担当者、request bodyのメールをprincipal決定に使わない。

JWKSは固定鍵をrepoへ保存せず、信頼済み設定のteam domainからだけcert endpointを構成し、保守されているJWT libraryで`kid`に対応する鍵を選ぶ。Accessのapplication audienceは公開設定値として環境変数へ置けるが、team/account/resourceの実値はrepoへ固定しない。OAuth client secretや管理API tokenはsecretとしてCloudflare/Googleの管理面だけで扱う。

JWKS cacheは有限とし、初期契約を最大10分、取得timeout 3秒、未知`kid`によるrefreshは1要求1回かつ30秒のcooldown付きとする。cache有効中は取得障害時も既知鍵を利用できるが、cache失効後にJWKSを取得できない場合、未知`kid`、署名不正はD1/R2へ触れる前にfail closedで拒否する。Cloudflare Accessは通常6週間で署名鍵をrotateし、旧鍵を7日間残すため、新旧鍵が同時に返る期間、切替後、取得障害をlocal testで再現する。数値は採用libraryの安全な設定可否を次実装で確認し、緩和する場合は別レビューを要する。

許可停止は次の順で行う。

1. D1 operatorを`active=0`にしてアプリ更新を即時拒否する。
2. Accessの完全一致メールAllowから対象者を外す。
3. Cloudflare Accessで対象ユーザーのsessionをrevokeする。
4. Google側アカウント停止が必要な場合は、そのtenantの正当な管理者が別途行う。

AJAXは期限切れを識別できるよう`X-Requested-With: XMLHttpRequest`を付け、401時は下書きを現在タブのmemoryだけに保持して再認証を促す。自動再送はしない。session durationの初期案は8時間とし、実設定は試用責任者の承認対象にする。

## 4. 添付契約（延期したfull candidate）

この節以降のR2 bucket、添付、R2費用、R2復元・撤収に関する設計は、添付を有効化する延期したfull candidateだけに適用する。初期workers.dev共有試用は添付を無効にし、R2 binding/subscriptionを持たない。

- R2 bucketはprivateを維持し、`r2.dev`とpublic custom domainを有効にしない。
- UIへobject key、R2 account/bucket情報、S3 URL、presigned URLを返さない。
- WorkerはJWTとD1 operatorを検証し、attachment IDからD1 metadataを引き、case relation、非archive状態、size、SHA-256を確認してR2 bindingから返す。
- responseは`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、許可MIMEの固定化を維持する。
- object keyはサーバー生成値だけを使い、利用者入力や元ファイル名をpathへ使用しない。
- `TRIAL_ATTACHMENTS_ENABLED=false`では、content attachment APIをJWT/D1 metadata/R2 binding呼出し前に503で停止し、case detailは`attachments: []`を返してmetadata queryをしない。Class Bや想定外trafficの停止時に、GET/HEADを継続させない。
- 共有試用は合成WebP 1件から開始する。複数・大容量添付はローカル必須へ遡及せず、必要性が確定した時点で別の負荷・上限試験とする。

## 5. 費用と停止条件（R2部分は延期したfull candidate）

2026-09-06時点の公式仕様では、Workers Freeは100,000 request/日、D1 Freeは5,000,000 rows read/日、100,000 rows written/日、1 DBあたり500 MB、account合計5 GB、Time Travel 7日である。初期workers.dev試用はWorkers/D1/Accessだけを確認し、添付/R2の費用・上限・subscriptionを使わない。R2 Standardの月次free tier、添付/R2の表の行は、別承認とsubscriptionを要する延期したfull candidateだけに適用する。

| 項目 | 試用上限 | 停止・対応 |
| --- | --- | --- |
| 利用者 | 3〜4名の完全一致メール | 未承認者を追加しない。Access seat残数は作成前にdashboardで確認 |
| データ | 合成案件のみ、最大100案件 | 実データを入れない。上限到達前に試用を停止してexport |
| 添付 | 合成WebP、合計100 MB、最大100 object | public accessを禁止。想定外増加時はuploadを止め、read-onlyで保全 |
| Worker | 手動試用のみ | Free request/CPU limit接近、1027/1102発生、予期しないtrafficでrouteをfail closed停止 |
| D1 | rows read/writeとstorageを日次試用日に確認 | free limit接近時は更新試験を止める。勝手にPaidへ変更しない |
| R2 | account全体のstorage/Class A/Class Bを試用前後で確認 | Class A超過見込みではPUTを停止。Class B超過見込みでは添付GET/HEADをR2呼出し前に停止。保全中のstorage消費は継続するため、free tier超過分を保持する判断は別承認 |

Zero Trustにはfree planがあるが、現在のseat上限、既存seat消費、契約状態は対象accountのdashboardを正とする。Free planのAccess log保持は24時間のため、業務監査の正本にはせず、D1の追記専用eventを保持する。Admin logの保持期間もdashboardで確認する。

## 6. 復元・監査・撤収（R2部分は延期したfull candidate）

### 復元

1. source D1とR2をread-onlyにして試用更新を止める。
2. migration番号と件数を記録し、5つの`contact_*` tableだけをdata exportする。
3. R2 objectをmanifest付きでexportし、attachment ID、case ID、object key、size、SHA-256を記録する。
4. 新しい検証D1へmigrationを順番に適用し、dataをimportする。
5. 別のprivate R2 bucketへobjectをrestoreする。
6. 全5表、FK、版、履歴、receipt replay、添付hashを照合する。DBだけ、またはblobだけの復元は成功扱いにしない。

D1 Time TravelはFreeで7日利用できるが、in-place restoreは破壊的であり、今回の別検証DBへの復元試験の代替にしない。

### 監査

- D1 eventへ検証済みoperator email、操作、from/to version、request ID、時刻を記録する。
- 本文、添付bytes、JWT、OAuth secret、Access tokenをeventやapplication logへ複製しない。
- Access logは入口認証の補助証跡、D1 eventは業務操作の正本として分ける。

### 撤収

1. Workerの`TRIAL_ENABLED=false`を有効にし、許可hostname確認の直後、JWT/JWKS、D1 operator、R2を含む外部呼出し前に全case/attachment APIを503で停止する。
2. AccessのAllow policyを無効化または削除してdeny-by-defaultにし、Access applicationと保護hostname自体は残す。Bypassは作らない。
3. 全application sessionをrevokeする。保護設定を削除して停止した扱いにしない。
4. `workers.dev`、version/alias Preview URL、試用hostnameの全経路から、既存JWTを提示してもAPI・添付へ到達できないことを確認する。
5. D1/R2をread-onlyで保全し、5表exportとblob manifest/hashを取得する。添付GET/HEADも停止し、保全中はR2 storage使用量だけが残ることを記録する。
6. 共有hostnameを既存本番へ向けず、公開フォーム/GASは無変更のまま維持する。
7. Worker、D1、R2、Access applicationの削除は、保全物確認とstorage費用判断後の別承認で行う。

## 7. 共有専用entrypointの分離

共有bundleに現在の`mvpWorker.mjs`や`ui/`をそのまま載せてはならない。次を独立したローカル実装単位とする。

**次の1単位: Access adapterを注入できる共有entrypointと共有UI shell（R2 adapterは延期したfull candidate）**

- `sharedWorker.mjs`: host、trial flag、principal/JWT+D1、APIまたはASSETSの順に判定し、test routeを登録しない。認証済みの非API GET/HEADだけがASSETSを返し、asset responseにも`Cache-Control: no-store`を付ける。非API mutationは405とする。
- `AccessPrincipalResolver`: Access JWTを検証し、D1 operatorと照合する。
- `R2AttachmentStore`: 添付有効化を別承認した延期したfull candidateでだけ、private bindingからbytesを読み、metadata照合を維持する。
- `shared-ui/`: actor selector、`ローカル・合成データ`表示、test操作を含めず、認証済み本人をread-only表示する。
- `wrangler.shared.example.jsonc`: custom-domain/R2候補は変更せずに保持する。`wrangler.shared-trial-bootstrap.example.jsonc`はbindings/assets/routesなしのworkers.dev停止面、`wrangler.shared-trial.example.jsonc`はASSETS/D1だけのplaceholder試用面とする。Free上限時のfail-closed設定はdeploy checklistで照合する。remote resource ID、hostname、AUD、team domain、secretは固定しない。

受入条件:

- shared entrypoint、shared UI、共有asset manifestを検索して、`/__test/`、`x-mvp-actor`、`operator-a@example.invalid`、`operator-b@example.invalid`、`case-mvp-1`、embedded blobが0件。
- JWT欠落、署名不正、issuer/audience/期限不一致、email欠落、無効operatorをrequest body解釈前に拒否するlocal testがある。
- JWTのclaim型不正、未来`nbf`、service token、未知`kid`、新旧JWKS切替、JWKS timeout、cache有効/失効時の取得障害を検証する。refresh回数は要求数に比例して無制限に増えない。
- 許可された異なる2principalが同じ案件を更新でき、eventにはそれぞれの検証済みemailが残る。
- 添付有効化を別承認した延期したfull candidateでは、fake R2で正常、未知ID、別case、archive、欠損、size/hash不一致を検証する。
- shared configとlocal configを取り違えると起動時またはtestで失敗し、local test hookをshared routeから到達できない。
- 初期workers.dev試用ではproduction workers.dev routeだけを有効にし、Preview URLを無効にし、R2 bindingを持たない。AccessのBypassを作らず、停止時は既存JWTでもworkers.dev routeの全経路から到達できない。custom-domain/R2のroute・Preview・添付条件は延期したG7 full candidateだけで確認する。
- `TRIAL_ENABLED=false`ではJWT/JWKS、D1、R2のfake operation countがいずれも増えない。
- `TRIAL_ATTACHMENTS_ENABLED=false`ではR2のGET/HEAD/PUTを呼ばずに拒否し、fake R2 operation countが増えない。
- 既存53件を壊さず、追加したadapter契約だけを独立testで確認する。

この単位ではremote D1/R2、実Google account、実JWT、実hostnameを使わない。localでAccess相当の署名済みtest JWTとfake R2を注入し、外部資源作成前に境界だけを確定する。JWKSのcache、timeout、cooldown値は採用JWT libraryで実現可能かを確認し、契約どおりに設定できない場合は実装を完了扱いにせず再レビューする。

## 8. 実行ゲート

次は一括承認せず、操作範囲を分ける。

| ゲート | 必要な事実・判断 | 実行内容 | 戻し方 |
| --- | --- | --- | --- |
| G0 方式 | 本書の案A、試用目的、session時間を承認 | 設計確定のみ | 本書をproposedへ戻す |
| G1 account確認 | Cloudflare account/zone、Zero Trust team、Google OAuth project所有者、3〜4名のGoogle login可否、seat/plan/billing状態を読み取り確認 | resourceは作らない | 変更なし |
| G2 初期workers.dev resource作成 | Worker/D1/Accessのresource名、region/hostname、account既存使用量を含む無料枠、責任者、撤収日を承認 | attachment/R2なしでtrial Worker、D1、Google IdP、Access appを作成 | 全拒否flag、Access deny、session revoke、resourceは保全して停止 |
| G3 deploy | commit SHA、shared bundle漏洩scan、local test、独立reviewを承認 | 試用hostnameへdeploy | 直前versionへrollbackまたはroute停止 |
| G4 operator登録 | 完全一致メールと本人確認を承認 | Access allowlistとD1 operatorへ同じ3〜4名を登録 | D1無効化、policy削除、session revoke |
| G5 初期workers.dev合成試用 | 添付なしの合成fixture、期間、上限、確認担当を承認 | 2端末競合、失効、D1復元、撤収を確認 | 試用停止、export、read-only保全 |
| G7 添付full candidate | private R2のsubscription、resource名、Class A/B/storage停止閾値、添付上限、復元/撤収責任者を別承認 | private R2とattachment flowを作成し、添付、R2復元、撤収を確認 | 添付停止、R2 read-only保全、Access deny、session revoke |
| G6 実データ/本番 | 別の移行・費用・通知・rollback計画を承認 | 今回は実施しない | 今回は対象外 |

## 9. 作成前に不足している事実

- 3〜4名それぞれが利用する正確なGoogleアカウント。メール一覧をrepoへ固定しない。
- 対象Cloudflare account、zone、Zero Trust teamの所有者と操作権限。
- 試用hostnameをCloudflareでproxyできるか。既存本番hostnameを流用しない。
- Zero Trustの現在plan、seat総数/使用数、Access log保持、billing状態。
- Google OAuth projectとconsent screenの所有者、External app設定可否、client secret保管責任者。
- 試用期間、停止責任者、復元確認者、削除判断日。

これらはlive dashboardの読み取りで確認し、推測で埋めない。

延期したfull candidateへ進む場合だけ、private R2の利用開始に支払方法や課金同意が必要か、account単位の通知・予算導線があるかを確認し、G7でsubscriptionとresource作成を別承認する。

## 10. 公式根拠

- [Google IdP integration](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Access session management and revocation](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Zero Trust log retention](https://developers.cloudflare.com/cloudflare-one/insights/logs/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 private-by-default buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [R2 Worker binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Disable workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Disable Worker Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Worker limits and fail-closed routes](https://developers.cloudflare.com/workers/platform/limits/)

# サポートお問い合わせ確認アプリ GAS

問い合わせ対応者が Spreadsheet と Drive を直接行き来せず、問い合わせ内容、添付画像、対応ステータスを 1 画面で確認するための Apps Script Web App です。

## 配備方針

- 公開投稿用 GAS とは別プロジェクトとして作成します。
- 短期運用では Web App を `executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS` で配備します。
- 閲覧者ごとの OAuth 承認ループを避けるため、通知URLのフラグメントに含める `CONTACT_VIEWER_ACCESS_TOKEN` で問い合わせ情報の表示を制御します。読み取り後は可視URLからトークンを消し、同じタブ内の再読み込みに限って `sessionStorage` から復帰します。
- `CONTACT_VIEWER_EMAILS` は将来の Google アカウント単位制御へ戻す場合の許可ユーザー一覧として維持します。
- CS運用MVPでは `CONTACT_VIEWER_EMAILS` を担当者候補にも利用します。ただし共有トークン認証中は、選択された担当者と実際の操作者を同一人物として監査できません。
- 投稿データの正本は既存 Spreadsheet `contact_submissions`、添付本体は既存 Drive フォルダです。
- 仕様確認後の作業DB整理では、プレビュー関数で削除候補を確認してからバックアップ作成付きで削除します。

## 既存デプロイ記録（実環境未再確認）

以下は過去の運用記録です。CS運用MVPの現行環境・切り戻し先を保証しません。既存アプリ更新は[反映・移行手順](../../../docs/ハンドブック/デプロイ/06_SUPPORT_CONTACT_CS_MVP_RELEASE.md)に従い、対象・バージョン・権限・列・timezoneを別承認のもと事前確認します。ローカル準備完了と本番受入完了は区別します。

- Script ID: `1tG0AXoDPAG86OurWepwGnZRoZNbplnq_VsiYUINIrv_NbVnMl1Mj7NwW`
- Web App URL: `https://script.google.com/macros/s/AKfycbxz4foQKPlgAeF5ShuM2RBudUpYD8VOvIi7riU1j4QtghnHzvpw9JSKQgfcm61hJKh3/exec`
- Current version: `17` (`support contact viewer apps script hash token`)
- Owner: `customer@speed-ad.com`

## Script Properties

| Key | 必須 | 内容 |
| --- | --- | --- |
| `SPREADSHEET_ID` | 必須 | 問い合わせ保存先 Spreadsheet ID |
| `DRIVE_FOLDER_ID` | 必須 | 添付画像保存先 Drive フォルダ ID |
| `CONTACT_SHEET_NAME` | 任意 | 既定は `contact_submissions` |
| `CONTACT_VIEWER_EMAILS` | 必須 | 確認アプリ利用者。カンマ、セミコロン、改行区切りで複数指定可能 |
| `CONTACT_VIEWER_ACCESS_TOKEN` | 必須 | 通知URLの `#token=` に付与する確認用トークン。repoには実値を記録しない |
| `CONTACT_UNHANDLED_STALE_HOURS` | 任意 | 未対応滞留を要確認表示する時間。未設定または0では滞留判定を無効化 |

初期値:

```text
CONTACT_VIEWER_EMAILS=customer@speed-ad.com,s-umeda@abroad-o.com,t-hayashi@abroad-o.com
```

2026-06-29 時点の運用値:

```text
SPREADSHEET_ID=1tv6xEckXPd8bIwbGfE-aJ-XxkIUDreglmcioCpkH-98
DRIVE_FOLDER_ID=1rcFGJh9l3NwUeYt2MIR8p2A-DVYxxEwY
CONTACT_SHEET_NAME=contact_submissions
CONTACT_VIEWER_EMAILS=customer@speed-ad.com,s-umeda@abroad-o.com,t-hayashi@abroad-o.com
CONTACT_VIEWER_ACCESS_TOKEN=<Script Properties only>
```

## 初回構築時の配備後設定

次は新規構築用です。既存アプリのCS運用MVP更新ではURL発行、トークン変更、公開投稿GASの再デプロイは行いません。

1. 確認アプリの Web App URL を発行する。
2. 確認アプリと公開投稿用 GAS の Script Property `CONTACT_VIEWER_ACCESS_TOKEN` に同じ値を設定する。
3. 公開投稿用 GAS の Script Property `CONTACT_VIEWER_BASE_URL` に確認アプリの Web App URL を設定する。
4. 公開投稿用 GAS を再デプロイし、社内通知メールの `確認アプリ` リンクに `id` と `#token` が含まれ、詳細を開けることを確認する。

## 確認項目

- 初期一覧は対応が必要な問い合わせを優先し、上部にステータス件数が出る。
- 通知メール内の確認アプリURLで一覧、詳細、添付プレビューを表示できる。
- `未対応` / `対応中` / `対応済み` / `保留` と内部メモを更新できる。対応中・対応済み・保留のクイック操作も使える。
- CS運用MVPでは既存4状態に `顧客確認待ち` / `引継ぎ待ち` を追加し、担当者、緊急度、分類、Gmail参照リンク、進捗メモ、引継ぎ、対応結果、次回確認日を固定項目として更新できる。
- 高緊急度未割当、次回確認日超過、引継ぎ未受領を要確認表示する。未対応滞留は `CONTACT_UNHANDLED_STALE_HOURS` が設定されている場合だけ表示する。
- `対応済み` は担当者、対応結果、最終対応記録、引継ぎ整合をサーバー側で検証し、条件不足では保存しない。
- 顧客確認待ち、保留、継続対応は次回確認日を必須とし、過去日は保存しない。
- 次回確認日のDateセル表示と期限判定はSpreadsheetのタイムゾーンを共通利用する。日付文字列はUTC変換せず維持する。スクリプト設定は `Asia/Tokyo` だが、シート側の設定値を移行前に確認する（今回、実シートは未参照）。
- 新旧いずれの更新入口も認証を先に行い、無効トークンでは案件・Spreadsheetを参照しない。
- 主要変更は `contact_case_events` へ追記する。追記例外時はリクエストIDで保存済みか確認し、保存済みなら案件行を維持、未保存なら案件行を戻して値を照合する。結果不明または復元不能時は手動確認を求める。
- 画面取得時の最終更新日時が保存時と異なる場合は競合として拒否する。同じ更新リクエストIDの再送は重複更新しない。
- 添付はその場で大きく開け、複数添付は前後移動できる。
- `token` がない、または不正なURLでは問い合わせ情報が表示されない。
- `token` / `accessToken` のクエリやフラグメントは読み取り後に可視URLから消える。同じタブ内の再読み込みでは保持済みトークンで復帰し、不正トークン判定時は保持値を消す。
- Apps Script HTML Service の iframe 内でも `google.script.url.getLocation` から親URLの `#token=` と `id` を読み取り、通知メールの実URLで一覧・詳細を開ける。
- 添付ビューアは開いた時に閉じるボタンへフォーカスし、閉じた時に元の添付サムネイルへ戻る。
- 添付ファイルの Drive リンクはフォールバックとして開ける。

## CS運用MVPのデータ契約

`contact_submissions` の既存列と値は変更せず、次の列がない場合だけ末尾へ追加します。

```text
assignee_email
urgency
case_category
gmail_thread_url
progress_note
handoff_to
handoff_status
resolution_code
resolution_summary
next_followup_at
closed_at
closed_by
```

対応履歴は別シート `contact_case_events` へ追記します。履歴は `event_id`、`submission_id`、`event_type`、変更前後値、メモ、認証主体、参考メール、認証方式、更新リクエストID、作成日時を保持し、問い合わせ本文、添付内容、トークンは複製しません。

共有トークン運用中の `actor_auth_mode` は `shared_token` です。Sessionからメールアドレスを取得できても参考値であり、アカウント単位監査の証拠にはなりません。個人別監査を必須にする場合は、Googleアカウント単位認証へ移行してから本運用化します。

本番移行前は別承認でSpreadsheet全体を保全します。移行関数の自動バックアップは受付シート1枚の複製だけで、既存履歴や全Spreadsheetの保全を代替しません。追加列・履歴シートは切り戻し時も削除しません。CS編集開始後は新状態・進捗を旧版で安全に扱えないため、編集停止・現状保全・個別復旧判断が必須です。バックアップ全体の上書きで移行後の新規投稿を消してはいけません。詳細は[反映・移行手順](../../../docs/ハンドブック/デプロイ/06_SUPPORT_CONTACT_CS_MVP_RELEASE.md)を参照してください。

一覧・詳細の読み取りでは列や履歴シートを追加しません。移行はApps Scriptエディタから次の順で実行します。共有トークン経由では実行できません。

1. `previewContactCaseSchemaMigration()` で不足列、履歴シート有無、既存の対応済み行を確認する。
2. 実行承認後だけ `executeContactCaseSchemaMigration('PREPARE_CONTACT_CASE_SCHEMA_V1')` を実行する。通常のエディタRunは引数を渡せないため、承認済みの呼出方法を事前に確定する。未確定なら停止し、一時公開入口は追加しない。
3. 同一Spreadsheet内にバックアップシートが作成され、不足列が末尾追加され、既存の対応済み行へ `legacy_migrated` 履歴が1件ずつ追加されたことを確認する。

移行関数は既存行の状態を再判定・上書きしません。再実行時は既に `legacy_migrated` がある受付IDを除外します。

履歴列は正規11列の順序を固定し、通常追記には完全一致を要求します。移行だけは未作成・空シート・正規先頭部分の末尾補完を許可します。列順違い、重複、未知列、途中欠落はバックアップ/列追加前に拒否し、自動で並べ替えません。受付列の順序・重複は実装だけで完全検証しないため、先頭17列と追加12列を事前照合します。移行全体のロックや自動復旧はないため同時編集を停止し、部分成功後は無条件再実行しません。

本番反映時は、確認者GASのソースをpushしても既存Web Appデプロイは更新せず、先に移行プレビューとバックアップ付き移行を完了します。列・履歴シートを確認してから新バージョンをWeb Appへ反映します。移行前に新UIだけを公開しないでください。

## ローカル検証

リポジトリルートで `node --test tests/support-contact-contract.test.mjs` を実行します。Dateセル・日付文字列・空値・不正日付・日付境界、認証前のDB未参照、旧列の互換性、履歴失敗時の復元と再送を合成データで検証します。

`node tests/support-contact-viewer-mock-server.mjs` で `http://127.0.0.1:4178/` に合成データの画面を表示できます。実GAS・Spreadsheet・メールには接続しません。これは画面と送信payloadの検証用であり、本番受入試験の代替ではありません。

## 問い合わせDB整理関数

`contact_submissions` のテスト投稿を整理する場合は、確認者GASに追加した以下の関数を使います。

| 関数 | 目的 |
| --- | --- |
| `previewContactDbCleanup` | 削除候補件数、対象 `submission_id`、添付ファイルID、判定理由を返します。 |
| `executeContactDbCleanup` | 確認フレーズ `DELETE_TEST_CONTACT_ROWS_20260622` を引数に受け取り、バックアップ作成後に候補行を削除し、対象添付をDriveゴミ箱へ移動します。 |

削除前には必ず `previewContactDbCleanup` の結果をレポートへ記録します。`executeContactDbCleanup` は同一Spreadsheet内に `contact_submissions_backup_YYYYMMDD_HHMMSS` 形式のバックアップシートを作成してから、削除候補行を下から順に削除します。添付ファイルは `attachment_refs` の fileId を参照し、Drive上のファイル名が削除対象 `submission_id` で始まる場合のみゴミ箱へ移動します。

削除対象は、既知テスト受付ID、または内部メールアドレスかつテスト判定語を含む行に限定します。外部メールアドレスの行は、既知テスト受付IDに一致しない限り自動削除しません。

2026-06-21 検証:

- 公開投稿GASの通知メールに確認アプリ詳細URLが入ることを確認済み。
- テスト受付ID `70a13837-4725-4b56-ab5f-22a5135ea3ca` で `storageStatus=stored` / `mailStatus=sent` を確認済み。
- 添付ファイル `70a13837-4725-4b56-ab5f-22a5135ea3ca-1-codex-production-check.webp` が Drive に `image/webp` として保存されることを確認済み。
- トークンなしの確認アプリURLはGoogle認証へリダイレクトせず、アプリ内で無効URL表示になることを確認済み。
- 確認アプリURLのトークンをURLフラグメントへ移行し、公開HTMLに `location.hash` 読み取りが反映されていることを確認済み。
- 確認アプリのUX改善をバージョン `8` へ反映し、公開HTMLに対応が必要フィルタ、ステータス件数、返信リンク、添付ビューア、サーバー側トークン検証が含まれることを確認済み。
- 確認アプリのUX修正をバージョン `9` へ反映し、公開HTMLに `sessionStorage` 復帰、添付ビューアのフォーカス復帰、閉じるボタンへの初期フォーカスが含まれることを確認済み。
- 2026-06-22 にDB整理関数を追加し、確認者GASの既存デプロイをバージョン `12` (`support contact db cleanup safe`) へ redeploy した。
- 一時実行入口を使って `contact_submissions` の削除候補12件を削除し、バックアップシート `contact_submissions_backup_20260622_060551` を作成した。削除後プレビューで候補0件を確認済み。
- 一時実行入口はバージョン `12` から削除済み。公開HTMLに `cleanupAction` と一時トークンが含まれないことを確認済み。
- 2026-06-29 に `customer@speed-ad.com` の `clasp` profile を再認証し、確認者GASの既存デプロイをバージョン `17` (`support contact viewer apps script hash token`) へ redeploy した。
- 公開HTMLに `cleanupAction`、一時トークン、確認用トークン経由のDB整理補助関数が含まれないことを確認済み。
- 通知メールの実 `#token=` URLで、Apps Script iframe 内の一覧、詳細、添付プレビュー、ステータス更新、内部メモ保存が動くことを確認済み。更新確認は既存の検証行 `87cba07a-a8f6-42da-885d-781821adf768` を一時更新し、表示値を元に戻した。
- トークンなしの確認アプリURLはGoogle認証へリダイレクトせず、アプリ内で無効URL表示になることを確認済み。
- DB整理系関数は確認画面の通常経路から呼び出しても、Apps Script実行ユーザー確認で拒否されることを確認済み。
- 添付4件のゴミ箱移動はDrive書き込み承認不足で未完了。対象 fileId と理由、再実行手順は `../db-cleanup-report-2026-06-22.md` に記録済み。

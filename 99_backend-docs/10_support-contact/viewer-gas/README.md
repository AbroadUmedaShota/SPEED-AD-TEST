# サポートお問い合わせ確認アプリ GAS

問い合わせ対応者が Spreadsheet と Drive を直接行き来せず、問い合わせ内容、添付画像、対応ステータスを 1 画面で確認するための Apps Script Web App です。

## 配備方針

- 公開投稿用 GAS とは別プロジェクトとして作成します。
- 短期運用では Web App を `executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS` で配備します。
- 閲覧者ごとの OAuth 承認ループを避けるため、通知URLのフラグメントに含める `CONTACT_VIEWER_ACCESS_TOKEN` で問い合わせ情報の表示を制御します。読み取り後は可視URLからトークンを消し、同じタブ内の再読み込みに限って `sessionStorage` から復帰します。
- `CONTACT_VIEWER_EMAILS` は将来の Google アカウント単位制御へ戻す場合の許可ユーザー一覧として維持します。
- 投稿データの正本は既存 Spreadsheet `contact_submissions`、添付本体は既存 Drive フォルダです。
- 仕様確認後の作業DB整理では、プレビュー関数で削除候補を確認してからバックアップ作成付きで削除します。

## 現行デプロイ

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

## 配備後設定

1. 確認アプリの Web App URL を発行する。
2. 確認アプリと公開投稿用 GAS の Script Property `CONTACT_VIEWER_ACCESS_TOKEN` に同じ値を設定する。
3. 公開投稿用 GAS の Script Property `CONTACT_VIEWER_BASE_URL` に確認アプリの Web App URL を設定する。
4. 公開投稿用 GAS を再デプロイし、社内通知メールの `確認アプリ` リンクに `id` と `#token` が含まれ、詳細を開けることを確認する。

## 確認項目

- 初期一覧は対応が必要な問い合わせを優先し、上部にステータス件数が出る。
- 通知メール内の確認アプリURLで一覧、詳細、添付プレビューを表示できる。
- `未対応` / `対応中` / `対応済み` / `保留` と内部メモを更新できる。対応中・対応済み・保留のクイック操作も使える。
- 添付はその場で大きく開け、複数添付は前後移動できる。
- `token` がない、または不正なURLでは問い合わせ情報が表示されない。
- `token` / `accessToken` のクエリやフラグメントは読み取り後に可視URLから消える。同じタブ内の再読み込みでは保持済みトークンで復帰し、不正トークン判定時は保持値を消す。
- Apps Script HTML Service の iframe 内でも `google.script.url.getLocation` から親URLの `#token=` と `id` を読み取り、通知メールの実URLで一覧・詳細を開ける。
- 添付ビューアは開いた時に閉じるボタンへフォーカスし、閉じた時に元の添付サムネイルへ戻る。
- 添付ファイルの Drive リンクはフォールバックとして開ける。

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

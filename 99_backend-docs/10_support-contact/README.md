# サポートお問い合わせ受付

`support.speed-ad.com/contact/` の投稿受付、Google Spreadsheet保存、受付メール送信に関するバックエンド整理資料です。

## 方針

- 公開問い合わせフォーム専用の Apps Script Web App を作成します。
- 既存の E2E/バグ報告DB用GASとは分離します。
- 投稿内容は Spreadsheet の `contact_submissions` に保存します。
- 添付画像はフロントエンドでWEBPへ変換してから Drive フォルダに保存し、Spreadsheet にはファイルID/URLを保存します。
- 投稿者向け受付メールは `customer@speed-ad.com` を From にできる場合のみ送信します。
- 確認者向けの閲覧・ステータス更新は、公開投稿用GASとは別の確認者専用GASで行います。
- 仕様確認済み後のDB整理は、確認者GASでバックアップシートを作成してからテスト投稿だけを削除します。
- bot 対策は公開投稿GAS側で honeypot、フォーム表示からの経過時間、ユーザー操作有無、投稿元URL、User-Agent に加えて Cloudflare Turnstile を組み合わせた多層検証を行い、保存前に拒否します。

## 現在の進行状態

2026-06-15 時点で、`customer@speed-ad.com` の外部メール受信と外部宛返信は確認済みです。専用GAS、Spreadsheet、Drive フォルダ、Web App URL も作成済みで、`/contact/` から投稿を受け付けられる状態です。

Apps Script エディタで `initializeContactStorage` と `checkContactConfiguration` を実行済みです。`checkContactConfiguration` は `ok: true`、From条件は `primary` で確認済みです。

- Script ID: `1qODYRRKo8X2ps9V6TI5Q8RzR-TswCUS7sx8gZYDEpfgaKeqJhHDl10KT`
- Web App URL: `https://script.google.com/macros/s/AKfycbw6xaQvmfspOOxXEs4DMqfLxQ3Aev6Qi8RcfiFu7iFwOHos48eAPvmmjxSnteN1Lj0D/exec`
- Sheet: `contact_submissions`
- Drive folder: `SPEED AD サポートお問い合わせ添付`
- Verification: `submitContact` のテスト投稿で `storageStatus=stored` / `mailStatus=sent` を確認済み。
- Verification: ローカルHTTP環境の `/05_support/contact/` から画面送信し、完了パネル表示まで確認済み。
- Verification: 添付画像ありの `submitContact` テスト投稿で `storageStatus=stored` / `mailStatus=sent` を確認済み。
- Viewer: 確認者専用GASは `viewer-gas/` に分離し、許可ユーザーだけが一覧、詳細、添付プレビュー、対応ステータス更新を行います。

## 問い合わせDB整理方針

対象DBは Spreadsheet `contact_submissions` と、各行の `attachment_refs` から参照されるDrive添付ファイルです。実データ整理は確認者GASの `previewContactDbCleanup` で候補を確認し、`executeContactDbCleanup` で同一Spreadsheet内に `contact_submissions_backup_YYYYMMDD_HHMMSS` 形式のバックアップシートを作成してから実行します。

自動削除候補は以下に限定します。

- 既知テスト受付ID: `3d6bd3bc-a065-4908-9f73-b0b048ad0b06`、`70a13837-4725-4b56-ab5f-22a5135ea3ca`、`93f9c46a-b306-4238-b14b-5169811b58f4`、`51cbb89e-b7e8-42ea-8890-0b4ce7645474`
- 既知ID以外は、メールが `s-umeda@abroad-o.com` / `customer@speed-ad.com` / `t-hayashi@abroad-o.com` のいずれかで、件名・本文・名前・User-Agent・投稿元URLのいずれかに `テスト`、`test`、`Codex`、`テストモード`、`production-check`、`contactTestMode` を含む行

外部メールアドレスの行は、既知テスト受付IDに一致しない限り自動削除しません。添付ファイルは、Drive上のファイル名が削除対象 `submission_id` で始まる場合だけゴミ箱へ移動します。

2026-06-22 の整理結果と 2026-06-29 の確認アプリ正常化結果は [db-cleanup-report-2026-06-22.md](./db-cleanup-report-2026-06-22.md) に記録します。

2026-06-22 実行結果:

- `previewContactDbCleanup` で全15行中12件を削除候補として確認。
- `executeContactDbCleanup` でバックアップシート `contact_submissions_backup_20260622_060551` を作成し、候補12行を削除。
- 削除後プレビューで候補0件、残行3件を確認。
- 添付4件のゴミ箱移動は、GAS / Drive API ともDrive書き込み承認不足で未完了。2026-06-29 に残添付専用の再実行関数でファイル名安全確認までは再確認済み。対象 fileId、理由、再実行手順は整理レポートに記録済み。
- `customer@speed-ad.com` のGoogle再認証後、確認者GASの既存デプロイをバージョン `17` (`support contact viewer apps script hash token`) へ反映済み。
- 確認アプリは Apps Script iframe 内でも通知メールの `#token=` と `id` を読み取り、一覧、詳細、添付プレビュー、ステータス更新、内部メモ保存が動くことを確認済み。
- 公開HTMLに `cleanupAction`、一時トークン、確認用トークン経由のDB整理補助関数が残っていないことを確認済み。

## 資料

- [GAS実装・配備手順](./gas/README.md)
- [確認者専用GAS実装・配備手順](./viewer-gas/README.md)

## 仕様正本

画面・入力・メール・保存仕様の正本は `docs/画面設計/仕様/23_support_contact_form_requirements.md` です。

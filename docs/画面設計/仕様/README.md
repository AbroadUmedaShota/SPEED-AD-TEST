# 画面仕様ドキュメント運用ルール

`docs/画面設計/仕様/` は、サービス画面と管理者画面の要件定義・機能仕様の正本です。管理者画面要件は既存資料を削除したうえで、新ルールに従って完全新規で再作成します。

## 読み方
- `00_*` から `14_*`: 主要画面の仕様書。
- `18_screen_inventory_current.md`: 現行画面、実装HTML、仕様を突き合わせる画面一覧・サービス設計整理。
- `*_current_impl.md`: 現行実装に合わせた補足仕様（実装優先の記録）。
- `design_memo_*.md`: 設計検討メモ。確定仕様とは分けて扱う。
- `admin/`: 空ディレクトリ（役目を終了）。管理者画面資料は 2026-05 の再作成以降 `docs/リライト版仕様書/admin/` が正本で、旧資料は `docs/アーカイブ/画面設計仕様admin_20260515/` にある。
- `premium/`: プレミアム登録・契約管理の要件群。

## 正本ルール
- 新規仕様は必ず `docs/画面設計/仕様/` に作成する。管理者画面資料のみ `docs/リライト版仕様書/admin/` に作成する（2026-08-28 に宣言を実態へ追従。作成先の変遷は同ディレクトリの README を参照）。
- 旧要件は社内 private 管理へ移管済みであり、shared repo では新規更新しない。
- 同一テーマで複数ファイルがある場合は、片方を「参照専用（legacy）」と明記する。

## 記載ルール
- 仕様書には front-matter で `owner`, `status`, `last_reviewed` を付与する。
- 実装依存の記述は「現行実装」と「理想仕様」を混在させず、必要なら節を分ける。
- データパス記述は `data/` と `docs/サンプル/` のどちらを参照するか明示する。

## 当面の整理対象
- [完了: 2026-02-18] `13_survey_answer_screen.md` を正本へ統合し、旧要件は社内 private 管理へ移管。
- [完了: 2026-04-06] `docs/画面改修/` の survey creation 関連資料を `docs/画面設計/仕様/` に移管。
- [完了: 2026-02-18] `premium_*_requirements.md` を `docs/画面設計/仕様/premium/` へ移管し、旧配置は legacy redirect 化。
- [完了: 2026-02-18] `01_first-login-tutorial.md` と `performance_management.md` を正本へ統合し、旧配置は legacy redirect 化。
- [完了: 2026-02-18] `help-center_requirements.md` を `15_help_center_requirements.md` として正本化し、旧配置は legacy redirect 化。
- `speed_review` / `graph` 系仕様の参照先統一（仕様・実装・データフロー）。
- front-matter 未付与の既存仕様への段階適用。

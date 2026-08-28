# ドキュメント案内

プロジェクト文書のトップガイドです。共有リポジトリに残す文書と、社内 private 管理に移した文書を明確に分けて扱います。

## 4分類

- 正本: `docs/画面設計/` `docs/リライト版仕様書/`（管理者画面仕様） `docs/ハンドブック/` `docs/リファレンス/`
- shared 補助資料: `docs/テンプレート/` `docs/サンプル/` `docs/変更履歴/CHANGELOG.md`
- internal stub: `docs/プロダクト/` `docs/会議録/` `docs/メモ/meetings/` `docs/legacy-要件定義/`
- アーカイブ: `docs/アーカイブ/`

## カテゴリ別インデックス

### 社内 private 管理 (`docs/プロダクト/`)
- shared repo には本文を置かず、社内専用の private 保管先へ移管しています。
- 事業方針、価格、契約、体制、会議判断、未公開検討事項は shared repo に含めません。

### 画面設計ドキュメント (`docs/画面設計/`)
- `仕様/`: 画面仕様・機能要件一式。`admin/` 配下に管理者画面資料の新ルール、`premium/` 配下にプレミアム契約関連要件。
- `画面/`: 画面単位のUI設計メモ。

### 運用ハンドブック (`docs/ハンドブック/`)
- `セットアップ/`: 初期セットアップとオンボーディング手順。
- `デプロイ/`: 展開/公開フローと必要なチェックリスト。
- `運用/06_OPERATIONS_GUIDE.md`: 運用手順と定例タスク。
- `運用/07_BACKLOG_ISSUE_GUIDE.md`: Backlog 起票手順と `SPDAD_SCD` 展示会スケジュール起票ルール。
- `セキュリティ/07_SECURITY_GUIDELINES.md`: セキュリティポリシーと権限管理。
- `テスト/`: 手動テストガイドラインとチェックリスト群。
  - `テスト/admin_screen_e2e_observed_requirements.md`: 管理者画面のstg実画面観測ベースE2E項目候補。
  - `テスト/admin_screen_e2e_execution_checklist.md`: 管理者画面E2Eのstg実行用チェックリスト。

### 参照資料 (`docs/リファレンス/`)
- `テンプレート/`: Issue / PR テンプレートの正規版（正本）。
- `レビュー/`: UI/仕様レビューの記録。
- `リソース/`: クライアント提供資料や比較表などの外部リファレンス。
- `共有規約/`: shared repo で開発会社と合わせる最低限の実装規約。
  - `01_SHARED_CODING_STANDARDS.md`: 実装時の共通コーディング規約。
  - `02_SHARED_DOC_BOUNDARY_RULES.md`: shared/private の文書境界ルール。
  - `03_PRIVATE_DOCS_MIGRATION_MAP.md`: private 移管マップと旧配置対応表。
  - `04_AI_RESPONSIBILITY_BOUNDARY.md`: AI/実装向けの責任分界ルール。

### 会議資料・メモ
- `会議録/` と `メモ/meetings/` は社内 private 管理へ移管済みです。

### 運用補助テンプレート (`docs/テンプレート/`)
- `email/`: メール文面テンプレート。
- `サンプル/`: Issue / PR 記載例（過去実績ベースのサンプル）。

### 更新履歴 (`docs/変更履歴/`)
- `CHANGELOG.md`: shared repo に残す実装変更ログ。
- 重要な意思決定ログや草案メモは社内 private 管理へ移管済みです。

### アーカイブ (`docs/アーカイブ/`)
- 過去のフォーム ZIP・配布物・一時退避資料を保管。
- 整理対象はこの直下に集約し、参照時のみ展開。

### ローカライズ資料 (`docs/ja/`)
- 日本語版/翻訳版のドキュメントを管理。

### Legacy ディレクトリ (`docs/legacy-要件定義/`)
- 旧要件の社内保管先への案内だけを置く stub です。
- shared repo での新規・改訂は `docs/画面設計/仕様/` を更新します。

## 運用ルール
- 正本は `docs/` 配下に集約する。別階層に `md/txt` を置いた場合は必ず移管する。
- ファイル名は英語 + `YYYY-MM-DD_`（時系列）または `NN_`（並び順）を基本とし、本文言語は任意。
- 仕様書・要件書は front-matter で `owner`, `status`, `last_reviewed` を付与し、ドラフト/レビュー済みを明示する。
- テンプレートの正本は `docs/リファレンス/テンプレート/` とし、`docs/テンプレート/` には補助資料・実例のみを置く。
- アーカイブ移動時は `docs/アーカイブ/README.md` に移動元と移動日を記録する。
- shared/private の境界判断は `docs/リファレンス/共有規約/02_SHARED_DOC_BOUNDARY_RULES.md` を正本とする。
- AI向けの責任分界ルールは `docs/リファレンス/共有規約/04_AI_RESPONSIBILITY_BOUNDARY.md` を参照する。

## 運用メモ
- 共通ヘッダーやサイドバーなどの HTML は `02_dashboard/common/` から `loadCommonHtml(...)` で読み込む。`window.__COMMON_BASE_PATH` を確認すること。
- ダッシュボード用 JSON はリポジトリ直下の `data/` 配下に統一。新規データは `resolveDashboardDataPath` を経由して参照すること。
- 実装が参照するデモ JSON は `data/demo/` を正本とし、`docs/サンプル/` には説明用の README や軽量な補助資料のみを残す。
- 社内限定の背景説明や企画判断は shared repo に持ち込まず、private 管理先で維持する。

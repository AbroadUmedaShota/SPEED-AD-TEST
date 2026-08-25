# E2E テスト (Playwright)

SPEED AD 静的モックの利用者導線を Playwright で確認する。
対象フローの定義は [99_backend-docs/08_e2e-testing/02_target-flows.md](../../99_backend-docs/08_e2e-testing/02_target-flows.md) を参照。

## 前提

- Node.js / npm
- Python（ローカル配信 `scripts/dev-server.py` 用）
- 初回のみ依存とブラウザを取得:
  ```
  npm install
  npm run test:e2e:install   # chromium / firefox / webkit
  ```

## 実行

| コマンド | 内容 |
| --- | --- |
| `npm run test:e2e` | 全プロジェクトで実行 |
| `npx playwright test --project=local` | ローカルの静的モックだけ（認証不要・サーバー自動起動） |
| `npm run test:e2e:stg` | stg 実機（認証が要る。先に `npm run test:e2e:auth`） |
| `npm run test:e2e:ui` | UI モードで実行 |
| `npm run test:e2e:report` | 直近の HTML レポートを表示 |

## プロジェクト（[playwright.config.js](../../playwright.config.js)）

| project | 対象 | 認証 |
| --- | --- | --- |
| `local` | ローカルの静的モック。`python scripts/dev-server.py` を自動起動 | 不要 |
| `setup` | stg のログイン状態を `playwright/.auth/` に保存 | — |
| `stg-public` / `stg-user` / `stg-admin` / `stg-perm-lv1` / `stg-perm-lv2` | stg 実機 | `setup` の結果を使う |

`local` は `**/stg/**` を除外しているので、モックのテストは stg を巻き込まない。
dev-server は `ThreadingHTTPServer`。並列ワーカーからの同時リクエストで詰まらせないため。

## 管理画面モックのゲート（`admin-mock/`）

`03_admin` を触ったらここが通ることを確認する。1コマンドで回る:

```
npx playwright test --project=local tests/e2e/admin-mock
```

| ファイル | 見るもの |
| --- | --- |
| `_screens.js` | 到達16画面と9一覧、状態切替を持つ領域(`REGIONS`)の定義。画面を足したらここに追記する |
| `shell.spec.js` | 全画面の土台（JSエラー・横はみ出し・hidden・シェル注入・`pLevel()`） |
| `lists.spec.js` | ページング・並び替え・絞り込み |
| `region-state.spec.js` | 一覧・集計領域の取得状態（`?state=`、下記参照） |
| `survey-detail.spec.js` | 会期ごとの編集ゲート（要注意操作） |
| `user-detail.spec.js` | アカウント状態の出し分け・招待・未保存の確認 |
| `billing.spec.js` | 1行=1アンケート・グループ契約の判別 |
| `consistency.spec.js` | 表記と操作性の一貫性（レビュー指摘を機械化したもの） |

### 領域の取得状態（`?state=`）の確認

一覧・集計領域（`[data-a-region]`）は URL クエリ `?state=` で読み込み中・失敗などの表示を強制できる（01_admin_common_ui.md §4.4）。レビュー時に手で確認する場合は対象画面へ以下を付けて開く:

| クエリ | 表示 |
| --- | --- |
| `?state=loading` | 初回読込中（骨格表示、絞り込み・ページャは操作不可） |
| `?state=reloading` | 再読込中（表示は維持したまま帯で知らせる） |
| `?state=error` | 取得失敗（本体を隠し、領域内に再試行を1個出す） |
| `?state=error-keep` | 取得失敗・表示維持（帯で知らせるだけで本体は隠さない） |
| `?state=partial` | 集計のみ失敗（reconciliation/index・data-entry/index の2画面だけ意味を持つ） |

機械的な検査は `region-state.spec.js` が `_screens.js` の `REGIONS` を data-driven で回す。画面に新しい `[data-a-region]` を追加したら `REGIONS` にも追記する。

### `consistency.spec.js` の `test.fail()` について

まだ直していない指摘は `test.fail()` を付けてある。**落ちるのが正しい**状態で、
直すと「Expected to fail, but passed」で赤くなるので、そのとき注釈を外す。
どの指摘かは `docs/architecture/admin_architecture.json` の findings（R-xx）と対応する。

画面ごとに状況が違うものは `test.fail(MIXED.includes(s.name))` のように条件で絞る。
まだきれいな画面では検査を有効なまま残し、あとから壊れたら拾えるようにするため。

## テストの追加

`tests/e2e/*.spec.js` に追加する。`smoke.spec.js` はセットアップ検証用の最小テスト。
クリック対象には安定した id / data 属性を優先して使う（テキスト依存を避ける）。
管理画面モックの入力欄は `type` 属性を持たない `<input>` があるので、
`input[type="text"]` では拾えない点に注意（`input:not([type])` を使う）。

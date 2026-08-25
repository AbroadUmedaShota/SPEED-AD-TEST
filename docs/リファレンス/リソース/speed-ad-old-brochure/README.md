# SPEED AD 旧パンフレット（A4巻三つ折り）

旧5パネルを、文字・罫線・アイコン・グラデーションを再編集できる HTML/CSS 正本へ再構築した制作物です。展示会出展者向けの別パンフレットとは分離し、通常営業、セミナー、問い合わせ・アンケート管理、パートナー管理、展示会を複数の利用例として扱います。

## 正本と成果物

- 正本: `index.html` / `styles.css`
- パターンB比較版: `variants/pattern-b/index.html`（工程01〜06を1面に集約し、無料・有料プランのデータ化メリットを折込フラップに掲載した比較案）
- ブランド正本: `assets/brand/`（2026-08-10 Web実装用の正式SVG・WOFF2・CSS）
- QR正本: `scripts/generate-qr.mjs`（固定リンク `https://speed-ad.com/`）
- 出力・検証: `scripts/export.mjs` / `scripts/verify.mjs`
- 再生成成果物: `output/`

旧PNGおよび前回の2倍補間画像は内容確認にのみ使い、正本のデザイン部品には使用していません。現在の紙面はHTML文字、CSS図形・グラデーション、インラインSVGアイコン、正式ブランドSVG・WOFF2、再生成SVG QRで構成しています。

## ブランドアセット

- カラー／白抜きエンブレム、favicon、横組み／縦積みワードマークの黒・白を `assets/brand/` に原本のまま保持します。
- パターンBの表紙・裏表紙は、正式カラーエンブレムと `SPEED AD Wordmark` WOFF2を使ったブランドロックアップです。内面は見出しとの競合を避け、ブランドロックアップを配置しません。
- 専用WOFF2はサービスワードマークだけに使用し、日本語本文には適用しません。
- パターンBの見た目調整は `.pattern-b` 配下へ限定し、標準版へ適用しません。表紙ロゴを中央配置し、挿絵はアンケート・名刺情報が一元管理データへ集約される流れを表すベクター図としています。内面3面は主見出しを同じ高さへ揃え、主要本文2.8mm以上・補足本文2.6mm以上を維持しながら、カード群を下端まで均等配置します。

## 連絡先方針

- 営業・導入相談窓口: `info@abroad-o.com`
- サポート・既存利用者向け問い合わせ窓口: `customer@speed-ad.com`
- 本パンフレットはサービス紹介・導入相談資料のため、裏表紙には営業・導入相談窓口の `info@abroad-o.com` のみを掲載します。

## 面付けと折り順

A4横（297×210mm）、左開きの巻三つ折りです。折込面は一般的な仮仕様として3mm短い97mmにしています。

| 面 | 左 | 中央 | 右 |
| --- | --- | --- | --- |
| 外面 | 折込フラップ 97mm（工程05–09） | 裏表紙 100mm | 表紙 100mm |
| 内面 | 表紙の裏 100mm（工程01–04） | 主な機能 100mm | 折込面の裏 97mm（利用シーン） |

折り方は、外面を上にした状態で左97mmの折込フラップを内側へ折り、右100mmの表紙をその上へかぶせます。開く順は「表紙 → 工程05–09 → 全開して工程01–04・主な機能・利用シーン」です。

> 入稿前に、印刷会社のテンプレートに合わせて `styles.css` の `--panel` と `--flap` を調整してください。紙厚・折り機によって折込面の短縮量が異なります。

## ローカル表示

リポジトリルートで次を実行します。

```powershell
python -m http.server 8000
```

ブラウザで以下を開きます。

```text
http://localhost:8000/docs/リファレンス/リソース/speed-ad-old-brochure/index.html
```

## 再出力

```powershell
cd docs/リファレンス/リソース/speed-ad-old-brochure
npm install
npm run build
```

Chromeが標準パスにない場合は、実行前に次を設定します。

```powershell
$env:BROCHURE_BROWSER_PATH = 'C:\path\to\chrome.exe'
```

`npm run export` はA4 2ページPDF、外面・内面の高解像度PNG、6面一覧、PDF 600dpi由来のグラデーション比較を生成します。`npm run verify` は代表3ビューポートのはみ出し・コンソールエラー、PDF寸法、面幅、PNG実効dpiと、HTML用SVG・PNG・PDF 300dpiのQR実デコードを確認します。Pattern Bでは、HTML表示文言とPDF抽出文言について、無料2項目、標準10項目、オンデマンド条件、CSVのプラン差、請求明細確認の必須表現と、誤認余地のある禁止表現も検査します。PDFレンダリングを行うため、export・verifyの双方で `pdftoppm` / `pdfinfo` が必要です。

PDF検証にはPopplerの `pdftoppm` が必要です。実行前に `pdftoppm -v` または `Get-Command pdftoppm` で、PATHから参照される実体を確認してください。PATH上のラッパーが壊れている場合は、実在するPopplerの `bin` を当該PowerShellセッションのPATH先頭へ追加してからbuildを実行します。次は今回の確認環境における例であり、固定必須パスではありません。

```powershell
$env:PATH = 'C:\Program Files\poppler\Release-24.08.0-0\Library\bin;' + $env:PATH
npm run build
```

### パターンBの再出力

パターンAはルートの `index.html` を標準版正本、パターンBは `variants/pattern-b/index.html` を比較版正本として保持します。パターンBのPDF・PNG・検証結果はAの成果物を上書きせず、`output/pattern-b/` に出力します。

パターンBに限り、回答・名刺情報を次のアクションへつなぐ流れと、「氏名・メールアドレスの基本2項目から無料で試せる」「標準10項目」「オンデマンドなら最短当日中」を掲載しています。当日中の表現には、オンデマンドプラン、Premium契約、18時までの入稿など所定条件がある旨を注記しています。CSV出力はプランに応じることを明記し、請求機能は請求書・明細の確認とPDF出力に限定して案内します。「自動で取り込み」「外部システムと連携」「入金状況を可視化」「請求・クローズ」は使用しません。資料間で項目定義に揺れがあるため、標準10項目の個別列挙は行っていません。これ以外の料金・契約条件・実績数値は追加していません。

```powershell
npm run build:pattern-b
```

### Pattern BのACCEA入稿用PDF

[ACCEA EXPRESS「A4サイズ 上質紙70kg 両面カラー + 巻き三つ折り加工」](https://ex.accea.co.jp/pamph/A4_70k_4C4C_o2)向けに、既存のRGB印刷確認PDFとは別系統で入稿用PDFを生成します。[公式A4巻き三つ折りテンプレート](https://www.accea.co.jp/usersguide/img/OL/A4_mitsuori.zip)のA4横・右表紙に合わせ、外面97 / 100 / 100mm、内面100 / 100 / 97mmとしています。塗り足しや完全データの基準は[ACCEAのデータ作成案内](https://ex.accea.co.jp/usersguide/about_data)を参照します。

```powershell
$env:POPPLER_BIN = 'C:\path\to\poppler\bin'
$env:GHOSTSCRIPT_PATH = 'C:\path\to\gswin64c.exe'
$env:CMYK_ICC_PROFILE = 'C:\path\to\JapanColor2001Uncoated.icc'
npm run build:print:pattern-b
```

`POPPLER_BIN`、`GHOSTSCRIPT_PATH`、`CMYK_ICC_PROFILE`は環境に合わせて指定し、端末固有パスはスクリプトへ保存しません。最終入稿PDFは `output/pdf/`、中間PDF・確認用PDF/PNG・検証結果は `output/pattern-b/print/` に生成されます。

- 入稿用PDF: `output/pdf/SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA入稿用_CMYK.pdf`
- 台紙: 420×350mm、2ページ。MediaBox/CropBoxは台紙全体、BleedBoxは303×216mm、TrimBox/ArtBoxは297×210mm
- 色・互換性: Ghostscriptと `JapanColor2001Uncoated.icc` でCMYKへ変換したPDF 1.4。PDF/X準拠とは表記しません
- 中間PDF: 303×216mmのコンパクトRGB版と、同内容をACCEA台紙へ1:1配置したRGB版。入稿には使用しません
- 確認用PDF/PNG: マゼンタが仕上がり線、ティール破線が折り位置。入稿には使用しません
- トンボ・折り指示: 公式台紙と同じ位置へトンボ、センタートンボ、仕上がり外の短い折り位置マークを配置。外面97 / 100 / 100mm、内面100 / 100 / 97mm
- 安全域: 文字・ロゴ・QRなどの重要要素を仕上がり線から5mm以上内側へ配置
- PDF box設定と台紙配置には `pdf-lib` を使用し、既存のベクター、埋め込みフォント、SVGロゴ、QRコードを保持します

入稿用PDFの生成後は、ページ数・各PDF box・PDF 1.4・最低300ppi・フォント埋め込み・CMYKリソース・RGBリソース残存・暗号化・フォーム・JavaScript・安全域・折り線交差・主要文言・QR実デコードを `scripts/verify-print.mjs` が検査します。Ghostscript変換後の一部日本語はToUnicodeマッピングが完全には維持されないため、公開文言の完全一致は変換前RGB台紙で検査し、最終CMYK版は300dpiレンダリング、フォント埋め込み、QR、面順、色空間を検査します。

## 出力仕様

- PDF: A4横 2ページ、背景印刷あり、RGB確認用
- PNG: 4倍デバイススケール（A4換算約384dpi）で外面・内面を出力
- QR: 誤り訂正レベルH、4モジュールのクワイエットゾーン、SVG
- グラデーション: CSS linear-gradient。旧ラスター画像のグラデーションは不使用。比較画像はPDFを600dpiで直接レンダリングした全景と4倍詳細crop
- フォント: サービスワードマークは `SPEED AD Wordmark` WOFF2。日本語本文は `Yu Gothic` → `Hiragino Kaku Gothic ProN` → `Noto Sans JP` の順でローカルフォールバック
- ACCEA入稿用PDF: Pattern B専用、420×350mm台紙、全周3mm塗り足し、A4 TrimBox、JapanColor2001Uncoated CMYK、両面カラー巻三つ折り。従来のA4 RGB確認用PDFは上書きしない

## 入稿前に印刷会社・原稿責任者へ確認する事項

1. ACCEA入稿用は公式テンプレートに合わせた100 / 100 / 97mmと右表紙の巻三つ折りです。他社へ入稿する場合は短辺補正と折り方向を再確認してください。
2. ACCEA入稿用は `JapanColor2001Uncoated.icc` で変換したCMYK PDF 1.4です。印刷会社から別のICC、PDF/X、総インキ量の追加指定を受けた場合は、その条件で再生成してください。
3. 「入金確認後」「クローズ」の公開文言、および旧版会社情報の最終校正。
4. 両面ダミー印刷による天地・表裏・折り位置・QR実機読取。
5. 濃紺の帯や面が折り位置に接する箇所は、紙・折り加工条件により背割れが目立つ可能性があります。デザイン変更やPP加工の追加は今回の対象外です。

## 原稿上の境界

- 旧版の価格、実績、効果数値は追加していません。
- 展示会は利用シーンの一例に留めています。
- 「問い合わせ・アンケート管理」は既存のアンケート作成・回答確認フローを一般利用シーンとして再編集したものです。
- 料金・契約・未公開企画はこの制作物に含めません。

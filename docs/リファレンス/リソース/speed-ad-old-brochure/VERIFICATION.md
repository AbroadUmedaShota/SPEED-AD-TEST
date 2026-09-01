# 検証結果

検証日: 2026-08-14

## 結果

- 標準版HTML/CSS正本: PASS
- パターンB HTML/CSS比較版: PASS
- パターンBの表紙・裏表紙における正式カラーエンブレム読込: PASS
- 2か所の `SPEED AD Wordmark` WOFF2読込・適用: PASS
- 表紙ブランドロックアップの中央配置: PASS（代表3ビューポートで中心差1px以内）
- 表紙挿絵のデータ集約図への置換: PASS
- 会社情報欄の公式WEB URL `www.abroad-o.com` 掲載: PASS
- パターンB内面3面の主見出し位置: PASS（代表3ビューポートで上端差1px以内）
- パターンB内面の最小文字サイズ: PASS（主要本文2.8mm、補足本文2.6mm）
- パターンB内面3面の下端余白: PASS（カード群を均等配分し、最大8mm以内）
- パターンB公開文言見直し: PASS（表紙、メリット、相談、工程01〜06、主な機能・課題、利用シーン・締め）
- パターンBの無料2項目・標準10項目・オンデマンド条件・CSVプラン差・請求明細確認: カード・機能単位のDOM完全一致、およびHTML/PDF抽出文言とも機械検証PASS
- `対象イベント` / `自動で取り込み` / `外部システムと連携` / `入金状況を可視化` / `請求・クローズ`: Pattern BのHTML/PDF抽出文言とも不使用、機械検証PASS
- パターンBの工程01〜06・カード順・利用シーン順の維持: PASS
- Pattern B専用CSSの標準版への非適用: PASS
- PDFページ数・MediaBox: 機械検証PASS（A4横 297×210mm、2ページ）
- 面幅geometry: 機械検証PASS（外面97/100/100mm、内面100/100/97mm、許容差内）
- 高解像度PNG: 機械検証PASS（4倍デバイススケール、A4換算約384dpi）
- 6面のpanel overflow: 機械検証PASS
- 6面の文字切れ・視覚的重なり: 目視PASS
- 代表ビューポート 1684×1191 / 1188×840 / 900×1200: PASS
- ブラウザコンソール・ページエラー: 0件
- QRリンク: `https://speed-ad.com/`
- HTML表示用SVG QRの実デコード: PASS
- 高解像度PNG QRの実デコード: PASS
- PDFを300dpiでレンダリングしたQRの実デコード: PASS
- PDF 600dpi直接レンダリングによるグラデーション全景・4倍crop比較: 目視PASS（旧版由来の滲み・縦境界なし）
- 旧ラスター画像への依存: なし
- 営業・導入相談窓口: `info@abroad-o.com`（HTML・PDF・PNGで一貫、PASS）
- ACCEA入稿用PDF: PASS（Pattern B、420×350mm ACCEA台紙、2ページ、PDF 1.4、JapanColor2001Uncoated CMYK）
- ACCEA入稿用PDF box: PASS（MediaBox/CropBox 420×350mm、BleedBox 303×216mm、TrimBox/ArtBox 297×210mm）
- ACCEA公式A4横・右表紙テンプレートとの面付け: PASS（外面97 / 100 / 100mm、内面100 / 100 / 97mm）
- ACCEA公式台紙とのトンボ・センタートンボ・折り位置: PASS
- 重要要素の5mm安全域: PASS（最小距離 外面5.91mm、内面7mm）
- 折り線をまたぐ重要要素: 0件、PASS
- 入稿用PDFのフォント埋め込み・サブセット: `pdffonts` 掲載の全フォントPASS（`SPEEDADWordmark-Regular`を含む）
- 入稿用PDF内画像: 最低300ppi、PASS（CSSグラデーション由来画像は600ppi）
- 入稿用PDFの色空間: CMYKリソースあり、DeviceRGB/CalRGBリソースなし、PASS
- 入稿用PDFの暗号化・フォーム・JavaScript: なし、PASS
- 入稿用PDFを300dpiレンダリングしたQR実デコード: `https://speed-ad.com/`、PASS
- 入稿用PDFの外面・内面300dpiレンダリング: 目視PASS（文字切れ、重なり、白線、背景の塗り足し切れなし）
- 変換前RGB台紙PDFの主要文言・面順: PDFテキスト抽出PASS。最終CMYK版はGhostscript変換後に一部日本語のToUnicodeマッピングが欠落するため、テキスト抽出結果を印刷品質判定には使用しない
- 標準版の隔離再生成: PASS。既存高解像度PNGとの比較はPSNR 外面58.41dB・内面58.22dBで、差分はアンチエイリアス範囲、視覚差なし

標準版の機械可読な詳細は `output/verification.json`、パターンBは `output/pattern-b/verification.json` を参照してください。視覚確認用は各出力ディレクトリの `SPEED_AD_旧パンフレット_6面一覧プレビュー.png` と `SPEED_AD_旧パンフレット_グラデーション等倍_高倍率比較.png` です。自動検証はDOMのpanel overflow、面幅、PDF寸法、PNG解像度、QRデコードに加え、Pattern BのHTML/PDF主要文言を対象とします。文字同士の視覚的な重なり、折り位置付近の見え方、グラデーションの滲み・バンディングは目視判定です。

ACCEA入稿用の機械可読な詳細は `output/pattern-b/print/verification.json`、ブラウザ計測値は `output/pattern-b/print/print-layout.json` を参照してください。最終入稿対象は `output/pdf/SPEED_AD_旧パンフレット_PatternB_A4巻三つ折り_ACCEA入稿用_CMYK.pdf` です。`output/pattern-b/print/` 内のRGB中間PDF、折り断裁確認用PDF/PNG、CMYKレンダリングPNGは確認専用です。

## 実行環境

- Windows環境でPATH上のPopplerラッパーが存在しない内部パスを参照していたため、実在するPopplerの `bin` を当該セッションのPATH先頭へ追加してからbuildを実行しました。
- 今回確認した実体は `C:\Program Files\poppler\Release-24.08.0-0\Library\bin` です。端末固有の固定必須パスではなく、生成スクリプトへのハードコードも行っていません。
- SVG・WOFF2をPDFへ確実に反映するため、出力・検証サーバーで `image/svg+xml` / `font/woff2` を明示し、PDF生成前に `document.fonts.ready` を待機しています。
- 対処後、`npm run build` と `npm run build:pattern-b` はともにPASSしました。
- ACCEA入稿用は同じPoppler実体を `POPPLER_BIN`、Ghostscript 10.05.1を `GHOSTSCRIPT_PATH`、`JapanColor2001Uncoated.icc` を `CMYK_ICC_PROFILE` で当該セッションへ指定し、`npm run build:print:pattern-b` がPASSしました。端末固有パスはスクリプトへハードコードしていません。

## 内容レビュー

- 標準版は、アカウント登録、アンケート作成、QR配布、回答・名刺取得、データ確認・CSV、営業フォロー、請求内容確認、クローズを一連の流れとして維持しました。
- パターンBは最終採用版ではなく比較版です。工程01〜06を内面左へ集約し、外面折込フラップで無料2項目と有料プランの標準10項目を案内します。
- パターンBの表紙・裏表紙に、2026-08-10 Web実装用データの正式カラーエンブレムと専用ワードマークフォントを配置しました。表紙ロゴは中央配置し、内面ロゴは見出しとの競合を避けて削除しました。日本語本文のフォントは変更していません。
- パターンBの表紙挿絵は、アンケート・名刺情報が一元管理データへ集約される流れを表す無文字のベクター図へ変更しました。
- パターンBは、工程01〜06・カード順・利用シーン順を維持したまま、表紙から締めまでの公開文言を現行仕様で確認できる範囲へ見直しました。3面の主見出し位置、カード余白、アイコン径、本文サイズ、下端までの配置バランスは維持しています。
- パターンBの当日表現は「オンデマンドなら最短当日中※」とし、「※最短当日中はオンデマンドプラン。Premium契約・18時までの入稿など所定条件があります。」を併記しました。
- CSV出力はプランに応じることを明記し、請求機能は「請求書・明細確認」「請求書と明細を一覧で確認し、PDF出力にも対応。」へ具体化しました。
- 誤認余地のある「対象イベント」「自動で取り込み」「外部システムと連携」「入金状況を可視化」「請求・クローズ」はPattern Bから除外しました。
- 資料間で項目定義に揺れがあるため、標準10項目の個別列挙は紙面から外しました。
- 利用シーンは営業・商談、セミナー・ウェビナー、問い合わせ・アンケート管理、パートナー・代理店管理、展示会・イベントの順とし、展示会を主軸にしていません。

## 残課題

- 最終CMYK版はGhostscript変換後に一部日本語のToUnicodeマッピングが欠落します。フォントは埋め込み済みで300dpiレンダリングは正常ですが、アクセシビリティや全文検索を要件とする場合は別工程での再生成が必要です。
- 濃紺部分が折り位置に接する箇所は、用紙・加工条件により背割れが目立つ可能性があります。デザイン変更やPP加工の発注は今回の対象外です。
- ACCEA向け面幅100 / 100 / 97mmは公式テンプレートと照合済みです。他社入稿時は再確認が必要です。
- 最終入稿前に実紙ダミーの両面印刷・折り・実機QR確認が必要です。

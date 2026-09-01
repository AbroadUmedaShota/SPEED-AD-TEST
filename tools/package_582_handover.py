# -*- coding: utf-8 -*-
"""sv_0003_26011 のダミーデータを、開発会社への受け渡し用フォルダへ梱包する。

出力先: リポジトリ直下 `582_ABC展示会_ダミー回答データ/`
  - 回答データ.csv        回答300件（1列=1設問、Excelで開ける UTF-8 BOM 付き）
  - 名刺データ.csv         回答⇔名刺画像の紐付け＋データ化項目（SPEEDレビュー表示内容）の全列
  - answers.json          回答300件（582の設問No・選択肢コード体系、日時はJST）
  - business_cards.json   名刺285件（納品フォーマットのgroup構成・画像相対パス）
  - bizcard_images/       名刺画像480枚（本番風の {10桁}_{回答ID8桁}_{1|2}.jpg へ改名コピー）
  - README.md             別途手書き（本スクリプトは触らない）

再実行可能: bizcard_images/ と CSV/XLSX/JSON のみ作り直す。
実行: python tools/package_582_handover.py
"""

import csv
import json
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_SURVEY_ID = "sv_0003_26011"
SRC_ANSWERS = REPO_ROOT / "data" / "responses" / "answers" / f"{SRC_SURVEY_ID}.json"
SRC_BIZCARDS = REPO_ROOT / "data" / "responses" / "business-cards" / f"{SRC_SURVEY_ID}.json"
SRC_IMAGES = REPO_ROOT / "media" / "generated" / SRC_SURVEY_ID / "bizcard"

OUT_DIR = REPO_ROOT / "582_ABC展示会_ダミー回答データ"
OUT_IMAGES = OUT_DIR / "bizcard_images"

# 本番の名刺画像ファイル名 {10桁}_{回答ID8桁}_{1=表|2=裏} に合わせる。
# 10桁の下5桁はアンケートID(582)のゼロ埋め。上5桁は本番側で採番されるため
# 確定するまで 00000 のプレースホルダとする（判明したらここを差し替えて再実行）。
IMAGE_PREFIX = "0000000582"

# dev https://dev.speed-ad.com/survey/582/questions の定義（2026-08-31取得）に基づく対応表
Q1_TEXT = "弊社ブースにお立ち寄り頂いた目的をお選びください（複数選択可）"
Q2_TEXT = "導入を予定されている時期をお選びください"
Q3_TEXT = "導入のご検討にあたり重要視しているポイントをお知らせください"
Q4_TEXT = "弊社からご案内する希望の情報をお選びください（複数選択可）"
Q5_TEXT = "その他、ご意見・ご要望があれば、ご記入ください"

Q1_LABEL_TO_CODE = {
    "製品Aの導入を検討": "1", "製品Bの導入を検討": "2", "製品Cの導入を検討": "3",
    "情報収集": "4", "その他": "5",
}
Q2_LABEL_TO_CODE = {
    "直ぐにでも": "1", "3か月以内": "2", "1年以内": "3",
    "検討中だが時期未定": "4", "導入予定なし": "5",
}
Q3_ROW_LABELS = {
    "1": "導入のコスト", "2": "維持管理のコスト", "3": "導入までのスピード",
    "4": "導入による業務効率化", "5": "他システムとの連携", "6": "アフターフォロー",
}
Q3_VALUE_LABELS = {
    "1": "非常に重要視している", "2": "重要視している",
    "3": "確認・比較はしている", "4": "あまり重要としていない",
}
Q4_LABEL_TO_CODE = {
    "営業担当からの説明・ご提案": "1", "お見積り": "2", "デモ・テスト導入": "3",
    "その他": "4", "案内を希望しない": "5",
}

CASE_JA = {"both": "両面", "frontOnly": "表面のみ", "none": "なし"}


def to_jst_dt(iso_z):
    return datetime.strptime(iso_z, "%Y-%m-%dT%H:%M:%SZ") + timedelta(hours=9)


def answer_no(answer_id):
    return int(re.search(r"(\d+)$", answer_id).group(1))


def convert_details(details):
    out = []
    for d in details:
        qid = d["questionId"]
        ans = d["answer"]
        if qid == "Q1":
            out.append({
                "questionNo": 1,
                "answerCodes": [Q1_LABEL_TO_CODE[a] for a in ans],
                "answerLabels": list(ans),
            })
        elif qid == "Q2":
            out.append({"questionNo": 2, "answerCode": Q2_LABEL_TO_CODE[ans], "answerLabel": ans})
        elif qid == "Q3":
            rows = []
            for row_key in sorted(ans, key=lambda k: int(k[1:])):
                row_code = row_key[1:]  # r1 -> 1
                value_code = ans[row_key]
                rows.append({
                    "rowCode": row_code,
                    "rowLabel": Q3_ROW_LABELS[row_code],
                    "valueCode": value_code,
                    "valueLabel": Q3_VALUE_LABELS[value_code],
                })
            out.append({"questionNo": 3, "answers": rows})
        elif qid == "Q4":
            out.append({
                "questionNo": 4,
                "answerCodes": [Q4_LABEL_TO_CODE[a] for a in ans],
                "answerLabels": list(ans),
            })
        elif qid == "Q5":
            out.append({"questionNo": 5, "answerText": ans})
    return out


def csv_answer_columns(details_conv):
    """CSV用: [Q1, Q2, Q3の6行分, Q4, Q5] の値リストを返す。"""
    by_no = {d["questionNo"]: d for d in details_conv}
    q1 = "、".join(by_no[1]["answerLabels"]) if 1 in by_no else ""
    q2 = by_no[2]["answerLabel"] if 2 in by_no else ""
    q3_map = {r["rowCode"]: r["valueLabel"] for r in by_no[3]["answers"]} if 3 in by_no else {}
    q3_cols = [q3_map.get(str(i), "") for i in range(1, 7)]
    q4 = "、".join(by_no[4]["answerLabels"]) if 4 in by_no else ""
    q5 = by_no[5]["answerText"] if 5 in by_no else ""
    return [q1, q2, *q3_cols, q4, q5]


def write_csv(rows):
    header = [
        "ID", "名刺画像ファイル名（表）", "名刺画像ファイル名（裏）", "回答日時",
        f"Q1.{Q1_TEXT}",
        f"Q2.{Q2_TEXT}",
        *[f"Q3.{Q3_TEXT}［{Q3_ROW_LABELS[str(i)]}］" for i in range(1, 7)],
        f"Q4.{Q4_TEXT}",
        f"Q5.{Q5_TEXT}",
    ]
    with open(OUT_DIR / "回答データ.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def write_bizcard_csv(rows):
    """名刺データ.csv: 回答⇔名刺画像の紐付け＋SPEEDレビューに表示されるデータ化項目の全列。"""
    header = [
        "回答ID", "回答日時", "名刺画像", "表面ファイル名", "裏面ファイル名",
        "会社名", "部署", "役職", "姓", "名", "メールアドレス",
        "郵便番号", "住所1", "住所2", "携帯", "TEL1", "FAX", "URL",
    ]
    with open(OUT_DIR / "名刺データ.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    answers_src = json.loads(SRC_ANSWERS.read_text(encoding="utf-8"))["answers"]
    bizcards_src = json.loads(SRC_BIZCARDS.read_text(encoding="utf-8"))
    cards_by_id = {c["answerId"]: c["businessCard"] for c in bizcards_src}

    if OUT_IMAGES.exists():
        shutil.rmtree(OUT_IMAGES)
    OUT_IMAGES.mkdir(parents=True)

    answers_out = []
    cards_out = []
    csv_rows = []
    xlsx_rows = []
    counts = {"both": 0, "frontOnly": 0, "none": 0}

    for a in answers_src:
        no = answer_no(a["answerId"])
        answer_id = f"{no:08d}"
        card = cards_by_id.get(a["answerId"])

        if card is None:
            case = "none"
        elif card["imageUrl"]["back"]:
            case = "both"
        else:
            case = "frontOnly"
        counts[case] += 1

        front_dst = back_dst = ""
        if card is not None:
            front_dst = f"{IMAGE_PREFIX}_{answer_id}_1.jpg"
            shutil.copy2(SRC_IMAGES / Path(card["imageUrl"]["front"]).name, OUT_IMAGES / front_dst)
            if case == "both":
                back_dst = f"{IMAGE_PREFIX}_{answer_id}_2.jpg"
                shutil.copy2(SRC_IMAGES / Path(card["imageUrl"]["back"]).name, OUT_IMAGES / back_dst)

        jst = to_jst_dt(a["answeredAt"])
        details_conv = convert_details(a["details"])

        answers_out.append({
            "no": no,
            "answerId": answer_id,
            "answeredAt": jst.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
            "businessCard": case,
            "details": details_conv,
        })

        csv_rows.append([
            answer_id, front_dst, back_dst, jst.strftime("%Y-%m-%d %H:%M:%S"),
            *csv_answer_columns(details_conv),
        ])

        g = (lambda grp, key: card[grp].get(key, "") if card else "")
        xlsx_rows.append([
            answer_id, jst.strftime("%Y-%m-%d %H:%M:%S"), CASE_JA[case],
            front_dst, back_dst,
            g("group3", "companyName"), g("group3", "department"), g("group3", "position"),
            g("group2", "lastName"), g("group2", "firstName"), g("group1", "email"),
            g("group4", "postalCode"), g("group4", "address1"), g("group4", "address2"),
            g("group5", "mobile"), g("group5", "tel1"), g("group5", "fax"),
            g("group6", "url"),
        ])

        if card is not None:
            card_info = {k: v for k, v in card.items() if k.startswith("group")}
            cards_out.append({
                "no": no,
                "answerId": answer_id,
                "images": {
                    "front": f"bizcard_images/{front_dst}",
                    "back": f"bizcard_images/{back_dst}" if back_dst else None,
                },
                "cardInfo": card_info,
            })

    answers_doc = {
        "surveyId": 582,
        "surveyTitle": "ABC展示会ご来場者様アンケート",
        "targetUrl": "https://dev.speed-ad.com/questionnaire_answer?id=582",
        "totalCount": len(answers_out),
        "businessCardBreakdown": counts,
        "answers": answers_out,
    }
    (OUT_DIR / "answers.json").write_text(
        json.dumps(answers_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "business_cards.json").write_text(
        json.dumps(cards_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csv(csv_rows)
    write_bizcard_csv(xlsx_rows)

    n_images = len(list(OUT_IMAGES.glob("*.jpg")))
    print(f"answers: {len(answers_out)} {counts}")
    print(f"business cards: {len(cards_out)}")
    print(f"images: {n_images}")
    print("written: 回答データ.csv / 名刺データ.csv / answers.json / business_cards.json")


if __name__ == "__main__":
    main()

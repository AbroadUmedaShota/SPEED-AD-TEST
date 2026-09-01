# -*- coding: utf-8 -*-
"""sv_0003_26011（dev id=582 相当「ABC展示会ご来場者様アンケート」）のダミーデータ一括生成。

生成物:
  - media/generated/sv_0003_26011/bizcard/  名刺画像（表 _1.jpg / 裏 _2.jpg）
  - data/responses/answers/sv_0003_26011.json         回答300件
  - data/responses/business-cards/sv_0003_26011.json  名刺285件（両面195/表面のみ90）
  - data/surveys/sv_0003_26011.json                   アンケート定義
  - data/core/surveys.json                            マスタへエントリ追加（既存エントリは置換）

seed固定・再実行可能。自分の出力先以外は変更しない。
実行: python tools/generate_sv582_dummy_data.py
"""

import json
import os
import random
import shutil
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SURVEY_ID = "sv_0003_26011"
SEED = 58211
REPO_ROOT = Path(__file__).resolve().parents[1]
BIZCARD_DIR = REPO_ROOT / "media" / "generated" / SURVEY_ID / "bizcard"
ANSWERS_PATH = REPO_ROOT / "data" / "responses" / "answers" / f"{SURVEY_ID}.json"
BIZCARDS_PATH = REPO_ROOT / "data" / "responses" / "business-cards" / f"{SURVEY_ID}.json"
SURVEY_DEF_PATH = REPO_ROOT / "data" / "surveys" / f"{SURVEY_ID}.json"
CORE_SURVEYS_PATH = REPO_ROOT / "data" / "core" / "surveys.json"

TOTAL = 300
CASE_BOTH = 195   # 両面あり 65%
CASE_FRONT = 90   # 表面のみ 30%
CASE_NONE = 15    # 名刺なし 5%

CARD_W, CARD_H = 1080, 653  # 名刺比率(91:55)相当

rng = random.Random(SEED)


# ---------------------------------------------------------------------------
# アンケート定義（dev /survey/582/questions と同構成）
# ---------------------------------------------------------------------------

Q1_OPTS = ["製品Aの導入を検討", "製品Bの導入を検討", "製品Cの導入を検討", "情報収集", "その他"]
Q1_OPTS_EN = ["Considering Product A", "Considering Product B", "Considering Product C", "Information gathering", "Other"]
Q2_OPTS = ["直ぐにでも", "3か月以内", "1年以内", "検討中だが時期未定", "導入予定なし"]
Q2_OPTS_EN = ["Immediately", "Within 3 months", "Within 1 year", "Under consideration (timing TBD)", "No plans to adopt"]
Q3_ROWS = ["導入のコスト", "維持管理のコスト", "導入までのスピード", "導入による業務効率化", "他システムとの連携", "アフターフォロー"]
Q3_ROWS_EN = ["Initial cost", "Maintenance cost", "Speed of deployment", "Operational efficiency", "Integration with other systems", "After-sales support"]
Q3_COLS = ["非常に重要視している", "重要視している", "確認・比較はしている", "あまり重要としていない"]
Q3_COLS_EN = ["Extremely important", "Important", "Reviewing and comparing", "Not very important"]
Q4_OPTS = ["営業担当からの説明・ご提案", "お見積り", "デモ・テスト導入", "その他", "案内を希望しない"]
Q4_OPTS_EN = ["Explanation and proposal from sales", "Quotation", "Demo / trial deployment", "Other", "No follow-up desired"]


def build_survey_def():
    def opts(ja_list, en_list):
        return [{"value": ja, "text": {"ja": ja, "en": en}} for ja, en in zip(ja_list, en_list)]

    return {
        "id": SURVEY_ID,
        "groupId": "group_marketing",
        "name": {
            "ja": "【サンプル】ABC展示会来場者アンケート",
            "en": "[Sample] ABC Exhibition Visitor Survey"
        },
        "status": "完了",
        "answerCount": TOTAL,
        "periodStart": "2026-06-15",
        "periodEnd": "2026-06-17",
        "plan": "Premium",
        "details": [
            {
                "id": "Q1",
                "text": {
                    "ja": "弊社ブースにお立ち寄り頂いた目的をお選びください（複数選択可）",
                    "en": "Why did you visit our booth? (multiple answers allowed)"
                },
                "type": "multi_choice",
                "required": True,
                "options": opts(Q1_OPTS, Q1_OPTS_EN)
            },
            {
                "id": "Q2",
                "text": {
                    "ja": "導入を予定されている時期をお選びください",
                    "en": "When do you plan to adopt?"
                },
                "type": "single_choice",
                "required": True,
                "options": opts(Q2_OPTS, Q2_OPTS_EN)
            },
            {
                "id": "Q3",
                "text": {
                    "ja": "導入のご検討にあたり重要視しているポイントをお知らせください",
                    "en": "What do you consider important when evaluating adoption?"
                },
                "type": "matrix_sa",
                "required": True,
                "rows": [
                    {"id": f"r{i + 1}", "text": {"ja": ja, "en": en}}
                    for i, (ja, en) in enumerate(zip(Q3_ROWS, Q3_ROWS_EN))
                ],
                "options": [
                    {"value": str(i + 1), "text": {"ja": ja, "en": en}}
                    for i, (ja, en) in enumerate(zip(Q3_COLS, Q3_COLS_EN))
                ]
            },
            {
                "id": "Q4",
                "text": {
                    "ja": "弊社からご案内する希望の情報をお選びください（複数選択可）",
                    "en": "What information would you like from us? (multiple answers allowed)"
                },
                "type": "multi_choice",
                "required": True,
                "options": opts(Q4_OPTS, Q4_OPTS_EN)
            },
            {
                "id": "Q5",
                "text": {
                    "ja": "その他、ご意見・ご要望があれば、ご記入ください",
                    "en": "Please share any other comments or requests"
                },
                "type": "free_text",
                "required": False
            }
        ],
        "displayTitle": {
            "ja": "ABC展示会ご来場者様アンケート",
            "en": "ABC Exhibition Visitor Survey"
        },
        "description": {
            "ja": "ご来場いただき、ありがとうございました。アンケートへのご協力をよろしくお願い致します。",
            "en": "Thank you for visiting. We appreciate your cooperation with this survey."
        },
        "memo": "dev環境 questionnaire_answer?id=582 と同構成のダミーデータ検証用アンケートです。",
        "realtimeAnswers": 0,
        "deadline": "2026-09-30",
        "downloadDeadline": "2026-09-30",
        "dataCompletionDate": "2026-06-19",
        "dataCompletionFlag": True,
        "bizcardEnabled": True,
        "bizcardRequest": 300,
        "bizcardCompletionCount": CASE_BOTH + CASE_FRONT,
        "bypassDownloadDeadline": True,
        "dataConversionPlan": "standard",
        "thankYouEmailSettings": "自動送信",
        "estimatedBillingAmount": (CASE_BOTH + CASE_FRONT) * 330,
        "bizcardSettings": {
            "bizcardEnabled": True,
            "bizcardRequest": 300,
            "dataConversionPlan": "standard",
            "internalMemo": "ABC展示会サンプル用の名刺データ化設定です。"
        }
    }


# ---------------------------------------------------------------------------
# 架空人物・会社プール
# ---------------------------------------------------------------------------

SURNAMES = [
    ("相沢", "Aizawa"), ("青木", "Aoki"), ("浅倉", "Asakura"), ("井川", "Ikawa"),
    ("石橋", "Ishibashi"), ("岩瀬", "Iwase"), ("上田", "Ueda"), ("遠藤", "Endo"),
    ("大川", "Okawa"), ("岡部", "Okabe"), ("小野寺", "Onodera"), ("柏木", "Kashiwagi"),
    ("片岡", "Kataoka"), ("川島", "Kawashima"), ("神田", "Kanda"), ("北村", "Kitamura"),
    ("久保田", "Kubota"), ("栗原", "Kurihara"), ("小泉", "Koizumi"), ("児玉", "Kodama"),
    ("斎木", "Saiki"), ("坂上", "Sakagami"), ("笹本", "Sasamoto"), ("澤村", "Sawamura"),
    ("篠田", "Shinoda"), ("柴崎", "Shibasaki"), ("白石", "Shiraishi"), ("菅野", "Sugano"),
    ("瀬川", "Segawa"), ("高森", "Takamori"), ("竹内", "Takeuchi"), ("立花", "Tachibana"),
    ("津田", "Tsuda"), ("寺岡", "Teraoka"), ("戸田", "Toda"), ("永井", "Nagai"),
    ("中西", "Nakanishi"), ("成瀬", "Naruse"), ("西村", "Nishimura"), ("野口", "Noguchi"),
    ("萩原", "Hagiwara"), ("長谷部", "Hasebe"), ("平野", "Hirano"), ("福島", "Fukushima"),
    ("藤本", "Fujimoto"), ("細川", "Hosokawa"), ("前田", "Maeda"), ("牧野", "Makino"),
    ("三浦", "Miura"), ("宮下", "Miyashita"), ("村上", "Murakami"), ("森田", "Morita"),
    ("矢野", "Yano"), ("山岸", "Yamagishi"), ("吉岡", "Yoshioka"), ("和田", "Wada"),
]

GIVEN_NAMES = [
    ("彰", "Akira"), ("敦子", "Atsuko"), ("郁夫", "Ikuo"), ("英治", "Eiji"),
    ("和奏", "Wakana"), ("香織", "Kaori"), ("一樹", "Kazuki"), ("清美", "Kiyomi"),
    ("圭介", "Keisuke"), ("恵子", "Keiko"), ("健吾", "Kengo"), ("沙織", "Saori"),
    ("俊介", "Shunsuke"), ("翔平", "Shohei"), ("翔子", "Shoko"), ("慎一", "Shinichi"),
    ("大輔", "Daisuke"), ("拓海", "Takumi"), ("千尋", "Chihiro"), ("哲也", "Tetsuya"),
    ("智子", "Tomoko"), ("直樹", "Naoki"), ("菜々美", "Nanami"), ("典子", "Noriko"),
    ("秀樹", "Hideki"), ("裕子", "Hiroko"), ("文哉", "Fumiya"), ("真央", "Mao"),
    ("正義", "Masayoshi"), ("美咲", "Misaki"), ("裕也", "Yuya"), ("優花", "Yuka"),
    ("洋平", "Yohei"), ("義昭", "Yoshiaki"), ("理沙", "Risa"), ("亮太", "Ryota"),
]

COMPANY_CORES = [
    ("アオゾラ精機", "Aozora Precision"), ("イスズミ電装", "Isuzumi Densou"),
    ("ウチダ計装", "Uchida Instruments"), ("エイコウ機工", "Eiko Machinery"),
    ("オリベ産業", "Oribe Industries"), ("カケハシ技研", "Kakehashi Giken"),
    ("キタホシ工業", "Kitahoshi Kogyo"), ("クレバス情報システム", "Crevasse Info Systems"),
    ("ケヤキ製作所", "Keyaki Works"), ("コハク電子", "Kohaku Electronics"),
    ("サンリツ機械", "Sanritsu Machinery"), ("シグマパーツ", "Sigma Parts"),
    ("スズカゼ空調", "Suzukaze HVAC"), ("セイリュウ金属", "Seiryu Metals"),
    ("ソラチ設備", "Sorachi Setsubi"), ("タチバナ樹脂", "Tachibana Resin"),
    ("ツバサ物流", "Tsubasa Logistics"), ("テクノハヤセ", "Techno Hayase"),
    ("トキワ計測", "Tokiwa Instruments"), ("ナルミ精密", "Narumi Precision"),
    ("ニシキ環境", "Nishiki Environment"), ("ヌマタ鋼業", "Numata Steel"),
    ("ネイロ通信", "Neiro Communications"), ("ノザワ電機", "Nozawa Electric"),
    ("ハクバ印刷", "Hakuba Printing"), ("ヒノデ化成", "Hinode Chemicals"),
    ("フタバ搬送", "Futaba Conveyors"), ("ヘイセイ工機", "Heisei Machine Tools"),
    ("ホシカワ製薬", "Hoshikawa Pharma"), ("マツカゼ建材", "Matsukaze Materials"),
    ("ミナモ水処理", "Minamo Water Tech"), ("ムサシ計器", "Musashi Meters"),
    ("メグロ電業", "Meguro Dengyo"), ("モリノ製函", "Morino Packaging"),
    ("ヤエス機材", "Yaesu Kizai"), ("ユウナギ商事", "Yunagi Trading"),
    ("ヨツバ油圧", "Yotsuba Hydraulics"), ("ワカバ食品機械", "Wakaba Food Machinery"),
    ("アカツキ溶接", "Akatsuki Welding"), ("イブキ断熱", "Ibuki Insulation"),
    ("カンナギ検査", "Kannagi Inspection"), ("サワラギ自動機", "Sawaragi Automation"),
    ("タカミネ照明", "Takamine Lighting"), ("ハルカゼ農機", "Harukaze Agri-Machines"),
    ("フジミ光学", "Fujimi Optics"), ("ミカヅキ精工", "Mikazuki Seiko"),
]

COMPANY_STYLES = [
    ("株式会社{c}", "{e} Co., Ltd."),
    ("{c}株式会社", "{e} Inc."),
    ("株式会社{c}ホールディングス", "{e} Holdings Co., Ltd."),
    ("{c}工業株式会社", "{e} Industrial Co., Ltd."),
]

DEPARTMENTS = [
    "営業部", "営業企画部", "生産技術部", "製造部", "品質保証部", "調達部",
    "情報システム部", "経営企画部", "総務部", "技術開発部", "設備管理部",
    "海外事業部", "第二営業部", "DX推進室",
]

POSITIONS = [
    ("部長", 6), ("次長", 4), ("課長", 12), ("係長", 10), ("主任", 18),
    ("リーダー", 8), ("担当", 25), ("マネージャー", 7), ("チーフ", 6),
    ("取締役", 2), ("代表取締役", 1), ("エンジニア", 8),
]

PREF_CITIES = [
    ("北海道", "札幌市中央区", "Sapporo, Hokkaido"),
    ("宮城県", "仙台市青葉区", "Sendai, Miyagi"),
    ("埼玉県", "さいたま市大宮区", "Saitama, Saitama"),
    ("千葉県", "千葉市美浜区", "Chiba, Chiba"),
    ("東京都", "千代田区", "Chiyoda-ku, Tokyo"),
    ("東京都", "港区", "Minato-ku, Tokyo"),
    ("東京都", "江東区", "Koto-ku, Tokyo"),
    ("東京都", "大田区", "Ota-ku, Tokyo"),
    ("東京都", "八王子市", "Hachioji, Tokyo"),
    ("神奈川県", "横浜市西区", "Yokohama, Kanagawa"),
    ("神奈川県", "川崎市幸区", "Kawasaki, Kanagawa"),
    ("新潟県", "新潟市中央区", "Niigata, Niigata"),
    ("長野県", "松本市", "Matsumoto, Nagano"),
    ("静岡県", "浜松市中区", "Hamamatsu, Shizuoka"),
    ("愛知県", "名古屋市中村区", "Nagoya, Aichi"),
    ("愛知県", "豊田市", "Toyota, Aichi"),
    ("京都府", "京都市下京区", "Kyoto, Kyoto"),
    ("大阪府", "大阪市北区", "Osaka, Osaka"),
    ("大阪府", "東大阪市", "Higashi-Osaka, Osaka"),
    ("兵庫県", "神戸市中央区", "Kobe, Hyogo"),
    ("広島県", "広島市中区", "Hiroshima, Hiroshima"),
    ("香川県", "高松市", "Takamatsu, Kagawa"),
    ("福岡県", "福岡市博多区", "Fukuoka, Fukuoka"),
    ("熊本県", "熊本市中央区", "Kumamoto, Kumamoto"),
]

TOWNS = [
    "栄町", "旭町", "本町", "緑が丘", "港南", "白金台町", "扇町", "曙町", "若葉台",
    "桜堤", "新開町", "浜見平", "千歳町", "藤棚町", "楠木町", "汐入町", "柳原町", "駒形町",
]

BUILDINGS = ["第一", "中央", "パーク", "ステーション", "リバーサイド", "グリーン", "サンライズ", "ベイ"]

TAGLINES = [
    ("ものづくりの現場に、確かな技術を。", "Reliable engineering for the factory floor."),
    ("次の50年を支える製品づくり。", "Building products for the next 50 years."),
    ("現場の声から生まれる改善提案。", "Improvements born from the shop floor."),
    ("計測と制御で、品質をかたちに。", "Quality through measurement and control."),
    ("地域とともに歩む技術商社。", "A technology partner rooted in the community."),
]

SERVICES = [
    "産業機械の設計・製造", "生産ライン自動化の受託開発", "計測機器の販売・校正",
    "保守メンテナンスサービス", "省エネ設備のコンサルティング", "制御盤の設計・製作",
    "治具・専用機の製作", "部品加工・表面処理", "設備据付・移設工事",
]

Q5_COMMENTS = [
    "ブースの説明が分かりやすかったです。資料を社内で共有します。",
    "製品Aのデモが印象的でした。価格表を送ってもらえると助かります。",
    "導入事例をもう少し詳しく知りたいです。特に同業種の事例があれば。",
    "既存システムとの連携可否について、後日詳しくお聞きしたいです。",
    "保守対応の範囲と費用感を教えてください。",
    "他社製品と比較検討中です。優位性が分かる資料が欲しいです。",
    "説明員の対応が丁寧で好印象でした。",
    "現場担当者にも見せたいので、動画資料などがあれば案内してください。",
    "小規模拠点向けのプランがあるか知りたいです。",
    "納期の目安を教えていただけると社内稟議を進めやすいです。",
    "展示されていた新型は当社の用途に合いそうです。仕様書を希望します。",
    "セミナーの開催予定があれば案内をお願いします。",
    "海外拠点への展開実績はありますか。",
    "トライアル導入の条件を確認したいです。",
    "カタログだけでは分からない運用面の話が聞けて良かったです。",
    "予算取りの参考にしたいので概算見積りをお願いします。",
    "サポート窓口の受付時間を教えてください。",
    "会場が混んでいてゆっくり聞けなかったので、改めて訪問説明を希望します。",
    "旧モデルからの移行パスがあるか気になっています。",
    "特になし",
]


def build_people(count):
    """架空人物を count 名生成する（氏名・所属の組合せは重複なし）。"""
    name_pairs = [(s, g) for s in SURNAMES for g in GIVEN_NAMES]
    rng.shuffle(name_pairs)
    name_pairs = name_pairs[:count]

    companies = []
    for i, (core_ja, core_en) in enumerate(COMPANY_CORES):
        style_ja, style_en = COMPANY_STYLES[i % len(COMPANY_STYLES)]
        pref, city, city_en = PREF_CITIES[i % len(PREF_CITIES)]
        town = TOWNS[i % len(TOWNS)]
        chome = f"{rng.randint(1, 5)}-{rng.randint(1, 20)}-{rng.randint(1, 15)}"
        domain = core_en.split()[0].lower().replace("-", "") + rng.choice([".example.com", ".example.jp"])
        companies.append({
            "nameJa": style_ja.format(c=core_ja),
            "nameEn": style_en.format(e=core_en),
            "postalCode": f"{rng.randint(100, 999):03d}-{rng.randint(0, 9999):04d}",
            "address1": f"{pref}{city}{town}{chome}",
            "addressEn": f"{chome} {town}, {city_en}, Japan",
            "building": rng.choice(BUILDINGS) + "ビル" if rng.random() < 0.5 else "",
            "domain": domain,
            "telPrefix": rng.choice(["03", "06", "052", "045", "011", "092", "022", "075", "082"]),
            "tagline": rng.choice(TAGLINES),
            "services": rng.sample(SERVICES, 3),
        })

    people = []
    for i, ((sur_ja, sur_en), (giv_ja, giv_en)) in enumerate(name_pairs):
        comp = companies[i % len(companies)]
        position = rng.choices([p for p, _ in POSITIONS], weights=[w for _, w in POSITIONS])[0]
        tel = f"{comp['telPrefix']}-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}"
        person = {
            "lastName": sur_ja, "firstName": giv_ja,
            "lastNameEn": sur_en, "firstNameEn": giv_en,
            "company": comp,
            "department": rng.choice(DEPARTMENTS) if rng.random() > 0.10 else "",
            "position": position if rng.random() > 0.15 else "",
            "email": f"{giv_en.lower()}.{sur_en.lower()}@{comp['domain']}",
            "tel1": tel,
            "fax": (tel[: tel.rfind("-")] + f"-{rng.randint(1000, 9999)}") if rng.random() < 0.45 else "",
            "mobile": f"0{rng.choice([70, 80, 90])}-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}" if rng.random() < 0.65 else "",
            "url": f"https://www.{comp['domain']}/" if rng.random() < 0.75 else "",
            "address2": (comp["building"] + f"{rng.randint(2, 12)}F") if comp["building"] else "",
        }
        people.append(person)
    return people


# ---------------------------------------------------------------------------
# 名刺画像
# ---------------------------------------------------------------------------

PALETTE = [
    (31, 78, 121), (21, 96, 77), (128, 57, 30), (72, 52, 117), (140, 108, 20),
    (33, 100, 116), (110, 44, 63), (52, 84, 46), (60, 64, 72), (0, 92, 111),
]

_font_cache = {}


def get_font(size, bold=False):
    key = (size, bold)
    if key not in _font_cache:
        candidates = (
            ["C:\\Windows\\Fonts\\meiryob.ttc", "C:\\Windows\\Fonts\\meiryo.ttc", "C:\\Windows\\Fonts\\msgothic.ttc"]
            if bold
            else ["C:\\Windows\\Fonts\\meiryo.ttc", "C:\\Windows\\Fonts\\msgothic.ttc"]
        )
        font = ImageFont.load_default()
        for path in candidates:
            if os.path.exists(path):
                font = ImageFont.truetype(path, size)
                break
        _font_cache[key] = font
    return _font_cache[key]


def contact_lines(p):
    lines = [f"〒{p['company']['postalCode']} {p['company']['address1']}" + (f" {p['address2']}" if p["address2"] else "")]
    tel = f"TEL {p['tel1']}"
    if p["fax"]:
        tel += f"  FAX {p['fax']}"
    lines.append(tel)
    if p["mobile"]:
        lines.append(f"Mobile {p['mobile']}")
    lines.append(f"E-mail {p['email']}")
    if p["url"]:
        lines.append(p["url"])
    return lines


def stable_hash(text):
    return zlib.crc32(text.encode("utf-8"))


def apply_sample_watermark(img):
    """サンプルデータであることを明示する斜めの「SAMPLE」透かしを重ねる。"""
    f = get_font(170, bold=True)
    probe = ImageDraw.Draw(img)
    tw = int(probe.textlength("SAMPLE", font=f))
    txt_layer = Image.new("RGBA", (tw + 40, 240), (0, 0, 0, 0))
    ImageDraw.Draw(txt_layer).text((20, 10), "SAMPLE", font=f, fill=(120, 120, 120, 80))
    rotated = txt_layer.rotate(25, expand=True, resample=Image.BICUBIC)
    base = img.convert("RGBA")
    base.alpha_composite(rotated, ((base.width - rotated.width) // 2, (base.height - rotated.height) // 2))
    return base.convert("RGB")


def draw_logo(draw, x, y, size, color, initials):
    shape = stable_hash(initials) % 3
    if shape == 0:
        draw.ellipse([x, y, x + size, y + size], fill=color)
    elif shape == 1:
        draw.rounded_rectangle([x, y, x + size, y + size], radius=size // 5, fill=color)
    else:
        draw.polygon([(x + size // 2, y), (x + size, y + size), (x, y + size)], fill=color)
    f = get_font(int(size * 0.42), bold=True)
    tw = draw.textlength(initials, font=f)
    ty = y + size * (0.42 if shape == 2 else 0.28)
    draw.text((x + (size - tw) / 2, ty), initials, font=f, fill=(255, 255, 255))


def initials_of(p):
    return (p["company"]["nameEn"][0] + p["lastNameEn"][0]).upper()


def draw_front(p, template):
    img = Image.new("RGB", (CARD_W, CARD_H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    accent = PALETTE[stable_hash(p["company"]["nameJa"]) % len(PALETTE)]
    name = f"{p['lastName']} {p['firstName']}"
    dept_pos = " ".join(x for x in (p["department"], p["position"]) if x)
    f_comp, f_name, f_small, f_tiny = get_font(44, True), get_font(72, True), get_font(30), get_font(26)

    if template == 0:  # 左揃えクラシック＋左端アクセントバー
        d.rectangle([0, 0, 22, CARD_H], fill=accent)
        d.text((70, 60), p["company"]["nameJa"], font=f_comp, fill=(20, 20, 20))
        d.text((70, 118), p["company"]["nameEn"], font=f_tiny, fill=(110, 110, 110))
        if dept_pos:
            d.text((70, 220), dept_pos, font=f_small, fill=(60, 60, 60))
        d.text((70, 265), name, font=f_name, fill=(0, 0, 0))
        draw_logo(d, CARD_W - 190, 55, 110, accent, initials_of(p))
        y = CARD_H - 60 - 36 * len(contact_lines(p))
        for line in contact_lines(p):
            d.text((70, y), line, font=f_tiny, fill=(70, 70, 70))
            y += 36
    elif template == 1:  # 上部カラーバンド
        d.rectangle([0, 0, CARD_W, 130], fill=accent)
        d.text((60, 38), p["company"]["nameJa"], font=f_comp, fill=(255, 255, 255))
        if dept_pos:
            d.text((60, 190), dept_pos, font=f_small, fill=(80, 80, 80))
        d.text((60, 240), name, font=f_name, fill=(20, 20, 20))
        d.text((60 + d.textlength(name, font=f_name) + 30, 288), f"{p['lastNameEn']} {p['firstNameEn']}", font=f_tiny, fill=(130, 130, 130))
        y = CARD_H - 55 - 34 * len(contact_lines(p))
        for line in contact_lines(p):
            d.text((60, y), line, font=f_tiny, fill=(80, 80, 80))
            y += 34
    elif template == 2:  # センター配置
        w = d.textlength(p["company"]["nameJa"], font=f_comp)
        d.text(((CARD_W - w) / 2, 70), p["company"]["nameJa"], font=f_comp, fill=accent)
        if dept_pos:
            w = d.textlength(dept_pos, font=f_small)
            d.text(((CARD_W - w) / 2, 205), dept_pos, font=f_small, fill=(90, 90, 90))
        w = d.textlength(name, font=f_name)
        d.text(((CARD_W - w) / 2, 255), name, font=f_name, fill=(0, 0, 0))
        d.line([CARD_W * 0.2, 380, CARD_W * 0.8, 380], fill=accent, width=3)
        y = 410
        for line in contact_lines(p):
            w = d.textlength(line, font=f_tiny)
            d.text(((CARD_W - w) / 2, y), line, font=f_tiny, fill=(80, 80, 80))
            y += 36
    else:  # 右側縦アクセント＋左テキスト
        d.rectangle([CARD_W - 150, 0, CARD_W, CARD_H], fill=tuple(min(255, c + 170) for c in accent))
        d.rectangle([CARD_W - 158, 0, CARD_W - 150, CARD_H], fill=accent)
        draw_logo(d, CARD_W - 128, CARD_H - 170, 100, accent, initials_of(p))
        d.text((60, 70), p["company"]["nameJa"], font=f_comp, fill=(20, 20, 20))
        if dept_pos:
            d.text((60, 200), dept_pos, font=f_small, fill=(70, 70, 70))
        d.text((60, 248), name, font=f_name, fill=(0, 0, 0))
        y = CARD_H - 60 - 34 * len(contact_lines(p))
        for line in contact_lines(p):
            d.text((60, y), line, font=f_tiny, fill=(70, 70, 70))
            y += 34
    return img


def draw_back(p, template):
    img = Image.new("RGB", (CARD_W, CARD_H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    accent = PALETTE[stable_hash(p["company"]["nameJa"]) % len(PALETTE)]
    comp = p["company"]
    f_comp, f_name, f_small, f_tiny = get_font(46, True), get_font(52, True), get_font(30), get_font(26)

    if template == 0:  # 英語面
        d.rectangle([0, CARD_H - 26, CARD_W, CARD_H], fill=accent)
        d.text((70, 70), comp["nameEn"], font=f_comp, fill=accent)
        d.text((70, 200), f"{p['firstNameEn']} {p['lastNameEn']}", font=f_name, fill=(20, 20, 20))
        pos_en = {"部長": "General Manager", "次長": "Deputy GM", "課長": "Manager", "係長": "Assistant Manager",
                  "主任": "Senior Staff", "リーダー": "Team Leader", "担当": "Staff", "マネージャー": "Manager",
                  "チーフ": "Chief", "取締役": "Director", "代表取締役": "President", "エンジニア": "Engineer"}.get(p["position"], "")
        if pos_en:
            d.text((70, 270), pos_en, font=f_small, fill=(90, 90, 90))
        lines = [comp["addressEn"], f"TEL +81-{p['tel1'][1:]}", f"E-mail {p['email']}"]
        if p["url"]:
            lines.append(p["url"])
        y = CARD_H - 80 - 36 * len(lines)
        for line in lines:
            d.text((70, y), line, font=f_tiny, fill=(80, 80, 80))
            y += 36
    elif template == 1:  # 事業内容面
        d.rectangle([0, 0, CARD_W, 90], fill=tuple(min(255, c + 185) for c in accent))
        d.text((60, 26), "事業内容", font=get_font(34, True), fill=accent)
        y = 140
        for s in comp["services"]:
            d.ellipse([64, y + 12, 78, y + 26], fill=accent)
            d.text((100, y), s, font=f_small, fill=(50, 50, 50))
            y += 62
        d.line([60, y + 10, CARD_W - 60, y + 10], fill=(200, 200, 200), width=2)
        d.text((60, y + 40), f"〒{comp['postalCode']} {comp['address1']}", font=f_tiny, fill=(90, 90, 90))
        if p["url"]:
            d.text((60, y + 80), p["url"], font=f_tiny, fill=(90, 90, 90))
    else:  # ロゴ面
        tint = tuple(min(255, c + 200) for c in accent)
        d.rectangle([0, 0, CARD_W, CARD_H], fill=tint)
        draw_logo(d, CARD_W // 2 - 80, 110, 160, accent, initials_of(p))
        w = d.textlength(comp["nameEn"], font=f_comp)
        d.text(((CARD_W - w) / 2, 320), comp["nameEn"], font=f_comp, fill=accent)
        tagline = comp["tagline"][0]
        w = d.textlength(tagline, font=f_small)
        d.text(((CARD_W - w) / 2, 420), tagline, font=f_small, fill=(90, 90, 90))
        if p["url"]:
            w = d.textlength(p["url"], font=f_tiny)
            d.text(((CARD_W - w) / 2, 500), p["url"], font=f_tiny, fill=(110, 110, 110))
    return img


# ---------------------------------------------------------------------------
# 回答生成
# ---------------------------------------------------------------------------

def gen_answer_details():
    q2 = rng.choices(Q2_OPTS, weights=[8, 15, 25, 35, 17])[0]

    if q2 == "導入予定なし":
        q1_pool = rng.choices([["情報収集"], ["情報収集", "その他"], ["その他"]], weights=[70, 15, 15])[0]
        q1 = list(q1_pool)
    else:
        products = [o for o in Q1_OPTS[:3]]
        picks = rng.sample(products, k=rng.choices([1, 2, 3], weights=[62, 30, 8])[0])
        if rng.random() < 0.45:
            picks.append("情報収集")
        if rng.random() < 0.06:
            picks.append("その他")
        q1 = [o for o in Q1_OPTS if o in picks]

    row_weights = [
        [45, 35, 15, 5],   # 導入のコスト
        [30, 40, 22, 8],   # 維持管理のコスト
        [15, 30, 35, 20],  # 導入までのスピード
        [40, 38, 16, 6],   # 導入による業務効率化
        [22, 30, 30, 18],  # 他システムとの連携
        [25, 35, 28, 12],  # アフターフォロー
    ]
    q3 = {f"r{i + 1}": rng.choices(["1", "2", "3", "4"], weights=w)[0] for i, w in enumerate(row_weights)}

    if q2 == "導入予定なし" and rng.random() < 0.6:
        q4 = ["案内を希望しない"]
    else:
        base = {"営業担当からの説明・ご提案": 45, "お見積り": 30, "デモ・テスト導入": 28, "その他": 5}
        picks = [o for o, w in base.items() if rng.random() * 100 < w]
        if not picks:
            picks = ["営業担当からの説明・ご提案"] if rng.random() < 0.7 else ["案内を希望しない"]
        q4 = [o for o in Q4_OPTS if o in picks]

    details = [
        {"questionId": "Q1", "answer": q1},
        {"questionId": "Q2", "answer": q2},
        {"questionId": "Q3", "answer": q3},
        {"questionId": "Q4", "answer": q4},
    ]
    if rng.random() < 0.4:
        details.append({"questionId": "Q5", "answer": rng.choice(Q5_COMMENTS)})
    return details


def gen_answered_at_list(count):
    """会期(6/15〜6/17・SPDAD2026-174 §3)のJST日中に分散したUTC時刻を昇順で返す。"""
    stamps = []
    for _ in range(count):
        # randint(1,17)の呼び出しを維持したまま15〜17へ順序保存で圧縮する。
        # 乱数の消費パターンを変えると人物・回答内容・画像の生成結果まで変わるため。
        day = 15 + (rng.randint(1, 17) - 1) * 3 // 17
        # JST 9:30〜17:30 ≒ UTC 0:30〜8:30
        minute_of_day = rng.randint(30, 8 * 60 + 30)
        h, m = divmod(minute_of_day, 60)
        stamps.append(f"2026-06-{day:02d}T{h:02d}:{m:02d}:{rng.randint(0, 59):02d}Z")
    stamps.sort()
    return stamps


# ---------------------------------------------------------------------------
# core/surveys.json 更新
# ---------------------------------------------------------------------------

def update_core_surveys(entry):
    original = CORE_SURVEYS_PATH.read_text(encoding="utf-8")
    surveys = json.loads(original)
    surveys = [s for s in surveys if s.get("id") != SURVEY_ID]

    # 既存フォーマット(indent=2)と同一に再現できるかを検証してから書く
    roundtrip = json.dumps(json.loads(original), ensure_ascii=False, indent=2) + "\n"
    if roundtrip != original:
        raise SystemExit(
            "data/core/surveys.json の整形が indent=2 ラウンドトリップと一致しません。"
            "差分ノイズを避けるため停止しました。手動で追記してください。"
        )
    surveys.append(entry)
    CORE_SURVEYS_PATH.write_text(json.dumps(surveys, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    cases = ["both"] * CASE_BOTH + ["front"] * CASE_FRONT + ["none"] * CASE_NONE
    rng.shuffle(cases)

    people = build_people(CASE_BOTH + CASE_FRONT)
    stamps = gen_answered_at_list(TOTAL)

    if BIZCARD_DIR.exists():
        shutil.rmtree(BIZCARD_DIR)
    BIZCARD_DIR.mkdir(parents=True)

    answers = []
    bizcards = []
    person_idx = 0
    for i in range(1, TOTAL + 1):
        answer_id = f"ans-{SURVEY_ID}-{i:05d}"
        answers.append({
            "answerId": answer_id,
            "surveyId": SURVEY_ID,
            "answeredAt": stamps[i - 1],
            "details": gen_answer_details(),
        })

        case = cases[i - 1]
        if case == "none":
            continue

        p = people[person_idx]
        person_idx += 1

        front_name = f"{SURVEY_ID}_{i:04d}_1.jpg"
        apply_sample_watermark(draw_front(p, person_idx % 4)).save(BIZCARD_DIR / front_name, quality=82)
        back_name = ""
        if case == "both":
            back_name = f"{SURVEY_ID}_{i:04d}_2.jpg"
            apply_sample_watermark(draw_back(p, person_idx % 3)).save(BIZCARD_DIR / back_name, quality=82)

        bizcards.append({
            "answerId": answer_id,
            "businessCard": {
                "group1": {"email": p["email"]},
                "group2": {"lastName": p["lastName"], "firstName": p["firstName"]},
                "group3": {"companyName": p["company"]["nameJa"], "department": p["department"], "position": p["position"]},
                "group4": {"postalCode": p["company"]["postalCode"], "address1": p["company"]["address1"], "address2": p["address2"]},
                "group5": {"mobile": p["mobile"], "tel1": p["tel1"], "fax": p["fax"]},
                "group6": {"url": p["url"]},
                "status": "done",
                "imageUrl": {
                    "front": f"../media/generated/{SURVEY_ID}/bizcard/{front_name}",
                    "back": f"../media/generated/{SURVEY_ID}/bizcard/{back_name}" if back_name else "",
                },
            },
        })

    ANSWERS_PATH.write_text(
        json.dumps({"surveyId": SURVEY_ID, "answers": answers}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    BIZCARDS_PATH.write_text(json.dumps(bizcards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    survey_def = build_survey_def()
    SURVEY_DEF_PATH.write_text(json.dumps(survey_def, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_core_surveys(survey_def)

    n_front_only = sum(1 for c in cases if c == "front")
    n_both = sum(1 for c in cases if c == "both")
    n_none = sum(1 for c in cases if c == "none")
    n_images = len(list(BIZCARD_DIR.glob("*.jpg")))
    print(f"answers: {len(answers)} (両面 {n_both} / 表面のみ {n_front_only} / 名刺なし {n_none})")
    print(f"bizcard records: {len(bizcards)}")
    print(f"images: {n_images} -> {BIZCARD_DIR}")
    print(f"written: {ANSWERS_PATH}")
    print(f"written: {BIZCARDS_PATH}")
    print(f"written: {SURVEY_DEF_PATH}")
    print(f"updated: {CORE_SURVEYS_PATH}")


if __name__ == "__main__":
    main()

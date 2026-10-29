"""Generate synthetic Vietnamese transaction datasets with isolated splits.

Outputs (all fully synthetic, no real user data):
    data/training_data.csv          train + validation rows (legacy path)
    data/training/train.csv         training split
    data/validation/validation.csv  validation split (threshold + hyper-parameters)
    data/evaluation/test.csv        held-out template groups (independent test)
    data/evaluation/paraphrase.csv       separate template bank (paraphrase set)
    data/dataset_metadata.json      seeds, counts and SHA-256 fingerprints

Splitting rules
---------------
* The core bank is split by whole template group into train/validation/test, so
  a phrasing never appears in more than one split.
* The paraphrase set is generated from a *separate* template bank and seed; it is
  reported separately and is never used for tuning or for the headline claim.
* Exact duplicates (normalised) are dropped inside a split and across splits.

Usage:
    python apps/ai-service/scripts/generate_dataset.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
GENERATOR_VERSION = "synthetic-v2"
TRAIN_SEED = 20261029
EVAL_SEED = 20261030

# ---------------------------------------------------------------------------
# Training template bank (same phrasings as the original dataset, so existing
# behaviour and the previous baseline remain comparable).
# ---------------------------------------------------------------------------
TEMPLATES: dict[str, list[str]] = {
    "food": [
        "ăn sáng {food}",
        "cà phê {brand}",
        "cơm trưa {place}",
        "đi chợ {market} mua đồ ăn",
        "trà sữa {brand}",
        "ship đồ ăn qua {app}",
        "bánh mì {place}",
        "buffet tối {brand}",
        "ăn nhậu với bạn ở {place}",
        "mua trái cây {market}",
        "đặt pizza {app}",
        "ăn phở {place}",
        "uống bia ở quán {place}",
        "mua rau củ quả ở {market}",
        "tiệc sinh nhật ở nhà hàng",
        "ăn vặt ngoài đường",
        "đồ ăn nhanh {brand}",
        "gọi cơm giao tận nơi",
        "mua thực phẩm ở siêu thị",
        "ăn sáng xôi mặn",
    ],
    "transport": [
        "đổ xăng {station}",
        "grab bike đi làm",
        "be car ra sân bay",
        "mua vé xe buýt tháng",
        "gửi xe {place}",
        "thay nhớt xe máy {station}",
        "rửa xe máy",
        "vé tàu đi {destination}",
        "taxi {brand}",
        "sửa xe đạp",
        "nạp tiền xe bus",
        "phí cầu đường {destination}",
        "đặt xe công nghệ đi làm",
        "vé máy bay đi {destination}",
        "đi xe khách về quê",
        "bảo dưỡng xe máy",
        "mua xăng xe",
        "phí đỗ xe",
    ],
    "shopping": [
        "mua áo {brand}",
        "quần jeans đặt trên shopee",
        "mua giày {brand}",
        "mỹ phẩm {brand}",
        "mua điện thoại mới",
        "tai nghe bluetooth",
        "mua đồ gia dụng",
        "đơn hàng lazada {code}",
        "mua quà tặng sinh nhật",
        "mua vali du lịch",
        "mua đồ chơi cho em bé",
        "đặt hàng tiki {code}",
        "mua túi xách hàng hiệu",
        "mua đồng hồ đeo tay",
        "mua nước hoa",
        "mua sắm online",
        "mua quần áo mới",
        "mua đồ điện tử",
    ],
    "housing": [
        "tiền thuê nhà tháng {n}",
        "tiền điện tháng {n}",
        "tiền nước tháng {n}",
        "cước internet wifi",
        "phí quản lý chung cư",
        "sửa ống nước",
        "mua nội thất phòng khách",
        "đổi bình gas",
        "dịch vụ vệ sinh nhà",
        "tiền rác tháng {n}",
        "sơn lại tường nhà",
        "mua máy lọc nước",
        "tiền nhà hàng tháng",
        "hóa đơn điện nước",
        "sửa máy điều hòa",
        "phí sinh hoạt gia đình",
    ],
    "health": [
        "mua thuốc {pharmacy}",
        "khám bệnh {hospital}",
        "đi nha sĩ",
        "xét nghiệm máu",
        "đóng bảo hiểm y tế",
        "phí tập gym tháng {n}",
        "mua vitamin",
        "khám sức khỏe định kỳ",
        "chữa răng khôn",
        "vật lý trị liệu",
        "mua khẩu trang",
        "tiêm phòng cúm",
        "mua thuốc bổ",
        "đi khám bác sĩ",
        "phí bảo hiểm sức khỏe",
        "mua nhiệt kế",
    ],
    "entertainment": [
        "vé xem phim {place}",
        "phí thuê bao netflix",
        "spotify premium",
        "vé concert {brand}",
        "du lịch {destination}",
        "karaoke cuối tuần",
        "nạp game online",
        "công viên giải trí",
        "bar beer với bạn",
        "chơi bowling",
        "thuê phòng xem bóng đá",
        "mua truyện tranh",
        "vé tham quan bảo tàng",
        "đặt phòng khách sạn đi du lịch",
        "mua vé xem ca nhạc",
        "chơi game ở quán net",
    ],
    "education": [
        "học phí khóa {subject}",
        "mua sách {subject}",
        "khóa học online trên udemy",
        "tiền học thêm cho con",
        "lệ phí thi chứng chỉ",
        "mua văn phòng phẩm",
        "học tiếng anh trung tâm",
        "giáo trình đại học",
        "khóa lập trình {subject}",
        "thuê gia sư",
        "mua máy tính cho việc học",
        "lệ phí nhập học",
        "đóng học phí cho con",
        "mua sách giáo khoa",
        "khóa đào tạo nghề",
        "phí thi tiếng anh ielts",
    ],
    "transfer_fee": [
        "phí chuyển khoản ngân hàng",
        "phí rút tiền atm",
        "phí giao dịch ngân hàng",
        "phí thường niên thẻ tín dụng",
        "phí chuyển tiền quốc tế",
        "phí duy trì tài khoản",
        "phí chuyển khoản nhanh 247",
        "phí quản lý thẻ",
        "phí dịch vụ chuyển tiền",
        "phí sms banking",
        "phí napas",
        "phí rút tiền mặt",
    ],
    "other": [
        "chi tiêu linh tinh",
        "quỹ đen",
        "ủng hộ từ thiện",
        "cúng giỗ",
        "mua đồ không rõ loại",
        "phí phát sinh",
        "đám cưới phong bì",
        "mừng tuổi",
        "đóng quỹ lớp",
        "chi phí không ghi chú",
        "tiền lì xì",
        "đóng góp quỹ từ thiện",
        "chi khác",
        "mua đồ lặt vặt",
    ],
    "salary": [
        "lương tháng {n}",
        "nhận lương công ty {brand}",
        "thưởng dự án",
        "thưởng tết",
        "lương chuyển khoản",
        "thanh toán lương tháng {n}",
        "thưởng hiệu suất quý",
        "phụ cấp làm thêm",
        "lương part time",
        "thu nhập từ công việc chính",
        "lương cơ bản",
        "thưởng nóng",
        "thu nhập lương tháng",
        "tiền lương công ty trả",
    ],
    "income_other": [
        "bán đồ cũ",
        "được tặng tiền",
        "hoàn tiền shopee",
        "lãi tiết kiệm ngân hàng",
        "cổ tức cổ phiếu",
        "thu nhập freelance",
        "trúng xổ số",
        "cho thuê nhà",
        "bồi thường bảo hiểm",
        "bán cổ phiếu",
        "nhận tiền chuyển khoản từ bạn",
        "tiền thưởng ngoài lương",
        "bán hàng online",
        "thu nhập ngoài giờ",
    ],
}

POOLS: dict[str, list[str]] = {
    "food": ["phở bò", "bún chả", "cơm tấm", "mì quảng", "bánh cuốn", "xôi gà"],
    "brand": ["highlands", "starbucks", "phúc long", "katinat", "the coffee house"],
    "place": ["quán gần nhà", "căn tin công ty", "nhà hàng trung tâm", "quán hải sản"],
    "market": ["chợ bến thành", "chợ thái bình", "siêu thị coopmart", "winmart"],
    "app": ["grabfood", "shopeefood", "befood", "giao hàng tiết kiệm"],
    "station": ["petrolimex", "pv oil", "cây xăng đầu ngõ"],
    "destination": ["đà lạt", "nha trang", "hà nội", "sài gòn", "đà nẵng"],
    "code": ["SP123", "LD9981", "TK2026", "OD776"],
    "n": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    "pharmacy": ["nhà thuốc long châu", "pharmacity", "nhà thuốc gần nhà"],
    "hospital": ["bệnh viện đại học y", "phòng khám gia đình", "bệnh viện chợ rẫy"],
    "subject": ["tiếng anh", "python", "toán", "thiết kế", "kế toán", "marketing"],
}

# ---------------------------------------------------------------------------
# Independent evaluation bank. Phrasings are deliberately different from the
# training bank, and slots use different values, to reduce template leakage.
# ---------------------------------------------------------------------------
EVAL_TEMPLATES: dict[str, list[str]] = {
    "food": [
        "ăn lẩu gia đình cuối tuần",
        "mua cà phê mang đi ở {eval_shop}",
        "đặt sushi giao tận nhà",
        "ăn bún bò ở {eval_place}",
        "mua bánh ngọt ở tiệm",
        "uống nước ép trái cây",
        "ăn tối ở quán nướng",
        "mua hạt dinh dưỡng",
        "gọi trà sữa size lớn",
        "ăn sáng bánh xèo",
    ],
    "transport": [
        "đi taxi từ sân bay về nhà",
        "mua vé tàu điện",
        "đổ dầu xe tải",
        "thuê xe máy đi du lịch",
        "phí gửi xe ở trung tâm thương mại",
        "bắt xe ôm công nghệ",
        "mua lốp xe mới",
        "đi xe buýt tuyến số 5",
        "sửa phanh xe đạp",
        "mua vé phà",
    ],
    "shopping": [
        "mua áo khoác mùa đông",
        "đặt son môi trên mạng",
        "mua máy ảnh cũ",
        "mua balo đi học",
        "đơn hàng mỹ phẩm",
        "mua đồng hồ thông minh",
        "mua giày chạy bộ",
        "mua quần áo cho con",
        "mua đồ trang trí nhà",
        "mua sạc dự phòng",
    ],
    "housing": [
        "đóng tiền nhà tháng này",
        "hóa đơn điện sinh hoạt",
        "tiền nước sinh hoạt",
        "lắp mạng internet cáp quang",
        "thay máy bơm nước",
        "mua bàn ghế phòng ăn",
        "phí chung cư hàng tháng",
        "sửa cửa nhà bị hỏng",
        "mua bình nóng lạnh",
        "dọn dẹp nhà cửa",
    ],
    "health": [
        "mua thuốc cảm cúm",
        "khám răng tại nha khoa",
        "mua bảo hiểm y tế tự nguyện",
        "đi vật lý trị liệu vai",
        "xét nghiệm máu tổng quát",
        "mua thuốc nhỏ mắt",
        "khám da liễu",
        "mua máy đo huyết áp",
        "tiêm vắc xin",
        "điều trị viêm họng",
    ],
    "entertainment": [
        "mua vé xem phim cuối tuần",
        "đăng ký gói netflix",
        "đi hát karaoke với đồng nghiệp",
        "mua vé công viên nước",
        "nạp tiền game mobile",
        "đặt tour du lịch",
        "thuê phòng hát",
        "mua vé xem bóng đá",
        "đi cà phê nhạc sống",
        "mua truyện tranh mới",
    ],
    "education": [
        "đóng học phí học kỳ",
        "mua sách tham khảo",
        "đăng ký khóa học tiếng nhật",
        "mua bút vở cho con",
        "lệ phí thi chứng chỉ tin học",
        "thuê gia sư toán",
        "mua laptop phục vụ học tập",
        "học phí mầm non",
        "mua tài liệu ôn thi",
        "khóa học kỹ năng mềm",
    ],
    "transfer_fee": [
        "phí chuyển tiền qua app",
        "phí rút tiền tại cây atm",
        "phí thường niên thẻ ghi nợ",
        "phí chuyển khoản liên ngân hàng",
        "phí duy trì tài khoản ngân hàng",
        "phí giao dịch quốc tế",
        "phí sms biến động số dư",
        "phí rút tiền mặt tại quầy",
        "phí mở thẻ tín dụng",
        "phí chuyển tiền nhanh",
    ],
    "other": [
        "chi tiêu không rõ mục đích",
        "ủng hộ quỹ từ thiện",
        "phong bì đám cưới",
        "mừng sinh nhật đồng nghiệp",
        "quỹ lớp đóng góp",
        "tiền cúng ông bà",
        "chi phí phát sinh ngoài dự kiến",
        "mua đồ linh tinh",
        "lì xì cho trẻ con",
        "đóng góp cộng đồng",
    ],
    "salary": [
        "nhận lương chuyển khoản tháng này",
        "công ty trả lương tháng 11",
        "thưởng cuối năm",
        "tiền lương làm thêm giờ",
        "thu nhập công việc chính",
        "lương thử việc",
        "thưởng doanh số quý",
        "phụ cấp ăn trưa",
        "lương theo hợp đồng",
        "nhận lương qua tài khoản",
    ],
    "income_other": [
        "bán điện thoại cũ",
        "nhận tiền hoàn từ shopee",
        "lãi gửi tiết kiệm",
        "cổ tức được chia",
        "thu nhập từ làm freelance",
        "bán quần áo cũ",
        "cho thuê phòng trọ",
        "nhận tiền bảo hiểm",
        "bán hàng qua mạng",
        "tiền lãi từ quỹ đầu tư",
    ],
}

EVAL_POOLS: dict[str, list[str]] = {
    "eval_shop": ["circle k", "family mart", "bách hóa xanh", "winmart"],
    "eval_place": ["quán bà tư", "nhà hàng sen", "quán ven đường", "tiệm cơm chay"],
    "eval_destination": ["huế", "quy nhơn", "phú quốc", "vũng tàu"],
    "eval_subject": ["tiếng nhật", "excel", "đồ họa", "data"],
    "eval_n": ["tháng này", "kỳ trước", "quý này", "năm nay"],
    "eval_person": ["đồng nghiệp", "bạn thân", "người thân", "hàng xóm"],
}

TYPE_BY_LABEL = {slug: ("INCOME" if slug in {"salary", "income_other"} else "EXPENSE") for slug in TEMPLATES}

# Label-neutral time markers used to create distinct surface forms of a template.
TRAIN_PREFIXES = [
    "",
    "hôm nay ",
    "sáng nay ",
    "chiều nay ",
    "tuần này ",
    "hôm qua ",
    "tuần trước ",
    "tháng này ",
]
EVAL_PREFIXES = ["", "hôm qua ", "sáng nay ", "tuần trước "]


def fill(template: str, pools: dict[str, list[str]], rng: random.Random) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return rng.choice(pools.get(key, ["misc"]))

    return re.sub(r"\{(\w+)\}", replace, template)


def remove_diacritics(text: str) -> str:
    """Simulate users typing Vietnamese without accents (common on phones)."""
    decomposed = unicodedata.normalize("NFD", text)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return without_marks.replace("đ", "d").replace("Đ", "D")


def normalize(text: str) -> str:
    """Exact duplicate key: case, spacing and punctuation folded, accents kept."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def normalize_loose(text: str) -> str:
    """Near-duplicate key: as above but accent-insensitive (for leakage reports)."""
    return normalize(remove_diacritics(text))


def stable_id(split: str, description: str) -> str:
    digest = hashlib.sha1(f"{split}:{normalize(description)}".encode("utf-8")).hexdigest()
    return f"{split[:3]}-{digest[:12]}"


def surface_variants(
    base: str, rng: random.Random, count: int, prefixes: list[str]
) -> list[str]:
    """Build distinct surface forms using a rotating time prefix and accent drops."""
    variants: list[str] = []
    for index in range(count):
        text = prefixes[index % len(prefixes)] + fill(base, POOLS, rng)
        roll = rng.random()
        variants.append(remove_diacritics(text) if roll < 0.25 else text)
    return variants


def assign_core_splits(groups: list[str]) -> dict[str, str]:
    """Assign whole groups per label to train/validation/test (~70/15/15)."""
    ordered = sorted(groups)
    total = len(ordered)
    if total < 3:
        return {group: "train" for group in ordered}
    wanted_validation = max(1, round(total * 0.15))
    wanted_test = max(1, round(total * 0.15))
    wanted = min(total - 1, wanted_validation + wanted_test)
    indices = sorted(
        {min(total - 1, ((2 * index + 1) * total) // (2 * wanted)) for index in range(wanted)}
    )
    split_by_group: dict[str, str] = {}
    for position, index in enumerate(indices):
        split_by_group[ordered[index]] = "validation" if position % 2 == 0 else "test"
    for group in ordered:
        split_by_group.setdefault(group, "train")
    return split_by_group


def build_core_rows(rng: random.Random) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for slug, templates in TEMPLATES.items():
        label_type = TYPE_BY_LABEL[slug]
        groups = [f"{slug}_{index}" for index in range(len(templates))]
        split_by_group = assign_core_splits(groups)
        for template_index, template in enumerate(templates):
            group = f"{slug}_{template_index}"
            split = split_by_group[group]
            for description in surface_variants(template, rng, 8, TRAIN_PREFIXES):
                key = normalize(description)
                if not key or key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "id": stable_id(split, description),
                        "description": description,
                        "label": slug,
                        "type": label_type,
                        "group": group,
                        "split": split,
                        "source": "synthetic-core",
                        "generator_version": GENERATOR_VERSION,
                    }
                )
    return rows


def build_paraphrase_rows(rng: random.Random) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for slug, templates in EVAL_TEMPLATES.items():
        label_type = TYPE_BY_LABEL[slug]
        for template_index, template in enumerate(templates):
            group = f"eval_{slug}_{template_index}"
            for index in range(4):
                description = EVAL_PREFIXES[index % len(EVAL_PREFIXES)] + fill(template, EVAL_POOLS, rng)
                if rng.random() < 0.25:
                    description = remove_diacritics(description)
                key = normalize(description)
                if not key or key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "id": stable_id("paraphrase", description),
                        "description": description,
                        "label": slug,
                        "type": label_type,
                        "group": group,
                        "split": "paraphrase",
                        "source": "synthetic-paraphrase",
                        "generator_version": GENERATOR_VERSION,
                    }
                )
    return rows


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows, key=lambda row: row["id"])
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(ordered)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    rng = random.Random(TRAIN_SEED)
    core_rows = build_core_rows(rng)
    paraphrase_rng = random.Random(EVAL_SEED)
    paraphrase_rows = build_paraphrase_rows(paraphrase_rng)

    # Global duplicate guard across every split.
    known: dict[str, str] = {}
    for row in core_rows + paraphrase_rows:
        key = normalize(row["description"])
        if key in known:
            raise SystemExit(
                f"Duplicate description across dataset: {row['description']!r} "
                f"({row['split']} vs {known[key]})"
            )
        known[key] = row["split"]

    fields = ["id", "description", "label", "type", "group", "split", "source", "generator_version"]
    train = [row for row in core_rows if row["split"] == "train"]
    validation = [row for row in core_rows if row["split"] == "validation"]
    test = [row for row in core_rows if row["split"] == "test"]
    train_and_validation = train + validation

    hashes = {
        "training_data.csv": write_csv(DATA_DIR / "training_data.csv", train_and_validation, fields),
        "training/train.csv": write_csv(DATA_DIR / "training" / "train.csv", train, fields),
        "validation/validation.csv": write_csv(
            DATA_DIR / "validation" / "validation.csv", validation, fields
        ),
        "evaluation/test.csv": write_csv(DATA_DIR / "evaluation" / "test.csv", test, fields),
        "evaluation/paraphrase.csv": write_csv(
            DATA_DIR / "evaluation" / "paraphrase.csv", paraphrase_rows, fields
        ),
    }
    metadata = {
        "datasetVersion": f"{GENERATOR_VERSION}-{datetime.now(timezone.utc).strftime('%Y%m%d')}",
        "generatorVersion": GENERATOR_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "seeds": {"core": TRAIN_SEED, "paraphrase": EVAL_SEED},
        "splits": {
            "train": len(train),
            "validation": len(validation),
            "test": len(test),
            "paraphrase": len(paraphrase_rows),
        },
        "files": hashes,
        "notes": (
            "Fully synthetic Vietnamese transaction descriptions. The core bank is split "
            "by whole template group into train/validation/test; the paraphrase set uses a "
            "separate template bank and seed and is reported separately."
        ),
    }
    (DATA_DIR / "dataset_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata["splits"], ensure_ascii=False))
    print(f"Wrote metadata to {DATA_DIR / 'dataset_metadata.json'}")


if __name__ == "__main__":
    main()


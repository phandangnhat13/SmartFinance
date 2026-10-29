"""Generate a synthetic Vietnamese transaction-description dataset.

The dataset is written to apps/ai-service/data/training_data.csv and is fully
synthetic: it contains no real user data. Each row carries a `group` column
(the template it came from) so that the training script can split by template
and avoid leaking the same phrasing into both train and test sets.

Usage:
    python apps/ai-service/scripts/generate_dataset.py
"""

from __future__ import annotations

import csv
import random
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "training_data.csv"

# Template groups per label. Several templates per label deliberately share
# domain vocabulary (phim, thuốc, lương, vé, ...) so that holding out a whole
# template still leaves useful signal in the training split.
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


def fill(template: str, rng: random.Random) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return rng.choice(POOLS.get(key, ["misc"]))

    return re.sub(r"\{(\w+)\}", replace, template)


def remove_diacritics(text: str) -> str:
    """Simulate users typing Vietnamese without accents (very common on phones)."""
    decomposed = unicodedata.normalize("NFD", text)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return without_marks.replace("đ", "d").replace("Đ", "D")


def main() -> None:
    rng = random.Random(20261029)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, str]] = []
    for slug, templates in TEMPLATES.items():
        label_type = "INCOME" if slug in {"salary", "income_other"} else "EXPENSE"
        for template_index, template in enumerate(templates):
            group = f"{slug}_{template_index}"
            # Several surface variants per template. Case and spacing variations
            # mimic how people type descriptions quickly.
            variants = [fill(template, rng) for _ in range(5)]
            for description in variants:
                surface = description
                roll = rng.random()
                if roll < 0.15:
                    surface = description.upper()
                elif roll < 0.3:
                    surface = description.replace(" ", "  ")
                rows.append(
                    {
                        "description": surface,
                        "label": slug,
                        "type": label_type,
                        "group": group,
                    }
                )
                # Accent-free copy of the same sentence, same group/variant.
                if rng.random() < 0.35:
                    rows.append(
                        {
                            "description": remove_diacritics(surface),
                            "label": slug,
                            "type": label_type,
                            "group": group,
                        }
                    )
    rng.shuffle(rows)
    with OUTPUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["description", "label", "type", "group"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUTPUT}")


if __name__ == "__main__":
    main()

"""Classification taxonomy shared with the NestJS API and the database.

Slugs are stable identifiers. System categories in PostgreSQL use the same
slugs, so the API can map a predicted label back to a legal category.
"""

TAXONOMY: dict[str, dict[str, str]] = {
    "food": {"name": "Ăn uống", "type": "EXPENSE"},
    "transport": {"name": "Di chuyển", "type": "EXPENSE"},
    "shopping": {"name": "Mua sắm", "type": "EXPENSE"},
    "housing": {"name": "Nhà ở", "type": "EXPENSE"},
    "health": {"name": "Sức khỏe", "type": "EXPENSE"},
    "entertainment": {"name": "Giải trí", "type": "EXPENSE"},
    "education": {"name": "Giáo dục", "type": "EXPENSE"},
    "transfer_fee": {"name": "Phí chuyển khoản", "type": "EXPENSE"},
    "other": {"name": "Khác", "type": "EXPENSE"},
    "salary": {"name": "Lương", "type": "INCOME"},
    "income_other": {"name": "Thu nhập khác", "type": "INCOME"},
}

LABELS: list[str] = list(TAXONOMY.keys())
INCOME_LABELS = [slug for slug, meta in TAXONOMY.items() if meta["type"] == "INCOME"]
EXPENSE_LABELS = [slug for slug, meta in TAXONOMY.items() if meta["type"] == "EXPENSE"]

# Selected on the validation split by scripts/evaluate_models.py (run
# 20261029T183303Z): highest coverage with selective accuracy >= 0.80.
# This is only a fallback; the model artifact stores its own threshold.
CONFIDENCE_THRESHOLD = 0.50

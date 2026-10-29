"""Validate the synthetic dataset splits before training/evaluation.

Checks:
* required columns and blank rows
* labels belong to the shared taxonomy and types match
* exact duplicates inside and across splits
* accent-insensitive near-duplicates across splits (reported as warnings)
* template-group leakage between splits
* class coverage and minimum support per split

Exit code 1 when an error is found; warnings do not fail the run.

Usage:
    python apps/ai-service/scripts/validate_dataset.py
"""

from __future__ import annotations

import csv
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
sys.path.insert(0, str(ROOT))

from app.taxonomy import TAXONOMY  # noqa: E402

FILES = {
    "train": DATA_DIR / "training" / "train.csv",
    "validation": DATA_DIR / "validation" / "validation.csv",
    "test": DATA_DIR / "evaluation" / "test.csv",
    "paraphrase": DATA_DIR / "evaluation" / "paraphrase.csv",
}
REQUIRED_COLUMNS = {"id", "description", "label", "type", "group", "split"}
MIN_PER_CLASS = 3


def normalize_exact(text: str) -> str:
    import re

    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def normalize_loose(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return normalize_exact(without_marks.replace("đ", "d").replace("Đ", "D"))


def keyword_tokens(text: str) -> set[str]:
    """Tokens used for the paraphrase lexical-overlap diagnostic."""
    return {token for token in normalize_loose(text).split() if len(token) >= 3}


def jaccard(left: set[str], right: set[str]) -> float:
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def load_split(name: str, path: Path) -> tuple[list[dict[str, str]], list[str]]:
    errors: list[str] = []
    if not path.exists():
        return [], [f"{name}: missing file {path}"]
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            return [], [f"{name}: missing columns {sorted(missing)}"]
        rows = list(reader)
    for line, row in enumerate(rows, start=2):
        if not row["description"].strip():
            errors.append(f"{name}:{line}: blank description")
        if not row["id"].strip():
            errors.append(f"{name}:{line}: blank id")
        if row["split"] != name:
            errors.append(f"{name}:{line}: split column is {row['split']!r}")
    return rows, errors


def main() -> int:
    taxonomy = {slug: meta["type"] for slug, meta in TAXONOMY.items()}
    splits: dict[str, list[dict[str, str]]] = {}
    errors: list[str] = []
    warnings: list[str] = []

    for name, path in FILES.items():
        rows, split_errors = load_split(name, path)
        splits[name] = rows
        errors.extend(split_errors)

    exact_seen: dict[str, str] = {}
    loose_seen: dict[str, str] = {}
    ids_seen: dict[str, str] = {}
    groups: defaultdict[str, set[str]] = defaultdict(set)
    distribution: dict[str, Counter[str]] = {}
    near_duplicate_warnings = 0

    for name, rows in splits.items():
        distribution[name] = Counter(row["label"] for row in rows)
        for row in rows:
            label = row["label"]
            if label not in taxonomy:
                errors.append(f"{name}: unknown label {label!r} in {row['id']}")
                continue
            if row["type"] != taxonomy[label]:
                errors.append(
                    f"{name}: type mismatch for {row['id']}: {row['type']} != {taxonomy[label]}"
                )
            previous_id = ids_seen.get(row["id"])
            if previous_id is not None:
                errors.append(f"duplicate id {row['id']!r} in {name} and {previous_id}")
            else:
                ids_seen[row["id"]] = name
            expected_prefix = f"{label}_" if name != "paraphrase" else f"eval_{label}_"
            if not row["group"].startswith(expected_prefix):
                warnings.append(
                    f"{name}: group {row['group']!r} does not match label {label!r}"
                )
            key = normalize_exact(row["description"])
            previous = exact_seen.get(key)
            if previous is not None:
                errors.append(f"duplicate description in {name} and {previous}: {row['description']!r}")
            else:
                exact_seen[key] = name
            loose_key = normalize_loose(row["description"])
            previous_loose = loose_seen.get(loose_key)
            if previous_loose is not None and previous_loose != name:
                near_duplicate_warnings += 1
                warnings.append(
                    f"accent-insensitive overlap between {name} and {previous_loose}: "
                    f"{row['description']!r}"
                )
            else:
                loose_seen[loose_key] = name
            groups[row["group"]].add(name)

    for group, group_splits in sorted(groups.items()):
        if len(group_splits) > 1:
            errors.append(f"group leakage: {group} appears in {sorted(group_splits)}")

    for name in ("train", "validation", "test", "paraphrase"):
        missing = sorted(set(taxonomy) - set(distribution[name]))
        if missing:
            errors.append(f"{name}: labels with no rows: {missing}")
        for label in sorted(taxonomy):
            count = distribution[name][label]
            if count < MIN_PER_CLASS:
                warnings.append(f"{name}: label {label} has only {count} rows")

    train_token_sets = [
        keyword_tokens(row["description"]) for row in splits.get("train", [])
    ]
    train_tokens: set[str] = set().union(*train_token_sets) if train_token_sets else set()
    paraphrase_rows = splits.get("paraphrase", [])
    overlap_rows = sum(
        1 for row in paraphrase_rows if keyword_tokens(row["description"]) & train_tokens
    )
    max_overlaps = [
        max(
            (jaccard(keyword_tokens(row["description"]), tokens) for tokens in train_token_sets),
            default=0.0,
        )
        for row in paraphrase_rows
    ]
    mean_overlap = (
        round(sum(max_overlaps) / len(max_overlaps), 4) if max_overlaps else None
    )
    above_05 = sum(1 for value in max_overlaps if value >= 0.5)
    above_08 = sum(1 for value in max_overlaps if value >= 0.8)

    report = {
        "ok": not errors,
        "splits": {name: len(rows) for name, rows in splits.items()},
        "distribution": {name: dict(sorted(counter.items())) for name, counter in distribution.items()},
        "checks": {
            "uniqueIds": len(ids_seen) == sum(len(rows) for rows in splits.values()),
            "duplicateDescriptions": sum(
                1 for error in errors if error.startswith("duplicate description")
            ),
            "nearDuplicateWarnings": near_duplicate_warnings,
            "groupLabelMismatches": sum(
                1 for warning in warnings if "does not match label" in warning
            ),
            "paraphraseLexicalOverlap": {
                "rows": len(paraphrase_rows),
                "rowsSharingTrainToken": overlap_rows,
                "share": round(overlap_rows / len(paraphrase_rows), 4) if paraphrase_rows else None,
                "meanMaxTokenJaccard": mean_overlap,
                "rowsWithMaxJaccardAtLeast05": above_05,
                "rowsWithMaxJaccardAtLeast08": above_08,
                "note": (
                    "informational: the paraphrase bank reuses everyday Vietnamese vocabulary "
                    "and is therefore not an out-of-distribution benchmark. Low Jaccard values "
                    "mean the wording is not copied; they do not prove semantic independence."
                ),
            },
        },
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


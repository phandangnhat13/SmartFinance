"""Dataset split integrity.

These tests run against the committed synthetic dataset, so a regeneration that
introduces leakage, duplicates or a missing class fails CI before training.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pytest

from scripts import validate_dataset

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SPLIT_FILES = {
    "train": DATA_DIR / "training" / "train.csv",
    "validation": DATA_DIR / "validation" / "validation.csv",
    "test": DATA_DIR / "evaluation" / "test.csv",
    "paraphrase": DATA_DIR / "evaluation" / "paraphrase.csv",
}


def test_all_splits_exist() -> None:
    for name, path in SPLIT_FILES.items():
        assert path.exists(), f"{name} split missing at {path}"
        assert path.stat().st_size > 0


def test_committed_dataset_passes_validation(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = validate_dataset.main()
    captured = capsys.readouterr().out
    report = json.loads(captured)
    assert exit_code == 0, report["errors"]
    assert report["ok"] is True
    assert report["splits"] == {"train": 992, "validation": 200, "test": 200, "paraphrase": 440}
    for name in SPLIT_FILES:
        assert len(report["distribution"][name]) == 11


def test_metadata_hashes_match_committed_files() -> None:
    metadata_path = DATA_DIR / "dataset_metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["splits"] == {"train": 992, "validation": 200, "test": 200, "paraphrase": 440}
    for relative, expected in metadata["files"].items():
        path = DATA_DIR / relative
        assert path.exists(), relative
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, relative


def test_load_split_reports_missing_columns(tmp_path: Path) -> None:
    path = tmp_path / "broken.csv"
    path.write_text("id,description\n1,hello\n", encoding="utf-8")
    rows, errors = validate_dataset.load_split("train", path)
    assert rows == []
    assert any("missing columns" in error for error in errors)


def test_load_split_flags_blank_rows_and_wrong_split(tmp_path: Path) -> None:
    path = tmp_path / "rows.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["id", "description", "label", "type", "group", "split"]
        )
        writer.writeheader()
        writer.writerow(
            {
                "id": "x1",
                "description": " ",
                "label": "food",
                "type": "EXPENSE",
                "group": "g1",
                "split": "validation",
            }
        )
    rows, errors = validate_dataset.load_split("train", path)
    assert len(rows) == 1
    assert any("blank description" in error for error in errors)
    assert any("split column" in error for error in errors)


def test_loose_normalisation_ignores_accents() -> None:
    assert validate_dataset.normalize_loose("Cà phê sáng") == validate_dataset.normalize_loose(
        "ca phe sang"
    )
    assert validate_dataset.normalize_exact("Cà phê  sáng") == validate_dataset.normalize_exact(
        "cà phê sáng"
    )
